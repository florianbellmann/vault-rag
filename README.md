Vault RAG
=========

A minimal retrieval-augmented generation pipeline for Obsidian vaults. The indexer walks your Markdown files, chunks them, embeds with Ollama, and stores results in a SQLite-backed vector store. A companion `ask` script embeds questions, scores against stored chunks, and prompts Ollama with the highest-scoring context.

Getting Started
---------------

1. **Install dependencies**

   ```bash
   bun install
   ```

2. **Configure environment**

   Copy `.env.example` to `.env` and update the values for your vault path, Ollama host/models, and optional tuning knobs (batch size, chunk length, top-k, etc.).

3. **Index your vault**

   ```bash
   bun run index
   ```

   The script prints `[current/total]` progress, processing/skipping/removal logs, and a summary of chunks written or pruned.

4. **Ask a question**

   ```bash
   bun run ask "How do I deploy service Foo?"
   ```

   The script embeds the question, retrieves the top-k chunks by cosine similarity, prompts the chat model, and shows the answer plus source files.

Scripts
-------

| Command             | Description                                      |
|---------------------|--------------------------------------------------|
| `bun run index`     | Walk vault, embed chunks, write/update SQLite    |
| `bun run reset`     | Remove `vault_index.sqlite*` files               |
| `bun run reindex`   | Reset + index                                    |
| `bun run ask ...`   | Retrieve + answer a question                     |
| `bun run ask:debug` | Same as `ask` but prints retrieval/prompt debug  |
| `bun run summarize <path>` | Append AI summary/recs to a note          |
| `bun run tag <path>`       | Append AI-generated universal tags        |

Environment Variables
---------------------

See `.env.example` for the full list:

- `OBSIDIAN_VAULT`: absolute path to your vault.
- `OLLAMA_URL`: Ollama host (e.g., `http://localhost:11434`).
- `EMBED_MODEL`, `CHAT_MODEL`: embedding/chat models to call.
- `DB_PATH`: location of the SQLite vector-store file.
- `EMBED_BATCH`, `CHUNK_MAX_CHARS`, `TOP_K`: optional tuning knobs.
- `WRITEBACK_ROOT`: directory where writeback scripts may modify notes (defaults to `OBSIDIAN_VAULT`).
- `SUMMARY_MIN_CHARS`: minimum non-AI characters required before summarizing a note (default 200).
- `TAG_MIN_CHARS`: minimum characters before tagging a note (default 120).
- `TAG_MAX`: maximum number of tags the agent should append (default 6).

Architecture
------------

- `src/index/index_vault.ts`: main indexer (walk vault → chunk → embed → store).
- `src/db.ts`: vector-store abstraction + SQLite implementation.
- `src/ask.ts`: query/QA helper built on the vector store.
- `src/write/writeback.ts`: safe write helpers + AI block markers.
- `src/write/summarize_note.ts`: uses writeback + chat model to append summaries.
- `src/write/tag_note.ts`: generates universal tags with Ollama and appends them.
- `src/write/tagging.ts`: helper utilities for parsing/normalizing tag output.
- `src/index/chunking.ts`, `src/index/util.ts`, `src/ollama.ts`, `src/similarity.ts`: shared helpers for chunk generation, file traversal, Ollama calls, and cosine similarity.

The abstraction layer keeps the indexer/question answering logic storage-agnostic, so you can swap in a different vector store (e.g., ChromaDB) later by implementing the same interface.

AI Writebacks
-------------

`writeback.ts` wraps all note mutations and enforces that generated content is surrounded by:

```
<!-- AI:BEGIN -->
...generated block...
<!-- AI:END -->
```

`makeChunks` strips every block between those markers before chunking, ensuring AI summaries, recommendations, and other generated notes never get fed back into the retrieval corpus. Tagging writes place the normalized tags into frontmatter (`tags:` list) so Obsidian can surface them globally.
