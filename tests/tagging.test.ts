import { describe, expect, test } from "bun:test";
import {
  extractTagsFromResponse,
  mergeTagsIntoFrontmatter,
  normalizeTagCandidate,
} from "../src/write/tagging";

describe("normalizeTagCandidate", () => {
  test("converts multi-word phrases to kebab-case hash tags", () => {
    expect(normalizeTagCandidate("Productivity Hacks")).toBe(
      "#productivity-hacks",
    );
  });

  test("strips invalid characters and leading hashes", () => {
    expect(normalizeTagCandidate(" #Health&Wellness! ")).toBe(
      "#healthwellness",
    );
  });

  test("returns null for empty strings", () => {
    expect(normalizeTagCandidate("")).toBeNull();
    expect(normalizeTagCandidate("#")).toBeNull();
  });
});

describe("extractTagsFromResponse", () => {
  test("parses newline separated tags", () => {
    const response = "#learning\n#career-development\n#health";
    expect(extractTagsFromResponse(response, 5)).toEqual([
      "#learning",
      "#career-development",
      "#health",
    ]);
  });

  test("parses comma separated phrases", () => {
    const response = "Wellness, Deep Work, Creativity";
    expect(extractTagsFromResponse(response, 3)).toEqual([
      "#wellness",
      "#deep-work",
      "#creativity",
    ]);
  });

  test("deduplicates and stops at max tags", () => {
    const response = "#focus\nFocus\nplanning\nPlanning\nrelationships";
    expect(extractTagsFromResponse(response, 2)).toEqual([
      "#focus",
      "#planning",
    ]);
  });
});

describe("mergeTagsIntoFrontmatter", () => {
  test("appends tags to existing frontmatter list", () => {
    const note = `---
tags:
  - #existing
---
Body`;
    const result = mergeTagsIntoFrontmatter(note, ["#new-tag"]);
    expect(result.added).toEqual(["#new-tag"]);
    expect(result.tags).toEqual(["#existing", "#new-tag"]);
    expect(result.content).toContain("#existing");
    expect(result.content).toContain("#new-tag");
  });

  test("creates frontmatter when missing", () => {
    const note = "Body without frontmatter";
    const result = mergeTagsIntoFrontmatter(note, ["#first"]);
    expect(result.added).toEqual(["#first"]);
    expect(result.content.startsWith("---")).toBe(true);
    expect(result.content).toContain("#first");
  });

  test("skips already existing tags", () => {
    const note = `---
tags:
  - #existing
---
Body`;
    const result = mergeTagsIntoFrontmatter(note, ["#existing"]);
    expect(result.added).toEqual([]);
    expect(result.content).toBe(note);
  });
});
