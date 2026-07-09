import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectionNameFor } from '@kdbscope/core';
import { ollamaHasModel } from '../../packages/core/src/embeddings/ollama.js';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string) => { ok: boolean; body?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const r = handler(String(url));
      return {
        ok: r.ok,
        status: r.ok ? 200 : 500,
        json: async () => r.body,
        text: async () => JSON.stringify(r.body ?? ''),
      };
    }),
  );
}

describe('ollamaHasModel', () => {
  it('matches a bare model name against the ":latest" tag', async () => {
    stubFetch(() => ({ ok: true, body: { models: [{ name: 'nomic-embed-text:latest' }] } }));
    expect(await ollamaHasModel('http://x', 'nomic-embed-text')).toBe(true);
  });

  it('matches an explicitly tagged model', async () => {
    stubFetch(() => ({ ok: true, body: { models: [{ name: 'bge-m3:567m' }] } }));
    expect(await ollamaHasModel('http://x', 'bge-m3:567m')).toBe(true);
  });

  it('returns false when the model is absent', async () => {
    stubFetch(() => ({ ok: true, body: { models: [{ name: 'llama3:latest' }] } }));
    expect(await ollamaHasModel('http://x', 'nomic-embed-text')).toBe(false);
  });

  it('returns false when Ollama has no models at all', async () => {
    stubFetch(() => ({ ok: true, body: {} }));
    expect(await ollamaHasModel('http://x', 'nomic-embed-text')).toBe(false);
  });

  it('returns false (never throws) when Ollama is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await ollamaHasModel('http://x', 'nomic-embed-text')).toBe(false);
  });
});

describe('collectionNameFor', () => {
  it('encodes provider, model and dim so switching models is a new collection', () => {
    expect(collectionNameFor('ollama', 'nomic-embed-text', 768)).toBe(
      'kdbscope_ollama_nomic_embed_text_768',
    );
    expect(collectionNameFor('bundled', 'Xenova/all-MiniLM-L6-v2', 384)).toBe(
      'kdbscope_bundled_xenova_all_minilm_l6_v2_384',
    );
  });

  it('never collides across providers with the same dim', () => {
    expect(collectionNameFor('ollama', 'm', 768)).not.toBe(collectionNameFor('openai', 'm', 768));
  });
});
