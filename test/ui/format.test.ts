import { describe, expect, it } from 'vitest';
import { bytes, compact, duration, exact, plural, relativeTime } from '../../packages/ui/src/format.js';

describe('compact', () => {
  it('leaves small numbers exact — they already read fine', () => {
    expect(compact(0)).toBe('0');
    expect(compact(42)).toBe('42');
    expect(compact(999)).toBe('999');
  });

  it('switches to k at a thousand, without a pointless .0', () => {
    expect(compact(1000)).toBe('1k');
    expect(compact(1200)).toBe('1.2k');
    expect(compact(81633)).toBe('82k');
  });

  it('drops the decimal once the integer part carries the size', () => {
    expect(compact(9900)).toBe('9.9k');
    expect(compact(12000)).toBe('12k');
    expect(compact(157135)).toBe('157k');
  });

  it('scales through M, B and T', () => {
    expect(compact(1_500_000)).toBe('1.5M');
    expect(compact(2_400_000_000)).toBe('2.4B');
    expect(compact(3_000_000_000_000)).toBe('3T');
  });

  it('handles negatives and non-numbers', () => {
    expect(compact(-1200)).toBe('-1.2k');
    expect(compact(NaN)).toBe('—');
  });
});

describe('exact', () => {
  it('separates thousands so a tooltip stays readable', () => {
    expect(exact(81633)).toBe((81633).toLocaleString());
    expect(exact(NaN)).toBe('—');
  });
});

describe('bytes', () => {
  it('uses binary units, matching du -h and Docker', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(1024)).toBe('1.00 KB');
    expect(bytes(2_515_421_157)).toBe('2.34 GB');
  });

  /**
   * Precision drops as the number grows: two decimals on 234 MB is false
   * precision that flickers every second during indexing.
   */
  it('sheds decimals as the number grows, so columns stay narrow and stable', () => {
    expect(bytes(2 * 1024 ** 2)).toBe('2.00 MB');
    expect(bytes(12 * 1024 ** 2)).toBe('12.0 MB');
    expect(bytes(245_298_879)).toBe('234 MB');
    expect(bytes(500 * 1024 ** 2)).toBe('500 MB');
  });

  it('reports nothing rather than a wrong zero when unknown', () => {
    expect(bytes(null)).toBe('—');
    expect(bytes(undefined)).toBe('—');
    expect(bytes(0)).toBe('0 B');
  });
});

describe('duration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(duration(45)).toBe('45s');
    expect(duration(200)).toBe('3m 20s');
    expect(duration(3900)).toBe('1h 05m');
  });

  it('rejects nonsense rather than rendering it', () => {
    expect(duration(-1)).toBe('—');
    expect(duration(null)).toBe('—');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-07-09T12:00:00Z');
  const ago = (s: number) => new Date(now - s * 1000).toISOString();

  it('describes recency in words', () => {
    expect(relativeTime(ago(10), now)).toBe('just now');
    expect(relativeTime(ago(60), now)).toBe('a minute ago');
    expect(relativeTime(ago(600), now)).toBe('10 minutes ago');
    expect(relativeTime(ago(3600), now)).toBe('1 hour ago');
    expect(relativeTime(ago(7200), now)).toBe('2 hours ago');
    expect(relativeTime(ago(86_400), now)).toBe('1 day ago');
  });

  it('says never when there is no timestamp', () => {
    expect(relativeTime(undefined, now)).toBe('never');
    expect(relativeTime('not a date', now)).toBe('never');
  });

  it('does not render a negative age from clock skew', () => {
    expect(relativeTime(new Date(now + 5000).toISOString(), now)).toBe('just now');
  });
});

describe('plural', () => {
  it('never renders "1 prompts"', () => {
    expect(plural(1, 'prompt')).toBe('1 prompt');
    expect(plural(0, 'prompt')).toBe('0 prompts');
    expect(plural(2, 'prompt')).toBe('2 prompts');
  });

  it('separates thousands and takes an irregular plural', () => {
    expect(plural(1500, 'entry', 'entries')).toBe(`${(1500).toLocaleString()} entries`);
  });
});
