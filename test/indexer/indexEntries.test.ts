import { describe, expect, it, vi } from 'vitest';
import { indexEntries } from '../../packages/indexer/src/pipeline.js';
import type { Entry } from '@atlas/core';

const entry = (id: number, body: string): { id: number; entry: Entry } => ({
  id,
  entry: {
    projectSlug: 'deepcast',
    sourceType: 'claude_session',
    sessionId: 'abc',
    title: `entry ${id}`,
    body,
    sourcePath: '/x/abc.jsonl',
  },
});

function makeDeps(embedImpl?: () => Promise<number[][]>) {
  const upserted: unknown[][] = [];
  const embedCalls: number[] = [];
  return {
    deps: {
      catalog: {} as any,
      vectors: {
        upsert: vi.fn(async (points: unknown[]) => {
          upserted.push(points);
        }),
      } as any,
      embedder: {
        name: 'fake',
        model: 'm',
        dim: 3,
        embed: vi.fn(async (texts: string[]) => {
          embedCalls.push(texts.length);
          if (embedImpl) return embedImpl();
          return texts.map(() => [1, 2, 3]);
        }),
      },
    },
    upserted,
    embedCalls,
  };
}

/** ~4 chunks per entry (body 4.2KB, chunker maxChars 1800). */
const BIG_BODY = 'paragraph text here. '.repeat(200);

describe('indexEntries', () => {
  it('batches chunks across entries, capping every embed call at 32', async () => {
    // 12 entries x ~4 chunks = ~48 chunks => at least two batches.
    const inserted = Array.from({ length: 12 }, (_, i) => entry(i + 1, BIG_BODY));
    const { deps, embedCalls } = makeDeps();

    const total = await indexEntries(deps, inserted);

    expect(total).toBeGreaterThan(32);
    expect(embedCalls.length).toBeGreaterThan(1);
    // Every embed call is capped at the batch size.
    for (const n of embedCalls) expect(n).toBeLessThanOrEqual(32);
    // All but the last batch are full — proves batches span entry boundaries.
    for (const n of embedCalls.slice(0, -1)) expect(n).toBe(32);
    expect(embedCalls.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it('reports cumulative progress after each batch', async () => {
    const inserted = Array.from({ length: 12 }, (_, i) => entry(i + 1, BIG_BODY));
    const { deps } = makeDeps();
    const progress: number[] = [];

    const total = await indexEntries(deps, inserted, (c) => {
      progress.push(c);
    });

    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toBe(total);
    // Monotonically increasing.
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('retries a transient embed failure instead of losing the file', async () => {
    let n = 0;
    const { deps } = makeDeps(async () => {
      if (++n === 1) throw new Error('fetch failed');
      return [[1, 2, 3]];
    });
    const total = await indexEntries(deps, [entry(1, 'short body')]);
    expect(total).toBe(1);
    expect(deps.embedder.embed).toHaveBeenCalledTimes(2);
  });

  it('returns 0 and does nothing for no entries', async () => {
    const { deps } = makeDeps();
    expect(await indexEntries(deps, [])).toBe(0);
    expect(deps.vectors.upsert).not.toHaveBeenCalled();
  });

  it('carries entry metadata into the qdrant payload', async () => {
    const { deps, upserted } = makeDeps();
    await indexEntries(deps, [entry(7, 'short body')]);
    const point = (upserted[0] as any[])[0];
    expect(point.payload).toMatchObject({
      entry_id: 7,
      project: 'deepcast',
      source_type: 'claude_session',
      session_id: 'abc',
    });
    expect(point.dense).toEqual([1, 2, 3]);
    expect(point.sparse.indices.length).toBeGreaterThan(0);
  });

  it('carries doc_status into the payload for archived docs', async () => {
    const { deps, upserted } = makeDeps();
    const e = entry(9, 'short body');
    e.entry.sourceType = 'doc';
    e.entry.meta = { docStatus: 'archived' };
    await indexEntries(deps, [e]);
    expect((upserted[0] as any[])[0].payload.doc_status).toBe('archived');
  });
});
