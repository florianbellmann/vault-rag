import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resetConfigCache } from "../src/core/config";
import { renderPrompt } from "../src/core/prompts";

const sampleConfig = `version: 1
paths:
  vault: "./vault"
  database: "./vault_index.sqlite"
  log_level: "info"
features:
  hybrid_retrieval: true
  reranking: true
  mmr_diversification: true
  query_rewriting: true
  iterative_retrieval: true
  summarization: true
  auto_tagging: true
  related_content_generation: true
  vault_hygiene_analysis: true
  evaluation_mode: false
models:
  embedding_model: "mock"
  embedding_dimension: 3
  embedding_batch_size: 2
  llm_model: "mock"
  reranker_model: "mock"
  query_rewrite_model: "mock"
  hygiene_model: "mock"
  temperature: 0.1
  max_tokens: 10
chunking:
  target_tokens: 100
  max_tokens: 200
  min_tokens: 50
  overlap_tokens: 10
  merge_small_chunks: true
  strong_boundaries:
    hr: true
    callout: true
    list: true
    code: true
    table: true
  metadata_prefix_strategy: "heading_path"
retrieval:
  vector_top_k: 10
  lexical_top_k: 5
  fusion_strategy: "rrf"
  fusion_weights:
    vector: 0.7
    lexical: 0.3
  mmr_lambda: 0.5
  rerank_top_n: 5
  context_token_budget: 200
  recency_boost: 0.1
  diversification_pool: 10
prompts:
  qa: "{{question}} -> {{context}}"
  summarization: "{{context}}"
  tagging: "{{context}}"
  related: "{{context}}"
  journal: "{{context}}"
  rework: "{{context}}"
  reranker: "{{chunks}}"
  query_rewrite: "{{question}}"
  iterative_gap: "{{context}}"
`;

describe("configuration loader", () => {
  test("respects environment overrides", async () => {
    const dir = await mkdtemp(join(tmpdir(), "config-test-"));
    const path = join(dir, "rag.config.yaml");
    await writeFile(path, sampleConfig, "utf8");
    process.env.RAG_CONFIG_PATH = path;
    process.env.RAG_LOG_LEVEL = "debug";
    resetConfigCache();
    const config = loadConfig();
    expect(config.paths.log_level).toBe("debug");
    process.env.RAG_CONFIG_PATH = undefined;
    process.env.RAG_LOG_LEVEL = undefined;
  });
});

describe("prompt templating", () => {
  test("replaces placeholders", () => {
    const output = renderPrompt("Hello {{name}}", { name: "world" });
    expect(output).toBe("Hello world");
  });
});
