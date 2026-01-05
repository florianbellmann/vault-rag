import { describe, expect, test } from "bun:test";
import { cosineSimilarity } from "../src/similarity";

describe("cosineSimilarity", () => {
  test("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  test("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  test("handles zero vectors safely", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});
