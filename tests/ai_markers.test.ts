import { describe, expect, test } from "bun:test";
import {
  AI_BLOCK_START,
  AI_BLOCK_END,
  stripAiBlocks,
} from "../src/ai_markers";

describe("stripAiBlocks", () => {
  test("removes single AI block", () => {
    const input = [
      "Hello world",
      AI_BLOCK_START,
      "Generated content",
      AI_BLOCK_END,
      "Goodbye",
    ].join("\n");
    const output = stripAiBlocks(input);
    expect(output).toBe("Hello world\nGoodbye");
  });

  test("removes multiple AI blocks and trims leading whitespace", () => {
    const input = `
Intro
${AI_BLOCK_START}
Block A
${AI_BLOCK_END}
Middle
${AI_BLOCK_START}
Block B
${AI_BLOCK_END}
`.trim();

    const output = stripAiBlocks(input);
    expect(output).toBe("Intro\nMiddle");
  });

  test("returns original string when no markers exist", () => {
    const input = "Plain text";
    expect(stripAiBlocks(input)).toBe(input);
  });
});
