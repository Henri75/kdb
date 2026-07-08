import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../packages/api/src/app.js';
import type { ApiDeps } from '../../packages/api/src/app.js';

function makeDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  return {
    catalog: {
      stats: async () => ({ projects: 2, entries: 10, chunks: 0, errors: 1, bySource: {} }),
      listProjects: async () => [{ slug: 'deepcast', name: 'DeepCast', entryCount: 10 }],
      timeline: async () => [{ entryId: 1, title: 't', occurredAt: '2026-07-08T00:00:00Z' }],
      components: async () => [{ component: 'video-import', count: 3 }],
      componentHistory: async () => [{ id: 1, title: 'x' }],
      sessionsList: async () => [{ id: 'abc' }],
      sessionDetail: async (id: string) =>
        id === 'abc' ? { session: { id: 'abc' }, entries: [] } : null,
      getEntries: async (ids: number[]) =>
        new Map(ids.filter((i) => i === 1).map((i) => [i, { id: i, title: 'entry' }])),
      recentErrors: async () => [{ id: 1, message: 'boom' }],
    } as any,
    search: { search: async () => ({ hits: [], mode: 'hybrid', degraded: false, tookMs: 5 }) } as any,
    ask: { ask: async () => ({ answer: '42 [1]', sources: [], model: 'm', degraded: false }) } as any,
    enqueueScan: vi.fn(async () => 1),
    vectorCount: async () => 123,
    meta: { embedder: 'ollama/nomic-embed-text', collection: 'kdbscope_x' },
    ...overrides,
  };
}

describe('api routes', () => {
  it('GET /api/health', async () => {
    const res = await buildApp(makeDeps()).request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('GET /api/stats merges catalog stats + vector count + meta', async () => {
    const res = await buildApp(makeDeps()).request('/api/stats');
    const body = await res.json();
    expect(body).toMatchObject({ projects: 2, chunks: 123, collection: 'kdbscope_x' });
  });

  it('GET /api/search requires q', async () => {
    const res = await buildApp(makeDeps()).request('/api/search');
    expect(res.status).toBe(400);
  });

  it('GET /api/search passes filters through', async () => {
    const search = { search: vi.fn(async () => ({ hits: [], mode: 'hybrid', degraded: false, tookMs: 1 })) };
    const app = buildApp(makeDeps({ search: search as any }));
    const res = await app.request('/api/search?q=bug&project=deepcast&source=git_commit&limit=5');
    expect(res.status).toBe(200);
    expect(search.search).toHaveBeenCalledWith(
      'bug',
      expect.objectContaining({ project: 'deepcast', sourceType: 'git_commit' }),
      5,
    );
  });

  it('POST /api/ask requires question', async () => {
    const res = await buildApp(makeDeps()).request('/api/ask', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/ask returns synthesized answer', async () => {
    const res = await buildApp(makeDeps()).request('/api/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'what changed?' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(await res.json()).toMatchObject({ answer: '42 [1]' });
  });

  it('GET /api/sessions/:id 404s on unknown session', async () => {
    const res = await buildApp(makeDeps()).request('/api/sessions/nope');
    expect(res.status).toBe(404);
  });

  it('POST /api/admin/reindex enqueues with flags', async () => {
    const deps = makeDeps();
    const res = await buildApp(deps).request('/api/admin/reindex', {
      method: 'POST',
      body: JSON.stringify({ project: 'deepcast', full: true }),
      headers: { 'content-type': 'application/json' },
    });
    expect(await res.json()).toEqual({ enqueued: 1 });
    expect(deps.enqueueScan).toHaveBeenCalledWith({ project: 'deepcast', full: true });
  });

  it('GET /api/entries/:id hydrates or 404s', async () => {
    const app = buildApp(makeDeps());
    expect((await app.request('/api/entries/1')).status).toBe(200);
    expect((await app.request('/api/entries/9')).status).toBe(404);
  });
});
