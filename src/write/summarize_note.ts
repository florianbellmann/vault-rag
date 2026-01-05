import { basename } from "node:path";
import { stripAiBlocks } from "../ai_markers";
import { summarizeContent } from "../core/augmentation/writebacks";
import { loadConfig } from "../core/config";
import { readMarkdown } from "../core/fs/vault";
import { parseFrontmatter } from "../core/metadata/frontmatter";
import { chalk, logger, setLogLevel } from "../logger";
import { appendAiBlock, resolveWritablePath } from "./writeback";

const config = loadConfig();
setLogLevel(config.paths.log_level);
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MIN_SUMMARY_CHARS = Number(process.env.SUMMARY_MIN_CHARS ?? "200");

async function main() {
  const targetArg = process.argv[2];
  if (!targetArg) {
    logger.error(
      "Usage: bun run src/write/summarize_note.ts <relative-or-absolute-path>",
    );
    process.exit(2);
  }

  const absolutePath = resolveWritablePath(targetArg);
  logger.info(chalk.cyan(`Summarizing note: ${absolutePath}`));
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
  logger.debug(
    `Original length: ${noteContent.length} chars (with AI blocks included).`,
  );

  const cleanedContent = stripAiBlocks(noteContent).trim();
  if (!cleanedContent) {
    logger.warn(
      "Note has no user-authored content after removing AI blocks; skipping.",
    );
    process.exit(1);
  }
  if (cleanedContent.length < MIN_SUMMARY_CHARS) {
    logger.warn(
      `Note only has ${cleanedContent.length} characters (< ${MIN_SUMMARY_CHARS}); skipping summary.`,
    );
    process.exit(0);
  }
  logger.info(
    chalk.green(
      `Generating summary for ${cleanedContent.length} characters of user content...`,
    ),
  );

  const { data, body } = parseFrontmatter(cleanedContent);
  const title =
    (typeof data.title === "string" && data.title) ||
    basename(absolutePath).replace(/\.md$/i, "");
  const response = await summarizeContent(
    targetArg,
    title,
    body.trim() || cleanedContent,
    config,
    OLLAMA_URL,
  );

  const timestamp = new Date().toISOString();
  const blockTitle = "AI Summary";
  logger.info(chalk.cyan("Writing summary block to note..."));
  await appendAiBlock(targetArg, {
    title: blockTitle,
    body: `Generated: ${timestamp}\n\n${response.trim()}`,
    replaceTitlePredicate: (titleLine) => titleLine.startsWith("AI Summary"),
  });
  logger.info(chalk.green(`Appended AI summary to ${absolutePath}`));
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
