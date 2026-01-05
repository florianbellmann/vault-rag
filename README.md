Vault RAG
=========
[![CI](https://github.com/florianbellmann/vault-rag/actions/workflows/ci.yml/badge.svg)](https://github.com/florianbellmann/vault-rag/actions/workflows/ci.yml)

Modern retrieval-augmented answering for Obsidian vaults. The 2-agent system now ships with structure-aware chunking, a configurable hybrid retriever, vault hygiene tooling, and a global configuration system that governs every behaviour (models, prompts, chunking, retrieval, and writebacks).

Key capabilities
----------------

- Structure-aware chunker that respects headings, callouts, tables, lists, fenced code, and AI-marked blocks.
- SQLite-backed vector + lexical store with hybrid retrieval, MMR diversification, reranking, and recency boosts.
- Query rewriting + iterative retrieval plans that expand recall before synthesis.
- Configurable prompt templates for QA, summarization, tagging, related-content generation, reranking, and evaluation.
- Vault hygiene analyzer plus an evaluation harness that reports recall@k and citation accuracy.
- Safe writeback agents (summary / tags / related links) that honour the shared configuration and AI block guards.

Getting started
---------------

1. **Install dependencies**

   ```bash
   bun install
   ```

2. **Create your config**

   Copy the template and customize it (your local file is gitignored):

   ```bash
   cp rag.config.yaml.example rag.config.yaml
   ```

   This file is the single source of truth for feature flags, chunking, retrieval models, and prompt templates. Override values in three ways:

   - Edit `rag.config.yaml`.
   - Set `RAG_CONFIG_PATH=/path/to/custom.yaml`.
   - Override specific values via env variables (`OBSIDIAN_VAULT`, `RAG_DB_PATH`, `RAG_LOG_LEVEL`, `WRITEBACK_ROOT`, etc.).

3. **Index the vault**

   ```bash
   bun run index
   ```

   The indexer walks the vault (skipping `.obsidian`, `.trash`, `.git`), chunks notes, embeds only changed sections, and updates the SQLite vector/FTS store. Stable chunk IDs + content hashes enable incremental updates without re-embedding entire files.

4. **Ask questions**

   ```bash
   bun run ask "How do I deploy service Foo?"
   ```

   The QA agent performs query rewriting, hybrid retrieval, MMR diversification, optional reranking, context packing, and grounded answer generation. Every fact is cited (`[C1] path | heading`).

Scripts
-------

| Command | Description |
| --- | --- |
| `bun run index` | Run the indexer using the global config |
| `bun run ask "<question>"` | Retrieval-augmented answer with citations |
| `bun run rag:eval --file eval/questions.json` | Evaluate recall@k + citation accuracy |
| `bun run rag:hygiene` | Run vault hygiene analysis |
| `bun run summarize <path>` | Append AI summary + recommendations (config-driven prompt) |
| `bun run tag <path>` | Generate universal tags via the tagging prompt |
| `bun run related <path>` | Append a related-content section populated from hybrid retrieval |
| `bun run enrich <path>` | Run summarize → tag → related sequentially |
| `bun run summarize:all <dir>` / `tag:all` / `related:all` | Batch writebacks for a folder |

Resetting or reindexing from scratch:

```bash
bun run reset        # remove the SQLite database
bun run reindex      # bun run test && reset && index
```

Architecture
------------

The refactor splits responsibilities into small modules:

- `core/config` – loads `rag.config.yaml`, supports env overrides (`RAG_CONFIG_PATH`, `OBSIDIAN_VAULT`, `RAG_DB_PATH`, `RAG_LOG_LEVEL`), and shares the configured log level.
- `core/types` – definitions for feature flags, model settings, chunk metadata, retrieval filters, etc.
- `core/chunking` – structure-aware Markdown chunker that respects headings, tables, lists, code, callouts, and AI markers. Produces deterministic chunk IDs plus metadata (heading path, tags, links, ordinals, chunk type).
- `core/store` – SQLite-based vector store with WAL enabled tables for `files`, `chunks`, and `chunk_fts` (FTS5). Supports incremental updates, lexical/BM25 queries, and metadata filtering.
- `core/embedding` – Ollama embedder with batching, exponential-backoff retries, and vector normalization.
- `core/retrieval` – hybrid retriever (vector + lexical) with reciprocal-rank fusion, recency boosts, optional MMR diversification, and LLM-based reranking.
- `core/augmentation` – orchestrates query rewriting, iterative retrieval gap analysis, context packing, answer generation, writeback prompts, vault hygiene analysis, and evaluation metrics.
- `cli/*` – thin commands (`index`, `ask`, `rag:eval`, `rag:hygiene`) that glue config + modules together so scripts stay maintainable.

Global configuration
--------------------

`rag.config.yaml.example` documents every option. Copy it to `rag.config.yaml` and tailor as needed:

```yaml
paths:
  vault: "./vault"
  database: "./vault_index.sqlite"
  log_level: "info"
features:
  hybrid_retrieval: true
  reranking: true
  query_rewriting: true
  iterative_retrieval: true
models:
  embedding_model: "nomic-embed-text"
  llm_model: "llama3"
chunking:
  target_tokens: 350
  overlap_tokens: 60
retrieval:
  vector_top_k: 40
  lexical_top_k: 30
  fusion_strategy: rrf
  mmr_lambda: 0.65
prompts:
  qa: |
    You are grounded in an Obsidian vault.
    Question: {{question}}
    Context:
    {{context}}
```

Every prompt is templated with `{{variable}}` placeholders so you can iterate on behaviour without touching TypeScript. Override prompts to tune tone, citation style, or instructions for summarizers/taggers.

Chunking & embeddings
---------------------

- The chunker parses Markdown into block-level structures (headings, paragraphs, lists, tables, callouts, fenced code, quotes). Strong boundaries enforce chunk splits while optional overlap tokens keep continuity inside sections.
- Each chunk stores the note title, heading path, ordinal, chunk type, tags, outgoing wiki links, frontmatter, and a SHA-1 hash for incremental indexing.
- Embedding representations prepend metadata (heading path, tags) to the chunk text. `core/embedding` batches calls to Ollama, retries transient failures, and normalizes vectors so cosine similarity = dot product later.

Retrieval pipeline
------------------

1. **Question planning** – optional query rewrites + iterative retrieval gap analysis expand the search space when feature flags allow.
2. **Hybrid retrieval** – cosine similarity over normalized embeddings + SQLite FTS/BM25 lexical matches with configurable Reciprocal Rank Fusion (RRF) weighting.
3. **Diversification** – Maximum Marginal Relevance (MMR) selects a diverse top-N from a larger candidate pool.
4. **Reranking** – deterministic reranking prompt (Ollama) refines the short-list, ensuring important sections surface first.
5. **Context packing** – hierarchical metadata (note title, heading path, tags, chunk type, ordinal) guides context packing within a token budget. Chunk overlap keeps continuity across section boundaries.
6. **Answer generation** – QA prompt enforces citation requirements and “I don’t know” fallbacks when context is insufficient.

Writeback agents
----------------

- **Summaries** – `bun run summarize <note>` filters AI blocks, enforces minimum content length, and uses the `prompts.summarization` template to produce recap + recommendations. Output is wrapped in `<!-- AI:BEGIN --> ... <!-- AI:END -->`.
- **Tags** – `bun run tag <note>` feeds the tagging prompt, normalizes tags, and merges them into frontmatter (`tags:` array). Duplicates are avoided and per-note limits honour `TAG_MAX`.
- **Related content** – `bun run related <note>` embeds the note, finds similar files from the vector store, and renders a prompt-driven bullet list of wiki links.
- **Batch + orchestration** – `summarize:all`, `tag:all`, `related:all`, and `enrich` commands use the same primitives, so prompt edits take effect everywhere.

Evaluation + hygiene
--------------------

- **Evaluation harness** – Provide a JSON file of `{ "question": "...", "expected_paths": ["Notes/Foo.md", ...] }` entries. Run `bun run rag:eval --file eval/questions.json` to compute recall@k (per question fraction of expected paths retrieved) and citation accuracy (fraction of citations referencing expected paths). Output is JSON for CI.
- **Vault hygiene** – `bun run rag:hygiene` scans for missing/malformed frontmatter, extremely long sections, missing headings, poor separator usage, and notes lacking summaries. Issues are logged with file paths and explanations.

Testing & linting
-----------------

```bash
bun test                     # chunking, retrieval fusion, indexer diffing, config templating
bun run lint                 # Biome lint
bun run format               # Biome format
```

Troubleshooting
---------------

- **Ollama unreachable** – ensure `OLLAMA_URL` (or `rag.config.yaml` + env overrides) points at a running Ollama host. Use `RAG_LOG_LEVEL=debug` for verbose logs: `RAG_LOG_LEVEL=debug bun run ask "..."`.
- **Empty retrieval results** – confirm `bun run index` completed successfully and the SQLite DB contains chunks (`bun run rag:hygiene` is a quick sanity check). Hybrid retrieval requires both embeddings and lexical stats—run `bun run reset && bun run index` if migrations or config changes were made.
- **Writeback path errors** – set `WRITEBACK_ROOT` (or rely on `paths.vault`) so writebacks cannot escape the vault. The helper rejects writes outside of the approved root.
- **Prompt tweaks** – edit `rag.config.yaml` prompts; no code changes required. Remember to restart long-running processes after config edits.

Refer to `report.md` for a detailed breakdown of recent architectural changes and testing notes.
