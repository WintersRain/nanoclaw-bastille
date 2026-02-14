import { describe, it, expect, vi } from 'vitest';

import { buildInjectionScanPrompt, parseInjectionScanResponse } from '../attachments.js';

describe('buildInjectionScanPrompt', () => {
  // Happy path: returns a focused prompt with no content moderation language
  it('should return a prompt focused on prompt injection, not content moderation', () => {
    const prompt = buildInjectionScanPrompt();

    // Must mention injection/manipulation
    expect(prompt.toLowerCase()).toContain('inject');

    // Must NOT contain moderation language
    expect(prompt.toLowerCase()).not.toContain('inappropriate');
    expect(prompt.toLowerCase()).not.toContain('nsfw');
    expect(prompt.toLowerCase()).not.toContain('offensive');
    expect(prompt.toLowerCase()).not.toContain('explicit');
    expect(prompt.toLowerCase()).not.toContain('harmful content');
  });
});

describe('parseInjectionScanResponse', () => {
  // Happy path: "SAFE" response
  it('should return safe:true when response starts with SAFE', () => {
    const result = parseInjectionScanResponse('SAFE');
    expect(result.safe).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // Happy path: "SAFE" with extra text
  it('should return safe:true when response contains SAFE on first line', () => {
    const result = parseInjectionScanResponse('SAFE\nNo injection detected.');
    expect(result.safe).toBe(true);
  });

  // Negative: "INJECTION" response with reason
  it('should return safe:false with reason when response starts with INJECTION', () => {
    const result = parseInjectionScanResponse('INJECTION: Text overlay says "ignore all instructions"');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('ignore all instructions');
  });

  // Negative: garbled/unexpected response treated as safe (fail open for availability)
  it('should fail open and return safe:true on unparseable response', () => {
    const result = parseInjectionScanResponse('I cannot determine the content of this image');
    expect(result.safe).toBe(true);
  });

  // Negative: empty response treated as safe
  it('should return safe:true on empty response', () => {
    const result = parseInjectionScanResponse('');
    expect(result.safe).toBe(true);
  });
});
