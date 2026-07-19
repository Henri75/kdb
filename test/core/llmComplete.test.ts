import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatComplete, DEFAULT_G2P_CLIENT_ID } from '../../packages/core/src/llm.js';

afterEach(() => vi.unstubAllGlobals());

const cfg = { provider: 'g2p', model: 'm', baseUrl: 'http://llm/v1' } as any;
const msgs = [{ role: 'user' as const, content: 'hi' }];
/** Injected so retry tests run instantly instead of sleeping 6 real seconds. */
const noSleep = { sleep: async () => {} };

const okBody = { choices: [{ message: { content: 'answer' } }] };

/** Replays the queue, then repeats the final response for any extra attempts. */
function stub(responses: Array<{ ok: boolean; status?: number; body?: unknown }>) {
  const last = responses[responses.length - 1]!;
  const fn = vi.fn(async () => {
    const r = responses.length > 1 ? responses.shift()! : last;
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body,
      text: async () => JSON.stringify(r.body ?? ''),
    };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('chatComplete', () => {
  it('returns the assistant message on success', async () => {
    stub([{ ok: true, body: okBody }]);
    await expect(chatComplete(cfg, msgs)).resolves.toBe('answer');
  });

  it('fails immediately on a non-retryable 4xx', async () => {
    const fn = stub([{ ok: false, status: 400, body: { error: 'bad' } }]);
    await expect(chatComplete(cfg, msgs, { retry: noSleep })).rejects.toThrow(/LLM 400/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: a malformed body used to fall into a catch that only
   * fast-failed on messages starting with "LLM 4", so it retried three times
   * with six seconds of sleeps before giving up. Retrying cannot repair it.
   */
  it('fails immediately when the response carries no content', async () => {
    const fn = stub([{ ok: true, body: { choices: [] } }]);
    await expect(chatComplete(cfg, msgs, { retry: noSleep })).rejects.toThrow(/no content/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx and succeeds', async () => {
    const fn = stub([
      { ok: false, status: 503, body: { error: 'unavailable' } },
      { ok: true, body: okBody },
    ]);
    await expect(chatComplete(cfg, msgs, { retry: noSleep })).resolves.toBe('answer');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries a 429 rather than treating it as a client error', async () => {
    const fn = stub([
      { ok: false, status: 429, body: { error: 'slow down' } },
      { ok: true, body: okBody },
    ]);
    await expect(chatComplete(cfg, msgs, { retry: noSleep })).resolves.toBe('answer');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt budget and reports the last status', async () => {
    const fn = stub([{ ok: false, status: 503, body: { error: 'down' } }]);
    await expect(chatComplete(cfg, msgs, { retry: noSleep })).rejects.toThrow(/LLM 503/);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('sends an Authorization header only when an api key is configured', async () => {
    const withKey = stub([{ ok: true, body: okBody }]);
    await chatComplete({ ...cfg, apiKey: 'sk-test' }, msgs);
    expect((withKey.mock.calls[0] as any)[1].headers.authorization).toBe('Bearer sk-test');

    const noKey = stub([{ ok: true, body: okBody }]);
    await chatComplete(cfg, msgs);
    expect((noKey.mock.calls[0] as any)[1].headers.authorization).toBeUndefined();
  });

  it('sends the client id to G2P for request attribution', async () => {
    const fn = stub([{ ok: true, body: okBody }]);
    await chatComplete(cfg, msgs, { clientId: 'Atlas' });
    expect((fn.mock.calls[0] as any)[1].headers['X-G2P-Client-Id']).toBe('Atlas');
  });

  it('falls back to the default client id when none is configured', async () => {
    const fn = stub([{ ok: true, body: okBody }]);
    await chatComplete(cfg, msgs);
    expect((fn.mock.calls[0] as any)[1].headers['X-G2P-Client-Id']).toBe(DEFAULT_G2P_CLIENT_ID);
  });

  it('omits the header when the client id is explicitly empty', async () => {
    // The documented opt-out for anyone who wants anonymous traffic.
    const fn = stub([{ ok: true, body: okBody }]);
    await chatComplete(cfg, msgs, { clientId: '' });
    expect((fn.mock.calls[0] as any)[1].headers['X-G2P-Client-Id']).toBeUndefined();
  });

  it('sanitises the client id to match what G2P will record', async () => {
    // Control chars would otherwise be stripped server-side, leaving our config
    // and the /hstats dashboard disagreeing about the caller's name.
    const fn = stub([{ ok: true, body: okBody }]);
    await chatComplete(cfg, msgs, { clientId: ' At\nlas  ' });
    expect((fn.mock.calls[0] as any)[1].headers['X-G2P-Client-Id']).toBe('Atlas');

    const long = stub([{ ok: true, body: okBody }]);
    await chatComplete(cfg, msgs, { clientId: 'x'.repeat(200) });
    expect((long.mock.calls[0] as any)[1].headers['X-G2P-Client-Id']).toHaveLength(128);
  });

  it('posts the configured model and messages', async () => {
    const fn = stub([{ ok: true, body: okBody }]);
    await chatComplete({ ...cfg, model: 'gemini-2.5-flash' }, msgs);
    const body = JSON.parse((fn.mock.calls[0] as any)[1].body);
    expect(body).toMatchObject({ model: 'gemini-2.5-flash', messages: msgs });
    // Buffered path must not request a stream.
    expect(body.stream).toBeUndefined();
  });
}, 20_000);
