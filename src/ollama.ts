// Minimal Ollama REST helpers.
type EmbedResponse = { embeddings: number[][] };

// Calls Ollama's embed endpoint and returns the embeddings array.
export async function ollamaEmbed(
  input: string[],
  opts: { ollamaUrl: string; model: string },
): Promise<number[][]> {
  const res = await fetch(`${opts.ollamaUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: opts.model, input }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama embed failed: ${res.status} ${t}`);
  }

  const data = (await res.json()) as EmbedResponse;
  return data.embeddings;
}

type GenerateResponse = { response: string };

// Calls the generate endpoint for ad-hoc prompting.
export async function ollamaGenerate(
  prompt: string,
  opts: { ollamaUrl: string; model: string },
): Promise<string> {
  const res = await fetch(`${opts.ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      prompt,
      stream: false,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama generate failed: ${res.status} ${t}`);
  }

  const data = (await res.json()) as GenerateResponse;
  return data.response;
}
