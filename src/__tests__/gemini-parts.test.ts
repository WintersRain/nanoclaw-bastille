import { describe, it, expect } from 'vitest';

import { buildGeminiParts } from '../gemini-parts.js';

describe('buildGeminiParts', () => {
  // Happy path: text + images produces text part followed by inlineData parts
  it('should produce text part followed by image inlineData parts', () => {
    const parts = buildGeminiParts('Describe this image', [
      { name: 'photo.png', mimeType: 'image/png', data: 'aGVsbG8=' },
    ]);

    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ text: 'Describe this image' });
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } });
  });

  // Negative: no images, just text part
  it('should return only text part when no images provided', () => {
    const parts = buildGeminiParts('Just text');

    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ text: 'Just text' });
  });

  // Negative: empty images array
  it('should return only text part when images array is empty', () => {
    const parts = buildGeminiParts('Just text', []);

    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ text: 'Just text' });
  });

  // Multiple images
  it('should include all images as inlineData parts', () => {
    const parts = buildGeminiParts('Check these', [
      { name: 'a.png', mimeType: 'image/png', data: 'YQ==' },
      { name: 'b.jpg', mimeType: 'image/jpeg', data: 'Yg==' },
    ]);

    expect(parts).toHaveLength(3);
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'YQ==' } });
    expect(parts[2]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'Yg==' } });
  });
});
