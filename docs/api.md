2026-07-09 01:20 UTC

# REST API

## Revision History
- 2026-07-09 01:20 UTC — Initial version.

Base: `http://127.0.0.1:8710`. JSON everywhere. No auth (localhost-only tool).

| Method | Path | Params / body | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{ok}` |
| GET | `/api/stats` | — | counts, per-source breakdown, embedder, collection, lastRunAt |
| GET | `/api/search` | `q` (required), `project`, `source`, `component`, `since`, `until`, `limit` | `{hits[], mode, degraded, tookMs}` |
| POST | `/api/ask` | `{question, project?, source?, component?, k?}` | `{answer, sources[], model, degraded}` |
| GET | `/api/projects` | — | projects with entry counts |
| GET | `/api/projects/:slug/timeline` | `limit`, `before` (ISO cursor), `sources` (csv) | `{items[]}` newest first |
| GET | `/api/projects/:slug/components` | — | `{components[]}` |
| GET | `/api/projects/:slug/components/:name` | — | `{component, entries[]}` |
| GET | `/api/projects/:slug/sessions` | — | `{sessions[]}` |
| GET | `/api/sessions/:id` | — | `{session, entries[]}` (404 if unknown) |
| GET | `/api/entries/:id` | — | full entry row (404 if unknown) |
| POST | `/api/admin/reindex` | `{project?, full?}` | `{enqueued}` |
| GET | `/api/admin/errors` | — | last 50 index errors |

`mode` in search responses: `hybrid` (dense+sparse RRF), `sparse-only`
(embedding provider unreachable), `fts` (Qdrant unreachable — Postgres fallback).
`degraded: true` whenever the served mode is not `hybrid`.
