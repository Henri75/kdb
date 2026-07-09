import type { AppConfig } from './config.js';

/**
 * Minimal OpenAI-compatible chat client. G2P is just a preset base URL —
 * same wire protocol, no inbound key required.
 *
 * Retry policy (§3.8): transient failures only — 429 and 5xx, max 2 retries
 * with exponential backoff. Other 4xx fail immediately.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function chatComplete(
  cfg: AppConfig['llm'],
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          max_tokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0.2,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) {
        const text = await r.text();
        const err = new Error(`LLM ${r.status}: ${text.slice(0, 500)}`);
        if (!RETRYABLE.has(r.status)) throw err;
        lastError = err;
        continue;
      }
      const data = (await r.json()) as {
        choices: { message: { content: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('LLM returned no content');
      return content;
    } catch (e) {
      const err = e as Error;
      // AbortError / network errors are transient; API 4xx errors are not.
      if (err.message.startsWith('LLM 4')) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new Error('LLM call failed');
}

/**
 * Parse an OpenAI-style SSE chunk stream into content deltas.
 *
 * The wire format is newline-delimited `data: {json}` frames terminated by
 * `data: [DONE]`. Frames can be split across network reads, so the caller
 * feeds raw text and we buffer until a complete `\n\n` record is available.
 */
export function createSseParser(): (text: string) => string[] {
  let buffer = '';
  return (text: string): string[] => {
    buffer += text;
    const deltas: string[] = [];
    let sep: number;
    // Records are separated by a blank line; keep the trailing partial record.
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const record = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of record.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const piece = json.choices?.[0]?.delta?.content;
          if (piece) deltas.push(piece);
        } catch {
          // A malformed frame must not kill the stream.
        }
      }
    }
    return deltas;
  };
}

/**
 * Stream a chat completion, yielding content deltas as they arrive.
 *
 * Retries only apply before the first token: once bytes have reached the
 * caller we cannot replay the stream without duplicating output.
 */
export async function* chatStream(
  cfg: AppConfig['llm'],
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; retries?: number } = {},
): AsyncGenerator<string, void, unknown> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = JSON.stringify({
    model: cfg.model,
    messages,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.2,
    stream: true,
  });

  // Interactive path: default to one attempt. A user watching a blank stream
  // is better served by a fast degraded answer (with sources) than by six
  // seconds of silent backoff. Batch callers can opt into retries.
  const retries = opts.retries ?? 0;

  let response: Response | undefined;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body,
        signal: AbortSignal.timeout(300_000),
      });
      if (!r.ok) {
        const text = await r.text();
        const err = new Error(`LLM ${r.status}: ${text.slice(0, 500)}`);
        if (!RETRYABLE.has(r.status)) throw err;
        lastError = err;
        continue;
      }
      response = r;
      break;
    } catch (e) {
      const err = e as Error;
      if (err.message.startsWith('LLM 4')) throw err;
      lastError = err;
    }
  }
  if (!response?.body) throw lastError ?? new Error('LLM stream failed');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parse = createSseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const delta of parse(decoder.decode(value, { stream: true }))) {
        yield delta;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
