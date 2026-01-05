import { ollamaEmbed } from "../../ollama";
import type { ModelConfiguration } from "../types";

/**
 * Text fragment queued for embedding.
 */
export interface EmbeddingPayload {
  /** Stable identifier used to map embeddings back to chunks. */
  id: string;
  /** Textual representation sent to the embedding model. */
  text: string;
}

/**
 * Embedding output returned by the adapter.
 */
export interface EmbeddingResult {
  /** Identifier that matches the payload ID. */
  id: string;
  /** Normalized embedding vector. */
  embedding: number[];
}

/**
 * Minimal contract for embedding adapters.
 */
export interface Embedder {
  /**
   * Generates embeddings for the provided payloads.
   *
   * @param payloads - Representation strings ready for embedding.
   */
  embed(payloads: EmbeddingPayload[]): Promise<EmbeddingResult[]>;
}

/**
 * Ollama-backed embedder that batches requests and normalizes embeddings for cosine similarity.
 */
export class OllamaEmbedder implements Embedder {
  constructor(
    private readonly baseUrl: string,
    private readonly config: ModelConfiguration,
  ) {}

  async embed(payloads: EmbeddingPayload[]): Promise<EmbeddingResult[]> {
    const batchSize = this.config.embedding_batch_size;
    const results: EmbeddingResult[] = [];
    for (let index = 0; index < payloads.length; index += batchSize) {
      const batch = payloads.slice(index, index + batchSize);
      const embeddings = await this.embedWithRetries(
        batch.map((item) => item.text),
      );
      embeddings.forEach((vector, vectorIndex) => {
        results.push({
          id: batch[vectorIndex]?.id ?? "",
          embedding: normalize(vector),
        });
      });
    }
    return results;
  }

  private async embedWithRetries(texts: string[]): Promise<number[][]> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await ollamaEmbed(texts, {
          ollamaUrl: this.baseUrl,
          model: this.config.embedding_model,
        });
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100));
      }
    }
    return [];
  }
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm || !Number.isFinite(norm)) return vector;
  return vector.map((value) => value / norm);
}
