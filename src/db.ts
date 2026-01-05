import { Database } from "bun:sqlite";

export type ChunkRow = {
  chunk_id: string;
  path: string;
  chunk_index: number;
  heading: string;
  mtime: number;
  hash: string;
  text: string;
  embedding_json: string; // JSON array of numbers
};

export function openDb(dbPath = "./vault_index.sqlite") {
  const db = new Database(dbPath);

  db.exec(`
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
  `);

  return db;
}
