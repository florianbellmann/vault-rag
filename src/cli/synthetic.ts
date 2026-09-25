import { writeFile } from "node:fs/promises";
import { chunkMarkdown } from "../core/chunking/markdownChunker";
import { loadConfig } from "../core/config";
import { fileMtimeSeconds, iterVaultMarkdown, readMarkdown } from "../core/fs/vault";
import { renderPrompt } from "../core/prompts";
import type { EvalQuestion } from "../core/eval/evaluator";
import type { ChunkRecord, GlobalConfig } from "../core/types";
import { logger, setLogLevel } from "../logger";
import { ollamaGenerate } from "../ollama";

interface SyntheticOptions {
  outputPath: string;
  perFile: number;
  maxFiles?: number;
  minTokens?: number;
  multiCount: number;
}

const QUESTION_PROMPT = `
You are generating evaluation questions for a retrieval system over an Obsidian vault.
Use only the provided chunk. Write 1 specific question that can be answered using only this chunk.
Avoid yes/no questions. Return a JSON array with a single string and no extra text.

Note path: {{path}}
Heading path: {{heading}}

Chunk:
{{chunk}}
`.trim();

const MULTI_QUESTION_PROMPT = `
You are generating evaluation questions for a retrieval system over an Obsidian vault.
Use BOTH chunks to craft 1 specific question that requires information from each.
Avoid yes/no questions. If the question can be answered from only one chunk, it is invalid.
Return a JSON array with a single string and no extra text.

Chunk A path: {{pathA}}
Chunk A heading: {{headingA}}
Chunk A:
{{chunkA}}

Chunk B path: {{pathB}}
Chunk B heading: {{headingB}}
Chunk B:
{{chunkB}}
`.trim();

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    logger.error(
      "Usage: bun run rag:synthetic --out <path> [--per-file <n>] [--multi-count <n>] [--max-files <n>] [--min-tokens <n>]",
    );
    process.exit(1);
  }
  const config = loadConfig();
  setLogLevel(config.paths.log_level);
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const effectiveOptions: SyntheticOptions = {
    ...options,
    minTokens: options.minTokens ?? config.chunking.min_tokens,
  };
  const files = await collectFiles(config, effectiveOptions.maxFiles);
  const candidates = await buildCandidates(files, config, effectiveOptions);
  const questions: EvalQuestion[] = [];
  const seenQuestions = new Set<string>();
  let fileIndex = 0;
  for (const entry of candidates) {
    fileIndex++;
    const perFileQuestions = await synthesizeForFile(
      entry,
      candidates,
      config,
      effectiveOptions,
      ollamaUrl,
    );
    for (const entry of perFileQuestions) {
      if (seenQuestions.has(entry.question)) continue;
      seenQuestions.add(entry.question);
      questions.push(entry);
    }
    logger.info(
      `[${fileIndex}/${candidates.length}] Generated ${perFileQuestions.length} questions for ${entry.file.relative}`,
    );
  }

  await writeFile(options.outputPath, JSON.stringify(questions, null, 2));
  logger.info(
    `Synthetic eval dataset written to ${options.outputPath} (${questions.length} questions).`,
  );
}

function parseArgs(args: string[]): SyntheticOptions | null {
  const outputPath = readFlagValue(args, "--out");
  if (!outputPath) return null;
  const perFile = parseNumberFlag(args, "--per-file") ?? 2;
  const multiCount = parseNumberFlag(args, "--multi-count") ?? 0;
  const maxFiles = parseNumberFlag(args, "--max-files");
  const minTokens = parseNumberFlag(args, "--min-tokens");
  return {
    outputPath,
    perFile: Math.max(perFile, 1),
    multiCount: Math.max(multiCount, 0),
    maxFiles,
    minTokens,
  };
}

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseNumberFlag(args: string[], flag: string): number | undefined {
  const value = readFlagValue(args, flag);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function collectFiles(
  config: GlobalConfig,
  maxFiles?: number,
): Promise<Array<{ absolute: string; relative: string }>> {
  const files: Array<{ absolute: string; relative: string }> = [];
  for await (const file of iterVaultMarkdown(config.paths.vault)) {
    files.push(file);
    if (maxFiles && files.length >= maxFiles) break;
  }
  return files;
}

async function buildCandidates(
  files: Array<{ absolute: string; relative: string }>,
  config: GlobalConfig,
  options: SyntheticOptions,
): Promise<Array<{ file: { absolute: string; relative: string }; chunks: ChunkRecord[] }>> {
  const candidates: Array<{
    file: { absolute: string; relative: string };
    chunks: ChunkRecord[];
  }> = [];
  for (const file of files) {
    const markdown = await readMarkdown(file.absolute);
    const mtime = await fileMtimeSeconds(file.absolute);
    const chunks = chunkMarkdown(
      { filePath: file.relative, markdown, mtime },
      config.chunking,
    );
    const filtered = chunks
      .filter((chunk) => chunk.tokens >= (options.minTokens ?? 0))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, Math.max(options.perFile, options.multiCount || 1));
    candidates.push({ file, chunks: filtered });
  }
  return candidates;
}

async function synthesizeForFile(
  entry: { file: { absolute: string; relative: string }; chunks: ChunkRecord[] },
  candidates: Array<{ file: { absolute: string; relative: string }; chunks: ChunkRecord[] }>,
  config: GlobalConfig,
  options: SyntheticOptions,
  ollamaUrl: string,
): Promise<EvalQuestion[]> {
  if (entry.chunks.length === 0) return [];
  const entries: EvalQuestion[] = [];
  const singleChunks = entry.chunks.slice(0, options.perFile);
  for (const chunk of singleChunks) {
    const question = await generateQuestion(chunk, config, ollamaUrl);
    if (!question) continue;
    entries.push({ question, expected_paths: [entry.file.relative] });
  }
  if (options.multiCount > 0) {
    const multiChunks = entry.chunks.slice(0, options.multiCount);
    for (let index = 0; index < multiChunks.length; index++) {
      const chunk = multiChunks[index];
      const partner = selectPartnerChunk(entry.file.relative, candidates, index);
      if (!partner) continue;
      const question = await generateMultiQuestion(
        chunk,
        partner,
        config,
        ollamaUrl,
      );
      if (!question) continue;
      entries.push({
        question,
        expected_paths: [entry.file.relative, partner.filePath],
      });
    }
  }
  return entries;
}

function selectPartnerChunk(
  currentPath: string,
  candidates: Array<{ file: { absolute: string; relative: string }; chunks: ChunkRecord[] }>,
  offset: number,
): ChunkRecord | null {
  const pool = candidates
    .filter((entry) => entry.file.relative !== currentPath)
    .map((entry) => entry.chunks[0])
    .filter(Boolean) as ChunkRecord[];
  if (pool.length === 0) return null;
  const index = offset % pool.length;
  return pool[index] ?? null;
}

async function generateQuestion(
  chunk: ChunkRecord,
  config: GlobalConfig,
  ollamaUrl: string,
): Promise<string | null> {
  const prompt = renderPrompt(QUESTION_PROMPT, {
    path: chunk.filePath,
    heading: chunk.headingPath.join(" > "),
    chunk: chunk.content,
  });
  const response = await ollamaGenerate(prompt, {
    model: config.models.llm_model,
    ollamaUrl,
    options: { temperature: 0.2, max_tokens: 128 },
  });
  const questions = parseQuestionList(response);
  return questions[0] ?? null;
}

async function generateMultiQuestion(
  chunkA: ChunkRecord,
  chunkB: ChunkRecord,
  config: GlobalConfig,
  ollamaUrl: string,
): Promise<string | null> {
  const prompt = renderPrompt(MULTI_QUESTION_PROMPT, {
    pathA: chunkA.filePath,
    headingA: chunkA.headingPath.join(" > "),
    chunkA: chunkA.content,
    pathB: chunkB.filePath,
    headingB: chunkB.headingPath.join(" > "),
    chunkB: chunkB.content,
  });
  const response = await ollamaGenerate(prompt, {
    model: config.models.llm_model,
    ollamaUrl,
    options: { temperature: 0.2, max_tokens: 128 },
  });
  const questions = parseQuestionList(response);
  return questions[0] ?? null;
}

function parseQuestionList(response: string): string[] {
  try {
    const parsed = JSON.parse(response.trim()) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item).trim())
        .filter(Boolean);
    }
  } catch {
    // fall back to line parsing
  }
  return response
    .split("\n")
    .map((line) => line.replace(/^[*-]\s*/, "").trim())
    .filter(Boolean);
}

main().catch((error) => {
  logger.error("Synthetic QA generation failed:", error);
  process.exit(1);
});
