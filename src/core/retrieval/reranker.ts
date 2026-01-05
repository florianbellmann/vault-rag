import { ollamaGenerate } from "../../ollama";
import { renderPrompt } from "../prompts";
import type {
  ModelConfiguration,
  PromptTemplates,
  RankedChunk,
} from "../types";

export interface Reranker {
  rerank(question: string, candidates: RankedChunk[]): Promise<RankedChunk[]>;
}

/**
 * Lightweight reranker that prompts an Ollama model with structured chunk previews.
 */
export class OllamaReranker implements Reranker {
  constructor(
    private readonly baseUrl: string,
    private readonly models: ModelConfiguration,
    private readonly prompts: PromptTemplates,
  ) {}

  async rerank(
    question: string,
    candidates: RankedChunk[],
  ): Promise<RankedChunk[]> {
    if (candidates.length <= 1) return candidates;
    const preview = candidates
      .map(
        (entry) =>
          `ID: ${entry.chunk.chunkId}\nHeading: ${entry.chunk.headingPath.join(
            " > ",
          )}\nContent:\n${entry.chunk.content.slice(0, 800)}`,
      )
      .join("\n\n");
    const prompt = renderPrompt(this.prompts.reranker, {
      question,
      chunks: preview,
    });
    const response = await ollamaGenerate(prompt, {
      model: this.models.reranker_model,
      ollamaUrl: this.baseUrl,
      options: {
        temperature: 0,
        max_tokens: 256,
      },
    });
    const orderedIds = safeParseIds(response);
    if (!orderedIds.length) return candidates;
    const byId = new Map(
      candidates.map((entry) => [entry.chunk.chunkId, entry]),
    );
    const reranked: RankedChunk[] = [];
    for (const id of orderedIds) {
      const candidate = byId.get(id);
      if (candidate) reranked.push(candidate);
    }
    for (const entry of candidates) {
      if (!orderedIds.includes(entry.chunk.chunkId)) reranked.push(entry);
    }
    return reranked;
  }
}

function safeParseIds(response: string): string[] {
  try {
    const parsed = JSON.parse(response.trim()) as string[];
    if (Array.isArray(parsed)) {
      return parsed.map((value) => String(value));
    }
  } catch {
    // Fall through to fallback behaviour.
  }
  return [];
}
