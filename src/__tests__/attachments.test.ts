import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { collectImages } from '../attachments.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('collectImages', () => {
  // Happy path: extract image from message with file marker
  it('should collect a PNG image referenced in message content', () => {
    // Create a fake image file
    const attachDir = path.join(tmpDir, 'attachments', '123');
    fs.mkdirSync(attachDir, { recursive: true });
    const imgData = Buffer.from('fake-png-data');
    fs.writeFileSync(path.join(attachDir, 'photo.png'), imgData);

    const messages = [
      { content: 'Look at this\n[file: photo.png | image/png | attachments/123/photo.png]' },
    ];

    const result = collectImages(messages, tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('photo.png');
    expect(result[0].mimeType).toBe('image/png');
    expect(result[0].data).toBe(imgData.toString('base64'));
  });

  // Negative: non-image files are skipped
  it('should skip non-image file types', () => {
    const attachDir = path.join(tmpDir, 'attachments', '456');
    fs.mkdirSync(attachDir, { recursive: true });
    fs.writeFileSync(path.join(attachDir, 'doc.pdf'), 'pdf-data');

    const messages = [
      { content: '[file: doc.pdf | application/pdf | attachments/456/doc.pdf]' },
    ];

    const result = collectImages(messages, tmpDir);

    expect(result).toHaveLength(0);
  });

  // Negative: file that doesn't exist on disk is skipped
  it('should skip files that do not exist on disk', () => {
    const messages = [
      { content: '[file: missing.png | image/png | attachments/789/missing.png]' },
    ];

    const result = collectImages(messages, tmpDir);

    expect(result).toHaveLength(0);
  });

  // Negative: oversized image is skipped
  it('should skip images exceeding per-image size limit', () => {
    const attachDir = path.join(tmpDir, 'attachments', '100');
    fs.mkdirSync(attachDir, { recursive: true });
    // Create a file just over the limit (pass a small limit for testing)
    const bigData = Buffer.alloc(1024 + 1, 'x');
    fs.writeFileSync(path.join(attachDir, 'big.png'), bigData);

    const messages = [
      { content: '[file: big.png | image/png | attachments/100/big.png]' },
    ];

    const result = collectImages(messages, tmpDir, 1024, 1024 * 1024);

    expect(result).toHaveLength(0);
  });

  // Negative: total size cap stops collection
  it('should stop collecting when total size cap is reached', () => {
    const attachDir = path.join(tmpDir, 'attachments', '200');
    fs.mkdirSync(attachDir, { recursive: true });
    // Two 600-byte images, total cap 1000 — second should be skipped
    fs.writeFileSync(path.join(attachDir, 'a.png'), Buffer.alloc(600, 'a'));
    fs.writeFileSync(path.join(attachDir, 'b.png'), Buffer.alloc(600, 'b'));

    const messages = [
      { content: '[file: a.png | image/png | attachments/200/a.png]\n[file: b.png | image/png | attachments/200/b.png]' },
    ];

    const result = collectImages(messages, tmpDir, 1024, 1000);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('a.png');
  });

  // Negative: messages with no file markers return empty
  it('should return empty array when no file markers exist', () => {
    const messages = [
      { content: 'Just a normal message' },
      { content: 'Another one' },
    ];

    const result = collectImages(messages, tmpDir);

    expect(result).toHaveLength(0);
  });
});
