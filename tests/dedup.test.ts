import { describe, expect, test } from "bun:test";
import type { ChunkRecord } from "../src/db";
import { dedupeRankedChunks } from "../src/dedup";

const chunk = (overrides: Partial<ChunkRecord>): ChunkRecord => ({
  chunkId: "id",
  path: "note.md",
  chunkIndex: 0,
  heading: "",
  mtime: 0,
  hash: "hash",
  text: "",
  embedding: [],
  ...overrides,
});

describe("dedupeRankedChunks", () => {
  test("removes duplicate hashes", () => {
    const entries = [
      {
        chunkRecord: chunk({ chunkId: "a", hash: "x", path: "noteA.md" }),
        score: 0.9,
      },
      {
        chunkRecord: chunk({ chunkId: "b", hash: "x", path: "noteA.md" }),
        score: 0.8,
      },
    ];
    const result = dedupeRankedChunks(entries, { maxPerPath: 2 });
    expect(result).toHaveLength(1);
    expect(result[0]?.chunkRecord.chunkId).toBe("a");
  });

  test("limits number of chunks per path", () => {
    const entries = [
      {
        chunkRecord: chunk({ chunkId: "a", hash: "x", path: "noteA.md" }),
        score: 0.9,
      },
      {
        chunkRecord: chunk({ chunkId: "b", hash: "y", path: "noteA.md" }),
        score: 0.8,
      },
      {
        chunkRecord: chunk({ chunkId: "c", hash: "z", path: "noteB.md" }),
        score: 0.7,
      },
    ];
    const result = dedupeRankedChunks(entries, { maxPerPath: 1 });
    expect(result.map((r) => r.chunkRecord.chunkId)).toEqual(["a", "c"]);
  });

  test("defaults to one chunk per path when option omitted", () => {
    const entries = [
      {
        chunkRecord: chunk({ chunkId: "a", hash: "x", path: "noteA.md" }),
        score: 0.9,
      },
      {
        chunkRecord: chunk({ chunkId: "b", hash: "y", path: "noteA.md" }),
        score: 0.8,
      },
    ];
    const result = dedupeRankedChunks(entries);
    expect(result).toHaveLength(1);
  });
});
