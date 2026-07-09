import type { AppConfig } from './config.js';
import { chatComplete, chatStream, type ChatMessage } from './llm.js';
import type { SearchService } from './search.js';
import type { Catalog } from './catalog.js';
import type { AskResult, AskSource, SearchFilters, SearchHit } from './types.js';

/**
 * Ask mode: retrieve → synthesize with citations. The LLM sees numbered
 * context blocks and must cite [n]; sources map back to entries.
 */

const SYSTEM_PROMPT =
  'You are KDBScope, an assistant that answers questions about what happened across ' +
  "the user's software projects, using ONLY the provided context blocks (kdb logs, " +
  'Claude Code sessions, git commits, docs). Cite sources inline as [n] after each ' +
  'claim. If the context is insufficient, say exactly what is missing. Be concrete: ' +
  'name components, dates, files and root causes. Answer in the language of the question.';

const NO_MATCH =
  'No indexed content matched this question. Try a broader query or trigger a reindex.';

export function buildAskPrompt(question: string, hits: SearchHit[], bodies: Map<number, string>): string {
  const blocks = hits
    .map((h, i) => {
      const body = (bodies.get(h.entryId) ?? h.snippet).slice(0, 1500);
      const date = h.occurredAt ? ` (${h.occurredAt.slice(0, 10)})` : '';
      return `[${i + 1}] ${h.projectSlug} / ${h.sourceType}${h.component ? ` / ${h.component}` : ''}${date}\n${h.title}\n${body}`;
    })
    .join('\n\n---\n\n');
  return `Context blocks:\n\n${blocks}\n\nQuestion: ${question}`;
}

/** Events emitted by the streaming Ask pipeline, in order. */
export type AskEvent =
  | { type: 'sources'; sources: AskSource[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; model: string; degraded: boolean }
  | { type: 'error'; message: string };

interface Prepared {
  sources: AskSource[];
  messages: ChatMessage[] | null;
}

export class AskService {
  constructor(
    private searchService: SearchService,
    private catalog: Catalog,
    private llmConfig: AppConfig['llm'],
  ) {}

  /** Shared retrieval: both ask() and askStream() build their prompt here. */
  private async prepare(question: string, filters: SearchFilters, k: number): Promise<Prepared> {
    const { hits } = await this.searchService.search(question, filters, k);
    const sources: AskSource[] = hits.map((h, i) => ({
      n: i + 1,
      entryId: h.entryId,
      title: h.title,
      projectSlug: h.projectSlug,
      sourceType: h.sourceType,
      sourcePath: h.sourcePath,
      occurredAt: h.occurredAt,
    }));
    if (!hits.length) return { sources: [], messages: null };

    const rows = await this.catalog.getEntries(hits.map((h) => h.entryId));
    const bodies = new Map<number, string>(
      [...rows.entries()].map(([id, row]) => [id, String(row.body)]),
    );
    return {
      sources,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildAskPrompt(question, hits, bodies) },
      ],
    };
  }

  async ask(question: string, filters: SearchFilters = {}, k = 12): Promise<AskResult> {
    const { sources, messages } = await this.prepare(question, filters, k);
    if (!messages) {
      return { answer: NO_MATCH, sources: [], model: this.llmConfig.model, degraded: false };
    }
    try {
      const answer = await chatComplete(this.llmConfig, messages);
      return { answer, sources, model: this.llmConfig.model, degraded: false };
    } catch (e) {
      // LLM down: still useful — return the retrieved sources with an explanation.
      return {
        answer:
          `LLM unavailable (${(e as Error).message.slice(0, 200)}). ` +
          'Here are the most relevant indexed sources for your question instead.',
        sources,
        model: this.llmConfig.model,
        degraded: true,
      };
    }
  }

  /**
   * Streaming variant. Sources are emitted first so the UI can render
   * citations before any prose arrives, then answer deltas, then `done`.
   */
  async *askStream(
    question: string,
    filters: SearchFilters = {},
    k = 12,
  ): AsyncGenerator<AskEvent, void, unknown> {
    let prepared: Prepared;
    try {
      prepared = await this.prepare(question, filters, k);
    } catch (e) {
      yield { type: 'error', message: (e as Error).message };
      return;
    }

    yield { type: 'sources', sources: prepared.sources };

    if (!prepared.messages) {
      yield { type: 'delta', text: NO_MATCH };
      yield { type: 'done', model: this.llmConfig.model, degraded: false };
      return;
    }

    try {
      for await (const delta of chatStream(this.llmConfig, prepared.messages)) {
        yield { type: 'delta', text: delta };
      }
      yield { type: 'done', model: this.llmConfig.model, degraded: false };
    } catch (e) {
      yield {
        type: 'delta',
        text:
          `\n\n_LLM unavailable (${(e as Error).message.slice(0, 200)}). ` +
          'The sources above are the most relevant indexed results._',
      };
      yield { type: 'done', model: this.llmConfig.model, degraded: true };
    }
  }
}
