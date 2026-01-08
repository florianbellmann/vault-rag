import { basename } from "node:path";
import { stat, writeFile } from "node:fs/promises";
import { reworkContent } from "../core/augmentation/writebacks";
import { loadConfig } from "../core/config";
import { readMarkdown } from "../core/fs/vault";
import {
  parseFrontmatter,
  stringifyFrontmatter,
} from "../core/metadata/frontmatter";
import { chalk, logger, setLogLevel } from "../logger";
import { resolveWritablePath } from "./writeback";

const config = loadConfig();
setLogLevel(config.paths.log_level);
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

function selectCreatedAt(stats: Awaited<ReturnType<typeof stat>>): string {
  const createdMs =
    Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0
      ? stats.birthtimeMs
      : stats.mtimeMs;
  return new Date(createdMs).toISOString();
}

function removeAiMarkers(content: string): string {
  return content
    .replace(/<!--\s*AI:BEGIN\s*-->\s*/g, "")
    .replace(/\s*<!--\s*AI:END\s*-->/g, "");
}

function ensureFrontmatter(
  content: string,
  title: string,
  createdAt: string,
): string {
  const parsed = parseFrontmatter(content);
  if (parsed.hasFrontmatter) return content.trimEnd();
  const nextData: Record<string, unknown> = {
    title,
    created: createdAt,
  };
  return stringifyFrontmatter(nextData, parsed.body.trimEnd());
}

export type ReworkStatus = "updated" | "skipped" | "failed";

export type ReworkResult = {
  status: ReworkStatus;
  path: string;
  message?: string;
};

export async function reworkNote(targetArg: string): Promise<ReworkResult> {
  const absolutePath = resolveWritablePath(targetArg);
  logger.info(chalk.cyan(`Reworking note for chunking: ${absolutePath}`));

  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const message = `Note not found: ${absolutePath}`;
      logger.error(message);
      return { status: "failed", path: absolutePath, message };
    }
    throw error;
  }
  if (stats.isDirectory()) {
    const message = `Target is a directory. Use "bun run rework:all ${targetArg}" instead.`;
    logger.error(message);
    return { status: "failed", path: absolutePath, message };
  }

  let noteContent = "";
  try {
    noteContent = await readMarkdown(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const message = `Note not found: ${absolutePath}`;
      logger.error(message);
      return { status: "failed", path: absolutePath, message };
    }
    throw error;
  }

  const createdAt = selectCreatedAt(stats);
  const modifiedAt = new Date(stats.mtimeMs).toISOString();
  const { data } = parseFrontmatter(noteContent);
  const title =
    (typeof data.title === "string" && data.title.trim()) ||
    basename(absolutePath).replace(/\.md$/i, "");

  const response = await reworkContent(
    targetArg,
    title,
    noteContent,
    createdAt,
    modifiedAt,
    config,
    OLLAMA_URL,
  );

  let nextContent = removeAiMarkers(response);
  if (!nextContent) {
    const message = "Model returned empty content; refusing to overwrite note.";
    logger.error(message);
    return { status: "failed", path: absolutePath, message };
  }
  nextContent = ensureFrontmatter(nextContent, title, createdAt);
  const finalContent = nextContent.endsWith("\n")
    ? nextContent
    : `${nextContent}\n`;
  const normalizedExisting = noteContent.trimEnd();
  const normalizedNext = finalContent.trimEnd();
  if (normalizedExisting === normalizedNext) {
    logger.info(chalk.dim(`No changes needed for ${absolutePath}`));
    return { status: "skipped", path: absolutePath };
  }
  await writeFile(absolutePath, finalContent, "utf8");
  logger.info(chalk.green(`Reworked note saved to ${absolutePath}`));
  return { status: "updated", path: absolutePath };
}

async function main() {
  const targetArg = process.argv[2];
  if (!targetArg) {
    logger.error(
      "Usage: bun run src/write/rework_note.ts <relative-or-absolute-path>",
    );
    process.exit(2);
  }

  const result = await reworkNote(targetArg);
  if (result.status === "failed") {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    logger.error(error);
    process.exit(1);
  });
}
