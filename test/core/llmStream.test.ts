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

  /**
   * The usage frame is the odd one out: it carries `choices: []`, so it yields
   * no content and would be dropped entirely by a content-only read. It only
   * arrives when the request opts in via stream_options.include_usage.
   */
  describe('usage capture', () => {
    const usageFrame =
      `data: ${JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 11, completion_tokens: 19, total_tokens: 30 },
      })}\n\n`;

    it('captures the usage frame without emitting it as a delta', () => {
      const seen: unknown[] = [];
      const parse = createSseParser((u) => seen.push(u));

      expect(parse(frame('hi') + usageFrame)).toEqual(['hi']);
      expect(seen).toEqual([{ promptTokens: 11, completionTokens: 19, totalTokens: 30 }]);
    });

    it('does not invoke the sink when no usage frame arrives', () => {
      const seen: unknown[] = [];
      const parse = createSseParser((u) => seen.push(u));

      parse(frame('hi') + 'data: [DONE]\n\n');
      expect(seen).toEqual([]);
    });

    it('parses content deltas the same whether or not a sink is passed', () => {
      // The sink is additive: it must not change what the parser returns.
      expect(createSseParser()(frame('x'))).toEqual(['x']);
      expect(createSseParser(() => {})(frame('x'))).toEqual(['x']);
    });
  });
});
