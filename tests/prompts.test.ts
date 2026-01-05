import { describe, expect, test } from "bun:test";
import { renderPrompt } from "../src/core/prompts";

describe("renderPrompt", () => {
  test("replaces placeholders with provided values", () => {
    const template = "Hello {{name}}, your score is {{score}}.";
    const output = renderPrompt(template, { name: "Vault", score: 42 });
    expect(output).toBe("Hello Vault, your score is 42.");
  });

  test("omits placeholders when value missing", () => {
    const template = "Project: {{project}} | Owner: {{owner}}";
    const output = renderPrompt(template, { project: "RAG" });
    expect(output).toBe("Project: RAG | Owner: ");
  });
});
