import { describe, expect, test } from "bun:test";
import { createVectorStore } from "../src/core/store";
import type { StoredChunk } from "../src/core/store";

describe("SQLite FTS lexical search", () => {
  test("does not throw on punctuation-heavy queries", () => {
    const store = createVectorStore(":memory:");
    const chunk: StoredChunk = {
      chunkId: "chunk-1",
      filePath: "Notes/Leadership.md",
      noteTitle: "Leadership",
      headingPath: ["Leadership"],
      ordinal: 0,
      chunkType: "text",
      tags: [],
      links: [],
      frontmatter: {},
      mtime: Date.now(),
      content: "Leadership principles and team alignment.",
      representation: "Leadership principles and team alignment.",
      contentHash: "hash-1",
      tokens: 5,
      embedding: [0, 0, 0],
    };

    store.upsertChunks([chunk]);

    expect(() => store.lexicalSearch("`", 5)).not.toThrow();
    expect(() => store.lexicalSearch('`leadership` "team"', 5)).not.toThrow();
    const results = store.lexicalSearch('`leadership` "team"', 5);
    expect(results.length).toBeGreaterThan(0);

    store.close();
  });
});
