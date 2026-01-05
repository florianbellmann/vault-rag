import { createVectorStore } from "./db";
import type { ChunkRecord } from "./db";
import { cosineSimilarity } from "./similarity";
import { ollamaEmbed, ollamaGenerate } from "./ollama";
import { logger, chalk } from "./logger";
import { dedupeRankedChunks } from "./dedup";

// Models + storage configuration.
const OLLAMA_URL = process.env.OLLAMA_URL;
const EMBED_MODEL = process.env.EMBED_MODEL;
const CHAT_MODEL = process.env.CHAT_MODEL;
const DB_PATH = process.env.DB_PATH ?? "./vault_index.sqlite";

const TOP_RESULT_COUNT = Number(process.env.TOP_K ?? "8");
const MAX_CHUNKS_PER_PATH = Number(
  process.env.RETRIEVAL_MAX_CHUNKS_PER_NOTE ?? "1",
);

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    logger.error("Usage: bun run src/ask.ts <question>");
    process.exit(2);
  }
  logger.debug(`[ask] Question: ${question}`);

  const [questionEmbedding] = await ollamaEmbed([question], {
    ollamaUrl: OLLAMA_URL,
    model: EMBED_MODEL,
  });

  const vectorStore = createVectorStore(DB_PATH);
  let chunkRecords: ChunkRecord[] = [];
  try {
    chunkRecords = vectorStore.getAllChunks();
    logger.debug(`[ask] Loaded ${chunkRecords.length} chunks from store.`);
  } finally {
    vectorStore.close();
  }

  const scoredChunks = chunkRecords.map((chunkRecord) => {
    // score is the cosine similarity between the question and the chunk embedding.
    const score = cosineSimilarity(questionEmbedding, chunkRecord.embedding);
    return { chunkRecord, score };
  });

  scoredChunks.sort((left, right) => right.score - left.score);
  const topChunks = scoredChunks.slice(0, TOP_RESULT_COUNT);
  const dedupedChunks = dedupeRankedChunks(topChunks, {
    maxPerPath: MAX_CHUNKS_PER_PATH,
  });
  logger.debug(
    `[ask] Deduplicated results: kept ${dedupedChunks.length}/${topChunks.length}`,
  );
  logger.debug("[ask] Top candidates by cosine similarity:");
  for (const [index, entry] of dedupedChunks.entries()) {
    const percentScore = (entry.score * 100).toFixed(2);
    logger.debug(
      `  ${index + 1}. ${entry.chunkRecord.path} (${entry.chunkRecord.heading}) -> ${percentScore}%`,
    );
  }

  const contextBlocks = dedupedChunks.map(
    ({ chunkRecord }, contextIndex) =>
      `(${contextIndex + 1}) [${chunkRecord.path} | ${chunkRecord.heading}]\n${
        chunkRecord.text
      }`,
  );

  // TODO: Consider moving the prompt template + retrieval strategy into a configurable module.
  // Right now we scan every chunk in-memory and compute cosine similarity. That's fine for small vaults,
  // but a dedicated retrieval layer (e.g., vector DB query or ANN index) would be more scalable.

  const prompt = [
    "You are helping me with my Obsidian vault.",
    "Answer the question using ONLY the provided context. If the answer is not contained, say you don't know.",
    "",
    `Question: ${question}`,
    "",
    "Context:",
    contextBlocks.join("\n\n---\n\n"),
    "",
    "Answer:",
  ].join("\n");

  const answer = await ollamaGenerate(prompt, {
    ollamaUrl: OLLAMA_URL,
    model: CHAT_MODEL,
  });
  logger.debug("[ask] Prompt sent to chat model:");
  logger.debug(prompt);

  logger.info(chalk.bold("Answer:"));
  logger.info(chalk.white(answer.trim()));
  logger.info(chalk.bold("Sources:"));
  const uniqueSourcePaths = [
    ...new Set(dedupedChunks.map((entry) => entry.chunkRecord.path)),
  ];
  for (const sourcePath of uniqueSourcePaths) {
    logger.info(chalk.dim(`- ${sourcePath}`));
  }
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
