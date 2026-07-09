import { describe, expect, it } from 'vitest';
import { createSseParser } from '../../packages/core/src/llm.js';

const frame = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe('createSseParser', () => {
  it('extracts content deltas from complete frames', () => {
    const parse = createSseParser();
    expect(parse(frame('Hello') + frame(' world'))).toEqual(['Hello', ' world']);
  });

  it('buffers frames split across network reads', () => {
    const parse = createSseParser();
    const full = frame('streamed');
    const cut = Math.floor(full.length / 2);
    expect(parse(full.slice(0, cut))).toEqual([]);
    expect(parse(full.slice(cut))).toEqual(['streamed']);
  });

  it('ignores the [DONE] sentinel and empty data lines', () => {
    const parse = createSseParser();
    expect(parse(frame('x') + 'data: [DONE]\n\n')).toEqual(['x']);
    expect(parse('data: \n\n')).toEqual([]);
  });

  it('survives a malformed frame without dropping the stream', () => {
    const parse = createSseParser();
    expect(parse('data: {not json}\n\n' + frame('after'))).toEqual(['after']);
  });

  it('ignores frames with no content delta (role-only openers)', () => {
    const parse = createSseParser();
    const roleOnly = `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`;
    expect(parse(roleOnly + frame('hi'))).toEqual(['hi']);
  });

  it('handles multiple data lines inside one record', () => {
    const parse = createSseParser();
    const rec =
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'b' } }] })}\n\n`;
    expect(parse(rec)).toEqual(['a', 'b']);
  });
});
