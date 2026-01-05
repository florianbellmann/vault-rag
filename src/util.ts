import { createHash } from "node:crypto";
import * as path from "node:path";
import { readdir, stat, readFile } from "node:fs/promises";

const IGNORE_DIRS = new Set([".obsidian", ".trash", ".git"]);

// Recursively walks the vault and yields markdown file paths.
export async function* iterMarkdownFiles(root: string): AsyncGenerator<string> {
  async function* walk(dir: string): AsyncGenerator<string> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        yield* walk(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        yield full;
      }
    }
  }
  yield* walk(root);
}

// Reads a UTF-8 text file.
export async function readText(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return buf.toString("utf-8");
}

// Creates a hex sha256 of the provided string.
export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// Returns the file's mtime in seconds (easier to compare than ms).
export async function mtimeSeconds(filePath: string): Promise<number> {
  const st = await stat(filePath);
  return Math.floor(st.mtimeMs / 1000);
}
