import { stripAiBlocks } from "./ai_markers";
import { readText } from "./util";
import { ollamaGenerate } from "./ollama";
import { appendAiBlock, resolveWritablePath } from "./writeback";

const OLLAMA_URL = process.env.OLLAMA_URL;
const CHAT_MODEL = process.env.CHAT_MODEL;
if (!OLLAMA_URL) throw new Error("Set OLLAMA_URL before running summarize_note.");
if (!CHAT_MODEL) throw new Error("Set CHAT_MODEL before running summarize_note.");
const MIN_SUMMARY_CHARS = Number(process.env.SUMMARY_MIN_CHARS ?? "200");

async function main() {
  const targetArg = process.argv[2];
  if (!targetArg) {
    console.error("Usage: bun run src/summarize_note.ts <relative-or-absolute-path>");
    process.exit(2);
  }

  const absolutePath = resolveWritablePath(targetArg);
  let noteContent = "";
  try {
    noteContent = await readText(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`Note not found: ${absolutePath}`);
      process.exit(1);
    }
    throw error;
  }

  const cleanedContent = stripAiBlocks(noteContent).trim();
  if (!cleanedContent) {
    console.error("Note has no user-authored content to summarize.");
    process.exit(1);
  }
  if (cleanedContent.length < MIN_SUMMARY_CHARS) {
    console.error(
      `Note only has ${cleanedContent.length} characters (< ${MIN_SUMMARY_CHARS}); skipping summary.`,
    );
    process.exit(0);
  }

  const prompt = [
    "You are an assistant that summarizes Obsidian daily notes.",
    "Provide two sections:",
    "1. Summary - bullet points highlighting key facts or events.",
    "2. Recommendations - actionable suggestions or follow-ups for tomorrow.",
    "",
    "Keep it concise (<= 6 bullets per section). Use Markdown bullet lists.",
    "",
    "Note content:",
    "```markdown",
    cleanedContent,
    "```",
    "",
    "Answer:",
  ].join("\n");

  const response = await ollamaGenerate(prompt, {
    ollamaUrl: OLLAMA_URL,
    model: CHAT_MODEL,
  });

  const timestamp = new Date().toISOString();
  const blockTitle = `AI Summary (${timestamp})`;
  await appendAiBlock(targetArg, {
    title: blockTitle,
    body: response.trim(),
  });
  console.log(`Appended AI summary to ${absolutePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
