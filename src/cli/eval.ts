import { AnswerEngine } from "../core/augmentation/qa_engine";
import { loadConfig } from "../core/config";
import { OllamaEmbedder } from "../core/embedding";
import { Evaluator } from "../core/eval/evaluator";
import { HybridRetriever } from "../core/retrieval";
import { OllamaReranker } from "../core/retrieval/reranker";
import { createVectorStore } from "../core/store";
import { logger, setLogLevel } from "../logger";

async function main() {
  const fileFlagIndex = process.argv.findIndex((arg) => arg === "--file");
  if (fileFlagIndex === -1 || !process.argv[fileFlagIndex + 1]) {
    logger.error("Usage: bun run rag:eval --file <path>");
    process.exit(1);
  }
  const filePathArg = process.argv[fileFlagIndex + 1];
  if (!filePathArg) {
    logger.error("--file flag requires a path argument.");
    process.exit(1);
  }
  const filePath = filePathArg;
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
    const evaluator = new Evaluator(engine, config.retrieval.rerank_top_n);
    const metrics = await evaluator.evaluateFile(filePath);
    logger.info(JSON.stringify(metrics, null, 2));
  } finally {
    store.close();
  }
}

main().catch((error) => {
  logger.error("Evaluation failed:", error);
  process.exit(1);
});
