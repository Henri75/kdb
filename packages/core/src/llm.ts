import type { AppConfig } from './config.js';
import { HttpError, withRetry, type RetryOptions } from './retry.js';

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

/** Token accounting, as reported by the provider (never estimated). */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * What actually served a completion, as opposed to what we asked for.
 *
 * A routing gateway (G2P) picks the model by policy, so the configured model is
 * a *request*, not a fact: asking for `gemini-2.5-flash` may be answered by
 * `gemma-4-31b-it`. Reporting the configured name would attribute an answer to a
 * model that never saw the question.
 */
export interface StreamMeta {
  /** Model that answered, from the gateway. Absent if it did not say. */
  servedModel?: string;
  /** Gateway-side retries. > 1 means it failed over before succeeding. */
  attempts?: number;
  /** Correlates this answer with the gateway's own logs. */
  requestId?: string;
  /** Milliseconds from request to the first content token. */
  ttftMs?: number;
  /** Present only when the provider sent a usage frame. */
  usage?: TokenUsage;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Thrown for a malformed success response — retrying cannot repair it. */
class MalformedResponseError extends Error {
  readonly status = 422;
}

/**
 * Buffered completion. Retry classification is delegated to withRetry, which
 * reads `err.status`: hand-rolling it here previously matched on the message
 * text (`startsWith('LLM 4')`), which both retried a malformed body three
 * times and would have mislabelled a 429 as permanent.
 */
export async function chatComplete(
  cfg: AppConfig['llm'],
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; retry?: RetryOptions } = {},
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;

  return withRetry(
    async () => {
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
        // 429/5xx carry a retryable status; everything else fails fast.
        throw new HttpError(`LLM ${r.status}: ${text.slice(0, 500)}`, r.status);
      }
      const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new MalformedResponseError('LLM returned no content');
      return content;
    },
    { attempts: 3, baseDelayMs: 1000, ...opts.retry },
  );
}

/**
 * Parse an OpenAI-style SSE chunk stream into content deltas.
 *
 * The wire format is newline-delimited `data: {json}` frames terminated by
 * `data: [DONE]`. Frames can be split across network reads, so the caller
 * feeds raw text and we buffer until a complete `\n\n` record is available.
 *
 * `onUsage` is optional and out-of-band: the usage frame carries `choices: []`,
 * so it yields no content and cannot be expressed in the return value without
 * changing what a "delta" means to every caller. Keeping the return type as
 * plain content deltas is what lets this stay a drop-in for the existing loop.
 */
export function createSseParser(onUsage?: (usage: TokenUsage) => void): (text: string) => string[] {
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
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
          };
          const piece = json.choices?.[0]?.delta?.content;
          if (piece) deltas.push(piece);
          // Arrives once, in a trailing frame with an empty `choices` array,
          // and only when the request opted in via stream_options.
          const u = json.usage;
          if (onUsage && u && typeof u.total_tokens === 'number') {
            onUsage({
              promptTokens: u.prompt_tokens ?? 0,
              completionTokens: u.completion_tokens ?? 0,
              totalTokens: u.total_tokens,
            });
          }
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
  opts: {
    maxTokens?: number;
    temperature?: number;
    retries?: number;
    /**
     * Called as telemetry becomes known: once with the response headers, again
     * at the first token (ttft), and once more if a usage frame arrives. A
     * callback rather than a yielded event so the delta stream stays a plain
     * `AsyncGenerator<string>` for every existing caller.
     */
    onMeta?: (meta: StreamMeta) => void;
  } = {},
): AsyncGenerator<string, void, unknown> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = JSON.stringify({
    model: cfg.model,
    messages,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.2,
    stream: true,
    // Without this the provider never sends the usage frame, and token counts
    // would have to be estimated. Ignored by providers that don't support it.
    stream_options: { include_usage: true },
  });

  // Interactive path: default to one attempt. A user watching a blank stream
  // is better served by a fast degraded answer (with sources) than by six
  // seconds of silent backoff. Batch callers can opt into retries.
  const retries = opts.retries ?? 0;

  // Start the clock before the request so ttft measures what the user waits.
  const startedAt = Date.now();
  const meta: StreamMeta = {};
  const emitMeta = () => opts.onMeta?.({ ...meta });

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

  // Telemetry must never be able to break the answer it describes: a provider
  // (or a stub) that omits headers should cost us the metrics, not the reply.
  // Header lookup is case-insensitive per the Headers spec — the gateway sends
  // `X-G2p-Reply-Model`, not the `X-G2P-` you might expect. Do not "fix" this
  // into a case-sensitive read.
  const header = (name: string): string | undefined =>
    response.headers?.get?.(name) ?? undefined;
  const attempts = Number(header('x-g2p-reply-attempts'));
  meta.servedModel = header('x-g2p-reply-model');
  meta.attempts = Number.isFinite(attempts) && attempts > 0 ? attempts : undefined;
  meta.requestId = header('x-request-id');
  emitMeta();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parse = createSseParser((usage) => {
    meta.usage = usage;
    emitMeta();
  });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const delta of parse(decoder.decode(value, { stream: true }))) {
        // Time to *first token*: the latency the user actually feels before
        // words appear. Recorded once; later deltas are throughput, not latency.
        if (meta.ttftMs === undefined) {
          meta.ttftMs = Date.now() - startedAt;
          emitMeta();
        }
        yield delta;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
