import * as path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { AI_BLOCK_START, AI_BLOCK_END } from "../ai_markers";
import { logger, chalk } from "../logger";

const WRITEBACK_ROOT =
  process.env.WRITEBACK_ROOT ?? process.env.OBSIDIAN_VAULT;
if (!WRITEBACK_ROOT)
  throw new Error("Set WRITEBACK_ROOT or OBSIDIAN_VAULT for writeback scripts.");

const WRITEBACK_ROOT_ABSOLUTE = path.resolve(WRITEBACK_ROOT);

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
  logger.debug(
    `[writeback] Resolved path ${targetPath} -> ${absoluteTarget}`,
  );
  return absoluteTarget;
}

export async function appendAiBlock(
  targetPath: string,
  options: { title: string; body: string },
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
