export type Chunk = {
  heading: string;
  text: string;
};

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

export function chunkText(s: string, maxChars = 1800): string[] {
  const t = s.trim();
  if (!t) return [];
  const chunks: string[] = [];
  for (let i = 0; i < t.length; i += maxChars) {
    chunks.push(t.slice(i, i + maxChars));
  }
  return chunks;
}

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
