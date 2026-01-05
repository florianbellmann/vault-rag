import { createHash } from "node:crypto";
import { basename } from "node:path";
import { stripAiBlocks } from "../../ai_markers";
import { parseFrontmatter } from "../metadata/frontmatter";
import type { ChunkRecord, ChunkType, ChunkingConfiguration } from "../types";

export interface ChunkingInput {
  filePath: string;
  markdown: string;
  mtime: number;
}

type MarkdownBlockType =
  | "heading"
  | "paragraph"
  | "list"
  | "code"
  | "table"
  | "callout"
  | "quote"
  | "hr";

interface MarkdownBlock {
  type: MarkdownBlockType;
  depth?: number;
  text: string;
  tokens: number;
  strongBoundary: boolean;
}

interface ChunkDraft {
  text: string;
  headingPath: string[];
  tokens: number;
  chunkType: ChunkType;
  mergeable: boolean;
}

/**
 * Structure-aware Markdown chunker that respects headings, fenced blocks, tables, and callouts.
 *
 * The chunker keeps hierarchical metadata and produces deterministic chunk identifiers so the
 * indexer can diff file revisions precisely.
 */
export function chunkMarkdown(
  input: ChunkingInput,
  config: ChunkingConfiguration,
): ChunkRecord[] {
  const { markdown, filePath, mtime } = input;
  const { data: frontmatter, body } = parseFrontmatter(stripAiBlocks(markdown));
  const tags = extractTags(frontmatter);
  const sanitizedBody = body.trim();
  const outgoingLinks = collectWikiLinks(sanitizedBody);
  const blocks = parseBlocks(sanitizedBody, config);
  const noteTitle = resolveTitle(frontmatter, filePath, blocks);
  const drafts = buildChunkDrafts(blocks, config, noteTitle);
  const mergedDrafts = config.merge_small_chunks
    ? mergeSmallChunks(drafts, config.min_tokens)
    : drafts;

  return mergedDrafts.map((draft, index) => {
    const ordinal = index + 1;
    const chunkId = stableChunkId(filePath, draft.headingPath, ordinal);
    const contentHash = sha1(draft.text);
    const representation = buildRepresentation(
      draft.text,
      draft.headingPath,
      noteTitle,
      tags,
      config.metadata_prefix_strategy,
    );
    const chunkLinks = collectWikiLinks(draft.text);
    return {
      chunkId,
      filePath,
      noteTitle,
      headingPath: draft.headingPath,
      ordinal,
      chunkType: draft.chunkType,
      tags,
      links: chunkLinks,
      frontmatter,
      mtime,
      content: draft.text,
      representation,
      contentHash,
      tokens: draft.tokens,
    };
  });
}

function buildChunkDrafts(
  blocks: MarkdownBlock[],
  config: ChunkingConfiguration,
  noteTitle: string,
): ChunkDraft[] {
  const drafts: ChunkDraft[] = [];
  const headingStack: string[] = [];
  const { target_tokens, max_tokens, overlap_tokens } = config;
  let chunkBlocks: MarkdownBlock[] = [];
  let chunkTokens = 0;
  let lastFlushReason: "size" | "boundary" | "heading" | "end" | null = null;
  let overlapBuffer: MarkdownBlock | null = null;

  const flushChunk = (reason: typeof lastFlushReason) => {
    if (chunkBlocks.length === 0) {
      lastFlushReason = reason;
      return;
    }
    const text = chunkBlocks
      .map((block) => block.text)
      .join("\n\n")
      .trim();
    if (!text) {
      chunkBlocks = [];
      chunkTokens = 0;
      lastFlushReason = reason;
      overlapBuffer = null;
      return;
    }
    const headingPath = buildHeadingPath(noteTitle, headingStack);
    drafts.push({
      text,
      headingPath,
      tokens: chunkTokens,
      chunkType: resolveChunkType(chunkBlocks),
      mergeable: reason === "size",
    });
    overlapBuffer =
      reason === "size"
        ? makeOverlapBlock(text, overlap_tokens, chunkBlocks, config)
        : null;
    chunkBlocks = overlapBuffer ? [overlapBuffer] : [];
    chunkTokens = overlapBuffer?.tokens ?? 0;
    lastFlushReason = reason;
  };

  for (const block of blocks) {
    if (block.type === "heading") {
      flushChunk("heading");
      updateHeadingStack(headingStack, block);
      continue;
    }

    if (block.strongBoundary && chunkBlocks.length > 0) {
      flushChunk("boundary");
    }

    // Start of a chunk needs to inherit overlap text if available and not yet injected.
    if (chunkBlocks.length === 0 && overlapBuffer !== null) {
      const buffer: MarkdownBlock = overlapBuffer;
      chunkBlocks.push(buffer);
      chunkTokens += buffer.tokens;
      overlapBuffer = null;
    }

    chunkBlocks.push(block);
    chunkTokens += block.tokens;

    if (block.strongBoundary) {
      flushChunk("boundary");
      continue;
    }

    if (chunkTokens >= target_tokens || chunkTokens >= max_tokens) {
      flushChunk("size");
    }
  }

  flushChunk("end");
  return drafts;
}

function parseBlocks(
  markdown: string,
  config: ChunkingConfiguration,
): MarkdownBlock[] {
  const lines = markdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let current: MarkdownBlock | null = null;
  let inFence = false;
  let fenceDelimiter = "";
  let tableBuffer: string[] = [];

  const pushCurrent = () => {
    if (current) {
      current.tokens = approximateTokens(current.text);
      blocks.push(current);
      current = null;
    }
  };

  const pushTableBuffer = () => {
    if (tableBuffer.length === 0) return;
    blocks.push({
      type: "table",
      text: tableBuffer.join("\n"),
      tokens: approximateTokens(tableBuffer.join(" ")),
      strongBoundary: config.strong_boundaries.table,
    });
    tableBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine ?? "";
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    const fenceMatch = line.match(/^(```|~~~)/);
    const hrMatch = line.match(/^((?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/);
    const listMatch = line.match(/^\s{0,3}(?:[-*+]|\d+\.)\s+/);
    const calloutMatch = line.match(/^>\s*\[!([A-Z]+)\](.*)$/i);
    const quoteMatch = line.startsWith(">") && !calloutMatch;
    const tableRow =
      line.trim().startsWith("|") &&
      line.includes("|") &&
      !line.trim().startsWith("|---");

    if (inFence) {
      if (current?.text) {
        current.text += `\n${line}`;
      } else if (current) {
        current.text = line;
      }
      if (line.trim().startsWith(fenceDelimiter)) {
        inFence = false;
        fenceDelimiter = "";
        pushCurrent();
      }
      continue;
    }

    if (headingMatch) {
      pushTableBuffer();
      pushCurrent();
      const depth = headingMatch[1]?.length ?? 1;
      blocks.push({
        type: "heading",
        depth,
        text: headingMatch[2]?.trim() ?? "",
        tokens: 0,
        strongBoundary: true,
      });
      continue;
    }

    if (fenceMatch) {
      pushTableBuffer();
      pushCurrent();
      inFence = true;
      fenceDelimiter = fenceMatch[1] ?? "```";
      current = {
        type: "code",
        text: line,
        tokens: 0,
        strongBoundary: config.strong_boundaries.code,
      };
      continue;
    }

    if (line.trim() === "") {
      pushTableBuffer();
      pushCurrent();
      continue;
    }

    if (hrMatch) {
      pushTableBuffer();
      pushCurrent();
      blocks.push({
        type: "hr",
        text: line,
        tokens: approximateTokens(line),
        strongBoundary: config.strong_boundaries.hr,
      });
      continue;
    }

    if (tableRow) {
      tableBuffer.push(line);
      continue;
    }
    pushTableBuffer();

    if (calloutMatch) {
      pushCurrent();
      current = {
        type: "callout",
        text: line,
        tokens: 0,
        strongBoundary: config.strong_boundaries.callout,
      };
      continue;
    }

    if (quoteMatch) {
      if (current?.type === "quote") {
        current.text += `\n${line}`;
      } else {
        pushCurrent();
        current = {
          type: "quote",
          text: line,
          tokens: 0,
          strongBoundary: false,
        };
      }
      continue;
    }

    if (listMatch) {
      if (current?.type === "list") {
        current.text += `\n${line}`;
      } else {
        pushCurrent();
        current = {
          type: "list",
          text: line,
          tokens: 0,
          strongBoundary: config.strong_boundaries.list,
        };
      }
      continue;
    }

    if (current && current.type === "paragraph") {
      current.text += `\n${line}`;
    } else {
      pushCurrent();
      current = {
        type: "paragraph",
        text: line,
        tokens: 0,
        strongBoundary: false,
      };
    }
  }

  pushTableBuffer();
  pushCurrent();
  return blocks;
}

function resolveTitle(
  frontmatter: Record<string, unknown>,
  filePath: string,
  blocks: MarkdownBlock[],
): string {
  const fmTitle = frontmatter.title;
  if (typeof fmTitle === "string" && fmTitle.trim().length > 0) {
    return fmTitle.trim();
  }
  const heading = blocks.find((block) => block.type === "heading");
  if (heading?.text) return heading.text;
  return basename(filePath).replace(/\.md$/i, "");
}

function updateHeadingStack(stack: string[], block: MarkdownBlock): void {
  if (!block.depth) return;
  const targetDepth = Math.max(1, block.depth);
  stack.splice(targetDepth - 1);
  stack[targetDepth - 1] = block.text.trim();
}

function buildHeadingPath(noteTitle: string, headings: string[]): string[] {
  const path = [noteTitle];
  for (const heading of headings) {
    if (!heading) continue;
    if (path[path.length - 1] === heading) continue;
    path.push(heading);
  }
  return path;
}

function resolveChunkType(blocks: MarkdownBlock[]): ChunkType {
  const counts: Record<ChunkType, number> = {
    text: 0,
    code: 0,
    table: 0,
    callout: 0,
    list: 0,
    quote: 0,
  };
  for (const block of blocks) {
    switch (block.type) {
      case "code":
        counts.code += block.tokens;
        break;
      case "table":
        counts.table += block.tokens;
        break;
      case "callout":
        counts.callout += block.tokens;
        break;
      case "list":
        counts.list += block.tokens;
        break;
      case "quote":
        counts.quote += block.tokens;
        break;
      default:
        counts.text += block.tokens;
    }
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "text") as ChunkType;
}

function mergeSmallChunks(
  drafts: ChunkDraft[],
  minTokens: number,
): ChunkDraft[] {
  if (drafts.length <= 1) return drafts;
  const merged: ChunkDraft[] = [];
  for (const draft of drafts) {
    const previous = merged[merged.length - 1];
    if (
      draft.tokens < minTokens &&
      previous &&
      previous.mergeable &&
      draft.mergeable &&
      sameHeadingPath(previous.headingPath, draft.headingPath)
    ) {
      previous.text = `${previous.text}\n\n${draft.text}`.trim();
      previous.tokens = approximateTokens(previous.text);
      continue;
    }
    merged.push({ ...draft });
  }
  return merged;
}

function sameHeadingPath(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function extractTags(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.tags;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((value) => String(value).replace(/^#/, "").trim())
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[, ]+/)
      .map((value) => value.replace(/^#/, "").trim())
      .filter(Boolean);
  }
  return [];
}

function collectWikiLinks(markdown: string): string[] {
  const links = new Set<string>();
  const pattern = /\[\[([^[\]|#]+)(?:\|[^[\]]+)?]]/g;
  let match: RegExpExecArray | null = pattern.exec(markdown);
  while (match) {
    links.add(match[1]?.trim() ?? "");
    match = pattern.exec(markdown);
  }
  return [...links].filter(Boolean);
}

function approximateTokens(text: string): number {
  if (!text.trim()) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

function stableChunkId(
  filePath: string,
  headingPath: string[],
  ordinal: number,
): string {
  return sha1(`${filePath}|${headingPath.join(">")}|${ordinal}`);
}

function buildRepresentation(
  content: string,
  headingPath: string[],
  noteTitle: string,
  tags: string[],
  strategy: ChunkingConfiguration["metadata_prefix_strategy"],
): string {
  const headingLabel =
    strategy === "heading_path"
      ? `Heading: ${headingPath.join(" > ")}`
      : `Title: ${noteTitle}`;
  const tagsLabel = tags.length ? `Tags: ${tags.join(", ")}` : "";
  const prefix = [headingLabel, tagsLabel].filter(Boolean).join("\n");
  return `${prefix}\n\n${content}`.trim();
}

function makeOverlapBlock(
  text: string,
  overlapTokens: number,
  blocks: MarkdownBlock[],
  config: ChunkingConfiguration,
): MarkdownBlock | null {
  if (overlapTokens <= 0) return null;
  const lastBlock = blocks[blocks.length - 1];
  if (!lastBlock || lastBlock.strongBoundary) return null;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length <= overlapTokens) return null;
  const overlapSlice = tokens.slice(tokens.length - overlapTokens);
  const overlapText = overlapSlice.join(" ");
  return {
    type: "paragraph",
    text: overlapText,
    tokens: overlapSlice.length,
    strongBoundary: false,
  };
}
