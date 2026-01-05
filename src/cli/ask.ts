import { AnswerEngine } from "../core/augmentation/qa_engine";
import { loadConfig } from "../core/config";
import { OllamaEmbedder } from "../core/embedding";
import { HybridRetriever } from "../core/retrieval";
import { OllamaReranker } from "../core/retrieval/reranker";
import { createVectorStore } from "../core/store";
import { logger, setLogLevel } from "../logger";

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    logger.error('Usage: bun run ask "<question>"');
    process.exit(1);
  }
  const config = loadConfig();
  setLogLevel(config.paths.log_level);
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const store = createVectorStore(config.paths.database);
  const embedder = new OllamaEmbedder(ollamaUrl, config.models);
  const reranker = config.features.reranking
    ? new OllamaReranker(ollamaUrl, config.models, config.prompts)
    : undefined;
  const retriever = new HybridRetriever(store, config, reranker);
  const engine = new AnswerEngine(embedder, retriever, config, ollamaUrl);
  try {
    const result = await engine.answer(question);
    logger.info(result.answer.trim());
    logger.info("Sources:");
    for (const entry of result.chunks) {
      const citation = result.citations.get(entry.chunk.chunkId);
      logger.info(
        `[${citation}] ${entry.chunk.filePath} :: ${entry.chunk.headingPath.join(" > ")}`,
      );
    }
  } finally {
    store.close();
  }
}

main().catch((error) => {
  logger.error("Question answering failed:", error);
  process.exit(1);
});
