import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractAzureOutputText, extractOpenAIOutputText } from "../../providers/parsers";

describe("provider response parsing", () => {
  it("extracts OpenAI output_text shortcut", () => {
    const text = extractOpenAIOutputText({ output_text: "hello" });
    assert.equal(text, "hello");
  });

  it("extracts OpenAI content blocks", () => {
    const text = extractOpenAIOutputText({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "hello " }, { type: "output_text", text: "world" }]
        }
      ]
    });

    assert.equal(text, "hello world");
  });

  it("extracts Azure message content", () => {
    const text = extractAzureOutputText({
      choices: [{ message: { content: "azure text" } }]
    });

    assert.equal(text, "azure text");
  });
});
