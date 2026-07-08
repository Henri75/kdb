2026-07-09 01:20 UTC

# Operations

## Revision History
- 2026-07-09 01:20 UTC — Initial version.

## Day-to-day

```bash
make up / make down / make ps / make logs
make reindex          # incremental, now
make reindex-full     # rebuild everything (dedup keys make it safe)
make smoke            # 6 endpoint checks against the running stack
```

Freshness: the indexer scans every `SCAN_INTERVAL_MIN` (default 5) minutes;
"Reindex now" in the UI / `kdbs reindex` / `kdb_reindex` (MCP) trigger instantly.

## First index

The boot tick enqueues one job per (project, source). kdb/git/docs sources are
small and finish first; the Claude transcript corpus (~10k files) takes the
longest — with the bundled CPU embedder expect hours, with Ollama on Apple
Silicon substantially less. Everything already indexed is searchable while the
rest fills in. Progress: `kdbs status` or the UI footer.

## Troubleshooting

- **`degraded: true` / mode `fts`** — Qdrant down or the collection doesn't
  match the active embedder. Check `docker logs kdb-qdrant-1`; restart api after
  changing embedding config.
- **mode `sparse-only`** — embedding provider unreachable (e.g. Ollama stopped).
  Keyword search still works; hybrid resumes when the provider is back.
- **Ask returns sources but no answer** — LLM endpoint unreachable (G2P not
  running?). The response says so explicitly; sources are still returned.
- **Index errors** — `GET /api/admin/errors` or `kdbs status` error count.
  Errors are per-file; one corrupt transcript never fails a scan.
- **Ollama/G2P from containers** — reached via `host.docker.internal`
  (extra_hosts is set for OrbStack/Docker Desktop compatibility).
- **Postgres 18 volume** — mounted at `/var/lib/postgresql` (image convention;
  data lives in a subdirectory).

## Data reset

```bash
docker compose down -v   # wipes qdrant/postgres/redis volumes (the source files
make up                  # are untouched — everything reindexes from scratch)
```
