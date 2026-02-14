import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Tests for storeDiscordMessage attachment metadata.
 * The function should append [file: name | type | path] lines to message content.
 */

// We need to test the content transformation logic.
// Since storeDiscordMessage is tightly coupled to Discord.js Message objects and a live DB,
// we extract the content-building logic into a testable helper: buildMessageContent.

import { buildMessageContent } from '../db.js';

describe('buildMessageContent', () => {
  // Happy path: message with text + attachments
  it('should append attachment metadata after message text', () => {
    const content = 'Hello world';
    const attachments = [
      { name: 'photo.png', contentType: 'image/png', relativePath: 'attachments/123/photo.png' },
    ];

    const result = buildMessageContent(content, attachments);

    expect(result).toBe('Hello world\n[file: photo.png | image/png | attachments/123/photo.png]');
  });

  // Negative: no attachments, content unchanged
  it('should return original content when no attachments provided', () => {
    const result = buildMessageContent('Just text', undefined);
    expect(result).toBe('Just text');
  });

  // Negative: empty attachments array
  it('should return original content when attachments array is empty', () => {
    const result = buildMessageContent('Just text', []);
    expect(result).toBe('Just text');
  });

  // Negative: empty content with attachments (attachment-only message)
  it('should use attachment lines as content when message text is empty', () => {
    const attachments = [
      { name: 'doc.pdf', contentType: 'application/pdf', relativePath: 'attachments/456/doc.pdf' },
    ];

    const result = buildMessageContent('', attachments);

    expect(result).toBe('[file: doc.pdf | application/pdf | attachments/456/doc.pdf]');
  });

  // Multiple attachments
  it('should join multiple attachments with newlines', () => {
    const content = 'Check these out';
    const attachments = [
      { name: 'a.png', contentType: 'image/png', relativePath: 'attachments/1/a.png' },
      { name: 'b.jpg', contentType: 'image/jpeg', relativePath: 'attachments/1/b.jpg' },
    ];

    const result = buildMessageContent(content, attachments);

    expect(result).toContain('[file: a.png | image/png | attachments/1/a.png]');
    expect(result).toContain('[file: b.jpg | image/jpeg | attachments/1/b.jpg]');
    expect(result.split('\n').length).toBe(3); // text + 2 attachments
  });
});
