import { stripAiBlocks } from "./ai_markers";

// Helpers for turning Markdown into bounded-length chunks for embedding.
export type Chunk = {
  heading: string;
  text: string;
};

// Splits markdown into sections keyed by the latest markdown heading.
export function splitByHeadings(
  markdown: string,
): Array<{ heading: string; content: string }> {
  // Split while keeping headings.
  const markdownSections = markdown.split(/\n(?=#{1,6}\s)/g);
  const sections: Array<{ heading: string; content: string }> = [];

  let currentHeading = "ROOT";
  let currentContentLines: string[] = [];

  for (const section of markdownSections) {
    const lines = section.split("\n");
    const firstLine = lines[0] ?? "";
    const isHeading = /^#{1,6}\s+/.test(firstLine);

    if (isHeading) {
      if (currentContentLines.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentContentLines.join("\n"),
        });
      }
      currentHeading = firstLine.trim();
      currentContentLines = lines.slice(1);
    } else {
      currentContentLines.push(section);
    }
  }

  if (currentContentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentContentLines.join("\n"),
    });
  }

  return sections;
}

// Splits a block of text into string slices capped at maxChars.
export function chunkText(text: string, maxChars = 1800): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const chunks: string[] = [];
  for (
    let characterOffset = 0;
    characterOffset < trimmed.length;
    characterOffset += maxChars
  ) {
    chunks.push(trimmed.slice(characterOffset, characterOffset + maxChars));
  }
  return chunks;
}

// Builds embed-ready chunks by combining headings and bounded content slices.
export function makeChunks(markdown: string, maxChars = 1800): Chunk[] {
  const sanitizedMarkdown = stripAiBlocks(markdown);
  const headingSections = splitByHeadings(sanitizedMarkdown);
  const chunks: Chunk[] = [];

  for (const section of headingSections) {
    for (const sectionChunk of chunkText(section.content, maxChars)) {
      const chunkTextValue = `${section.heading}\n${sectionChunk}`.trim();
      if (chunkTextValue) {
        chunks.push({ heading: section.heading, text: chunkTextValue });
      }
    }
  }

  return chunks;
}
