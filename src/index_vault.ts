import * as path from "node:path";
import { openDb } from "./db";
import { iterMarkdownFiles, readText, sha256, mtimeSeconds } from "./util";
import { makeChunks } from "./chunking";
import { ollamaEmbed } from "./ollama";

const VAULT = process.env.OBSIDIAN_VAULT;
if (!VAULT) throw new Error("Set OBSIDIAN_VAULT env var to your vault path.");

const OLLAMA_URL = process.env.OLLAMA_URL ;
const EMBED_MODEL = process.env.EMBED_MODEL ;
const DB_PATH = process.env.DB_PATH ?? "./vault_index.sqlite";

const BATCH = Number(process.env.EMBED_BATCH ?? "32");
const MAX_CHARS = Number(process.env.CHUNK_MAX_CHARS ?? "1800");

type FileState = { mtime: number; chunk_count: number };
type State = Record<string, FileState>;

function loadState(db: ReturnType<typeof openDb>): State {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_state (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL
    );
  `);
  const rows = db
    .query(`SELECT path, mtime, chunk_count FROM file_state`)
    .all() as Array<{
    path: string;
    mtime: number;
    chunk_count: number;
  }>;
  const state: State = {};
  for (const r of rows)
    state[r.path] = { mtime: r.mtime, chunk_count: r.chunk_count };
  return state;
}

function saveFileState(
  db: ReturnType<typeof openDb>,
  relPath: string,
  mtime: number,
  chunkCount: number,
) {
  db.query(
    `INSERT INTO file_state(path, mtime, chunk_count)
     VALUES (?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, chunk_count=excluded.chunk_count`,
  ).run(relPath, mtime, chunkCount);
}

function deleteFileState(db: ReturnType<typeof openDb>, relPath: string) {
  db.query(`DELETE FROM file_state WHERE path = ?`).run(relPath);
}

function upsertChunk(
  db: ReturnType<typeof openDb>,
  row: {
    chunk_id: string;
    path: string;
    chunk_index: number;
    heading: string;
    mtime: number;
    hash: string;
    text: string;
    embedding: number[];
  },
) {
  db.query(
    `INSERT INTO chunks(chunk_id, path, chunk_index, heading, mtime, hash, text, embedding_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chunk_id) DO UPDATE SET
       mtime=excluded.mtime,
       hash=excluded.hash,
       text=excluded.text,
       heading=excluded.heading,
       embedding_json=excluded.embedding_json`,
  ).run(
    row.chunk_id,
    row.path,
    row.chunk_index,
    row.heading,
    row.mtime,
    row.hash,
    row.text,
    JSON.stringify(row.embedding),
  );
}

function deleteChunksByIds(db: ReturnType<typeof openDb>, ids: string[]) {
  const stmt = db.query(`DELETE FROM chunks WHERE chunk_id = ?`);
  for (const id of ids) stmt.run(id);
}

async function main() {
  const db = openDb(DB_PATH);
  const state = loadState(db);

  const seen = new Set<string>();

  for await (const absPath of iterMarkdownFiles(VAULT)) {
    const rel = path.relative(VAULT, absPath);
    seen.add(rel);

    const mtime = await mtimeSeconds(absPath);
    const prev = state[rel];
    if (prev && prev.mtime === mtime) continue; // unchanged

    const md = await readText(absPath);
    const chunks = makeChunks(md, MAX_CHARS);

    const docs: string[] = [];
    const ids: string[] = [];
    const headings: string[] = [];
    const hashes: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i]!.text;
      docs.push(text);
      ids.push(`${rel}:${i}`);
      headings.push(chunks[i]!.heading);
      hashes.push(sha256(text));
    }

    // Embed + upsert in batches
    for (let i = 0; i < docs.length; i += BATCH) {
      const batchDocs = docs.slice(i, i + BATCH);
      const batchIds = ids.slice(i, i + BATCH);
      const batchHeadings = headings.slice(i, i + BATCH);
      const batchHashes = hashes.slice(i, i + BATCH);

      const embs = await ollamaEmbed(batchDocs, {
        ollamaUrl: OLLAMA_URL,
        model: EMBED_MODEL,
      });

      for (let j = 0; j < batchDocs.length; j++) {
        const chunkIndex = i + j;
        upsertChunk(db, {
          chunk_id: batchIds[j]!,
          path: rel,
          chunk_index: chunkIndex,
          heading: batchHeadings[j]!,
          mtime,
          hash: batchHashes[j]!,
          text: batchDocs[j]!,
          embedding: embs[j]!,
        });
      }
    }

    // Delete stale chunks if file shrank
    const prevCount = prev?.chunk_count ?? 0;
    if (prevCount > chunks.length) {
      const stale = [];
      for (let i = chunks.length; i < prevCount; i++) stale.push(`${rel}:${i}`);
      deleteChunksByIds(db, stale);
    }

    saveFileState(db, rel, mtime, chunks.length);
  }

  // Handle deleted files
  for (const rel of Object.keys(state)) {
    if (seen.has(rel)) continue;
    const prevCount = state[rel]!.chunk_count;
    const stale = [];
    for (let i = 0; i < prevCount; i++) stale.push(`${rel}:${i}`);
    deleteChunksByIds(db, stale);
    deleteFileState(db, rel);
  }

  console.log("Indexing done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
