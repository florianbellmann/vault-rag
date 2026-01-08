import { loadConfig } from "../core/config";
import { OllamaEmbedder } from "../core/embedding";
import { VaultIndexer } from "../core/indexer";
import { createVectorStore } from "../core/store";
import { logger, setLogLevel } from "../logger";
import { formatDuration } from "../utils/formatDuration";

async function main() {
  const config = loadConfig();
  setLogLevel(config.paths.log_level);
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const store = createVectorStore(config.paths.database);
  const embedder = new OllamaEmbedder(ollamaUrl, config.models);
  try {
    const indexer = new VaultIndexer(config, embedder, store);
    const stats = await indexer.run();
    logger.info(
      `Indexed ${stats.processed} files, skipped ${stats.skipped}, removed ${stats.removed}, failed ${stats.failed}, chunks upserted ${stats.chunksUpserted}, chunks deleted ${stats.chunksDeleted}, total ${formatDuration(
        stats.durationMs,
      )}`,
    );
  } finally {
    store.close();
  }
}

main().catch((error) => {
  logger.error("Indexing failed:", error);
  process.exit(1);
});
