import * as path from "node:path";
import { createVectorStore } from "./db";
import { iterMarkdownFiles, readText, sha256, mtimeSeconds } from "./util";
import { makeChunks } from "./chunking";
import { ollamaEmbed } from "./ollama";

// Simple indexer that walks an Obsidian vault, embeds Markdown chunks,
// and writes them into the configured vector store.

const VAULT = process.env.OBSIDIAN_VAULT;
if (!VAULT) throw new Error("Set OBSIDIAN_VAULT env var to your vault path.");

const OLLAMA_URL = process.env.OLLAMA_URL;
const EMBED_MODEL = process.env.EMBED_MODEL;
const DB_PATH = process.env.DB_PATH ?? "./vault_index.sqlite";

const BATCH = Number(process.env.EMBED_BATCH ?? "32");
const MAX_CHARS = Number(process.env.CHUNK_MAX_CHARS ?? "1800");

type IndexStats = {
  processedFiles: number;
  skippedFiles: number;
  deletedFiles: number;
  chunksUpserted: number;
  chunksDeleted: number;
};

async function main() {
  const store = createVectorStore(DB_PATH);
  const state = store.loadFileState();

  const seen = new Set<string>();
  // Basic counters so we can print a useful summary report.
  const stats: IndexStats = {
    processedFiles: 0,
    skippedFiles: 0,
    deletedFiles: 0,
    chunksUpserted: 0,
    chunksDeleted: 0,
  };
  const start = Date.now();

  try {
    for await (const absPath of iterMarkdownFiles(VAULT)) {
      const rel = path.relative(VAULT, absPath);
      seen.add(rel);

      const mtime = await mtimeSeconds(absPath);
      const prev = state[rel];
      if (prev && prev.mtime === mtime) {
        stats.skippedFiles++;
        continue;
      }

      const md = await readText(absPath);
      const chunks = makeChunks(md, MAX_CHARS);
      console.log(`Processing ${rel} (${chunks.length} chunks)...`);

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

      // Embed + upsert in batches to keep requests bounded.
      for (let i = 0; i < docs.length; i += BATCH) {
        const batchDocs = docs.slice(i, i + BATCH);
        const batchIds = ids.slice(i, i + BATCH);
        const batchHeadings = headings.slice(i, i + BATCH);
        const batchHashes = hashes.slice(i, i + BATCH);

        const embs = await ollamaEmbed(batchDocs, {
          ollamaUrl: OLLAMA_URL,
          model: EMBED_MODEL,
        });

        const rows = batchDocs.map((text, j) => ({
          chunkId: batchIds[j]!,
          path: rel,
          chunkIndex: i + j,
          heading: batchHeadings[j]!,
          mtime,
          hash: batchHashes[j]!,
          text,
          embedding: embs[j]!,
        }));
        store.upsertChunks(rows);
      }

      stats.processedFiles++;
      stats.chunksUpserted += chunks.length;

      // Delete stale chunks if file shrank.
      const prevCount = prev?.chunkCount ?? 0;
      if (prevCount > chunks.length) {
        const stale = [];
        for (let i = chunks.length; i < prevCount; i++) {
          stale.push(`${rel}:${i}`);
        }
        store.deleteChunksByIds(stale);
        stats.chunksDeleted += stale.length;
      }

      store.saveFileState(rel, { mtime, chunkCount: chunks.length });
    }

    // Handle deleted files by removing their lingering chunks.
    for (const rel of Object.keys(state)) {
      if (seen.has(rel)) continue;
      const prevCount = state[rel]!.chunkCount;
      console.log(`Removing deleted file ${rel} (${prevCount} chunks)...`);
      const stale = [];
      for (let i = 0; i < prevCount; i++) stale.push(`${rel}:${i}`);
      store.deleteChunksByIds(stale);
      store.deleteFileState(rel);
      stats.deletedFiles++;
      stats.chunksDeleted += stale.length;
    }
  } finally {
    store.close();
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log("Indexing summary:");
  console.log(`  Files processed: ${stats.processedFiles}`);
  console.log(`  Files skipped (unchanged): ${stats.skippedFiles}`);
  console.log(`  Files removed: ${stats.deletedFiles}`);
  console.log(`  Chunks upserted: ${stats.chunksUpserted}`);
  console.log(`  Chunks deleted: ${stats.chunksDeleted}`);
  console.log(`  Duration: ${duration}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
