import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { collectImages } from '../attachments.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-scan-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helper: write a valid PNG to disk
function writeFakePng(dir: string, relativePath: string, content = 'test-image-data'): void {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe('collectImages with injection scanner', () => {
  // Happy path: scanner approves, image is collected
  it('should include images that pass the injection scan', async () => {
    writeFakePng(tmpDir, 'attachments/1/safe.png');
    const messages = [{ content: '[file: safe.png | image/png | attachments/1/safe.png]' }];

    const scanner = async () => ({ safe: true });
    const result = await collectImages(messages, tmpDir, undefined, undefined, scanner);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('safe.png');
  });

  // Negative: scanner rejects, image is dropped
  it('should exclude images that fail the injection scan', async () => {
    writeFakePng(tmpDir, 'attachments/2/injected.png');
    const messages = [{ content: '[file: injected.png | image/png | attachments/2/injected.png]' }];

    const scanner = async () => ({ safe: false, reason: 'Contains prompt injection text' });
    const result = await collectImages(messages, tmpDir, undefined, undefined, scanner);

    expect(result).toHaveLength(0);
  });

  // Scanner error fails open (availability over security for non-critical bot)
  it('should include images when scanner throws an error (fail open)', async () => {
    writeFakePng(tmpDir, 'attachments/3/ok.png');
    const messages = [{ content: '[file: ok.png | image/png | attachments/3/ok.png]' }];

    const scanner = async () => { throw new Error('API unavailable'); };
    const result = await collectImages(messages, tmpDir, undefined, undefined, scanner);

    expect(result).toHaveLength(1);
  });

  // No scanner provided — backward compatible, collects normally
  it('should collect images without scanning when no scanner provided', async () => {
    writeFakePng(tmpDir, 'attachments/4/photo.png');
    const messages = [{ content: '[file: photo.png | image/png | attachments/4/photo.png]' }];

    const result = await collectImages(messages, tmpDir);

    expect(result).toHaveLength(1);
  });
});
