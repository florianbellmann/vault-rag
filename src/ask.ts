import { createVectorStore } from "./db";
import type { ChunkRecord } from "./db";
import { cosineSimilarity } from "./similarity";
import { ollamaEmbed, ollamaGenerate } from "./ollama";

// Models + storage configuration.
const OLLAMA_URL = process.env.OLLAMA_URL;
const EMBED_MODEL = process.env.EMBED_MODEL;
const CHAT_MODEL = process.env.CHAT_MODEL;
const DB_PATH = process.env.DB_PATH ?? "./vault_index.sqlite";

const TOP_RESULT_COUNT = Number(process.env.TOP_K ?? "8");
const DEBUG_ENABLED = process.env.DEBUG === "1" || process.env.DEBUG === "true";
const log = {
  debug: (...messages: unknown[]) => {
    if (!DEBUG_ENABLED) return;
    console.debug(...messages);
  },
};

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error("Usage: bun run src/ask.ts <question>");
    process.exit(2);
  }
  log.debug(`[ask] Question: ${question}`);

  const [questionEmbedding] = await ollamaEmbed([question], {
    ollamaUrl: OLLAMA_URL,
    model: EMBED_MODEL,
  });

  const vectorStore = createVectorStore(DB_PATH);
  let chunkRecords: ChunkRecord[] = [];
  try {
    chunkRecords = vectorStore.getAllChunks();
    log.debug(`[ask] Loaded ${chunkRecords.length} chunks from store.`);
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
  log.debug("[ask] Top candidates by cosine similarity:");
  for (const [index, entry] of topChunks.entries()) {
    const percentScore = (entry.score * 100).toFixed(2);
    log.debug(
      `  ${index + 1}. ${entry.chunkRecord.path} (${entry.chunkRecord.heading}) -> ${percentScore}%`,
    );
  }

  const contextBlocks = topChunks.map(
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
  log.debug("[ask] Prompt sent to chat model:\n");
  log.debug(prompt);

  console.log(answer.trim());
  console.log("\nSources:");
  const uniqueSourcePaths = [
    ...new Set(topChunks.map((entry) => entry.chunkRecord.path)),
  ];
  for (const sourcePath of uniqueSourcePaths) {
    console.log(`- ${sourcePath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
