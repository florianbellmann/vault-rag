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
  saveFileState(filePath: string, state: FileState): void;
  deleteFileState(filePath: string): void;
  upsertChunks(chunkRecords: ChunkRecord[]): void;
  deleteChunksByIds(chunkIds: string[]): void;
  getAllChunks(): ChunkRecord[];
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
  private database: Database;

  constructor(dbPath: string) {
    this.database = new Database(dbPath);
    this.database.exec(`
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
    const rows = this.database
      .query("SELECT path, mtime, chunk_count as chunkCount FROM file_state")
      .all() as Array<{ path: string; mtime: number; chunkCount: number }>;
    const state: FileStateMap = {};
    for (const rowRecord of rows) {
      state[rowRecord.path] = {
        mtime: rowRecord.mtime,
        chunkCount: rowRecord.chunkCount,
      };
    }
    return state;
  }

  saveFileState(filePath: string, state: FileState): void {
    this.database
      .query(
        `INSERT INTO file_state(path, mtime, chunk_count)
         VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           mtime=excluded.mtime,
           chunk_count=excluded.chunk_count`,
      )
      .run(filePath, state.mtime, state.chunkCount);
  }

  deleteFileState(filePath: string): void {
    this.database.query("DELETE FROM file_state WHERE path = ?").run(filePath);
  }

  upsertChunks(chunkRecords: ChunkRecord[]): void {
    const statement = this.database.query(
      `INSERT INTO chunks(chunk_id, path, chunk_index, heading, mtime, hash, text, embedding_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chunk_id) DO UPDATE SET
         mtime=excluded.mtime,
         hash=excluded.hash,
         text=excluded.text,
         heading=excluded.heading,
         embedding_json=excluded.embedding_json`,
    );
    for (const chunkRecord of chunkRecords) {
      statement.run(
        chunkRecord.chunkId,
        chunkRecord.path,
        chunkRecord.chunkIndex,
        chunkRecord.heading,
        chunkRecord.mtime,
        chunkRecord.hash,
        chunkRecord.text,
        JSON.stringify(chunkRecord.embedding),
      );
    }
  }

  deleteChunksByIds(chunkIds: string[]): void {
    const statement = this.database.query(
      "DELETE FROM chunks WHERE chunk_id = ?",
    );
    for (const chunkId of chunkIds) statement.run(chunkId);
  }

  getAllChunks(): ChunkRecord[] {
    const rows = this.database
      .query(
        "SELECT chunk_id, path, chunk_index, heading, mtime, hash, text, embedding_json FROM chunks",
      )
      .all() as Array<{
      chunk_id: string;
      path: string;
      chunk_index: number;
      heading: string;
      mtime: number;
      hash: string;
      text: string;
      embedding_json: string;
    }>;

    return rows.map((chunkRow) => ({
      chunkId: chunkRow.chunk_id,
      path: chunkRow.path,
      chunkIndex: chunkRow.chunk_index,
      heading: chunkRow.heading,
      mtime: chunkRow.mtime,
      hash: chunkRow.hash,
      text: chunkRow.text,
      embedding: JSON.parse(chunkRow.embedding_json) as number[],
    }));
  }

  close(): void {
    const closableDatabase = this.database as Database & { close?: () => void };
    closableDatabase.close?.();
  }
}
