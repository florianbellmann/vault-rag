import { writeFile } from "node:fs/promises";
import { stripAiBlocks } from "../ai_markers";
import { generateTags } from "../core/augmentation/writebacks";
import { loadConfig } from "../core/config";
import { readMarkdown } from "../core/fs/vault";
import { chalk, logger, setLogLevel } from "../logger";
import { parseFrontmatter } from "./frontmatter";
import { mergeTagsIntoFrontmatter } from "./tagging";
import { resolveWritablePath } from "./writeback";

const config = loadConfig();
setLogLevel(config.paths.log_level);
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MIN_TAG_CHARS = Number(process.env.TAG_MIN_CHARS ?? "120");
const TAG_LIMIT = Number(process.env.TAG_MAX ?? "6");

async function main() {
  const targetArg = process.argv[2];
  if (!targetArg) {
    logger.error(
      "Usage: bun run src/write/tag_note.ts <relative-or-absolute-path>",
    );
    process.exit(2);
  }

  const absolutePath = resolveWritablePath(targetArg);
  logger.info(chalk.cyan(`Generating tags for note: ${absolutePath}`));
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

  const parsed = parseFrontmatter(noteContent);
  const cleanedContent = stripAiBlocks(parsed.body).trim();
  if (cleanedContent.length < MIN_TAG_CHARS) {
    logger.warn(
      `Note only has ${cleanedContent.length} characters (< ${MIN_TAG_CHARS}); skipping tagging.`,
    );
    process.exit(0);
  }

  const tags = await generateTags(
    targetArg,
    cleanedContent,
    TAG_LIMIT,
    config,
    OLLAMA_URL,
  );
  if (tags.length === 0) {
    logger.warn("Model returned no usable tags; skipping writeback.");
    process.exit(1);
  }

  const { content: updatedContent, added } = mergeTagsIntoFrontmatter(
    noteContent,
    tags,
    parsed,
  );

  if (added.length === 0) {
    logger.warn("All generated tags already exist; skipping update.");
    process.exit(0);
  }

  const finalContent = updatedContent.endsWith("\n")
    ? updatedContent
    : `${updatedContent}\n`;
  await writeFile(absolutePath, finalContent, "utf8");
  logger.info(
    chalk.green(
      `Appended ${added.length} tag(s) to ${absolutePath}: ${added.join(", ")}`,
    ),
  );
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
