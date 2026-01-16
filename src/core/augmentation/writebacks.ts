import { ollamaGenerate } from "../../ollama";
import { renderPrompt } from "../prompts";
import type { GlobalConfig } from "../types";

/**
 * Generates a structured summary for a note using the configured prompt.
 */
export async function summarizeContent(
  path: string,
  title: string,
  context: string,
  config: GlobalConfig,
  ollamaUrl: string,
): Promise<string> {
  const prompt = renderPrompt(config.prompts.summarization, {
    path,
    title,
    context,
  });
  return ollamaGenerate(prompt, {
    model: config.models.llm_model,
    ollamaUrl,
    options: { temperature: config.models.temperature, max_tokens: 400 },
  });
}

/**
 * Rewrites a note to improve chunking quality without adding new information.
 */
export async function reworkContent(
  path: string,
  title: string,
  context: string,
  createdAt: string,
  modifiedAt: string,
  config: GlobalConfig,
  ollamaUrl: string,
): Promise<string> {
  const prompt = renderPrompt(config.prompts.rework, {
    path,
    title,
    context,
    created_at: createdAt,
    modified_at: modifiedAt,
  });
  return ollamaGenerate(prompt, {
    model: config.models.llm_model,
    ollamaUrl,
    options: {
      temperature: config.models.temperature,
      max_tokens: config.models.max_tokens,
    },
  });
}

/**
 * Produces normalized universal tags for a note.
 */
export async function generateTags(
  title: string,
  context: string,
  tagLimit: number,
  config: GlobalConfig,
  ollamaUrl: string,
): Promise<string[]> {
  const prompt = renderPrompt(config.prompts.tagging, {
    title,
    context,
    tag_limit: tagLimit,
  });
  const response = await ollamaGenerate(prompt, {
    model: config.models.llm_model,
    ollamaUrl,
    options: { temperature: 0.2, max_tokens: 256 },
  });
  const candidates = parseTagCandidates(response);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const tag = normalizeTag(candidate);
    if (!tag || seen.has(tag)) continue;
    normalized.push(tag);
    seen.add(tag);
    if (normalized.length >= tagLimit) break;
  }
  return normalized;
}

/**
 * Generates a related-content section based on retrieved candidates.
 */
export async function generateRelatedContent(
  title: string,
  context: string,
  config: GlobalConfig,
  ollamaUrl: string,
): Promise<string> {
  const prompt = renderPrompt(config.prompts.related, { title, context });
  return ollamaGenerate(prompt, {
    model: config.models.llm_model,
    ollamaUrl,
    options: { temperature: 0.2, max_tokens: 256 },
  });
}

/**
 * Generates a journal reflection based on today's entry, recent history, and vault context.
 */
export async function generateJournalReflection(
  path: string,
  title: string,
  todayEntry: string,
  recentEntries: string,
  knowledgeContext: string,
  historyDays: number,
  config: GlobalConfig,
  ollamaUrl: string,
): Promise<string> {
  const prompt = renderPrompt(config.prompts.journal, {
    path,
    title,
    today_entry: todayEntry,
    recent_entries: recentEntries,
    knowledge_context: knowledgeContext,
    history_days: historyDays,
  });
  return ollamaGenerate(prompt, {
    model: config.models.llm_model,
    ollamaUrl,
    options: { temperature: config.models.temperature, max_tokens: 512 },
  });
}

function parseTagCandidates(response: string): string[] {
  try {
    const parsed = JSON.parse(response) as string[];
    if (Array.isArray(parsed)) {
      return parsed.map((tag) => String(tag));
    }
  } catch {
    // fall back to manual splitting
  }
  return response
    .split(/[\n,]+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function normalizeTag(candidate: string): string | null {
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
