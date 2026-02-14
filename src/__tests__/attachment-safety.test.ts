import { describe, it, expect } from 'vitest';

import { isImageSafeForProcessing } from '../attachments.js';

describe('isImageSafeForProcessing', () => {
  // Happy path: known safe image types pass
  it('should allow standard image types', () => {
    expect(isImageSafeForProcessing('photo.png', 'image/png')).toBe(true);
    expect(isImageSafeForProcessing('photo.jpg', 'image/jpeg')).toBe(true);
    expect(isImageSafeForProcessing('anim.gif', 'image/gif')).toBe(true);
    expect(isImageSafeForProcessing('icon.webp', 'image/webp')).toBe(true);
  });

  // Negative: non-image MIME types are rejected
  it('should reject non-image MIME types', () => {
    expect(isImageSafeForProcessing('script.js', 'application/javascript')).toBe(false);
    expect(isImageSafeForProcessing('page.html', 'text/html')).toBe(false);
    expect(isImageSafeForProcessing('data.json', 'application/json')).toBe(false);
  });

  // Negative: executable disguised as image (MIME mismatch)
  it('should reject files with image extension but wrong MIME type', () => {
    expect(isImageSafeForProcessing('evil.png', 'application/x-executable')).toBe(false);
    expect(isImageSafeForProcessing('evil.jpg', 'text/html')).toBe(false);
  });

  // Negative: SVG is rejected (can contain scripts)
  it('should reject SVG files', () => {
    expect(isImageSafeForProcessing('diagram.svg', 'image/svg+xml')).toBe(false);
  });
});
