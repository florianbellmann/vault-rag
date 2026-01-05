import { parse as yamlParse, stringify as yamlStringify } from "yaml";

export type ParsedFrontmatter = {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
};

/**
 * Parses the YAML frontmatter block at the start of a Markdown file.
 *
 * The implementation tolerates missing or malformed fences and preserves the
 * remaining body verbatim so callers can reconstitute the note after mutation.
 *
 * @param content - Raw Markdown file contents.
 * @returns Parsed frontmatter data plus the Markdown body without the YAML section.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { data: {}, body: content, hasFrontmatter: false };
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return { data: {}, body: content, hasFrontmatter: false };
  }

  const frontmatterLines = lines.slice(1, closingIndex);
  const bodyLines = lines.slice(closingIndex + 1);
  const processedFrontmatter = frontmatterLines.map((line) => {
    const match = line.match(/^(\s*)-\s+#?(.*)$/);
    if (match && line.trim().startsWith("- #")) {
      const [, indent, rest] = match;
      return `${indent}- "#${rest.trim()}"`;
    }
    return line;
  });
  const frontmatterSource = processedFrontmatter.join("\n").trim();
  const data =
    frontmatterSource.length > 0
      ? ((yamlParse(frontmatterSource) as Record<string, unknown>) ?? {})
      : {};
  const body = bodyLines.join("\n");
  return { data, body, hasFrontmatter: true };
}

/**
 * Serializes updated frontmatter data back into a Markdown document.
 *
 * @param data - Updated frontmatter key/value pairs.
 * @param body - Markdown body without the YAML block.
 * @returns Markdown document with normalized frontmatter fences.
 */
export function stringifyFrontmatter(
  data: Record<string, unknown>,
  body: string,
): string {
  const entries = Object.entries(data ?? {});
  const yamlSection =
    entries.length > 0
      ? `${yamlStringify(data, { simpleKeys: true })
          .trimEnd()
          .replace(/^(\s*-\s+)(#.+)$/gm, (_, prefix, tag) => {
            const trimmedTag = tag.trim();
            return `${prefix}"${trimmedTag}"`;
          })}\n`
      : "";
  const frontmatterBlock = `---\n${yamlSection}---`;
  const normalizedBody = body.replace(/^\n+/, "");
  const trailing = normalizedBody ? `\n${normalizedBody}` : "\n";
  return `${frontmatterBlock}${trailing}`;
}
