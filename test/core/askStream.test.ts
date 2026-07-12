import { describe, expect, it, vi, afterEach } from 'vitest';
import { AskService } from '@atlas/core';
import type { AskEvent } from '@atlas/core';

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
  const search = {
    search: async (_q: string, filters: { project?: string } = {}) => ({
      // A project scope this fixture data does not belong to matches nothing —
      // lets tests drive the empty-scope fallback path.
      hits: filters.project && filters.project !== 'deepcast' ? [] : hits,
      mode: 'hybrid',
      degraded: false,
      tookMs: 1,
    }),
  };
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

  /**
   * A follow-up like "why?" carries no search signal and retrieves nothing,
   * but the conversation above it holds the answer. Only a *first* question
   * with no hits is a genuine dead end.
   */
  it('answers a follow-up even when retrieval finds nothing', async () => {
    const svc = makeService([], frame('Because of the pidfile.'));
    const events = await collect(
      svc.askStream('why?', {}, 12, [
        { role: 'user', content: 'what broke?' },
        { role: 'assistant', content: 'pgbouncer crash-looped [1]' },
      ]),
    );
    const text = events.filter((e) => e.type === 'delta').map((e: any) => e.text).join('');
    expect(text).toBe('Because of the pidfile.');
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('still short-circuits a first question that retrieves nothing', async () => {
    const svc = makeService([]);
    const events = await collect(svc.askStream('nothing at all'));
    expect((events[1] as any).text).toMatch(/No indexed content matched/);
  });

  it('sends prior turns before the freshly retrieved context', async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(frame('ok')));
          c.close();
        },
      }),
    }));
    vi.stubGlobal('fetch', spy);
    const svc = makeService([hit]);
    await collect(
      svc.askStream('and then?', {}, 12, [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
      ]),
    );

    const sent = JSON.parse((spy.mock.calls[0] as any)[1].body).messages;
    expect(sent.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(sent[1].content).toBe('first question');
    // The newest question carries the context blocks, so [n] refers to them.
    expect(sent[3].content).toContain('Context blocks:');
    expect(sent[3].content).toContain('and then?');
  });

  it('never yields a delta before its sources', async () => {
    const svc = makeService([hit], frame('x'));
    const events = await collect(svc.askStream('q'));
    const firstDelta = events.findIndex((e) => e.type === 'delta');
    const sourcesAt = events.findIndex((e) => e.type === 'sources');
    expect(sourcesAt).toBeLessThan(firstDelta);
  });

  /**
   * The core regression: a feature indexed under one project (the drain feature
   * lives in google-gemini-pool) was invisible when asked about scoped to the
   * "wrong" sibling project. A hard scope must fall back to all projects rather
   * than confidently answer "no such thing exists".
   */
  it('widens to all projects when the scoped question matches nothing there', async () => {
    // hit belongs to `deepcast`; scope to a project the fixture never matches.
    const svc = makeService([hit], frame('It lives in deepcast [1]'));
    const events = await collect(svc.askStream('drain feature?', { project: 'google-gemini-pool' }));

    const sources = events.find((e) => e.type === 'sources') as any;
    expect(sources.sources).toHaveLength(1);
    expect(sources.scopeFallback).toEqual({
      requested: 'google-gemini-pool',
      usedAllProjects: true,
    });
    const text = events.filter((e) => e.type === 'delta').map((e: any) => e.text).join('');
    expect(text).toContain('deepcast');
  });

  it('does NOT fall back when the scoped question has in-scope hits', async () => {
    const svc = makeService([hit], frame('answer [1]'));
    const events = await collect(svc.askStream('q', { project: 'deepcast' }));

    const sources = events.find((e) => e.type === 'sources') as any;
    expect(sources.sources).toHaveLength(1);
    expect(sources.scopeFallback).toBeUndefined();
  });

  it('reports no match when nothing matches even after widening', async () => {
    const svc = makeService([]); // empty everywhere
    const events = await collect(svc.askStream('nothing', { project: 'whatever' }));
    const sources = events.find((e) => e.type === 'sources') as any;
    expect(sources.scopeFallback).toBeUndefined();
    expect((events[1] as any).text).toMatch(/No indexed content matched/);
  });
});
