import type { VectorStore } from "../store";
import type { GlobalConfig, RankedChunk, RetrievalFilters } from "../types";
import { applyMmr } from "./mmr";
import type { Reranker } from "./reranker";

/**
 * Hybrid retriever that combines vector similarity with lexical FTS matching,
 * optional MMR diversification, and reranking.
 */
export class HybridRetriever {
  constructor(
    private readonly store: VectorStore,
    private readonly config: GlobalConfig,
    private readonly reranker?: Reranker,
  ) {}

  async retrieve(
    question: string,
    questionEmbedding: number[],
    filters?: RetrievalFilters,
  ): Promise<RankedChunk[]> {
    const { retrieval, features } = this.config;
    const vectorCandidates = this.scoreVectorCandidates(
      questionEmbedding,
      retrieval.vector_top_k,
      filters,
    );
    const lexicalCandidates = features.hybrid_retrieval
      ? this.store.lexicalSearch(question, retrieval.lexical_top_k, filters)
      : [];

    const fused = fuseCandidates(
      vectorCandidates,
      lexicalCandidates,
      retrieval.fusion_weights,
    );

    const deduped = dedupeFused(fused);
    const diversified =
      features.mmr_diversification && deduped.length > retrieval.rerank_top_n
        ? applyMmr(
            deduped.slice(0, retrieval.diversification_pool),
            retrieval.rerank_top_n,
            retrieval.mmr_lambda,
          )
        : deduped.slice(0, retrieval.rerank_top_n);

    if (features.reranking && this.reranker) {
      return this.reranker.rerank(question, diversified);
    }

    return diversified;
  }

  private scoreVectorCandidates(
    queryEmbedding: number[],
    limit: number,
    filters?: RetrievalFilters,
  ): RankedChunk[] {
    const allChunks = this.store.listAllChunks();
    const filtered = filters
      ? allChunks.filter((chunk) => matchesFilters(chunk, filters))
      : allChunks;
    const scored = filtered.map((chunk) => ({
      chunk,
      score:
        dot(chunk.embedding ?? [], queryEmbedding) +
        recencyBoost(chunk.mtime, this.config.retrieval.recency_boost),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}

export function fuseCandidates(
  vectorScores: RankedChunk[],
  lexicalScores: Array<{ chunk: RankedChunk["chunk"]; score: number }>,
  weights: { vector: number; lexical: number },
): RankedChunk[] {
  const scores = new Map<string, number>();
  for (let index = 0; index < vectorScores.length; index++) {
    const candidate = vectorScores[index];
    const contribution = weights.vector / (1 + index);
    scores.set(
      candidate.chunk.chunkId,
      (scores.get(candidate.chunk.chunkId) ?? 0) + contribution,
    );
  }
  for (let index = 0; index < lexicalScores.length; index++) {
    const candidate = lexicalScores[index];
    const contribution = weights.lexical / (1 + index);
    scores.set(
      candidate.chunk.chunkId,
      (scores.get(candidate.chunk.chunkId) ?? 0) + contribution,
    );
  }
  const uniqueChunks = new Map<string, RankedChunk["chunk"]>();
  for (const entry of vectorScores) {
    uniqueChunks.set(entry.chunk.chunkId, entry.chunk);
  }
  for (const entry of lexicalScores) {
    uniqueChunks.set(entry.chunk.chunkId, entry.chunk);
  }
  return [...scores.entries()]
    .map(([chunkId, score]) => {
      const chunk = uniqueChunks.get(chunkId);
      if (!chunk) return null;
      return { chunk, score };
    })
    .filter((entry): entry is RankedChunk => Boolean(entry))
    .sort((a, b) => b.score - a.score);
}

export function dedupeFused(entries: RankedChunk[]): RankedChunk[] {
  const seenFiles = new Map<string, number>();
  const result: RankedChunk[] = [];
  for (const entry of entries) {
    const count = seenFiles.get(entry.chunk.filePath) ?? 0;
    if (count >= 2) continue;
    seenFiles.set(entry.chunk.filePath, count + 1);
    result.push(entry);
  }
  return result;
}

function matchesFilters(
  chunk: RankedChunk["chunk"],
  filters: RetrievalFilters,
): boolean {
  if (filters.pathPrefix && !chunk.filePath.startsWith(filters.pathPrefix)) {
    return false;
  }
  if (
    filters.tags &&
    filters.tags.length > 0 &&
    !filters.tags.some((tag) => chunk.tags.includes(tag))
  ) {
    return false;
  }
  if (
    filters.chunkTypes &&
    filters.chunkTypes.length > 0 &&
    !filters.chunkTypes.includes(chunk.chunkType)
  ) {
    return false;
  }
  return true;
}

function dot(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let sum = 0;
  for (let index = 0; index < length; index++) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    sum += leftValue * rightValue;
  }
  return sum;
}

function recencyBoost(mtime: number, weight: number): number {
  if (weight <= 0) return 0;
  const ageDays = (Date.now() - mtime) / (1000 * 60 * 60 * 24);
  if (!Number.isFinite(ageDays) || ageDays <= 0) return weight;
  return weight / (1 + ageDays);
}
