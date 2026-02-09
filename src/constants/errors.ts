export const ERROR_MESSAGES = {
  CANCELLED: "Ink2Markdown cancelled.",
  NETWORK_PROVIDER: "Network error while contacting provider.",
  REQUEST_TIMEOUT: "Request timed out.",
  OPENAI_NO_OUTPUT: "OpenAI response did not include output text.",
  AZURE_NO_OUTPUT: "Azure response did not include output text.",
  CANVAS_CONTEXT: "Could not create canvas context for line segmentation.",
  IMAGE_LOAD: "Failed to load image for segmentation."
} as const;
