import { describe, expect, test } from "bun:test";
import { AI_BLOCK_END, AI_BLOCK_START } from "../src/ai_markers";
import { chunkMarkdown } from "../src/core/chunking/markdownChunker";
import type { ChunkingConfiguration } from "../src/core/types";

const config: ChunkingConfiguration = {
  target_tokens: 50,
  max_tokens: 80,
  min_tokens: 10,
  overlap_tokens: 5,
  merge_small_chunks: true,
  strong_boundaries: {
    hr: true,
    callout: true,
    list: true,
    code: true,
    table: true,
  },
  metadata_prefix_strategy: "heading_path",
};

describe("chunkMarkdown", () => {
  test("strips AI blocks and preserves metadata", () => {
    const markdown = [
      "---",
      'tags: ["#foo"]',
      "---",
      "# Heading",
      "Real content line",
      AI_BLOCK_START,
      "AI should not be indexed",
      AI_BLOCK_END,
      "More user content",
    ].join("\n");
    const chunks = chunkMarkdown(
      { filePath: "Note.md", markdown, mtime: 1 },
      config,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain("Real content line");
    expect(chunks[0]?.content).not.toContain("AI should not be indexed");
    expect(chunks[0]?.tags).toEqual(["foo"]);
    expect(chunks[0]?.headingPath).toEqual(["Heading"]);
  });

  test("keeps code blocks intact", () => {
    const markdown = ["# H1", "```ts", "const foo = 1;", "```"].join("\n");
    const chunks = chunkMarkdown(
      { filePath: "Note.md", markdown, mtime: 1 },
      config,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.chunkType).toBe("code");
    expect(chunks[0]?.content).toContain("const foo");
  });

  test("respects callout boundaries", () => {
    const markdown = ["# H1", "> [!NOTE] callout", "", "Paragraph"].join("\n");
    const chunks = chunkMarkdown(
      { filePath: "Note.md", markdown, mtime: 1 },
      config,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.chunkType).toBe("callout");
  });
});
