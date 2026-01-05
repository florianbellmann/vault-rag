import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

describe("writeback utilities", () => {
  let resolveWritablePath: typeof import("../src/writeback").resolveWritablePath;
  let appendAiBlock: typeof import("../src/writeback").appendAiBlock;
  let rootDir: string;

  beforeAll(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "writeback-"));
    process.env.WRITEBACK_ROOT = rootDir;
    const module = await import("../src/writeback");
    resolveWritablePath = module.resolveWritablePath;
    appendAiBlock = module.appendAiBlock;
  });

  test("resolveWritablePath allows relative path inside root", () => {
    const resolved = resolveWritablePath("daily/note.md");
    expect(resolved.startsWith(rootDir)).toBeTruthy();
  });

  test("resolveWritablePath prevents escape outside root", () => {
    expect(() => resolveWritablePath("../outside.md")).toThrow();
  });

  test("appendAiBlock writes markers and preserves existing text", async () => {
    const target = "daily/ai-note.md";
    await appendAiBlock(target, {
      title: "AI Summary",
      body: "Line A",
    });
    await appendAiBlock(target, {
      title: "Second Block",
      body: "Line B",
    });

    const absolutePath = resolveWritablePath(target);
    const fileContent = await readFile(absolutePath, "utf8");
    const blocks = fileContent.trim().split("<!-- AI:BEGIN -->").filter(Boolean);
    expect(blocks).toHaveLength(2);
    expect(fileContent).toContain("<!-- AI:END -->");
  });
});
