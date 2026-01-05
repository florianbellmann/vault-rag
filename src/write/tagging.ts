import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";
import type { ParsedFrontmatter } from "./frontmatter";

const DEFAULT_MAX_TAGS = Number(process.env.TAG_MAX ?? "6");

export function normalizeTagCandidate(candidate: string): string | null {
  const stripped = candidate.replace(/^[#\s]+/, "").trim();
  if (!stripped) return null;
  const slug = stripped
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  if (!slug) return null;
  return `#${slug}`;
}

export function extractTagsFromResponse(
  response: string,
  maxTags = DEFAULT_MAX_TAGS,
): string[] {
  const parts = response
    .split(/[\n,]/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const normalized = normalizeTagCandidate(part);
    if (!normalized || seen.has(normalized)) continue;
    tags.push(normalized);
    seen.add(normalized);
    if (tags.length >= maxTags) break;
  }
  return tags;
}

export function normalizeExistingTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "string" ? normalizeTagCandidate(item) : null,
      )
      .filter((tag): tag is string => Boolean(tag));
  }
  if (typeof value === "string") {
    const normalized = normalizeTagCandidate(value);
    return normalized ? [normalized] : [];
  }
  return [];
}

export function mergeTagsIntoFrontmatter(
  noteContent: string,
  tagsToAdd: string[],
  parsed?: ParsedFrontmatter,
): { content: string; added: string[]; tags: string[] } {
  const parseResult = parsed ?? parseFrontmatter(noteContent);
  const existingTags = normalizeExistingTags(parseResult.data.tags);
  const seen = new Set(existingTags);
  const added: string[] = [];
  const maxTagsOverall = Math.max(DEFAULT_MAX_TAGS, existingTags.length);

  for (const candidate of tagsToAdd) {
    const normalized = normalizeTagCandidate(candidate);
    if (!normalized || seen.has(normalized)) continue;
    if (existingTags.length >= maxTagsOverall) break;
    existingTags.push(normalized);
    seen.add(normalized);
    added.push(normalized);
  }

  if (added.length === 0) {
    return { content: noteContent, added, tags: existingTags };
  }

  const nextData = { ...parseResult.data, tags: existingTags };
  const updatedContent = stringifyFrontmatter(nextData, parseResult.body);
  return { content: updatedContent, added, tags: existingTags };
}
