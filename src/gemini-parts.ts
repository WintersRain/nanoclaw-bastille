/**
 * Build Gemini API content parts from text and optional images.
 * Used by the agent-runner to construct multimodal messages.
 */

export interface GeminiTextPart {
  text: string;
}

export interface GeminiInlineDataPart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

export type GeminiPart = GeminiTextPart | GeminiInlineDataPart;

export function buildGeminiParts(
  prompt: string,
  images?: Array<{ name: string; mimeType: string; data: string }>,
): GeminiPart[] {
  const parts: GeminiPart[] = [{ text: prompt }];
  if (images && images.length > 0) {
    for (const img of images) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
  }
  return parts;
}
