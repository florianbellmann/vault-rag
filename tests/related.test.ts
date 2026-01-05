import { describe, expect, test } from "bun:test";
import { rankRelatedFiles } from "../src/write/related";
import type { ChunkRecord } from "../src/db";

const mockChunks: ChunkRecord[] = [
  {
    chunkId: "noteA:0",
    path: "noteA.md",
    chunkIndex: 0,
    heading: "A",
    mtime: 0,
    hash: "",
    text: "",
    embedding: [1, 0, 0],
  },
  {
    chunkId: "noteB:0",
    path: "noteB.md",
    chunkIndex: 0,
    heading: "B",
    mtime: 0,
    hash: "",
    text: "",
    embedding: [0, 1, 0],
  },
  {
    chunkId: "noteB:1",
    path: "noteB.md",
    chunkIndex: 1,
    heading: "B2",
    mtime: 0,
    hash: "",
    text: "",
    embedding: [0, 0.8, 0.2],
  },
  {
    chunkId: "noteC:0",
    path: "noteC.md",
    chunkIndex: 0,
    heading: "C",
    mtime: 0,
    hash: "",
    text: "",
    embedding: [0.5, 0.5, 0],
  },
];

describe("rankRelatedFiles", () => {
  test("returns sorted candidates excluding the target path", () => {
    const result = rankRelatedFiles([0.6, 0.8, 0], mockChunks, "noteB.md", 5);
    expect(result.map((r) => r.path)).toEqual(["noteC.md", "noteA.md"]);
  });

  test("limits results to topK", () => {
    const result = rankRelatedFiles([1, 0, 0], mockChunks, "noteX.md", 1);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe("noteA.md");
  });

  test("returns empty when only matching file exists", () => {
    const result = rankRelatedFiles([0, 1, 0], mockChunks, "noteB.md", 5);
    expect(result.map((r) => r.path)).toEqual(["noteC.md", "noteA.md"]);
  });
});
