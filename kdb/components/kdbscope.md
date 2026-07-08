<!-- GENERATED VIEW — do not edit. Rebuilt from kdbscope.log by bin/kdb_rebuild.mjs -->

---
### [2026-07-08] - KDBScope v0.1.0 — cross-project knowledge indexer built end-to-end

**Objective:**
- Build a Web+CLI+MCP tool that indexes all projects' kdb/ logs, Claude Code session transcripts, git history and docs, with hybrid vector search and an Ask (LLM) mode.

**Summary of Work:**
- TS monorepo (npm workspaces): packages/core (parsers, chunker, sparse encoder, catalog, qdrant wrapper, embeddings, search/ask), indexer (BullMQ+cron), api (Hono), mcp (streamable HTTP, 9 tools), cli (kdbs), ui (React 19 + Tailwind 4).
- 7-service docker compose (indexer/api/mcp/ui/qdrant/redis/postgres), ro bind mounts of ~/.claude and __CODING NEW, all ports 127.0.0.1, images pinned tag@digest.
- Hybrid search: dense (pluggable provider: auto/ollama/bundled/openai-compat/g2p) + hash-based sparse with qdrant IDF, RRF fusion; degradation chain hybrid → sparse-only → postgres FTS.
- Claude jsonl distiller with byte-offset tail reads (11GB corpus paid once).

**Key Decisions & Rationale:**
- Microservices + Postgres 18 catalog (user choice; SQLite rejected: multi-container writers, WAL over docker mounts unsafe, org baseline). ADR: docs/adr/20260709-microservices-architecture.md.
- Chunks live only in Qdrant (rebuildable by rescan) — no relational mirror.
- Indexer publishes active_collection in settings table so api/mcp query the same embedding space.
- Claude dir → project mapping by ENCODING project paths (lossy dash encoding cannot be decoded).

**Code/Files Modified:**
- packages/* (new), docker/*, docker-compose.yml, Makefile, scripts/smoke.sh, docs/*, test/* (63 tests)

**Outcomes & Lessons Learned:**
- **What Worked:** stack live on first deploy after 3 real fixes; 63 unit tests green; smoke 6/6; boot tick discovered 90 projects, 138 scan jobs; hybrid search answering in ~60ms.
- **What Failed:** (1) postgres:18 image wants volume at /var/lib/postgresql not .../data — container crash-looped; (2) concurrent boot migrations raced on pg_type — fixed with pg_advisory_lock(732015); (3) macOS statSync mtimeMs is fractional, BIGINT column rejected it — Math.trunc at every read/write/compare site; (4) TS7 removed baseUrl from tsconfig paths; (5) bullmq pins its own ioredis (5.10.1) — aligning avoids type clashes.

**Status:**
- Completed
---
### [2026-07-08] - Bugfix: search hydration dropped all hits (pg int8-as-string)

**Objective:**
- Fix /api/search returning 0 hits while Qdrant contained matching points.

**Summary of Work:**
- Root cause (verified by querying Qdrant directly, then the API): node-postgres returns BIGSERIAL ids as strings; SearchService.hydrate keyed its Map by string '7256' while Qdrant payload lookups used number 7256 — every hit dropped. FTS fallback worked, masking it as "hybrid but empty".
- Fix: pg.types.setTypeParser(20, parseInt) in Catalog constructor (ids fit in a double).

**Code/Files Modified:**
- packages/core/src/catalog.ts

**Outcomes & Lessons Learned:**
- **What Worked:** live verify post-rebuild: "pgbouncer crash loop" returns the real DeepCast changelog/component entries; Ask returns a cited answer via g2p; MCP tools/list green.
- **What Failed:** n/a (first-principles gate: hypothesis confirmed at each layer before the fix).

**Status:**
- Completed
