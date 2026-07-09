import { describe, expect, it } from 'vitest';
import { scanJobId } from '../../packages/indexer/src/scheduler.js';

/**
 * BullMQ rejects ':' in custom job ids ("Custom Id cannot contain :"), which
 * crash-looped the indexer once. Project slugs and Claude dir names can hold
 * dots, slashes and colons, so ids must always be normalised.
 */
describe('scanJobId', () => {
  it('never contains a colon, even when inputs do', () => {
    const id = scanJobId('deepcast', 'claude_session__-Users-nasta-x:y', false);
    expect(id).not.toContain(':');
  });

  it('normalises every character outside [A-Za-z0-9_-]', () => {
    expect(scanJobId('fwdr.it', 'doc')).toBe('fwdr-it--doc--inc');
    expect(scanJobId('a/b', 'kdb')).toBe('a-b--kdb--inc');
  });

  it('distinguishes full from incremental runs', () => {
    expect(scanJobId('p', 'kdb', true)).toBe('p--kdb--full');
    expect(scanJobId('p', 'kdb', false)).toBe('p--kdb--inc');
  });

  it('is stable so an identical pending job is not queued twice', () => {
    expect(scanJobId('p', 'doc')).toBe(scanJobId('p', 'doc'));
  });

  it('separates distinct claude dirs of the same project', () => {
    const a = scanJobId('deepcast', 'claude_session__-Users-nasta-DeepCast');
    const b = scanJobId('deepcast', 'claude_session__-Volumes-CloudBox-DeepCast');
    expect(a).not.toBe(b);
  });
});
