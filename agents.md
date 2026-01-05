Agents
======

This repo hosts two simple “agents” that cooperate to provide retrieval-augmented answers over an Obsidian vault. Each agent is a standalone script that can be composed in automation (Git hooks, CRON, Zapier, etc.) depending on your workflow.

Indexer Agent (`src/index/index_vault.ts`)
------------------------------------

Responsibilities:

1. Discover Markdown files inside the vault while respecting ignore lists (e.g., `.obsidian`, `.trash`, `.git`).
2. Chunk each Markdown note by heading and length (`src/chunking.ts`), hash the chunk text, and embed in batches through Ollama (`src/ollama.ts`).
3. Persist embeddings, chunk metadata, and per-file state (mtime & chunk count) into the vector store (`src/db.ts`).
4. Track stats (processed/skipped/deleted files, chunks written/pruned) and print a colorized summary.

Key behaviors:

- Uses a `VectorStore` abstraction so you can swap SQLite for another backend later.
- Skips unchanged files based on mtime, deletes stale chunks when files shrink, and cleans up entries for deleted files.
- Emits structured progress logs (`[current/total]`, `Indexing`, `Skipping`, `Removing`) for observability.

Question/Answer Agent (`src/ask.ts`)
------------------------------------

Responsibilities:

1. Embed an incoming question via Ollama using the same embedding model as the indexer.
2. Load all stored chunk embeddings from the vector store and compute cosine similarity scores (`src/similarity.ts`).
3. Select the top-k chunks, assemble a context block, and craft a deterministic prompt that instructs the chat model to stay grounded.
4. Call Ollama’s chat model to generate an answer and display the unique source files used.

Key behaviors:

- Uses the shared `VectorStore` interface, so switching backends automatically benefits QA.
- Leaves prompts and scoring logic simple/transparent, making it easy to iterate on prompt engineering.
- Exposes a `bun run ask "<question>"` script so it can be wired into local CLI workflows or automations.

Extending Agents
----------------

- **New Vector Store**: implement `VectorStore` in `src/db.ts` (e.g., wrap ChromaDB) and point `createVectorStore` to it.
- **Alternate Embedders/LLMs**: update `src/ollama.ts` or add a new client module. The rest of the system only depends on the `ollamaEmbed` / `ollamaGenerate` signatures.
- **Pipelining**: Because both agents are plain scripts, you can run the indexer on a schedule and trigger the QA agent via CLI, HTTP wrapper, Raycast command, etc.
- **Writeback Agents**: `src/write/writeback.ts`, `src/write/summarize_note.ts`, and `src/write/tag_note.ts` encapsulate safe note updates. All AI output is wrapped with `<!-- AI:BEGIN --> ... <!-- AI:END -->` markers, which the indexer automatically strips before chunking. The summarize agent produces recap + recommendations, while the tag agent emits universal tags (#project-management, #health, etc.) to help with organization.
