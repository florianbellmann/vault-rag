import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const IGNORE_DIRECTORIES = new Set([".obsidian", ".trash", ".git"]);

/**
 * Recursively iterates through Markdown files inside the provided vault path.
 */
export async function* iterVaultMarkdown(
  rootDirectory: string,
): AsyncGenerator<{ absolute: string; relative: string }> {
  async function* walk(directory: string): AsyncGenerator<string> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRECTORIES.has(entry.name)) continue;
        yield* walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        yield fullPath;
      }
    }
  }

  for await (const absolutePath of walk(rootDirectory)) {
    yield {
      absolute: absolutePath,
      relative: relative(rootDirectory, absolutePath),
    };
  }
}

/**
 * Reads a Markdown file with UTF-8 encoding.
 */
export async function readMarkdown(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return buffer.toString("utf8");
}

/**
 * Returns the file mtime rounded to seconds.
 */
export async function fileMtimeSeconds(filePath: string): Promise<number> {
  const fileStats = await stat(filePath);
  return Math.floor(fileStats.mtimeMs / 1000);
}

/**
 * Convenience helper for hashing a string. Used for chunk content hashes.
 */
export function sha1(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("hex");
}
