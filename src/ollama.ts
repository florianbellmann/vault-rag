// Minimal Ollama REST helpers.
type EmbedResponse = { embeddings: number[][] };

// Calls Ollama's embed endpoint and returns the embeddings array.
export async function ollamaEmbed(
  inputTexts: string[],
  options: { ollamaUrl: string; model: string },
): Promise<number[][]> {
  const response = await fetch(`${options.ollamaUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: options.model, input: inputTexts }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama embed failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as EmbedResponse;
  return data.embeddings;
}

type GenerateResponse = { response: string };

// Calls the generate endpoint for ad-hoc prompting.
export async function ollamaGenerate(
  prompt: string,
  options: { ollamaUrl: string; model: string },
): Promise<string> {
  const response = await fetch(`${options.ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama generate failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as GenerateResponse;
  return data.response;
}
