import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { dirSize, parseRedisMemory, qdrantCollectionSizes } from '@kdbscope/core';

const root = mkdtempSync(join(tmpdir(), 'kdbscope-storage-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// A miniature Qdrant storage tree.
mkdirSync(join(root, 'collections/active/segments'), { recursive: true });
mkdirSync(join(root, 'collections/orphan'), { recursive: true });
writeFileSync(join(root, 'collections/active/meta.json'), 'x'.repeat(100));
writeFileSync(join(root, 'collections/active/segments/data'), 'y'.repeat(900));
writeFileSync(join(root, 'collections/orphan/data'), 'z'.repeat(300));

describe('dirSize', () => {
  it('sums files recursively', async () => {
    expect(await dirSize(join(root, 'collections/active'))).toBe(1000);
  });

  /** A missing path means "cannot tell", never "uses no disk". */
  it('returns null for a path that is not there', async () => {
    expect(await dirSize(join(root, 'nope'))).toBeNull();
  });
});

describe('qdrantCollectionSizes', () => {
  it('sizes each collection, largest first, flagging the active one', async () => {
    const sizes = await qdrantCollectionSizes(root, 'active');
    expect(sizes).toEqual([
      { name: 'active', bytes: 1000, active: true },
      { name: 'orphan', bytes: 300, active: false },
    ]);
  });

  /**
   * Switching the embedding model leaves the previous collection behind; on a
   * real index that is over a gigabyte of dead vectors worth surfacing.
   */
  it('marks every collection inactive when none matches', async () => {
    const sizes = await qdrantCollectionSizes(root, 'some-other-collection');
    expect(sizes.every((c) => !c.active)).toBe(true);
  });

  it('returns nothing when the storage volume is not mounted', async () => {
    expect(await qdrantCollectionSizes('/not/mounted', 'active')).toEqual([]);
  });
});

describe('parseRedisMemory', () => {
  it('reads used_memory from an INFO block', () => {
    const info = '# Memory\r\nused_memory:4378216\r\nused_memory_human:4.18M\r\n';
    expect(parseRedisMemory(info)).toBe(4_378_216);
  });

  it('is not fooled by used_memory_peak or similar keys', () => {
    expect(parseRedisMemory('used_memory_peak:999\r\nused_memory:42\r\n')).toBe(42);
  });

  it('returns null when the field is absent', () => {
    expect(parseRedisMemory('')).toBeNull();
  });
});
