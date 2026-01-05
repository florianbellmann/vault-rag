import type { ChunkRecord } from "./db";

export type RankedChunk = {
  chunkRecord: ChunkRecord;
  score: number;
};

export function dedupeRankedChunks(
  rankedChunks: RankedChunk[],
  options?: { maxPerPath?: number },
): RankedChunk[] {
  const maxPerPath = Math.max(options?.maxPerPath ?? 1, 1);
  const seenHashes = new Set<string>();
  const pathCounts = new Map<string, number>();
  const output: RankedChunk[] = [];

  for (const entry of rankedChunks) {
    const hashKey = entry.chunkRecord.hash;
    if (hashKey && seenHashes.has(hashKey)) continue;
    const count = pathCounts.get(entry.chunkRecord.path) ?? 0;
    if (count >= maxPerPath) continue;

    if (hashKey) seenHashes.add(hashKey);
    pathCounts.set(entry.chunkRecord.path, count + 1);
    output.push(entry);
  }

  return output;
}
