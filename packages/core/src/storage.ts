import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Where the index actually lives on disk, for the dashboard.
 *
 * Each store reports its own size in its own way:
 *  - Postgres: `pg_database_size()` — authoritative, one query.
 *  - Redis: `INFO memory` — it holds the job queue, so *memory* is the honest
 *    number; its disk is transient.
 *  - Qdrant: no API. Its telemetry exposes `disk_usage_bytes` and reports 0,
 *    which is worse than nothing because it looks authoritative. The storage
 *    volume is mounted read-only into the API instead.
 */

export interface CollectionSize {
  name: string;
  bytes: number;
  /** False when the indexer is no longer writing to it — dead weight. */
  active: boolean;
}

export interface StorageUsage {
  postgresBytes: number | null;
  qdrantBytes: number | null;
  redisMemoryBytes: number | null;
  /** Per-collection, so an orphaned collection from an old model is visible. */
  collections: CollectionSize[];
}

/** Recursive size of a directory. Missing paths report null, never a fake 0. */
export async function dirSize(path: string): Promise<number | null> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    let total = 0;
    for (const e of entries) {
      const child = join(path, e.name);
      if (e.isDirectory()) total += (await dirSize(child)) ?? 0;
      else if (e.isFile()) total += (await stat(child)).size;
    }
    return total;
  } catch {
    return null; // not mounted, or no permission
  }
}

/**
 * Size every Qdrant collection under a storage root, flagging which one the
 * indexer is currently writing to. Switching the embedding model leaves the
 * previous collection behind; on a real index that is over a gigabyte.
 */
export async function qdrantCollectionSizes(
  storagePath: string,
  activeCollection: string | null,
): Promise<CollectionSize[]> {
  const root = join(storagePath, 'collections');
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const sizes = await Promise.all(
    names.map(async (name) => ({
      name,
      bytes: (await dirSize(join(root, name))) ?? 0,
      active: name === activeCollection,
    })),
  );
  return sizes.sort((a, b) => b.bytes - a.bytes);
}

/** `INFO memory` is a flat `key:value` text block. */
export function parseRedisMemory(info: string): number | null {
  const m = info.match(/^used_memory:(\d+)/m);
  return m ? Number(m[1]) : null;
}
