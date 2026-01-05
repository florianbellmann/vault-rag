import { Database } from "bun:sqlite";

// Tracks the last indexed state of a file so we can diff and skip work later.
export type FileState = { mtime: number; chunkCount: number };
export type FileStateMap = Record<string, FileState>;

// Normalized representation of a chunk that can be stored in any vector backend.
export type ChunkRecord = {
  chunkId: string;
  path: string;
  chunkIndex: number;
  heading: string;
  mtime: number;
  hash: string;
  text: string;
  embedding: number[];
};

// Vector store contract. Implementations can wrap SQLite, ChromaDB, etc.
export interface VectorStore {
  loadFileState(): FileStateMap;
  saveFileState(path: string, state: FileState): void;
  deleteFileState(path: string): void;
  upsertChunks(rows: ChunkRecord[]): void;
  deleteChunksByIds(ids: string[]): void;
  close(): void;
}

export function createVectorStore(
  dbPath = "./vault_index.sqlite",
): VectorStore {
  // Today we back the store with SQLite but other adapters can be returned later.
  return new SqliteVectorStore(dbPath);
}

// SQLite-backed implementation of the vector store interface.
class SqliteVectorStore implements VectorStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        heading TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        hash TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
      CREATE INDEX IF NOT EXISTS idx_chunks_mtime ON chunks(mtime);

      CREATE TABLE IF NOT EXISTS file_state (
        path TEXT PRIMARY KEY,
        mtime INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL
      );
    `);
  }

  loadFileState(): FileStateMap {
    const rows = this.db
      .query(
        `SELECT path, mtime, chunk_count as chunkCount FROM file_state`,
      )
      .all() as Array<{ path: string; mtime: number; chunkCount: number }>;
    const state: FileStateMap = {};
    for (const row of rows) {
      state[row.path] = { mtime: row.mtime, chunkCount: row.chunkCount };
    }
    return state;
  }

  saveFileState(path: string, state: FileState): void {
    this.db
      .query(
        `INSERT INTO file_state(path, mtime, chunk_count)
         VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           mtime=excluded.mtime,
           chunk_count=excluded.chunk_count`,
      )
      .run(path, state.mtime, state.chunkCount);
  }

  deleteFileState(path: string): void {
    this.db.query(`DELETE FROM file_state WHERE path = ?`).run(path);
  }

  upsertChunks(rows: ChunkRecord[]): void {
    const stmt = this.db.query(
      `INSERT INTO chunks(chunk_id, path, chunk_index, heading, mtime, hash, text, embedding_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chunk_id) DO UPDATE SET
         mtime=excluded.mtime,
         hash=excluded.hash,
         text=excluded.text,
         heading=excluded.heading,
         embedding_json=excluded.embedding_json`,
    );
    for (const row of rows) {
      stmt.run(
        row.chunkId,
        row.path,
        row.chunkIndex,
        row.heading,
        row.mtime,
        row.hash,
        row.text,
        JSON.stringify(row.embedding),
      );
    }
  }

  deleteChunksByIds(ids: string[]): void {
    const stmt = this.db.query(`DELETE FROM chunks WHERE chunk_id = ?`);
    for (const id of ids) stmt.run(id);
  }

  close(): void {
    const db = this.db as Database & { close?: () => void };
    db.close?.();
  }
}
