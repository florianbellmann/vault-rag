import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { AI_BLOCK_END, AI_BLOCK_START, removeAiBlocks } from "../ai_markers";
import { loadConfig } from "../core/config";
import { chalk, logger } from "../logger";

const config = loadConfig();
const WRITEBACK_ROOT =
  process.env.WRITEBACK_ROOT ??
  process.env.OBSIDIAN_VAULT ??
  config.paths.vault;
if (!WRITEBACK_ROOT) {
  throw new Error("Set WRITEBACK_ROOT/OBSIDIAN_VAULT or update config paths.");
}

const WRITEBACK_ROOT_ABSOLUTE = path.resolve(WRITEBACK_ROOT);

/**
 * Resolves a user-supplied path relative to the writeback root while preventing directory traversal.
 *
 * @param targetPath - Absolute or vault-relative path to a note.
 * @returns Absolute, normalized path inside the configured writeback root.
 */
export function resolveWritablePath(targetPath: string): string {
  const absoluteTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(WRITEBACK_ROOT_ABSOLUTE, targetPath);
  const normalizedRoot = WRITEBACK_ROOT_ABSOLUTE.endsWith(path.sep)
    ? WRITEBACK_ROOT_ABSOLUTE
    : `${WRITEBACK_ROOT_ABSOLUTE}${path.sep}`;
  if (
    absoluteTarget !== WRITEBACK_ROOT_ABSOLUTE &&
    !absoluteTarget.startsWith(normalizedRoot)
  ) {
    throw new Error(
      `Refusing to write outside of ${WRITEBACK_ROOT_ABSOLUTE}: ${absoluteTarget}`,
    );
  }
  logger.debug(`[writeback] Resolved path ${targetPath} -> ${absoluteTarget}`);
  return absoluteTarget;
}

/**
 * Appends or replaces an AI block wrapped in `<!-- AI:BEGIN -->` markers.
 *
 * @param targetPath - Relative or absolute path passed by the CLI command.
 * @param options - Block metadata plus a predicate to replace existing sections.
 */
export async function appendAiBlock(
  targetPath: string,
  options: {
    title: string;
    body: string;
    replaceTitlePredicate?: (titleLine: string) => boolean;
  },
): Promise<string> {
  const absolutePath = resolveWritablePath(targetPath);
  const directoryPath = path.dirname(absolutePath);
  await mkdir(directoryPath, { recursive: true });

  let existing = "";
  try {
    existing = await readFile(absolutePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    logger.debug(`[writeback] Creating new file ${absolutePath}`);
  }
  if (options.replaceTitlePredicate) {
    const result = removeAiBlocks(existing, options.replaceTitlePredicate);
    if (result.removed > 0) {
      logger.info(
        chalk.dim(
          `[writeback] Removed ${result.removed} existing AI block(s) that matched replace predicate.`,
        ),
      );
    }
    existing = result.content;
  }
  existing = existing.trimEnd();

  const blockTitle = options.title.trim();
  const blockBody = options.body.trim();
  logger.info(
    chalk.green(
      `[writeback] Appending block "${blockTitle}" to ${absolutePath}`,
    ),
  );
  const aiBlock = [
    AI_BLOCK_START,
    blockTitle,
    "",
    blockBody,
    AI_BLOCK_END,
    "",
  ].join("\n");

  const nextContent = existing ? `${existing}\n\n${aiBlock}` : aiBlock;
  await writeFile(absolutePath, `${nextContent}\n`, "utf8");
  logger.info(
    chalk.green(
      `[writeback] Finished writing block to ${absolutePath} (length ${blockBody.length} chars)`,
    ),
  );
  return absolutePath;
}
