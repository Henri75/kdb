import type {
  AskResult,
  ComponentRow,
  Dashboard,
  ProjectRow,
  SearchResult,
  SessionRow,
  Stats,
  TimelineItem,
} from './types';

/** Typed fetch client. Same-origin /api (nginx proxies to the api service). */

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Events emitted by POST /api/ask/stream (mirrors core's AskEvent). */
export type AskEvent =
  | { type: 'sources'; sources: AskResult['sources']; scopeFallback?: AskResult['scopeFallback'] }
  | { type: 'delta'; text: string }
  | { type: 'done'; model: string; degraded: boolean }
  | { type: 'error'; message: string };

/**
 * Consume the Ask SSE stream. Yields each event as it arrives so the caller
 * can paint sources immediately and append answer text progressively.
 */
export async function* askStream(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<AskEvent, void, unknown> {
  const res = await fetch('/api/ask/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`${res.status}: ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const record = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (!record.startsWith('data:')) continue;
        try {
          yield JSON.parse(record.slice(5).trim()) as AskEvent;
        } catch {
          // Ignore a malformed frame rather than aborting the answer.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const api = {
  search: (params: Record<string, unknown>) => get<SearchResult>(`/api/search${qs(params)}`),
  ask: (body: Record<string, unknown>) => post<AskResult>('/api/ask', body),
  askStream,
  projects: () => get<ProjectRow[]>('/api/projects'),
  timeline: (slug: string, params: Record<string, unknown> = {}) =>
    get<{ items: TimelineItem[] }>(`/api/projects/${slug}/timeline${qs(params)}`),
  components: (slug: string) =>
    get<{ components: ComponentRow[] }>(`/api/projects/${slug}/components`),
  componentHistory: (slug: string, name: string) =>
    get<{ entries: any[] }>(`/api/projects/${slug}/components/${encodeURIComponent(name)}`),
  sessions: (slug: string) => get<{ sessions: SessionRow[] }>(`/api/projects/${slug}/sessions`),
  session: (id: string) => get<{ session: SessionRow; entries: any[] }>(`/api/sessions/${id}`),
  stats: () => get<Stats>('/api/stats'),
  dashboard: () => get<Dashboard>('/api/dashboard'),
  reindex: (body: Record<string, unknown> = {}) =>
    post<{ enqueued: number }>('/api/admin/reindex', body),
};
