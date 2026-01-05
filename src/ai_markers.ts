export const AI_BLOCK_START = "<!-- AI:BEGIN -->";
export const AI_BLOCK_END = "<!-- AI:END -->";
const AI_BLOCK_PATTERN = /<!-- AI:BEGIN -->([\s\S]*?)<!-- AI:END -->/g;

/**
 * Removes any AI-generated writeback blocks to keep indexing clean.
 */
export function stripAiBlocks(input: string): string {
  if (!input.includes(AI_BLOCK_START)) return input;
  const cleaned = input.replace(AI_BLOCK_PATTERN, "\n");
  return cleaned.replace(/\n{2,}/g, "\n").trim();
}

/**
 * Removes AI blocks whose title line satisfies a predicate—used when refreshing writebacks.
 */
export function removeAiBlocks(
  input: string,
  shouldRemove: (titleLine: string) => boolean,
): { content: string; removed: number } {
  if (!input.includes(AI_BLOCK_START)) return { content: input, removed: 0 };
  let removedCount = 0;
  const replaced = input.replace(AI_BLOCK_PATTERN, (match, inner) => {
    const titleLine =
      inner
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "";
    if (shouldRemove(titleLine)) {
      removedCount++;
      return "";
    }
    return match;
  });
  const cleaned = replaced.replace(/\n{3,}/g, "\n\n").trimEnd();
  return { content: cleaned, removed: removedCount };
}
