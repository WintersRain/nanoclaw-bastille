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
    const buffer = Buffer.from('fake-image-data');
    const attachments = [
      { name: 'photo.png', contentType: 'image/png', buffer },
    ];

    const result = downloadAttachments(tmpDir, 'msg-123', attachments);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('photo.png');
    expect(result[0].contentType).toBe('image/png');
    expect(result[0].relativePath).toBe('attachments/msg-123/photo.png');

    // Verify file was actually written
    const filePath = path.join(tmpDir, 'attachments', 'msg-123', 'photo.png');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath).toString()).toBe('fake-image-data');
  });

  // Negative: empty attachments returns empty array
  it('should return empty array when no attachments provided', () => {
    const result = downloadAttachments(tmpDir, 'msg-456', []);
    expect(result).toHaveLength(0);
  });

  // Sanitizes filenames — strips unsafe characters
  it('should sanitize filenames to remove unsafe characters', () => {
    const buffer = Buffer.from('data');
    const attachments = [
      { name: 'my file (1).png', contentType: 'image/png', buffer },
    ];

    const result = downloadAttachments(tmpDir, 'msg-789', attachments);

    expect(result[0].name).toBe('my_file__1_.png');
    const filePath = path.join(tmpDir, 'attachments', 'msg-789', 'my_file__1_.png');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  // Multiple attachments
  it('should handle multiple attachments in one message', () => {
    const attachments = [
      { name: 'a.png', contentType: 'image/png', buffer: Buffer.from('aaa') },
      { name: 'b.pdf', contentType: 'application/pdf', buffer: Buffer.from('bbb') },
    ];

    const result = downloadAttachments(tmpDir, 'msg-multi', attachments);

    expect(result).toHaveLength(2);
    expect(fs.existsSync(path.join(tmpDir, 'attachments', 'msg-multi', 'a.png'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'attachments', 'msg-multi', 'b.pdf'))).toBe(true);
  });
});
