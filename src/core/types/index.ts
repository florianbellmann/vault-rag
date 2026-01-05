import type { Database } from "bun:sqlite";

/**
 * Log verbosity levels supported by the CLI modules.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Feature flags that can be enabled or disabled system-wide via the global configuration.
 */
export interface FeatureFlags {
  hybrid_retrieval: boolean;
  reranking: boolean;
  mmr_diversification: boolean;
  query_rewriting: boolean;
  iterative_retrieval: boolean;
  summarization: boolean;
  auto_tagging: boolean;
  related_content_generation: boolean;
  vault_hygiene_analysis: boolean;
  evaluation_mode: boolean;
}

/**
 * Model configuration describing which Ollama models to leverage for every task.
 */
export interface ModelConfiguration {
  embedding_model: string;
  embedding_dimension: number;
  embedding_batch_size: number;
  llm_model: string;
  reranker_model: string;
  query_rewrite_model: string;
  hygiene_model: string;
  temperature: number;
  max_tokens: number;
}

/**
 * Chunking parameters influence how Markdown is segmented for embeddings.
 */
export interface ChunkingConfiguration {
  target_tokens: number;
  max_tokens: number;
  min_tokens: number;
  overlap_tokens: number;
  merge_small_chunks: boolean;
  strong_boundaries: {
    hr: boolean;
    callout: boolean;
    list: boolean;
    code: boolean;
    table: boolean;
  };
  metadata_prefix_strategy: "heading_path" | "title_only";
}

/**
 * Retrieval configuration toggles, thresholds, and heuristics.
 */
export interface RetrievalConfiguration {
  vector_top_k: number;
  lexical_top_k: number;
  fusion_strategy: "rrf";
  fusion_weights: {
    vector: number;
    lexical: number;
  };
  mmr_lambda: number;
  rerank_top_n: number;
  context_token_budget: number;
  recency_boost: number;
  diversification_pool: number;
}

/**
 * Structured prompt templates referenced by augmentation modules.
 */
export interface PromptTemplates {
  qa: string;
  summarization: string;
  tagging: string;
  related: string;
  reranker: string;
  query_rewrite: string;
  iterative_gap: string;
}

/**
 * File system locations required by the agents.
 */
export interface PathConfiguration {
  vault: string;
  database: string;
  log_level: LogLevel;
}

/**
 * Complete configuration schema loaded from rag.config.yaml.
 */
export interface GlobalConfig {
  version: number;
  paths: PathConfiguration;
  features: FeatureFlags;
  models: ModelConfiguration;
  chunking: ChunkingConfiguration;
  retrieval: RetrievalConfiguration;
  prompts: PromptTemplates;
}

/**
 * Metadata describing how a chunk map backs to the originating note.
 */
export interface ChunkMetadata {
  filePath: string;
  noteTitle: string;
  headingPath: string[];
  ordinal: number;
  chunkType: ChunkType;
  tags: string[];
  links: string[];
  frontmatter: Record<string, unknown>;
  mtime: number;
}

/**
 * Chunk categories used for filtering and reporting.
 */
export type ChunkType =
  | "text"
  | "code"
  | "table"
  | "callout"
  | "list"
  | "quote";

/**
 * Embedding-ready chunk representation.
 */
export interface ChunkRecord extends ChunkMetadata {
  chunkId: string;
  content: string;
  representation: string;
  contentHash: string;
  tokens: number;
  embedding?: number[];
}

/**
 * State snapshot of a file that helps the indexer decide whether to reprocess it.
 */
export interface FileState {
  mtime: number;
  chunkCount: number;
  contentHash: string;
}

/**
 * Metadata filters that can be applied during retrieval.
 */
export interface RetrievalFilters {
  pathPrefix?: string;
  tags?: string[];
  chunkTypes?: ChunkType[];
}

/**
 * Representation of a scored chunk after retrieval.
 */
export interface RankedChunk {
  chunk: ChunkRecord & { embedding: number[] };
  score: number;
  reasons?: string[];
}

/**
 * Abstraction for database handles used throughout the SQLite store implementation.
 */
export type SqliteProvider = Database;
