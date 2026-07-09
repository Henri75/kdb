import { describe, expect, it, vi, afterEach } from 'vitest';
import { AskService } from '@kdbscope/core';
import type { AskEvent } from '@kdbscope/core';

afterEach(() => vi.unstubAllGlobals());

const hit = {
  entryId: 1,
  score: 1,
  projectSlug: 'deepcast',
  sourceType: 'kdb_component' as const,
  title: 'video-import: timeout fix',
  snippet: 'snippet',
  sourcePath: '/x.log',
};

function makeService(hits: unknown[], streamBody?: string) {
  const search = { search: async () => ({ hits, mode: 'hybrid', degraded: false, tookMs: 1 }) };
  const catalog = {
    getEntries: async (ids: number[]) => new Map(ids.map((i) => [i, { body: 'full body' }])),
  };
  if (streamBody !== undefined) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        body: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(streamBody));
            c.close();
          },
        }),
      })),
    );
  }
  return new AskService(search as any, catalog as any, {
    provider: 'g2p',
    model: 'test-model',
    baseUrl: 'http://llm/v1',
  } as any);
}

const collect = async (gen: AsyncGenerator<AskEvent>) => {
  const out: AskEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
};

const frame = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe('AskService.askStream', () => {
  it('emits sources first, then deltas, then done', async () => {
    const svc = makeService([hit], frame('The ') + frame('fix [1]') + 'data: [DONE]\n\n');
    const events = await collect(svc.askStream('what changed?'));

    expect(events[0]).toMatchObject({ type: 'sources' });
    expect((events[0] as any).sources[0]).toMatchObject({ n: 1, entryId: 1 });

    const deltas = events.filter((e) => e.type === 'delta').map((e: any) => e.text);
    expect(deltas.join('')).toBe('The fix [1]');

    expect(events.at(-1)).toMatchObject({ type: 'done', model: 'test-model', degraded: false });
  });

  it('short-circuits with a no-match message when nothing is retrieved', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const svc = makeService([]);
    const events = await collect(svc.askStream('nothing'));

    expect(events[0]).toEqual({ type: 'sources', sources: [] });
    expect((events[1] as any).text).toMatch(/No indexed content matched/);
    expect(events.at(-1)).toMatchObject({ type: 'done', degraded: false });
    // Retrieval found nothing, so the LLM must not be called at all.
    expect(spy).not.toHaveBeenCalled();
  });

  it('degrades gracefully and fast when the LLM stream fails', async () => {
    const spy = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    vi.stubGlobal('fetch', spy);
    const svc = makeService([hit]);

    const t0 = Date.now();
    const events = await collect(svc.askStream('q'));

    expect(events[0]).toMatchObject({ type: 'sources' });
    const text = events.filter((e) => e.type === 'delta').map((e: any) => e.text).join('');
    expect(text).toMatch(/LLM unavailable/);
    expect(events.at(-1)).toMatchObject({ type: 'done', degraded: true });

    // Interactive streams must not sit in silent backoff: one attempt, no sleep.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('never yields a delta before its sources', async () => {
    const svc = makeService([hit], frame('x'));
    const events = await collect(svc.askStream('q'));
    const firstDelta = events.findIndex((e) => e.type === 'delta');
    const sourcesAt = events.findIndex((e) => e.type === 'sources');
    expect(sourcesAt).toBeLessThan(firstDelta);
  });
});
