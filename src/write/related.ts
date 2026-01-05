import type { ChunkRecord } from "../db";
import { cosineSimilarity } from "../similarity";

export type RelatedFileScore = { path: string; score: number };

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/");
}

export function rankRelatedFiles(
  noteEmbedding: number[],
  chunkRecords: ChunkRecord[],
  targetPath: string,
  topK: number,
): RelatedFileScore[] {
  const normalizedTarget = normalizePath(targetPath);
  const fileScores = new Map<string, number>();

  for (const chunk of chunkRecords) {
    const normalizedPath = normalizePath(chunk.path);
    if (normalizedPath === normalizedTarget) continue;
    const score = cosineSimilarity(noteEmbedding, chunk.embedding);
    const existing = fileScores.get(normalizedPath);
    if (existing === undefined || score > existing) {
      fileScores.set(normalizedPath, score);
    }
  }

  const ranked = Array.from(fileScores.entries())
    .map(([path, score]) => ({ path, score }))
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, topK);
}
