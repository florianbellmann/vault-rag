import { ollamaGenerate } from "../../ollama";
import type { Embedder } from "../embedding";
import { renderPrompt } from "../prompts";
import type { HybridRetriever } from "../retrieval";
import type { GlobalConfig, RankedChunk, RetrievalFilters } from "../types";

export interface AnswerResult {
  answer: string;
  chunks: RankedChunk[];
  context: string;
  citations: Map<string, string>;
}

/**
 * Coordinates query rewriting, retrieval, and answer generation.
 */
export class AnswerEngine {
  constructor(
    private readonly embedder: Embedder,
    private readonly retriever: HybridRetriever,
    private readonly config: GlobalConfig,
    private readonly ollamaUrl: string,
  ) {}

  async answer(
    question: string,
    filters?: RetrievalFilters,
  ): Promise<AnswerResult> {
    const [questionEmbedding] = await this.embedder.embed([
      { id: "question", text: question },
    ]);
    let retrieved = await this.retriever.retrieve(
      question,
      questionEmbedding.embedding,
      filters,
    );

    if (this.config.features.query_rewriting) {
      const rewrites = await rewriteQueries(
        question,
        this.config,
        this.ollamaUrl,
      );
      for (const rewrite of rewrites) {
        const [rewriteEmbedding] = await this.embedder.embed([
          { id: `rewrite-${rewrite}`, text: rewrite },
        ]);
        const rewriteResults = await this.retriever.retrieve(
          rewrite,
          rewriteEmbedding.embedding,
          filters,
        );
        retrieved = mergeChunks(retrieved, rewriteResults);
      }
    }

    if (this.config.features.iterative_retrieval) {
      const packed = packContext(
        retrieved,
        this.config.retrieval.context_token_budget,
      );
      const followUps = await draftFollowUps(
        question,
        packed.context,
        this.config,
        this.ollamaUrl,
      );
      for (const followUp of followUps) {
        const [followEmbedding] = await this.embedder.embed([
          { id: `gap-${followUp}`, text: followUp },
        ]);
        const followResults = await this.retriever.retrieve(
          followUp,
          followEmbedding.embedding,
          filters,
        );
        retrieved = mergeChunks(retrieved, followResults);
      }
    }

    const packed = packContext(
      retrieved,
      this.config.retrieval.context_token_budget,
    );
    const answer = await generateAnswer(
      question,
      packed.context,
      packed.chunks,
      this.config,
      this.ollamaUrl,
    );

    return {
      answer,
      chunks: packed.chunks,
      context: packed.context,
      citations: packed.citations,
    };
  }
}

/**
 * Drafts alternative search queries to widen recall for ambiguous questions.
 */
async function rewriteQueries(
  question: string,
  config: GlobalConfig,
  ollamaUrl: string,
): Promise<string[]> {
  const prompt = renderPrompt(config.prompts.query_rewrite, { question });
  const response = await ollamaGenerate(prompt, {
    model: config.models.query_rewrite_model,
    ollamaUrl,
    options: { temperature: 0.2, max_tokens: 256 },
  });
  return safeParseJsonArray(response);
}

/**
 * Prompts the model to highlight missing evidence and produce follow-up directives.
 */
async function draftFollowUps(
  question: string,
  context: string,
  config: GlobalConfig,
  ollamaUrl: string,
): Promise<string[]> {
  const prompt = renderPrompt(config.prompts.iterative_gap, {
    question,
    context,
  });
  const response = await ollamaGenerate(prompt, {
    model: config.models.llm_model,
    ollamaUrl,
    options: { temperature: 0.1, max_tokens: 256 },
  });
  return response
    .split("\n")
    .map((line) => line.replace(/^[*-]\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Generates the grounded answer using the QA prompt template.
 */
async function generateAnswer(
  question: string,
  context: string,
  chunks: RankedChunk[],
  config: GlobalConfig,
  ollamaUrl: string,
): Promise<string> {
  const citations = chunks
    .map(
      (chunk, index) =>
        `[C${index + 1}] ${chunk.chunk.filePath} | ${chunk.chunk.headingPath.join(
          " > ",
        )}`,
    )
    .join("\n");
  const prompt = renderPrompt(config.prompts.qa, {
    question,
    context: `${context}\n\nCitations:\n${citations}`,
  });
  return ollamaGenerate(prompt, {
    model: config.models.llm_model,
    ollamaUrl,
    options: {
      temperature: config.models.temperature,
      max_tokens: config.models.max_tokens,
    },
  });
}

/**
 * Packs ranked chunks into the configured token budget and assigns citation labels.
 */
function packContext(
  chunks: RankedChunk[],
  tokenBudget: number,
): { context: string; chunks: RankedChunk[]; citations: Map<string, string> } {
  const deduped: RankedChunk[] = [];
  const seen = new Set<string>();
  let remaining = tokenBudget;
  const citations = new Map<string, string>();
  let labelIndex = 1;
  for (const entry of chunks) {
    if (seen.has(entry.chunk.chunkId)) continue;
    const tokens = entry.chunk.tokens || approximateTokens(entry.chunk.content);
    if (deduped.length > 0 && remaining - tokens < 0) continue;
    deduped.push(entry);
    seen.add(entry.chunk.chunkId);
    remaining -= tokens;
    citations.set(entry.chunk.chunkId, `C${labelIndex++}`);
  }
  const context = deduped
    .map((entry) => {
      const citation = citations.get(entry.chunk.chunkId);
      return `[${citation}] ${entry.chunk.filePath} | ${entry.chunk.headingPath.join(
        " > ",
      )}\n${entry.chunk.content}`;
    })
    .join("\n\n---\n\n");
  return { context, chunks: deduped, citations };
}

/**
 * Merges base and supplemental retrieval results while keeping the top score per chunk.
 */
function mergeChunks(base: RankedChunk[], extra: RankedChunk[]): RankedChunk[] {
  const merged = new Map<string, RankedChunk>();
  for (const entry of [...base, ...extra]) {
    const existing = merged.get(entry.chunk.chunkId);
    if (!existing || entry.score > existing.score) {
      merged.set(entry.chunk.chunkId, entry);
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

function safeParseJsonArray(response: string): string[] {
  try {
    const parsed = JSON.parse(response.trim()) as string[];
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  } catch {
    // fall back to naive splitting
  }
  return response
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function approximateTokens(text: string): number {
  if (!text.trim()) return 0;
  return text.split(/\s+/).length;
}
