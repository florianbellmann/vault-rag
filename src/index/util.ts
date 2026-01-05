import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import * as path from "node:path";

const IGNORE_DIRECTORIES = new Set([".obsidian", ".trash", ".git"]);

// Recursively walks the vault and yields markdown file paths.
export async function* iterMarkdownFiles(
  rootDirectory: string,
): AsyncGenerator<string> {
  async function* walk(directory: string): AsyncGenerator<string> {
    const directoryEntries = await readdir(directory, { withFileTypes: true });
    for (const entry of directoryEntries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRECTORIES.has(entry.name)) continue;
        yield* walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        yield fullPath;
      }
    }
  }
  yield* walk(rootDirectory);
}

// Reads a UTF-8 text file.
export async function readText(filePath: string): Promise<string> {
  const fileBuffer = await readFile(filePath);
  return fileBuffer.toString("utf-8");
}

// Creates a hex sha256 of the provided string.
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// Returns the file's mtime in seconds (easier to compare than ms).
export async function mtimeSeconds(filePath: string): Promise<number> {
  const fileStats = await stat(filePath);
  return Math.floor(fileStats.mtimeMs / 1000);
}
