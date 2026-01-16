import { Database } from "bun:sqlite";
import type { ChunkRecord, FileState, RetrievalFilters } from "../types";

export type StoredChunk = ChunkRecord & { embedding: number[] };

/**
 * Vector store contract consumed by the indexer and retriever. Alternate backends
 * (e.g., Chroma, LanceDB) can satisfy the same interface.
 */
export interface VectorStore {
  /** Returns the last-known state of every indexed file. */
  loadFileStates(): Record<string, FileState>;
  /** Fetches all stored chunks for a specific file path. */
  loadChunksByFile(filePath: string): Record<string, StoredChunk>;
  /** Inserts or updates chunk metadata + embeddings. */
  upsertChunks(chunks: StoredChunk[]): void;
  /** Deletes the provided chunk IDs across both vector + FTS tables. */
  deleteChunksByIds(chunkIds: string[]): void;
  /** Removes every chunk + file state record for the provided path. */
  deleteChunksForFile(filePath: string): void;
  /** Lists all stored chunks (used for vector scoring without ANN). */
  listAllChunks(): StoredChunk[];
  /** Performs lexical/BM25 search via FTS (if supported). */
  lexicalSearch(
    query: string,
    limit: number,
    filters?: RetrievalFilters,
  ): Array<{ chunk: StoredChunk; score: number }>;
  /** Returns every path currently tracked by the store. */
  listIndexedPaths(): string[];
  /** Closes any open handles/connections. */
  close(): void;
}

/**
 * Convenience factory that returns the default SQLite-backed store.
 */
export function createVectorStore(dbPath: string): VectorStore {
  return new SqliteVectorStore(dbPath);
}

/**
 * SQLite implementation that keeps embeddings, metadata, and lexical indexes
 * in the same file for portability.
 */
class SqliteVectorStore implements VectorStore {
  private database: Database;

  constructor(dbPath: string) {
    this.database = new Database(dbPath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        mtime INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        content_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        note_title TEXT NOT NULL,
        heading_path TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        chunk_type TEXT NOT NULL,
        tags TEXT NOT NULL,
        links TEXT NOT NULL,
        frontmatter TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        content TEXT NOT NULL,
        representation TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        embedding_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_file_path ON chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(chunk_type);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
        chunk_id UNINDEXED,
        content
      );
    `);
  }

  loadFileStates(): Record<string, FileState> {
    const rows = this.database
      .query("SELECT path, mtime, chunk_count, content_hash FROM files")
      .all() as Array<{
      path: string;
      mtime: number;
      chunk_count: number;
      content_hash: string;
    }>;
    const map: Record<string, FileState> = {};
    for (const row of rows) {
      map[row.path] = {
        mtime: row.mtime,
        chunkCount: row.chunk_count,
        contentHash: row.content_hash,
      };
    }
    return map;
  }

  loadChunksByFile(filePath: string): Record<string, StoredChunk> {
    const rows = this.database
      .query("SELECT * FROM chunks WHERE file_path = ?")
      .all(filePath) as ChunkRow[];
    return rows.reduce<Record<string, StoredChunk>>((record, row) => {
      record[row.chunk_id] = rowToChunk(row);
      return record;
    }, {});
  }

  upsertChunks(chunks: StoredChunk[]): void {
    const insertChunk = this.database.query(
      `INSERT INTO chunks(
        chunk_id, file_path, note_title, heading_path, ordinal, chunk_type,
        tags, links, frontmatter, mtime, content, representation, content_hash,
        tokens, embedding_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        note_title=excluded.note_title,
        heading_path=excluded.heading_path,
        ordinal=excluded.ordinal,
        chunk_type=excluded.chunk_type,
        tags=excluded.tags,
        links=excluded.links,
        frontmatter=excluded.frontmatter,
        mtime=excluded.mtime,
        content=excluded.content,
        representation=excluded.representation,
        content_hash=excluded.content_hash,
        tokens=excluded.tokens,
        embedding_json=excluded.embedding_json`,
    );
    const insertFts = this.database.query(
      "INSERT INTO chunk_fts(rowid, chunk_id, content) VALUES (?, ?, ?)",
    );
    const deleteFts = this.database.query(
      "DELETE FROM chunk_fts WHERE chunk_id = ?",
    );
    const updateFileState = this.database.query(
      `INSERT INTO files(path, mtime, chunk_count, content_hash)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         mtime=excluded.mtime,
         chunk_count=excluded.chunk_count,
         content_hash=excluded.content_hash`,
    );

    const chunksByFile = chunks.reduce<Record<string, StoredChunk[]>>(
      (groups, chunk) => {
        groups[chunk.filePath] ??= [];
        groups[chunk.filePath]?.push(chunk);
        return groups;
      },
      {},
    );

    this.database.transaction(() => {
      for (const chunk of chunks) {
        insertChunk.run(
          chunk.chunkId,
          chunk.filePath,
          chunk.noteTitle,
          JSON.stringify(chunk.headingPath),
          chunk.ordinal,
          chunk.chunkType,
          JSON.stringify(chunk.tags),
          JSON.stringify(chunk.links),
          JSON.stringify(chunk.frontmatter),
          chunk.mtime,
          chunk.content,
          chunk.representation,
          chunk.contentHash,
          chunk.tokens,
          JSON.stringify(chunk.embedding),
        );
        deleteFts.run(chunk.chunkId);
        insertFts.run(null, chunk.chunkId, chunk.content);
      }
      for (const [filePath, fileChunks] of Object.entries(chunksByFile)) {
        const latestMtime = Math.max(...fileChunks.map((chunk) => chunk.mtime));
        const fileHash = fileChunks.map((chunk) => chunk.contentHash).join(":");
        updateFileState.run(filePath, latestMtime, fileChunks.length, fileHash);
      }
    })();
  }

  deleteChunksByIds(chunkIds: string[]): void {
    const deleteChunk = this.database.query(
      "DELETE FROM chunks WHERE chunk_id = ?",
    );
    const deleteFts = this.database.query(
      "DELETE FROM chunk_fts WHERE chunk_id = ?",
    );
    this.database.transaction(() => {
      for (const chunkId of chunkIds) {
        deleteChunk.run(chunkId);
        deleteFts.run(chunkId);
      }
    })();
  }

  deleteChunksForFile(filePath: string): void {
    const chunkIds = this.database
      .query("SELECT chunk_id FROM chunks WHERE file_path = ?")
      .all(filePath) as Array<{ chunk_id: string }>;
    this.deleteChunksByIds(chunkIds.map((row) => row.chunk_id));
    this.database.query("DELETE FROM files WHERE path = ?").run(filePath);
  }

  listAllChunks(): StoredChunk[] {
    const rows = this.database
      .query("SELECT * FROM chunks")
      .all() as ChunkRow[];
    return rows.map(rowToChunk);
  }

  lexicalSearch(
    query: string,
    limit: number,
    filters?: RetrievalFilters,
  ): Array<{ chunk: StoredChunk; score: number }> {
    if (!query.trim()) return [];
    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery) return [];
    let rows: Array<{ chunk_id: string; score: number }> = [];
    try {
      rows = this.database
        .query(
          `SELECT chunk_id, bm25(chunk_fts) AS score
           FROM chunk_fts
           WHERE chunk_fts MATCH ?
           ORDER BY score
           LIMIT ?`,
        )
        .all(ftsQuery, limit) as Array<{ chunk_id: string; score: number }>;
    } catch {
      return [];
    }
    if (rows.length === 0) return [];
    const chunkIds = rows.map((row) => row.chunk_id);
    const placeholders = chunkIds.map(() => "?").join(",");
    const chunkRows = this.database
      .query(`SELECT * FROM chunks WHERE chunk_id IN (${placeholders})`)
      .all(...chunkIds) as ChunkRow[];
    const chunkMap = new Map(chunkRows.map((row) => [row.chunk_id, row]));
    const filtered: Array<{ chunk: StoredChunk; score: number }> = [];
    for (const { chunk_id, score } of rows) {
      const row = chunkMap.get(chunk_id);
      if (!row) continue;
      const chunk = rowToChunk(row);
      if (filters && !matchesFilters(chunk, filters)) continue;
      filtered.push({ chunk, score: 1 / (score + 1) });
    }
    return filtered;
  }

  listIndexedPaths(): string[] {
    const rows = this.database.query("SELECT path FROM files").all() as Array<{
      path: string;
    }>;
    return rows.map((row) => row.path);
  }

  close(): void {
    const closable = this.database as Database & { close?: () => void };
    closable.close?.();
  }
}

function toFtsQuery(input: string): string {
  const tokens = input.match(/[A-Za-z0-9_]+/g) ?? [];
  if (tokens.length === 0) return "";
  return tokens
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" AND ");
}

type ChunkRow = {
  chunk_id: string;
  file_path: string;
  note_title: string;
  heading_path: string;
  ordinal: number;
  chunk_type: string;
  tags: string;
  links: string;
  frontmatter: string;
  mtime: number;
  content: string;
  representation: string;
  content_hash: string;
  tokens: number;
  embedding_json: string;
};

function rowToChunk(row: ChunkRow): StoredChunk {
  return {
    chunkId: row.chunk_id,
    filePath: row.file_path,
    noteTitle: row.note_title,
    headingPath: JSON.parse(row.heading_path) as string[],
    ordinal: row.ordinal,
    chunkType: row.chunk_type as ChunkRecord["chunkType"],
    tags: JSON.parse(row.tags) as string[],
    links: JSON.parse(row.links) as string[],
    frontmatter: JSON.parse(row.frontmatter) as Record<string, unknown>,
    mtime: row.mtime,
    content: row.content,
    representation: row.representation,
    contentHash: row.content_hash,
    tokens: row.tokens,
    embedding: JSON.parse(row.embedding_json) as number[],
  };
}

function matchesFilters(
  chunk: StoredChunk,
  filters: RetrievalFilters,
): boolean {
  if (filters.pathPrefix && !chunk.filePath.startsWith(filters.pathPrefix)) {
    return false;
  }
  if (
    filters.tags &&
    filters.tags.length > 0 &&
    !filters.tags.some((tag) => chunk.tags.includes(tag))
  ) {
    return false;
  }
  if (
    filters.chunkTypes &&
    filters.chunkTypes.length > 0 &&
    !filters.chunkTypes.includes(chunk.chunkType)
  ) {
    return false;
  }
  return true;
}
