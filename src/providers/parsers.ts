export function extractOpenAIOutputText(response: unknown): string {
  const data = asRecord(response);
  const outputText = data.output_text;
  if (typeof outputText === "string") {
    return outputText;
  }

  const output = data.output;
  if (!Array.isArray(output)) {
    throw new Error("OpenAI response did not include output text.");
  }

  const chunks: string[] = [];
  for (const item of output) {
    const message = asRecord(item);
    const content = message.content;
    if (message.type === "message" && Array.isArray(content)) {
      for (const part of content) {
        const block = asRecord(part);
        if (block.type === "output_text" && typeof block.text === "string") {
          chunks.push(block.text);
        }
      }
    }
  }

  const text = chunks.join("");
  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }
  return text;
}

export function extractAzureOutputText(response: unknown): string {
  const data = asRecord(response);
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("Azure response did not include output text.");
  }

  const first = asRecord(choices[0]);
  const message = asRecord(first.message);
  const content = message.content;
  if (typeof content !== "string") {
    throw new Error("Azure response did not include output text.");
  }
  return content;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
