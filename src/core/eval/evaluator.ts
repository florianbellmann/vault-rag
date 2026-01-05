import { readFile } from "node:fs/promises";
import type { AnswerEngine } from "../augmentation/qa_engine";

export interface EvalQuestion {
  question: string;
  expected_paths: string[];
}

export interface EvalMetrics {
  recall_at_k: number;
  citation_accuracy: number;
}

/**
 * Evaluation harness that reuses the answer pipeline to compute recall@k and citation accuracy.
 */
export class Evaluator {
  constructor(
    private readonly engine: AnswerEngine,
    private readonly topK: number,
  ) {}

  async evaluateFile(path: string): Promise<EvalMetrics> {
    const content = await readFile(path, "utf8");
    const cases = JSON.parse(content) as EvalQuestion[];
    let totalRecall = 0;
    let totalCitation = 0;
    for (const entry of cases) {
      const result = await this.engine.answer(entry.question);
      const retrievedPaths = result.chunks
        .slice(0, this.topK)
        .map((chunk) => chunk.chunk.filePath);
      totalRecall += computeRecall(retrievedPaths, entry.expected_paths);
      const citedPaths = result.chunks.map((chunk) => chunk.chunk.filePath);
      totalCitation += computeCitationAccuracy(
        citedPaths,
        entry.expected_paths,
      );
    }
    const denominator = Math.max(cases.length, 1);
    return {
      recall_at_k: totalRecall / denominator,
      citation_accuracy: totalCitation / denominator,
    };
  }
}

function computeRecall(retrieved: string[], expected: string[]): number {
  if (expected.length === 0) return 1;
  const hits = expected.filter((path) => retrieved.includes(path)).length;
  return hits / expected.length;
}

function computeCitationAccuracy(
  citations: string[],
  expected: string[],
): number {
  if (citations.length === 0) return 0;
  if (expected.length === 0) return 1;
  const hits = citations.filter((path) => expected.includes(path)).length;
  return hits / citations.length;
}
