import { iterVaultMarkdown, readMarkdown } from "../fs/vault";
import { parseFrontmatter } from "../metadata/frontmatter";
import type { GlobalConfig } from "../types";

export interface HygieneIssue {
  path: string;
  type:
    | "missing_frontmatter"
    | "no_headings"
    | "long_section"
    | "separator"
    | "missing_summary";
  detail: string;
}

/**
 * Scans the vault and surfaces data-quality warnings.
 */
export async function analyzeVault(
  config: GlobalConfig,
): Promise<HygieneIssue[]> {
  const issues: HygieneIssue[] = [];
  for await (const file of iterVaultMarkdown(config.paths.vault)) {
    const markdown = await readMarkdown(file.absolute);
    const { data, body, hasFrontmatter } = parseFrontmatter(markdown);
    if (!hasFrontmatter) {
      issues.push({
        path: file.relative,
        type: "missing_frontmatter",
        detail: "Add YAML frontmatter for consistent metadata.",
      });
    }
    const headings = [...body.matchAll(/^#{1,6}\s+/gm)];
    if (headings.length === 0) {
      issues.push({
        path: file.relative,
        type: "no_headings",
        detail: "Add headings to improve chunk structure.",
      });
    }
    const sections = body.split(/\n(?=#{1,6}\s)/g);
    for (const section of sections) {
      const tokenCount = section.split(/\s+/).length;
      if (tokenCount > config.chunking.max_tokens * 3) {
        issues.push({
          path: file.relative,
          type: "long_section",
          detail: `Section exceeds ${config.chunking.max_tokens * 3} tokens.`,
        });
        break;
      }
    }
    const separatorPattern = /#{1,6}.*\n[^\n#]/g;
    if (separatorPattern.test(body)) {
      issues.push({
        path: file.relative,
        type: "separator",
        detail: "Add blank lines after headings for consistent parsing.",
      });
    }
    const hasSummaryHeading = /#{1,3}\s+Summary/i.test(body);
    const hasSummaryField =
      typeof data.summary === "string" && data.summary.trim().length > 0;
    if (!hasSummaryHeading && !hasSummaryField) {
      issues.push({
        path: file.relative,
        type: "missing_summary",
        detail: "Add a summary heading or frontmatter summary.",
      });
    }
  }
  return issues;
}
