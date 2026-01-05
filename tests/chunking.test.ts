import { describe, expect, test } from "bun:test";
import { makeChunks } from "../src/index/chunking";
import { AI_BLOCK_START, AI_BLOCK_END } from "../src/ai_markers";

describe("makeChunks", () => {
  test("excludes AI blocks from generated chunks", () => {
    const markdown = [
      "# Heading",
      "Real content line",
      AI_BLOCK_START,
      "AI should not be indexed",
      AI_BLOCK_END,
      "More user content",
    ].join("\n");

    const chunks = makeChunks(markdown, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("Real content line");
    expect(chunks[0]?.text).toContain("More user content");
    expect(chunks[0]?.text).not.toContain("AI should not be indexed");
  });
});
