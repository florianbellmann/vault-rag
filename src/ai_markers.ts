export const AI_BLOCK_START = "<!-- AI:BEGIN -->";
export const AI_BLOCK_END = "<!-- AI:END -->";
const AI_BLOCK_PATTERN = /<!-- AI:BEGIN -->([\s\S]*?)<!-- AI:END -->/g;

// Removes any AI-generated writeback blocks to keep indexing clean.
export function stripAiBlocks(input: string): string {
  if (!input.includes(AI_BLOCK_START)) return input;
  const cleaned = input.replace(AI_BLOCK_PATTERN, "\n");
  return cleaned.replace(/\n{2,}/g, "\n").trim();
}
