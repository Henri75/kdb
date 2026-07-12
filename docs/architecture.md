2026-07-09 01:20 UTC

# Architecture

## Revision History
- 2026-07-12 13:50 UTC — Renamed the product to **Atlas** (was KDBScope). See *Naming: Atlas vs KDB* below for what did and did not change.
- 2026-07-11 04:35 UTC — Ask mode: soft project scope with all-projects fallback (`scopeFallback`); context reranking (doc boost + `claude_session` cap) so self-indexed chatter stops crowding out docs; multi-value `source` filter.
- 2026-07-10 22:24 UTC — Doc staleness: archived/aging model, query-time ranking, version-forced backfill.
- 2026-07-09 22:25 UTC — Message kinds; distiller keeps all prose + records actions; EXTRACTION_SCHEME.
- 2026-07-09 16:00 UTC — Host vs container paths; multi-root discovery; PROJECT_GROUPING.
- 2026-07-09 01:20 UTC — Initial version.

## Naming: Atlas vs KDB

Two different things used to share the name "kdb", which made the codebase hard
to talk about. They are now separated, and the separation is load-bearing:

- **Atlas** is *this tool* — the indexer, API, MCP server, CLI and UI. Anything
  that names the product is `atlas`: the npm workspace, the `@atlas/*` packages,
  the `atlas` CLI command, the `atlas` MCP server and its ten `atlas_*` tools.
- **KDB** is *one of the four things Atlas indexes* — the append-only knowledge
  base of `changelog.log` / `session.log` / `components/*.log` files that each
  project keeps under its own `kdb/` directory (see the root `CLAUDE.md` §2).
  Anything that names **that data** keeps the `kdb` prefix, deliberately: the
  source type `kdb`, the entry types `kdb_changelog`, `kdb_session`,
  `kdb_component`, `kdb_backlog`, `kdb_report`, the `kdbLog` parser, this repo's
  own `kdb/` directory, and the `bin/kdb_append` / `bin/kdb_rebuild` helpers.

So `atlas search pgbouncer -s kdb_changelog` reads correctly: *ask Atlas to
search KDB changelogs*. Renaming the `kdb_*` entry types to `atlas_*` would be
wrong — they would then claim the content is about Atlas, when it is content
Atlas merely reads.

Some **internal datastore identifiers still say `kdbscope`** (the Postgres
database and role, the Qdrant collection prefix `kdbscope_<provider>_<model>_<dim>`,
the BullMQ queue `kdbscope-scan`, the Redis scheduler lock, the deterministic-id
namespace in `ids.ts`, and the `KDBSCOPE_API_URL` env var). These are *not*
cosmetic leftovers to tidy up: each one is the key under which existing data is
stored. Changing the id namespace or the collection prefix invalidates every
dedup key and Qdrant point id and forces a full re-index of ~280k entries. They
were left alone on purpose. The Docker Compose project name is pinned to `kdb`
in `docker-compose.yml` for the same reason — it fixes the volume prefix
(`kdb_pg_data`, …) so the checkout directory can be renamed freely.

## Services

| Service | Package | Role |
|---|---|---|
| indexer | `packages/indexer` | discovery → incremental scan → parse → chunk → embed → upsert (BullMQ worker + cron scheduler behind a Redis lock) |
| api | `packages/api` | Hono REST; owns search/ask orchestration |
| mcp | `packages/mcp` | streamable-HTTP MCP, 10 tools proxying the API |
| ui | `packages/ui` | React SPA behind nginx (proxies `/api`) |
| qdrant | image | vectors: named `dense` + `sparse` (IDF modifier) per collection |
| redis | image | BullMQ queue, scheduler lock |
| postgres | image | catalog: projects, entries, sessions, scan state, errors, runs, settings |

All domain logic lives in `packages/core`; services are thin wrappers, which is
what keeps the unit tests fast and hermetic.

## Data model

- **Entry** (Postgres `entries`): browsable unit — one changelog line, one session
  block, one commit, one doc section, one distilled conversation event. Carries a
  deterministic `dedup_key` so re-scans are idempotent, plus a generated `tsvector`
  used as the search fallback.
- **Chunk** (Qdrant point): searchable unit (~1800 chars, 200 overlap), payload
  `{entry_id, project, source_type, component, session_id, kind, occurred_at}`,
  point id = deterministic UUID of (project, sourcePath, entryId, seq).
- **Session** (`sessions`): one Claude Code transcript; title, prompt/action
  counts, files-touched and timespan merged across incremental tail reads.

## Sources and parsers

| Source | Parser | Incremental strategy |
|---|---|---|
| kdb changelog/session/backlog/component logs | `parsers/kdbLog.ts` | whole-file on mtime/size change (files are small; dedup makes it idempotent) |
| kdb loose reports (`kdb/*.md` not generated views) | `parsers/docsMd.ts` | whole-file |
| Claude transcripts (`~/.claude/projects/**.jsonl`) | `parsers/claudeJsonl.ts` | **byte-offset tail reads** — only appended lines are parsed/embedded |
| git history | `parsers/gitLog.ts` | `git log <lastSha>..HEAD` |
| docs (`README.md`, `docs/**/*.md`) | `parsers/docsMd.ts` | whole-file on change |

The Claude distiller keeps **every** user prompt and every piece of assistant
prose, plus a compact record of the actions taken; it drops tool results,
thinking blocks, progress events and base64 payloads — the genuinely bulky,
low-signal parts. That is what turns 11 GB of transcripts into a few hundred MB
of meaningful text.

An earlier version dropped assistant messages under 280 characters. Measured on
real transcripts, that discarded ~53% of Claude's replies (a short *"No security
findings."* is exactly what you go looking for later) to save ~7% of the prose
volume. **Length is a poor proxy for value; kind is a good one.**

## Message kinds

Each captured session message is classified at parse time — deterministic, free,
no LLM — so search can ask for intent directly rather than guessing from prose:

| Kind | What it is |
|---|---|
| `prompt` | something the user asked for |
| `plan` | a plan or spec the user handed over |
| `insight` | a `★ Insight` block |
| `summary` | a `## Summary` / *What I did* wrap-up |
| `action` | tools that changed something (edits, commands, agents); one entry per turn |
| `response` | everything else Claude said |

The kind reaches the Qdrant payload **and** the Postgres fallback, so
`GET /api/search?q=…&kind=insight` works in hybrid and degraded modes alike.
`EXTRACTION_SCHEME` in `packages/core/src/parsers/claudeJsonl.ts` is bumped
whenever this rule changes, which rebuilds the derived index at the next boot.

Session metadata (title, prompt count, action count, timespan, files touched) is
gathered across the **whole** stream even once the per-session entry cap stops
entry collection: Claude writes its `summary` event at either end of the file, so
bailing out early silently loses the title. Sessions with no summary fall back to
their first prompt — a raw UUID is a useless label.

## Search pipeline

```
query ──► sparse encode (local, no network)
      └─► dense embed (provider) ──► Qdrant Query API
                                     prefetch: dense + sparse, fusion: RRF
                                     └─► hydrate entries from Postgres
degradation: hybrid → sparse-only (embedder down) → Postgres FTS (qdrant down)
```

## Ask mode

Retrieval → rerank → numbered context blocks → OpenAI-compatible
`chat/completions` (G2P preset or any endpoint) → answer with `[n]` citations.
`AskService` layers two behaviors over raw search that keep answers grounded:

- **Soft project scope.** A `project` filter is applied as a hard filter (a
  scoped question usually wants scoped results), but when it matches *nothing*
  the search widens to all projects and the result is flagged with
  `scopeFallback: {requested, usedAllProjects}`. Without this, asking about a
  feature under the "wrong" slug (G2P is indexed as `google-gemini-pool`, not
  `deepcast`) returned a confident "not found" instead of the answer that lived
  one project over. The prompt is told to open by naming the empty scope.
- **Context reranking (`rerankForContext`).** Because Atlas indexes its own
  operators' conversations, a debugging transcript about "feature X" out-matches
  the doc that *explains* X — the transcript echoes the question verbatim, the
  doc uses different words. Left alone, Ask answers from chatter. So the pool is
  over-fetched (k×3), each hit is multiplied by a per-source-type weight (docs
  ×1.35, kdb component/report/changelog boosted, `claude_session` ×0.8), and
  `claude_session` blocks are hard-capped at 50% of the k-block window (held-over
  sessions backfill only if nothing better exists). `/api/search` is not
  reranked — it returns raw relevance.

## Doc staleness

docs/ folders accumulate outdated material. Atlas never excludes it — the
index would silently lose recall — it classifies and lets ranking + labels do
the judging (ADR: `docs/adr/20260710-docs-staleness-query-time.md`):

- **archived** — the file's project-relative path crosses an archive-style
  segment (`archive`, `_archive`, `legacy`, `old`, `deprecated`, `previous`,
  `obsolete`, `superseded`, `outdated`, `backup`, `bak`; filename-stem tokens
  count too). Computed at scan time, stored in entry `meta` and as `doc_status`
  in the Qdrant payload. Filterable (`docStatus=active|archived`).
- **aging** — not archived, but older than `KDB_DOCS_AGING_MONTHS` (12). Derived
  at **query time** from `occurredAt`; deliberately never stored, because
  unchanged files are never rescanned and a stored flag would freeze.

`SearchService.finalize()` is the single staleness pass: it runs on the hybrid
path *and* the FTS fallback, multiplies archived scores by
`KDB_ARCHIVED_PENALTY` (0.6), attaches labels, re-sorts (2× over-fetch so
demoted hits can actually fall out). Aging is a label only — an old runbook
that never needed edits must not be buried. Ask context blocks arrive labeled
(`[ARCHIVED — 20 mo old]`) and the system prompt tells the model to prefer
fresh sources and disclose reliance on stale ones.

Reclassification without re-embedding: `DOCS_PARSER_VERSION` is recorded per
project; on mismatch the next docs scan walks unchanged files once, updates
`meta.docStatus` in Postgres and patches the Qdrant payload via `setPayload`
on the `entry_id` index. The docs walk covers 2000 files at depth 6 per
project, and logs a per-project warning when the cap drops anything.

## Host paths vs container paths

Project trees are bind-mounted read-only: `/Users/nasta/__CODING NEW` appears
inside the containers as `/data/code` (and extra roots as `/data/code2` …
`/data/code5`). Every discovered project therefore carries **both** paths:

- `rootPath` — where the indexer reads files.
- `hostPath` — the same tree as the user sees it.

Two things depend on the host path, and both fail silently without it:

1. **Editor deep links.** The API translates a container path back to a host
   path before emitting `vscode://…`; nobody outside the stack has `/data/code`.
2. **Attributing Claude Code transcripts to projects** (below).

## Claude-dir ↔ project mapping

Claude Code encodes a session's cwd as a directory name by replacing every char
outside `[A-Za-z0-9-]` with `-`. That is lossy, so Atlas never decodes: it
encodes each discovered project's **hostPath** the same way and picks the
deepest prefix match.

Matching against `rootPath` matches nothing — the dir name encodes
`/Users/nasta/__CODING NEW/DeepCast`, never `/data/code/DeepCast` — and every
project silently splits in two: one built from its files, one from its
transcripts under a path-shaped slug. `PROJECT_GROUPING` in
`packages/core/src/discovery.ts` is bumped whenever this rule changes, which
makes the indexer rebuild the derived index at the next boot.

Dirs that match no project (sessions from a folder outside every configured
root) become standalone projects named after the path, so no history is
invisible. Adding that folder as an extra root merges them into the real
project.
