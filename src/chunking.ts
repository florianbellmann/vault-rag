// Helpers for turning Markdown into bounded-length chunks for embedding.
export type Chunk = {
  heading: string;
  text: string;
};

// Splits markdown into sections keyed by the latest markdown heading.
export function splitByHeadings(
  md: string,
): Array<{ heading: string; content: string }> {
  // Split while keeping headings
  const parts = md.split(/\n(?=#{1,6}\s)/g);
  const out: Array<{ heading: string; content: string }> = [];

  let currentHeading = "ROOT";
  let currentContent: string[] = [];

  for (const part of parts) {
    const lines = part.split("\n");
    const first = lines[0] ?? "";
    const isHeading = /^#{1,6}\s+/.test(first);

    if (isHeading) {
      if (currentContent.length > 0) {
        out.push({
          heading: currentHeading,
          content: currentContent.join("\n"),
        });
      }
      currentHeading = first.trim();
      currentContent = lines.slice(1);
    } else {
      currentContent.push(part);
    }
  }

  if (currentContent.length > 0) {
    out.push({ heading: currentHeading, content: currentContent.join("\n") });
  }

  return out;
}

// Splits a block of text into string slices capped at maxChars.
export function chunkText(s: string, maxChars = 1800): string[] {
  const t = s.trim();
  if (!t) return [];
  const chunks: string[] = [];
  for (let i = 0; i < t.length; i += maxChars) {
    chunks.push(t.slice(i, i + maxChars));
  }
  return chunks;
}

// Builds embed-ready chunks by combining headings and bounded content slices.
export function makeChunks(md: string, maxChars = 1800): Chunk[] {
  const sections = splitByHeadings(md);
  const chunks: Chunk[] = [];

  for (const sec of sections) {
    for (const c of chunkText(sec.content, maxChars)) {
      const text = `${sec.heading}\n${c}`.trim();
      if (text) chunks.push({ heading: sec.heading, text });
    }
  }

  return chunks;
}
