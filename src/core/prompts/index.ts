/*
 * Replaces `{{placeholder}}` tokens in prompt templates with the provided values.
 *
 * The templating is intentionally minimal to keep prompts transparent. Missing values are replaced
 * with empty strings so prompts never leak `undefined`.
 *
 * @param template - Raw prompt template as defined in the global configuration.
 * @param variables - Named slots rendered into the template.
 * @returns Rendered template ready to send to a language model.
 */
export function renderPrompt(
  template: string,
  variables: Record<string, string | number | undefined>,
): string {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {
    const value = variables[key];
    return value === undefined ? "" : String(value);
  });
}
