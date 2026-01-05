import { describe, expect, test } from "bun:test";
import { fuseCandidates } from "../src/core/retrieval";
import { applyMmr } from "../src/core/retrieval/mmr";
import type { RankedChunk } from "../src/core/types";

function makeChunk(
  id: string,
  filePath: string,
  embedding: number[],
  score: number,
): RankedChunk {
  return {
    chunk: {
      chunkId: id,
      filePath,
      noteTitle: "Note",
      headingPath: ["Note"],
      ordinal: 1,
      chunkType: "text",
      tags: [],
      links: [],
      frontmatter: {},
      mtime: 1,
      content: "Text",
      representation: "rep",
      contentHash: "hash",
      tokens: 10,
      embedding,
    },
    score,
  };
}

describe("retrieval fusion and MMR", () => {
  test("fuses lexical and vector signals", () => {
    const vector = [
      makeChunk("a", "noteA.md", [1, 0], 0.9),
      makeChunk("b", "noteB.md", [0.9, 0], 0.8),
    ];
    const second = vector[1];
    const first = vector[0];
    if (!first || !second) {
      throw new Error("Vector candidates missing in test setup.");
    }
    const lexical = [
      { chunk: second.chunk, score: 0.8 },
      { chunk: first.chunk, score: 0.7 },
    ];
    const fused = fuseCandidates(vector, lexical, {
      vector: 0.3,
      lexical: 0.7,
    });
    expect(fused[0]?.chunk.chunkId).toBe("b");
  });

  test("applies MMR for diversity", () => {
    const candidates = [
      makeChunk("a", "noteA.md", [1, 0], 0.9),
      makeChunk("b", "noteB.md", [0.99, 0], 0.85),
      makeChunk("c", "noteC.md", [0, 1], 0.8),
    ];
    const diversified = applyMmr(candidates, 2, 0.5);
    const ids = diversified.map((entry) => entry.chunk.chunkId);
    expect(ids).toContain("c");
  });
});
