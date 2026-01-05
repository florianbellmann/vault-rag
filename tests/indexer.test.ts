import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Embedder,
  EmbeddingPayload,
  EmbeddingResult,
} from "../src/core/embedding";
import { VaultIndexer } from "../src/core/indexer";
import type { StoredChunk, VectorStore } from "../src/core/store";
import type {
  FeatureFlags,
  GlobalConfig,
  PromptTemplates,
  RetrievalFilters,
} from "../src/core/types";

class MockEmbedder implements Embedder {
  public calls: string[] = [];
  async embed(payloads: EmbeddingPayload[]): Promise<EmbeddingResult[]> {
    this.calls.push(...payloads.map((payload) => payload.id));
    return payloads.map((payload) => ({
      id: payload.id,
      embedding: [1, 0, 0],
    }));
  }
}

class MemoryStore implements VectorStore {
  private chunks = new Map<string, StoredChunk>();
  private files = new Map<
    string,
    { mtime: number; chunkCount: number; contentHash: string }
  >();
  loadFileStates() {
    const result: Record<
      string,
      { mtime: number; chunkCount: number; contentHash: string }
    > = {};
    for (const [path, state] of this.files.entries())
      result[path] = { ...state };
    return result;
  }
  loadChunksByFile(filePath: string) {
    const entries = [...this.chunks.values()].filter(
      (chunk) => chunk.filePath === filePath,
    );
    return entries.reduce<Record<string, StoredChunk>>((acc, chunk) => {
      acc[chunk.chunkId] = chunk;
      return acc;
    }, {});
  }
  upsertChunks(chunks: StoredChunk[]) {
    for (const chunk of chunks) {
      this.chunks.set(chunk.chunkId, chunk);
    }
    const byFile = chunks.reduce<Record<string, StoredChunk[]>>(
      (groups, chunk) => {
        const existing = groups[chunk.filePath];
        if (existing) {
          existing.push(chunk);
        } else {
          groups[chunk.filePath] = [chunk];
        }
        return groups;
      },
      {},
    );
    for (const [file, fileChunks] of Object.entries(byFile)) {
      if (fileChunks.length === 0) continue;
      this.files.set(file, {
        mtime: Math.max(...fileChunks.map((chunk) => chunk.mtime)),
        chunkCount: fileChunks.length,
        contentHash: fileChunks.map((chunk) => chunk.contentHash).join(":"),
      });
    }
  }
  deleteChunksByIds(chunkIds: string[]) {
    for (const id of chunkIds) {
      this.chunks.delete(id);
    }
  }
  deleteChunksForFile(filePath: string) {
    for (const chunk of this.chunks.values()) {
      if (chunk.filePath === filePath) this.chunks.delete(chunk.chunkId);
    }
    this.files.delete(filePath);
  }
  listAllChunks(): StoredChunk[] {
    return [...this.chunks.values()];
  }
  lexicalSearch(
    _query: string,
    _limit: number,
    _filters?: RetrievalFilters,
  ): Array<{ chunk: StoredChunk; score: number }> {
    return [];
  }
  listIndexedPaths(): string[] {
    return [...this.files.keys()];
  }
  close(): void {}
}

const featureFlags: FeatureFlags = {
  hybrid_retrieval: true,
  reranking: false,
  mmr_diversification: false,
  query_rewriting: false,
  iterative_retrieval: false,
  summarization: false,
  auto_tagging: false,
  related_content_generation: false,
  vault_hygiene_analysis: false,
  evaluation_mode: false,
};

const prompts: PromptTemplates = {
  qa: "Q: {{question}}\n{{context}}",
  summarization: "{{context}}",
  tagging: "{{context}}",
  related: "{{context}}",
  reranker: "{{chunks}}",
  query_rewrite: "{{question}}",
  iterative_gap: "{{context}}",
};

function createConfig(vault: string): GlobalConfig {
  return {
    version: 1,
    paths: {
      vault,
      database: ":memory:",
      log_level: "error",
    },
    features: featureFlags,
    models: {
      embedding_model: "mock",
      embedding_dimension: 3,
      embedding_batch_size: 8,
      llm_model: "mock",
      reranker_model: "mock",
      query_rewrite_model: "mock",
      hygiene_model: "mock",
      temperature: 0,
      max_tokens: 128,
    },
    chunking: {
      target_tokens: 50,
      max_tokens: 100,
      min_tokens: 10,
      overlap_tokens: 5,
      merge_small_chunks: true,
      strong_boundaries: {
        hr: true,
        callout: true,
        list: true,
        code: true,
        table: true,
      },
      metadata_prefix_strategy: "heading_path",
    },
    retrieval: {
      vector_top_k: 10,
      lexical_top_k: 5,
      fusion_strategy: "rrf",
      fusion_weights: { vector: 0.7, lexical: 0.3 },
      mmr_lambda: 0.5,
      rerank_top_n: 5,
      context_token_budget: 200,
      recency_boost: 0.1,
      diversification_pool: 10,
    },
    prompts,
  };
}

describe("VaultIndexer", () => {
  test("skips embedding unchanged files", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "rag-test-"));
    const notePath = join(tmp, "Note.md");
    await writeFile(notePath, "# Title\nBody text", "utf8");

    const config = createConfig(tmp);
    const store = new MemoryStore();
    const embedder = new MockEmbedder();
    const indexer = new VaultIndexer(config, embedder, store);

    await indexer.run();
    expect(embedder.calls.length).toBeGreaterThan(0);

    embedder.calls = [];
    await indexer.run();
    expect(embedder.calls).toHaveLength(0);
  });
});
