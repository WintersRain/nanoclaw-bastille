import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { downloadAttachments } from '../attachments.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-dl-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('downloadAttachments', () => {
  // Happy path: saves file to disk and returns metadata
  it('should save attachment to disk and return metadata with relative path', () => {
    // Valid PNG magic bytes + body
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const buffer = Buffer.concat([pngHeader, Buffer.alloc(50, 0)]);
    const attachments = [
      { name: 'photo.png', contentType: 'image/png', buffer },
    ];

    const result = downloadAttachments(tmpDir, 'msg-123', attachments);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('photo.png');
    expect(result[0].contentType).toBe('image/png');
    expect(result[0].relativePath).toBe('attachments/msg-123/photo.png');

    const filePath = path.join(tmpDir, 'attachments', 'msg-123', 'photo.png');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  // Negative: empty attachments returns empty array
  it('should return empty array when no attachments provided', () => {
    const result = downloadAttachments(tmpDir, 'msg-456', []);
    expect(result).toHaveLength(0);
  });

  // Sanitizes filenames — strips unsafe characters (use non-image type to avoid magic bytes check)
  it('should sanitize filenames to remove unsafe characters', () => {
    const buffer = Buffer.from('data');
    const attachments = [
      { name: 'my file (1).txt', contentType: 'text/plain', buffer },
    ];

    const result = downloadAttachments(tmpDir, 'msg-789', attachments);

    expect(result[0].name).toBe('my_file__1_.txt');
    const filePath = path.join(tmpDir, 'attachments', 'msg-789', 'my_file__1_.txt');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  // Multiple attachments (valid PNG + non-image)
  it('should handle multiple attachments in one message', () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const attachments = [
      { name: 'a.png', contentType: 'image/png', buffer: Buffer.concat([pngHeader, Buffer.alloc(50, 0)]) },
      { name: 'b.pdf', contentType: 'application/pdf', buffer: Buffer.from('bbb') },
    ];

    const result = downloadAttachments(tmpDir, 'msg-multi', attachments);

    expect(result).toHaveLength(2);
    expect(fs.existsSync(path.join(tmpDir, 'attachments', 'msg-multi', 'a.png'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'attachments', 'msg-multi', 'b.pdf'))).toBe(true);
  });
});
