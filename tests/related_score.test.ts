import { describe, expect, test } from "bun:test";
import type { StoredChunk } from "../src/core/store";
import { rankRelatedFiles } from "../src/write/related";

const baseChunk = (overrides: Partial<StoredChunk>): StoredChunk => ({
  chunkId: overrides.chunkId ?? "id",
  filePath: overrides.filePath ?? "Note.md",
  noteTitle: "Title",
  headingPath: ["Title"],
  ordinal: 1,
  chunkType: "text",
  tags: [],
  links: [],
  frontmatter: {},
  mtime: 0,
  content: "",
  representation: "",
  contentHash: "hash",
  tokens: 10,
  embedding: overrides.embedding ?? [1, 0],
});

describe("rankRelatedFiles", () => {
  test("orders files by cosine similarity and excludes source path", () => {
    const noteEmbedding = [1, 0];
    const chunks: StoredChunk[] = [
      baseChunk({ chunkId: "self", filePath: "Note.md", embedding: [1, 0] }),
      baseChunk({ chunkId: "a", filePath: "A.md", embedding: [0.9, 0] }),
      baseChunk({ chunkId: "b", filePath: "B.md", embedding: [0, 1] }),
    ];
    const result = rankRelatedFiles(noteEmbedding, chunks, "Note.md", 5);
    expect(result.map((entry) => entry.path)).toEqual(["A.md", "B.md"]);
  });

  test("caps results at topK", () => {
    const noteEmbedding = [1, 0];
    const chunks: StoredChunk[] = [
      baseChunk({ chunkId: "a", filePath: "A.md", embedding: [1, 0] }),
      baseChunk({ chunkId: "b", filePath: "B.md", embedding: [0.8, 0.2] }),
      baseChunk({ chunkId: "c", filePath: "C.md", embedding: [0.7, 0.1] }),
    ];
    const result = rankRelatedFiles(noteEmbedding, chunks, "Other.md", 2);
    expect(result).toHaveLength(2);
  });
});
