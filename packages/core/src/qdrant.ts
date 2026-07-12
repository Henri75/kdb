import { QdrantClient } from '@qdrant/js-client-rest';
import type { SearchFilters } from './types.js';
import type { SparseVector } from './sparse.js';
import { withRetry } from './retry.js';

/** Points per HTTP call. Keeps each request well inside Qdrant's 5s timeout. */
const UPSERT_BATCH = 64;

/**
 * Qdrant wrapper: one collection per embedding config, named vectors
 * 'dense' + 'sparse'. Sparse uses the server-side IDF modifier so clients
 * only ship term frequencies. Hybrid queries fuse both branches with RRF.
 */

export interface VectorPoint {
  id: string;
  dense?: number[];
  sparse: SparseVector;
  payload: {
    entry_id: number;
    project: string;
    source_type: string;
    component?: string;
    session_id?: string;
    /** Message classification (insight, summary, action…) for session entries. */
    kind?: string;
    /** 'archived' for docs under archive-style paths; absent means active. */
    doc_status?: string;
    occurred_at?: string;
  };
}

/**
 * The `kdbscope_` prefix is the tool's former name and is deliberately frozen:
 * it is the key the live collections are stored under. Renaming it to `atlas_`
 * would point the indexer at a collection that does not exist — it would create
 * an empty one and search would return nothing until a full re-embed of every
 * entry. Cosmetic gain, hours of rebuild. Leave it.
 */
export function collectionNameFor(provider: string, model: string, dim: number): string {
  const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return `kdbscope_${safe(provider)}_${safe(model)}_${dim}`;
}

/**
 * Translate search filters into a Qdrant payload filter. An over-broad filter
 * silently returns the wrong rows and an over-narrow one silently returns
 * none, so this is worth testing on its own.
 */
export function buildQdrantFilter(
  filters: SearchFilters,
): { must: object[]; must_not?: object[] } | undefined {
  const must: object[] = [];
  const mustNot: object[] = [];
  if (filters.project) must.push({ key: 'project', match: { value: filters.project } });
  // A subset (sourceTypes) wins over the single sourceType; the singular stays
  // for back-compat. Qdrant's `any` is the multi-value OR match.
  const types = filters.sourceTypes?.length
    ? filters.sourceTypes
    : filters.sourceType
      ? [filters.sourceType]
      : [];
  if (types.length === 1) must.push({ key: 'source_type', match: { value: types[0] } });
  else if (types.length > 1) must.push({ key: 'source_type', match: { any: types } });
  if (filters.component) must.push({ key: 'component', match: { value: filters.component } });
  if (filters.kind) must.push({ key: 'kind', match: { value: filters.kind } });
  // 'active' is expressed as NOT archived: most points carry no doc_status at
  // all, and a positive match would silently exclude every one of them.
  if (filters.docStatus === 'archived') {
    must.push({ key: 'doc_status', match: { value: 'archived' } });
  } else if (filters.docStatus === 'active') {
    mustNot.push({ key: 'doc_status', match: { value: 'archived' } });
  }
  if (filters.since || filters.until) {
    must.push({
      key: 'occurred_at',
      range: {
        ...(filters.since ? { gte: filters.since } : {}),
        ...(filters.until ? { lte: filters.until } : {}),
      },
    });
  }
  if (!must.length && !mustNot.length) return undefined;
  return { must, ...(mustNot.length ? { must_not: mustNot } : {}) };
}

export class VectorStore {
  private client: QdrantClient;
  /** Mutable: the indexer can switch collections when the embedder changes. */
  collection: string;

  constructor(url: string, collection: string) {
    // Client-side ceiling above Qdrant's own 5s REST timeout, so a slow-but-
    // progressing request is ended by the server, not silently by us.
    this.client = new QdrantClient({ url, timeout: 60_000 });
    this.collection = collection;
  }

  /** Point this store at a different collection (e.g. after a model switch). */
  useCollection(name: string): void {
    this.collection = name;
  }

  async healthy(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }

  async ensure(denseDim: number): Promise<void> {
    const existing = await this.client.getCollections();
    if (!existing.collections.some((c) => c.name === this.collection)) {
      await this.client.createCollection(this.collection, {
        vectors: { dense: { size: denseDim, distance: 'Cosine' } },
        sparse_vectors: { sparse: { modifier: 'idf' } },
      });
    }
    // Runs on existing collections too: payload fields added after a
    // collection was created (doc_status, entry_id) still need their index.
    // Re-creating an existing index is a cheap no-op for Qdrant.
    const fields: [string, 'keyword' | 'integer'][] = [
      ['project', 'keyword'],
      ['source_type', 'keyword'],
      ['component', 'keyword'],
      ['session_id', 'keyword'],
      ['kind', 'keyword'],
      ['doc_status', 'keyword'],
      // Integer index so setDocStatus can address points by entry id.
      ['entry_id', 'integer'],
    ];
    for (const [field, schema] of fields) {
      await this.client
        .createPayloadIndex(this.collection, {
          field_name: field,
          field_schema: schema,
          wait: true,
        })
        .catch(() => {}); // already indexed
    }
  }

  /**
   * Bulk upsert. `wait: false` on purpose: waiting forces a synchronous flush
   * per batch, which under ingest load exceeds Qdrant's REST
   * client_request_timeout (5s) and surfaces as `fetch failed`. The write is
   * still durable (accepted into the WAL); it just isn't searchable the same
   * millisecond, which no caller requires. Retried because point ids are
   * deterministic, so a replayed batch is a no-op.
   */
  /** Drop the collection if it exists. Vectors are always rebuildable. */
  async drop(): Promise<void> {
    try {
      await this.client.deleteCollection(this.collection);
    } catch {
      // Nothing to drop.
    }
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (!points.length) return;
    for (let i = 0; i < points.length; i += UPSERT_BATCH) {
      const slice = points.slice(i, i + UPSERT_BATCH);
      await withRetry(() =>
        this.client.upsert(this.collection, {
          wait: false,
          points: slice.map((p) => ({
            id: p.id,
            vector: {
              ...(p.dense ? { dense: p.dense } : {}),
              sparse: { indices: p.sparse.indices, values: p.sparse.values },
            },
            payload: p.payload,
          })),
        }),
      );
    }
  }

  /**
   * Flip doc_status on every chunk of the given entries, in place — no
   * re-embedding. Used when a file's archive classification changes (or the
   * parser version bumps) but its content did not.
   */
  async setDocStatus(entryIds: number[], status: 'archived' | null): Promise<void> {
    for (let i = 0; i < entryIds.length; i += 500) {
      const filter = { must: [{ key: 'entry_id', match: { any: entryIds.slice(i, i + 500) } }] };
      await withRetry(() =>
        status
          ? this.client.setPayload(this.collection, {
              payload: { doc_status: status },
              filter,
              wait: false,
            })
          : this.client.deletePayload(this.collection, { keys: ['doc_status'], filter, wait: false }),
      );
    }
  }

  /**
   * Points vs vectors: each point carries two named vectors (dense + sparse),
   * so `indexed_vectors_count` runs at roughly twice the point count. Both are
   * shown, because one of them is always the number someone expected.
   */
  async info(): Promise<{ points: number; vectors: number; segments: number } | null> {
    try {
      const r = await this.client.getCollection(this.collection);
      return {
        points: r.points_count ?? 0,
        vectors: r.indexed_vectors_count ?? 0,
        segments: r.segments_count ?? 0,
      };
    } catch {
      return null;
    }
  }

  async count(): Promise<number> {
    try {
      const r = await this.client.count(this.collection, { exact: false });
      return r.count;
    } catch {
      return 0;
    }
  }

  private buildFilter(filters: SearchFilters) {
    return buildQdrantFilter(filters);
  }

  /**
   * Hybrid (dense+sparse, RRF) when a dense query vector is supplied;
   * sparse-only nearest otherwise.
   */
  async query(opts: {
    dense?: number[];
    sparse: SparseVector;
    filters: SearchFilters;
    limit: number;
  }): Promise<{ entryId: number; score: number }[]> {
    const filter = this.buildFilter(opts.filters);
    const sparseQuery = { indices: opts.sparse.indices, values: opts.sparse.values };
    const perBranch = Math.max(opts.limit * 3, 30);

    const res = opts.dense
      ? await this.client.query(this.collection, {
          prefetch: [
            { query: opts.dense, using: 'dense', limit: perBranch, filter },
            { query: sparseQuery, using: 'sparse', limit: perBranch, filter },
          ],
          query: { fusion: 'rrf' },
          limit: opts.limit,
          with_payload: true,
        })
      : await this.client.query(this.collection, {
          query: sparseQuery,
          using: 'sparse',
          limit: opts.limit,
          filter,
          with_payload: true,
        });

    return res.points.map((p) => ({
      entryId: Number((p.payload as any)?.entry_id),
      score: p.score ?? 0,
    }));
  }
}
