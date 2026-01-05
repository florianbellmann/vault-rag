import { describe, expect, test } from "bun:test";
import {
  parseFrontmatter,
  stringifyFrontmatter,
} from "../src/core/metadata/frontmatter";

describe("parseFrontmatter", () => {
  test("parses existing frontmatter", () => {
    const content = `---
tags:
  - #foo
---
Body text`;
    const parsed = parseFrontmatter(content);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.data.tags).toEqual(["#foo"]);
    expect(parsed.body).toBe("Body text");
  });

  test("handles missing frontmatter", () => {
    const content = "No frontmatter\nLine2";
    const parsed = parseFrontmatter(content);
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe(content);
  });

  test("ignores unterminated frontmatter", () => {
    const content = "---\ntags: #foo\nBody";
    const parsed = parseFrontmatter(content);
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.body).toBe(content);
  });
});

describe("stringifyFrontmatter", () => {
  test("serializes frontmatter with body", () => {
    const result = stringifyFrontmatter(
      { tags: ["#foo", "#bar"] },
      "Content\nWith lines",
    );
    expect(result).toBe(
      `---
tags:
  - "#foo"
  - "#bar"
---
Content
With lines`,
    );
  });

  test("creates empty frontmatter when data missing", () => {
    const result = stringifyFrontmatter({}, "Body text");
    expect(result).toBe(`---
---
Body text`);
  });
});
