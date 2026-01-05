import { logger } from "../../logger";
import { chunkMarkdown } from "../chunking/markdownChunker";
import type { Embedder } from "../embedding";
import { fileMtimeSeconds, iterVaultMarkdown, readMarkdown } from "../fs/vault";
import type { StoredChunk, VectorStore } from "../store";
import type { ChunkRecord, GlobalConfig } from "../types";

export interface IndexStats {
  processed: number;
  skipped: number;
  removed: number;
  chunksUpserted: number;
  chunksDeleted: number;
}

/**
 * Walks the vault, chunks changed notes, embeds new content, and keeps the vector store in sync.
 */
export class VaultIndexer {
  constructor(
    private readonly config: GlobalConfig,
    private readonly embedder: Embedder,
    private readonly store: VectorStore,
  ) {}

  async run(): Promise<IndexStats> {
    const stats: IndexStats = {
      processed: 0,
      skipped: 0,
      removed: 0,
      chunksUpserted: 0,
      chunksDeleted: 0,
    };
    const seenPaths = new Set<string>();
    const fileStates = this.store.loadFileStates();
    let fileIndex = 0;
    for await (const file of iterVaultMarkdown(this.config.paths.vault)) {
      fileIndex++;
      seenPaths.add(file.relative);
      const mtime = await fileMtimeSeconds(file.absolute);
      const previous = fileStates[file.relative];
      if (previous && previous.mtime === mtime) {
        stats.skipped++;
        logger.debug(`Skipping ${file.relative} (unchanged)`);
        continue;
      }

      const markdown = await readMarkdown(file.absolute);
      const chunks = chunkMarkdown(
        {
          filePath: file.relative,
          markdown,
          mtime,
        },
        this.config.chunking,
      );
      const deletedChunks = await this.persistFile(file.relative, chunks);
      stats.processed++;
      stats.chunksUpserted += chunks.length;
      stats.chunksDeleted += deletedChunks;
      logger.info(
        `[${fileIndex}] Indexed ${file.relative} (${chunks.length} chunks)`,
      );
    }
    const removedPaths = this.store
      .listIndexedPaths()
      .filter((path) => !seenPaths.has(path));
    for (const path of removedPaths) {
      const chunkCount = Object.keys(this.store.loadChunksByFile(path)).length;
      this.store.deleteChunksForFile(path);
      stats.removed++;
      stats.chunksDeleted += chunkCount;
      logger.warn(`Removed ${path} (file deleted)`);
    }
    return stats;
  }

  private async persistFile(
    relativePath: string,
    chunks: ChunkRecord[],
  ): Promise<number> {
    const existing = this.store.loadChunksByFile(relativePath);
    const nextChunks: ChunkRecord[] = [];
    const toEmbed: ChunkRecord[] = [];
    for (const chunk of chunks) {
      const prior = existing[chunk.chunkId];
      if (prior && prior.contentHash === chunk.contentHash) {
        nextChunks.push({ ...chunk, embedding: prior.embedding });
      } else {
        toEmbed.push(chunk);
      }
    }
    if (toEmbed.length > 0) {
      const embeddings = await this.embedder.embed(
        toEmbed.map((chunk) => ({
          id: chunk.chunkId,
          text: chunk.representation,
        })),
      );
      const embeddingMap = new Map(
        embeddings.map((entry) => [entry.id, entry.embedding]),
      );
      for (const chunk of toEmbed) {
        const embedding = embeddingMap.get(chunk.chunkId);
        if (!embedding) continue;
        nextChunks.push({ ...chunk, embedding });
      }
    }
    const staleChunkIds = Object.keys(existing).filter(
      (chunkId) => !chunks.find((chunk) => chunk.chunkId === chunkId),
    );
    if (staleChunkIds.length) {
      this.store.deleteChunksByIds(staleChunkIds);
    }
    const storedChunks: StoredChunk[] = nextChunks.map((chunk) => {
      if (!chunk.embedding) {
        throw new Error(`Missing embedding for chunk ${chunk.chunkId}`);
      }
      return chunk as StoredChunk;
    });
    this.store.upsertChunks(storedChunks);
    return staleChunkIds.length;
  }
}
