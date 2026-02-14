import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { downloadAttachments } from '../attachments.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-val-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('downloadAttachments with magic bytes validation', () => {
  // Happy path: valid PNG is saved
  it('should save a valid PNG file', () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const pngBody = Buffer.alloc(100, 0);
    const validPng = Buffer.concat([pngHeader, pngBody]);

    const result = downloadAttachments(tmpDir, 'msg-1', [
      { name: 'photo.png', contentType: 'image/png', buffer: validPng },
    ]);

    expect(result).toHaveLength(1);
    expect(fs.existsSync(path.join(tmpDir, 'attachments', 'msg-1', 'photo.png'))).toBe(true);
  });

  // Negative: ELF binary disguised as PNG is rejected
  it('should reject an ELF binary claiming to be image/png', () => {
    const elfBinary = Buffer.from([0x7F, 0x45, 0x4C, 0x46, ...Array(100).fill(0)]);

    const result = downloadAttachments(tmpDir, 'msg-2', [
      { name: 'evil.png', contentType: 'image/png', buffer: elfBinary },
    ]);

    expect(result).toHaveLength(0);
    // File should NOT be saved to disk
    expect(fs.existsSync(path.join(tmpDir, 'attachments', 'msg-2', 'evil.png'))).toBe(false);
  });

  // Non-image types bypass magic bytes check (they won't be sent to Gemini multimodal anyway)
  it('should save non-image files without magic bytes validation', () => {
    const pdfData = Buffer.from('%PDF-1.4 fake pdf content');

    const result = downloadAttachments(tmpDir, 'msg-3', [
      { name: 'doc.pdf', contentType: 'application/pdf', buffer: pdfData },
    ]);

    expect(result).toHaveLength(1);
    expect(fs.existsSync(path.join(tmpDir, 'attachments', 'msg-3', 'doc.pdf'))).toBe(true);
  });

  // Mix: valid image + spoofed image — only valid one saved
  it('should save valid images and reject spoofed ones in the same batch', () => {
    const validJpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(100, 0)]);
    const fakeJpeg = Buffer.from('<script>alert(1)</script>');

    const result = downloadAttachments(tmpDir, 'msg-4', [
      { name: 'real.jpg', contentType: 'image/jpeg', buffer: validJpeg },
      { name: 'fake.jpg', contentType: 'image/jpeg', buffer: fakeJpeg },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('real.jpg');
  });
});
