import * as path from "node:path";
import { stripAiBlocks } from "../ai_markers";
import { generateRelatedContent } from "../core/augmentation/writebacks";
import { loadConfig } from "../core/config";
import { OllamaEmbedder } from "../core/embedding";
import { readMarkdown } from "../core/fs/vault";
import { createVectorStore } from "../core/store";
import { chalk, logger, setLogLevel } from "../logger";
import { rankRelatedFiles } from "./related";
import { appendAiBlock, resolveWritablePath } from "./writeback";

const config = loadConfig();
setLogLevel(config.paths.log_level);
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MIN_RELATED_CHARS = Number(process.env.RELATED_MIN_CHARS ?? "200");
const MAX_RELATED_CHARS = Number(process.env.RELATED_MAX_CHARS ?? "4000");
const RELATED_TOP_K = Number(process.env.RELATED_TOP_K ?? "5");
const WRITEBACK_ROOT =
  process.env.WRITEBACK_ROOT ??
  process.env.OBSIDIAN_VAULT ??
  config.paths.vault;

function toPosixRelative(filePath: string): string {
  const relative = path.relative(WRITEBACK_ROOT, filePath);
  return relative.replace(/\\/g, "/");
}

function toWikiLink(filePath: string): string {
  const withoutExt = filePath.replace(/\.md$/i, "");
  return `[[${withoutExt}]]`;
}

async function main() {
  const targetArg = process.argv[2];
  if (!targetArg) {
    logger.error(
      "Usage: bun run src/write/related_content.ts <relative-or-absolute-path>",
    );
    process.exit(2);
  }

  const absolutePath = resolveWritablePath(targetArg);
  logger.info(chalk.cyan(`Finding related content for: ${absolutePath}`));
  let noteContent = "";
  try {
    noteContent = await readMarkdown(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      logger.error(`Note not found: ${absolutePath}`);
      process.exit(1);
    }
    throw error;
  }

  const sanitized = stripAiBlocks(noteContent).trim();
  if (sanitized.length < MIN_RELATED_CHARS) {
    logger.warn(
      `Note only has ${sanitized.length} characters (< ${MIN_RELATED_CHARS}); skipping related content.`,
    );
    process.exit(0);
  }

  const truncated = sanitized.slice(0, MAX_RELATED_CHARS);
  const embedder = new OllamaEmbedder(OLLAMA_URL, config.models);
  const [noteEmbedding] = await embedder.embed([
    { id: "note", text: truncated },
  ]);
  if (!noteEmbedding) {
    logger.error("Failed to embed note for related content.");
    process.exit(1);
  }

  const vectorStore = createVectorStore(config.paths.database);
  let candidates = [];
  try {
    const chunkRecords = vectorStore.listAllChunks();
    if (chunkRecords.length === 0) {
      logger.warn("Vector store is empty; cannot produce related content.");
      process.exit(0);
    }
    const relativePath = toPosixRelative(absolutePath);
    candidates = rankRelatedFiles(
      noteEmbedding.embedding,
      chunkRecords,
      relativePath,
      RELATED_TOP_K,
    );
  } finally {
    vectorStore.close();
  }

  if (candidates.length === 0) {
    logger.warn("No related files found.");
    process.exit(0);
  }

  const timestamp = new Date().toISOString();
  const context = candidates
    .map(
      (candidate, index) =>
        `${index + 1}. ${toWikiLink(candidate.path)} (score ${(
          candidate.score * 100
        ).toFixed(1)}%)`,
    )
    .join("\n");
  const body = await generateRelatedContent(
    path.basename(absolutePath),
    context,
    config,
    OLLAMA_URL,
  );
  await appendAiBlock(targetArg, {
    title: "AI Related Content",
    body: `Generated: ${timestamp}\n\n${body.trim()}`,
    replaceTitlePredicate: (titleLine) =>
      titleLine.startsWith("AI Related Content"),
  });
  logger.info(
    chalk.green(
      `Appended related content section with ${candidates.length} link(s).`,
    ),
  );
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
