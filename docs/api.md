2026-07-09 01:20 UTC

# REST API

## Revision History
- 2026-07-11 04:35 UTC — `source` accepts a comma-separated subset (`doc,kdb_component`); Ask retrieval reranks for source-type diversity; Ask returns `scopeFallback` (and the SSE `sources` event carries it) when a project scope was empty and widened to all projects.
- 2026-07-10 22:24 UTC — `docStatus` filter on search/ask; hits carry `docStatus`/`ageMonths`; dashboard adds `sourceDetail`, `activity`, `runs`, `archivedDocs`.
- 2026-07-10 00:00 UTC — /api/dashboard: storage, service health, vector stats.
- 2026-07-09 22:25 UTC — Conversation history on both Ask endpoints; `kind` filter.
- 2026-07-09 01:50 UTC — Streaming Ask (SSE), source deep links, richer /api/stats.
- 2026-07-09 01:20 UTC — Initial version.

Base: `http://127.0.0.1:8710`. JSON everywhere. No auth (localhost-only tool).

| Method | Path | Params / body | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{ok}` |
| GET | `/api/stats` | — | counts, per-source breakdown, embedder, collection, lastRunAt, `queue`, `pending`, `backfill`, `recentErrors` |
| GET | `/api/dashboard` | — | everything in `/api/stats` plus `sessions`, `storage`, `health`, `vectors`, `sourceDetail` (per-source entries/files/volume/last-indexed), `activity` (30-day per-day per-source counts), `runs`, `archivedDocs` |
| GET | `/api/search` | `q` (required), `project`, `source` (one type or a comma-separated subset, e.g. `doc,kdb_component`; empty = all), `component`, `kind`, `since`, `until`, `docStatus` (`active` excludes archived docs, `archived` targets them), `limit` | `{hits[], mode, degraded, tookMs}`; each hit carries `hostPath` + `editorUrl`, and doc hits may carry `docStatus` (`archived` = downranked, `aging` = label only) + `ageMonths` |
| POST | `/api/ask` | `{question, project?, source?` (string or string[]), `component?, kind?, docStatus?, k?, history?}` | `{answer, sources[], model, degraded, scopeFallback?}` — `scopeFallback: {requested, usedAllProjects}` when a project scope matched nothing and the search widened to all projects |
| POST | `/api/ask/stream` | same as `/api/ask` | SSE: `sources` → `delta`* → `done`; the `sources` event carries `scopeFallback?` |
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

## Dashboard

`/api/dashboard` is deliberately separate from `/api/stats`: it walks Qdrant's
storage directory and probes every dependency, which is far too slow for the
footer that polls `/api/stats` every 30 seconds. Storage figures are cached for
30 seconds (the walk is ~200ms over ~1,100 files, and grows with file count
rather than gigabytes).

- `health` — `{postgres, qdrant, redis, ollama}`. These are *reachability from
  the API*, which is exactly what determines whether search works. Knowing a
  container's Docker state would need the Docker socket, an absurd privilege
  for a stats endpoint.
- `vectors` — `{points, vectors, segments}`. Each point carries two named
  vectors (dense + sparse), so `vectors` runs at roughly twice `points`.
- `storage` — `postgresBytes` and `qdrantBytes` are **disk**, `redisMemoryBytes`
  is **memory** (Redis holds the job queue; its disk is transient). A `null`
  means *cannot tell*, never *uses no disk*.
- `storage.collections` — per-collection sizes with an `active` flag. Switching
  the embedding model leaves the previous collection behind; on a real index
  that is over a gigabyte of vectors nothing reads.

Postgres reports its own size via `pg_database_size()` and Redis via
`INFO memory`. Qdrant has **no API for disk usage** — its telemetry exposes a
`disk_usage_bytes` field that reports `0`, which is worse than absent because it
looks authoritative. Its storage volume is therefore mounted **read-only** into
the API container at `/qdrant-storage`.

## Conversations

Both Ask endpoints accept an optional `history`: an array of prior
`{role: 'user'|'assistant', content}` turns. It is whitelisted server-side — a
`system` role from a client would rewrite the assistant's instructions — and the
newest 12 turns are replayed.

Prior turns are sent *before* the freshly retrieved context, so the `[n]`
citations in an answer always refer to the blocks directly above the question.
A follow-up such as *"why?"* carries no search signal and may retrieve nothing;
with history present that is fine (the conversation holds the answer), while a
*first* question with no hits is still a genuine dead end.

## Filtering by message kind

`kind` narrows results to how a session message was classified: `prompt`,
`plan`, `insight`, `summary`, `action`, `response`. For example
`GET /api/search?q=qdrant&kind=insight` returns only `★ Insight` blocks. See
[architecture](architecture.md#message-kinds).

`source` restricts to one or more source types. Pass a single value
(`source=doc`) or a comma-separated subset (`source=doc,kdb_component`); an
empty value searches everything. The Ask endpoints accept the same value as a
string or a JSON `string[]`.

**Ask vs. search ranking.** `/api/search` returns hits in raw relevance order.
The Ask endpoints then rerank the retrieved pool for context quality: authoritative
sources (docs, kdb component/changelog logs) are boosted and `claude_session`
blocks are capped at half the context window, so descriptive documentation is not
crowded out by transcripts that merely echo the question. See
[architecture](architecture.md#ask-mode).

## Streaming Ask

`POST /api/ask/stream` returns `text/event-stream`. Each frame is
`data: {json}\n\n`, in this order:

| Event | Payload | Meaning |
|---|---|---|
| `sources` | `{sources: [...], scopeFallback?}` | retrieved context; emitted before any prose. `scopeFallback: {requested, usedAllProjects}` appears when a project scope was empty and the search widened to all projects |
| `delta` | `{text: "…"}` | append to the answer |
| `done` | `{model, degraded}` | terminal; `degraded` if the LLM failed |

The stream always terminates with `done`, even when the LLM is unreachable — in
that case a `delta` explains it and the sources still stand. Interactive streams
do **not** retry: a fast degraded answer beats seconds of silent backoff.

nginx must not buffer this route (`proxy_buffering off` plus the
`x-accel-buffering: no` response header), or the whole answer arrives at once.

## Source deep links

Search hits and `/api/entries/:id` carry `hostPath` (the container path mapped
back through the bind mounts) and `editorUrl` (`vscode://file/…:line`). The API
is the only component that knows both sides of the mount, so it does the
translation; a path it cannot map is returned unchanged rather than guessed at.
