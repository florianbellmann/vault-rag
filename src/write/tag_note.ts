import { stripAiBlocks } from "../ai_markers";
import { readText } from "../index/util";
import { ollamaGenerate } from "../ollama";
import { resolveWritablePath } from "./writeback";
import { extractTagsFromResponse, mergeTagsIntoFrontmatter } from "./tagging";
import { logger, chalk } from "../logger";
import { parseFrontmatter } from "./frontmatter";
import { writeFile } from "node:fs/promises";

const OLLAMA_URL = process.env.OLLAMA_URL;
const CHAT_MODEL = process.env.CHAT_MODEL;
if (!OLLAMA_URL) throw new Error("Set OLLAMA_URL before running tag_note.");
if (!CHAT_MODEL) throw new Error("Set CHAT_MODEL before running tag_note.");
const MIN_TAG_CHARS = Number(process.env.TAG_MIN_CHARS ?? "120");

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
    noteContent = await readText(absolutePath);
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

  const prompt = [
    "You are helping organize an Obsidian vault.",
    "Return 3-6 short, universal tags that describe the main themes (e.g., #project-management, #health, #learning, #relationships, #finance, #planning).",
    "Rules:",
    "- Respond with a newline-separated list of tags.",
    "- Each tag must start with '#', be lowercase, and use hyphens for multi-word concepts.",
    "- Focus on broad concepts that could apply to other notes.",
    "",
    "Note content:",
    "```markdown",
    cleanedContent,
    "```",
  ].join("\n");

  const response = await ollamaGenerate(prompt, {
    ollamaUrl: OLLAMA_URL,
    model: CHAT_MODEL,
  });

  const tags = extractTagsFromResponse(response);
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
