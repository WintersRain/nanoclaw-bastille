import { describe, it, expect } from 'vitest';

import { validateImageMagicBytes } from '../attachments.js';

describe('validateImageMagicBytes', () => {
  // Happy path: valid PNG magic bytes
  it('should accept a buffer with valid PNG magic bytes', () => {
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(100).fill(0)]);
    expect(validateImageMagicBytes(png, 'image/png')).toBe(true);
  });

  // Happy path: valid JPEG
  it('should accept a buffer with valid JPEG magic bytes', () => {
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Array(100).fill(0)]);
    expect(validateImageMagicBytes(jpeg, 'image/jpeg')).toBe(true);
  });

  // Happy path: valid GIF
  it('should accept a buffer with valid GIF87a magic bytes', () => {
    const gif = Buffer.from('GIF87a' + '\0'.repeat(100));
    expect(validateImageMagicBytes(gif, 'image/gif')).toBe(true);
  });

  // Happy path: valid GIF89a
  it('should accept a buffer with valid GIF89a magic bytes', () => {
    const gif = Buffer.from('GIF89a' + '\0'.repeat(100));
    expect(validateImageMagicBytes(gif, 'image/gif')).toBe(true);
  });

  // Happy path: valid WEBP
  it('should accept a buffer with valid WEBP magic bytes', () => {
    // RIFF....WEBP
    const webp = Buffer.alloc(20);
    webp.write('RIFF', 0);
    webp.writeUInt32LE(12, 4); // file size
    webp.write('WEBP', 8);
    expect(validateImageMagicBytes(webp, 'image/webp')).toBe(true);
  });

  // Negative: ELF binary claiming to be PNG
  it('should reject an ELF binary disguised as PNG', () => {
    const elf = Buffer.from([0x7F, 0x45, 0x4C, 0x46, ...Array(100).fill(0)]);
    expect(validateImageMagicBytes(elf, 'image/png')).toBe(false);
  });

  // Negative: HTML claiming to be JPEG
  it('should reject HTML content disguised as JPEG', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect(validateImageMagicBytes(html, 'image/jpeg')).toBe(false);
  });

  // Negative: wrong image format (JPEG bytes but claiming PNG)
  it('should reject JPEG bytes when MIME claims PNG', () => {
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Array(100).fill(0)]);
    expect(validateImageMagicBytes(jpeg, 'image/png')).toBe(false);
  });

  // Negative: buffer too short
  it('should reject buffers that are too short to validate', () => {
    const tiny = Buffer.from([0x89, 0x50]);
    expect(validateImageMagicBytes(tiny, 'image/png')).toBe(false);
  });

  // Negative: unknown MIME type
  it('should reject unknown MIME types', () => {
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(100).fill(0)]);
    expect(validateImageMagicBytes(png, 'image/tiff')).toBe(false);
  });
});
