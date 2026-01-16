import * as path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { stripAiBlocks } from "../ai_markers";
import { generateJournalReflection } from "../core/augmentation/writebacks";
import { loadConfig } from "../core/config";
import { OllamaEmbedder } from "../core/embedding";
import { iterVaultMarkdown, readMarkdown } from "../core/fs/vault";
import { parseFrontmatter } from "../core/metadata/frontmatter";
import { HybridRetriever } from "../core/retrieval";
import { OllamaReranker } from "../core/retrieval/reranker";
import { createVectorStore } from "../core/store";
import { chalk, logger, setLogLevel } from "../logger";
import { appendAiBlock, resolveWritablePath } from "./writeback";

const config = loadConfig();
setLogLevel(config.paths.log_level);
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MIN_JOURNAL_CHARS = Number(process.env.JOURNAL_MIN_CHARS ?? "200");
const MAX_TODAY_CHARS = Number(process.env.JOURNAL_MAX_CHARS ?? "4000");
const MAX_HISTORY_CHARS = Number(
  process.env.JOURNAL_HISTORY_MAX_CHARS ?? "12000",
);
const HISTORY_DAYS = Number(process.env.JOURNAL_HISTORY_DAYS ?? "30");
const MAX_ENTRY_SNIPPET = Number(
  process.env.JOURNAL_ENTRY_MAX_CHARS ?? "1500",
);

type JournalResources = {
  store: ReturnType<typeof createVectorStore>;
  embedder: OllamaEmbedder;
  retriever: HybridRetriever;
};

function extractAiBlocks(input: string): string[] {
  const blocks: string[] = [];
  const pattern = /<!-- AI:BEGIN -->([\s\S]*?)<!-- AI:END -->/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const raw = match[1]?.trim();
    if (raw) blocks.push(raw);
  }
  return blocks;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}\n...`;
}

async function collectRecentEntries(
  absolutePath: string,
): Promise<string> {
  const directory = path.dirname(absolutePath);
  const cutoffMs = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates: Array<{ file: string; mtimeMs: number; content: string }> =
    [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const fullPath = path.join(directory, entry.name);
    if (fullPath === absolutePath) continue;
    const stats = await stat(fullPath);
    if (stats.mtimeMs < cutoffMs) continue;
    const raw = await readMarkdown(fullPath);
    const cleaned = stripAiBlocks(raw).trim();
    const aiBlocks = extractAiBlocks(raw);
    if (!cleaned && aiBlocks.length === 0) continue;
    const sections: string[] = [];
    if (cleaned) {
      sections.push("User entry:");
      sections.push(cleaned);
    }
    if (aiBlocks.length > 0) {
      sections.push("Prior AI reflections:");
      sections.push(aiBlocks.join("\n\n---\n\n"));
    }
    candidates.push({
      file: entry.name,
      mtimeMs: stats.mtimeMs,
      content: sections.join("\n\n"),
    });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let total = 0;
  const blocks: string[] = [];
  for (const candidate of candidates) {
    const snippet = truncate(candidate.content, MAX_ENTRY_SNIPPET);
    const block = [
      `File: ${candidate.file}`,
      `Modified: ${new Date(candidate.mtimeMs).toISOString()}`,
      "",
      snippet,
    ].join("\n");
    if (total + block.length > MAX_HISTORY_CHARS) break;
    blocks.push(block);
    total += block.length;
  }

  return blocks.join("\n\n---\n\n");
}

function approximateTokens(text: string): number {
  if (!text.trim()) return 0;
  return text.split(/\s+/).length;
}

function packContext(
  chunks: Awaited<ReturnType<HybridRetriever["retrieve"]>>,
  tokenBudget: number,
): string {
  const seen = new Set<string>();
  let remaining = tokenBudget;
  const lines: string[] = [];
  let label = 1;
  for (const entry of chunks) {
    if (seen.has(entry.chunk.chunkId)) continue;
    const tokens = entry.chunk.tokens || approximateTokens(entry.chunk.content);
    if (lines.length > 0 && remaining - tokens < 0) continue;
    remaining -= tokens;
    seen.add(entry.chunk.chunkId);
    lines.push(
      `[C${label++}] ${entry.chunk.filePath} | ${entry.chunk.headingPath.join(
        " > ",
      )}\n${entry.chunk.content}`,
    );
  }
  return lines.join("\n\n---\n\n");
}

async function buildKnowledgeContext(
  resources: JournalResources,
  queryText: string,
): Promise<string> {
  const [embedding] = await resources.embedder.embed([
    { id: "journal", text: queryText },
  ]);
  if (!embedding) return "";
  const results = await resources.retriever.retrieve(
    queryText,
    embedding.embedding,
  );
  if (results.length === 0) return "";
  return packContext(results, config.retrieval.context_token_budget);
}

async function journalNote(
  targetArg: string,
  resources: JournalResources,
): Promise<void> {
  const absolutePath = resolveWritablePath(targetArg);
  let noteContent = "";
  try {
    noteContent = await readMarkdown(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      logger.error(`Note not found: ${absolutePath}`);
      return;
    }
    throw error;
  }

  const cleanedContent = stripAiBlocks(noteContent).trim();
  if (!cleanedContent) {
    logger.warn("Note has no user content after removing AI blocks; skipping.");
    return;
  }
  if (cleanedContent.length < MIN_JOURNAL_CHARS) {
    logger.warn(
      `Note only has ${cleanedContent.length} characters (< ${MIN_JOURNAL_CHARS}); skipping journal reflection.`,
    );
    return;
  }

  const { data, body } = parseFrontmatter(cleanedContent);
  const title =
    (typeof data.title === "string" && data.title) ||
    path.basename(absolutePath).replace(/\.md$/i, "");

  const todayEntry = truncate(body.trim() || cleanedContent, MAX_TODAY_CHARS);
  const recentEntries = await collectRecentEntries(absolutePath);
  const knowledgeContext = await buildKnowledgeContext(
    resources,
    `${title}\n${todayEntry}`,
  );

  const response = await generateJournalReflection(
    targetArg,
    title,
    todayEntry,
    recentEntries || "No other journal entries found in the last month.",
    knowledgeContext || "No indexed context available.",
    HISTORY_DAYS,
    config,
    OLLAMA_URL,
  );

  const timestamp = new Date().toISOString();
  await appendAiBlock(targetArg, {
    title: "AI Journal Reflection",
    body: `Generated: ${timestamp}\n\n${response.trim()}`,
    replaceTitlePredicate: (titleLine) =>
      titleLine.startsWith("AI Journal Reflection"),
  });
  logger.info(chalk.green(`Appended journal reflection to ${absolutePath}`));
}

async function main() {
  const targetArg = process.argv[2];
  if (!targetArg) {
    logger.error("Usage: bun run src/write/journal.ts <path-or-dir>");
    process.exit(2);
  }

  const absoluteTarget = resolveWritablePath(targetArg);
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(absoluteTarget);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      logger.error(`Path not found: ${absoluteTarget}`);
      process.exit(1);
    }
    throw error;
  }

  const store = createVectorStore(config.paths.database);
  const embedder = new OllamaEmbedder(OLLAMA_URL, config.models);
  const reranker = config.features.reranking
    ? new OllamaReranker(OLLAMA_URL, config.models, config.prompts)
    : undefined;
  const retriever = new HybridRetriever(store, config, reranker);
  const resources: JournalResources = { store, embedder, retriever };

  try {
    if (stats.isDirectory()) {
      logger.info(chalk.cyan(`Journaling all notes under: ${absoluteTarget}`));
      let count = 0;
      for await (const file of iterVaultMarkdown(absoluteTarget)) {
        count++;
        logger.info(
          chalk.dim(`Generating journal reflection ${count}: ${file.absolute}`),
        );
        await journalNote(file.absolute, resources);
      }
      logger.info(chalk.green(`Processed ${count} note(s).`));
      return;
    }

    logger.info(chalk.cyan(`Journaling note: ${absoluteTarget}`));
    await journalNote(targetArg, resources);
  } finally {
    store.close();
  }
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
