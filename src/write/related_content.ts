import * as path from "node:path";
import { stripAiBlocks } from "../ai_markers";
import { readText } from "../index/util";
import { ollamaEmbed } from "../ollama";
import { appendAiBlock, resolveWritablePath } from "./writeback";
import { createVectorStore } from "../db";
import { logger, chalk } from "../logger";
import { rankRelatedFiles } from "./related";

const OLLAMA_URL = process.env.OLLAMA_URL;
const EMBED_MODEL = process.env.EMBED_MODEL;
const DB_PATH = process.env.DB_PATH ?? "./vault_index.sqlite";
if (!OLLAMA_URL) throw new Error("Set OLLAMA_URL before running related_content.");
if (!EMBED_MODEL) throw new Error("Set EMBED_MODEL before running related_content.");
const MIN_RELATED_CHARS = Number(process.env.RELATED_MIN_CHARS ?? "200");
const MAX_RELATED_CHARS = Number(process.env.RELATED_MAX_CHARS ?? "4000");
const RELATED_TOP_K = Number(process.env.RELATED_TOP_K ?? "5");
const WRITEBACK_ROOT = process.env.WRITEBACK_ROOT ?? process.env.OBSIDIAN_VAULT;
if (!WRITEBACK_ROOT)
  throw new Error(
    "Set WRITEBACK_ROOT or OBSIDIAN_VAULT so related content can resolve paths.",
  );

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
    noteContent = await readText(absolutePath);
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
  const [noteEmbedding] = await ollamaEmbed([truncated], {
    ollamaUrl: OLLAMA_URL,
    model: EMBED_MODEL,
  });

  const vectorStore = createVectorStore(DB_PATH);
  let candidates = [];
  try {
    const chunkRecords = vectorStore.getAllChunks();
    if (chunkRecords.length === 0) {
      logger.warn("Vector store is empty; cannot produce related content.");
      process.exit(0);
    }
    const relativePath = toPosixRelative(absolutePath);
    candidates = rankRelatedFiles(
      noteEmbedding,
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

  const body = candidates
    .map((candidate) => `- ${toWikiLink(candidate.path)}`)
    .join("\n");
  const timestamp = new Date().toISOString();
  await appendAiBlock(targetArg, {
    title: `AI Related Content (${timestamp})`,
    body,
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
