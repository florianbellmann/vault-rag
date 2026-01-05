import * as path from "node:path";
import { createVectorStore } from "../db";
import { chalk, logger } from "../logger";
import { ollamaEmbed } from "../ollama";
import { makeChunks } from "./chunking";
import { iterMarkdownFiles, mtimeSeconds, readText, sha256 } from "./util";

// Simple indexer that walks an Obsidian vault, embeds Markdown chunks,
// and writes them into the configured vector store.

const VAULT_PATH = process.env.OBSIDIAN_VAULT;
if (!VAULT_PATH)
  throw new Error("Set OBSIDIAN_VAULT env var to your vault path.");

const OLLAMA_URL = process.env.OLLAMA_URL;
const EMBED_MODEL = process.env.EMBED_MODEL;
const DB_PATH = process.env.DB_PATH ?? "./vault_index.sqlite";

const EMBED_BATCH_SIZE = Number(process.env.EMBED_BATCH ?? "32");
const CHUNK_MAX_CHAR_LENGTH = Number(process.env.CHUNK_MAX_CHARS ?? "1800");

type IndexStats = {
  processedFiles: number;
  skippedFiles: number;
  deletedFiles: number;
  chunksUpserted: number;
  chunksDeleted: number;
  chunksTotal: number;
};

async function main() {
  const vectorStore = createVectorStore(DB_PATH);
  const fileState = vectorStore.loadFileState();
  const seenFiles = new Set<string>();
  // Basic counters so we can print a useful summary report.
  const stats: IndexStats = {
    processedFiles: 0,
    skippedFiles: 0,
    deletedFiles: 0,
    chunksUpserted: 0,
    chunksDeleted: 0,
    chunksTotal: Object.values(fileState).reduce(
      (total, state) => total + state.chunkCount,
      0,
    ),
  };
  const startTime = Date.now();
  try {
    const vaultFiles: string[] = [];
    for await (const absolutePath of iterMarkdownFiles(VAULT_PATH)) {
      vaultFiles.push(absolutePath);
    }

    for (let fileIndex = 0; fileIndex < vaultFiles.length; fileIndex++) {
      const absolutePath = vaultFiles[fileIndex];
      if (!absolutePath) continue;
      const relativePath = path.relative(VAULT_PATH, absolutePath);
      seenFiles.add(relativePath);
      const progressLabel = chalk.cyan(
        `[${fileIndex + 1}/${vaultFiles.length}]`,
      );

      const modifiedTimeSeconds = await mtimeSeconds(absolutePath);
      const previousState = fileState[relativePath];
      if (previousState && previousState.mtime === modifiedTimeSeconds) {
        stats.skippedFiles++;
        logger.info(
          `${progressLabel} ${chalk.yellow("Skipping")} ${chalk.dim(
            relativePath,
          )} (unchanged)`,
        );
        continue;
      }

      const markdown = await readText(absolutePath);
      const chunks = makeChunks(markdown, CHUNK_MAX_CHAR_LENGTH);
      // Remove the prior chunk count (if any) so we can add the latest count later.
      stats.chunksTotal -= previousState?.chunkCount ?? 0;
      logger.info(
        `${progressLabel} ${chalk.green("Indexing")} ${chalk.bold(
          relativePath,
        )} ${chalk.dim(`(${chunks.length} chunks)`)}`,
      );

      const chunkTexts: string[] = [];
      const chunkIds: string[] = [];
      const chunkHeadings: string[] = [];
      const chunkHashes: string[] = [];

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        if (!chunk) continue;
        const chunkTextValue = chunk.text;
        chunkTexts.push(chunkTextValue);
        chunkIds.push(`${relativePath}:${chunkIndex}`);
        chunkHeadings.push(chunk.heading);
        chunkHashes.push(sha256(chunkTextValue));
      }

      // Embed + upsert in batches to keep requests bounded.
      for (
        let batchStart = 0;
        batchStart < chunkTexts.length;
        batchStart += EMBED_BATCH_SIZE
      ) {
        const batchChunkTexts = chunkTexts.slice(
          batchStart,
          batchStart + EMBED_BATCH_SIZE,
        );
        const batchChunkIds = chunkIds.slice(
          batchStart,
          batchStart + EMBED_BATCH_SIZE,
        );
        const batchChunkHeadings = chunkHeadings.slice(
          batchStart,
          batchStart + EMBED_BATCH_SIZE,
        );
        const batchChunkHashes = chunkHashes.slice(
          batchStart,
          batchStart + EMBED_BATCH_SIZE,
        );

        const embeddings = await ollamaEmbed(batchChunkTexts, {
          ollamaUrl: OLLAMA_URL,
          model: EMBED_MODEL,
        });

        const chunkRecords = [];
        for (
          let batchIndex = 0;
          batchIndex < batchChunkTexts.length;
          batchIndex++
        ) {
          const chunkTextValue = batchChunkTexts[batchIndex];
          const chunkId = batchChunkIds[batchIndex];
          const heading = batchChunkHeadings[batchIndex];
          const hash = batchChunkHashes[batchIndex];
          const embedding = embeddings[batchIndex];
          if (!chunkTextValue || !chunkId || !heading || !hash || !embedding) {
            continue;
          }
          chunkRecords.push({
            chunkId,
            path: relativePath,
            chunkIndex: batchStart + batchIndex,
            heading,
            mtime: modifiedTimeSeconds,
            hash,
            text: chunkTextValue,
            embedding,
          });
        }
        vectorStore.upsertChunks(chunkRecords);
      }

      stats.processedFiles++;
      stats.chunksUpserted += chunks.length;

      // Delete stale chunks if file shrank.
      const previousChunkCount = previousState?.chunkCount ?? 0;
      if (previousChunkCount > chunks.length) {
        const staleChunkIds: string[] = [];
        for (
          let chunkIndex = chunks.length;
          chunkIndex < previousChunkCount;
          chunkIndex++
        ) {
          staleChunkIds.push(`${relativePath}:${chunkIndex}`);
        }
        vectorStore.deleteChunksByIds(staleChunkIds);
        stats.chunksDeleted += staleChunkIds.length;
      }

      vectorStore.saveFileState(relativePath, {
        mtime: modifiedTimeSeconds,
        chunkCount: chunks.length,
      });
      stats.chunksTotal += chunks.length;
    }

    // Handle deleted files by removing their lingering chunks.
    for (const relativePath of Object.keys(fileState)) {
      if (seenFiles.has(relativePath)) continue;
      const previousChunkCount = fileState[relativePath]?.chunkCount ?? 0;
      logger.info(
        `${chalk.red("Removing")} ${chalk.bold(relativePath)} ${chalk.dim(
          `(${previousChunkCount} chunks)`,
        )}`,
      );
      const staleChunkIds: string[] = [];
      for (let chunkIndex = 0; chunkIndex < previousChunkCount; chunkIndex++) {
        staleChunkIds.push(`${relativePath}:${chunkIndex}`);
      }
      vectorStore.deleteChunksByIds(staleChunkIds);
      vectorStore.deleteFileState(relativePath);
      stats.deletedFiles++;
      stats.chunksDeleted += staleChunkIds.length;
      stats.chunksTotal -= staleChunkIds.length;
    }
  } finally {
    vectorStore.close();
  }

  const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info(chalk.bold("Indexing summary:"));
  logger.info(`  ${chalk.green("Files processed:")} ${stats.processedFiles}`);
  logger.info(
    `  ${chalk.yellow("Files skipped (unchanged):")} ${stats.skippedFiles}`,
  );
  logger.info(`  ${chalk.red("Files removed:")} ${stats.deletedFiles}`);
  logger.info(`  ${chalk.green("Chunks upserted:")} ${stats.chunksUpserted}`);
  logger.info(`  ${chalk.red("Chunks deleted:")} ${stats.chunksDeleted}`);
  logger.info(`  ${chalk.cyan("Total chunks indexed:")} ${stats.chunksTotal}`);
  logger.info(`  ${chalk.cyan("Duration:")} ${durationSeconds}s`);
}

main().catch((error) => {
  logger.error("Indexing failed:", error);
  process.exit(1);
});
