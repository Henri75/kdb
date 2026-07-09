import type { Catalog } from './catalog.js';
import type { EmbeddingProvider } from './embeddings/types.js';
import type { VectorStore } from './qdrant.js';
import { sparseVector } from './sparse.js';
import type { SearchFilters, SearchHit, SearchResult } from './types.js';

/**
 * Search orchestration with the graceful-degradation chain:
 *   hybrid (dense+sparse RRF) → sparse-only → Postgres FTS.
 */
/** How long the API trusts its cached view of the indexer's active collection. */
const COLLECTION_TTL_MS = 15_000;

export class SearchService {
  private collectionCheckedAt = 0;

  constructor(
    private catalog: Catalog,
    private vectors: VectorStore,
    /** Resolved lazily and may be null when the provider is unreachable. */
    private embedder: EmbeddingProvider | null,
  ) {}

  setEmbedder(e: EmbeddingProvider | null) {
    this.embedder = e;
  }

  /**
   * Follow the collection the indexer is currently writing.
   *
   * Changing the embedding model changes the vector dimension, and therefore
   * the collection. Without this, the API keeps querying the collection it saw
   * at boot: every dense query then fails on a dimension mismatch and search
   * silently degrades to the Postgres fallback.
   */
  private async syncCollection(now: number): Promise<void> {
    if (now - this.collectionCheckedAt < COLLECTION_TTL_MS) return;
    this.collectionCheckedAt = now;
    try {
      const active = await this.catalog.getSetting('active_collection');
      if (active && active !== this.vectors.collection) this.vectors.useCollection(active);
    } catch {
      // Keep serving with the current collection if the catalog is unreachable.
    }
  }

  async search(q: string, filters: SearchFilters = {}, limit = 20): Promise<SearchResult> {
    const t0 = Date.now();
    await this.syncCollection(t0);
    const sparse = sparseVector(q);

    let dense: number[] | undefined;
    let mode = 'sparse-only';
    if (this.embedder) {
      try {
        dense = (await this.embedder.embed([q]))[0];
        mode = 'hybrid';
      } catch {
        dense = undefined; // provider down → sparse still works
      }
    }

    try {
      const raw = await this.vectors.query({ dense, sparse, filters, limit });
      const hydrated = await this.hydrate(raw);
      return {
        hits: hydrated,
        mode,
        degraded: mode !== 'hybrid',
        tookMs: Date.now() - t0,
      };
    } catch {
      // Qdrant unavailable → keyword fallback straight from Postgres.
      const hits = await this.catalog.ftsSearch(q, filters, limit);
      return { hits, mode: 'fts', degraded: true, tookMs: Date.now() - t0 };
    }
  }

  /** Map Qdrant matches back to full entries; drops stale ids gracefully. */
  private async hydrate(raw: { entryId: number; score: number }[]): Promise<SearchHit[]> {
    const rows = await this.catalog.getEntries(raw.map((r) => r.entryId).filter(Boolean));
    const hits: SearchHit[] = [];
    for (const r of raw) {
      const row = rows.get(r.entryId);
      if (!row) continue;
      hits.push({
        entryId: r.entryId,
        score: r.score,
        projectSlug: row.slug,
        sourceType: row.source_type,
        component: row.component ?? undefined,
        sessionId: row.session_id ?? undefined,
        title: row.title,
        snippet: String(row.body).slice(0, 280),
        occurredAt: row.occurred_at?.toISOString?.() ?? undefined,
        sourcePath: row.source_path,
        sourceRef: row.source_ref ?? undefined,
      });
    }
    return hits;
  }
}
