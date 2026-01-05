import type { RankedChunk } from "../types";

/**
 * Applies Maximum Marginal Relevance (MMR) to a ranked candidate list to increase diversity.
 *
 * @param candidates - Ranked list sorted by relevance.
 * @param topN - Target number of chunks to keep.
 * @param lambda - Balances relevance vs. diversity (1.0 favors relevance).
 */
export function applyMmr(
  candidates: RankedChunk[],
  topN: number,
  lambda: number,
): RankedChunk[] {
  if (candidates.length <= topN) return candidates;
  const selected: RankedChunk[] = [];
  const remaining = [...candidates];

  while (selected.length < topN && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      if (!candidate) continue;
      const relevance = candidate.score;
      const diversity =
        selected.length === 0
          ? 0
          : Math.max(
              ...selected.map((entry) =>
                cosineSimilarity(
                  entry.chunk.embedding ?? [],
                  candidate.chunk.embedding ?? [],
                ),
              ),
            );
      const mmrScore = lambda * relevance - (1 - lambda) * diversity;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = i;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    if (next) selected.push(next);
  }

  return selected;
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let dot = 0;
  for (let index = 0; index < length; index++) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
  }
  return dot;
}
