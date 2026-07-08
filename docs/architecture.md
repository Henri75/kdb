2026-07-09 01:20 UTC

# Architecture

## Revision History
- 2026-07-09 01:20 UTC — Initial version.

## Services

| Service | Package | Role |
|---|---|---|
| indexer | `packages/indexer` | discovery → incremental scan → parse → chunk → embed → upsert (BullMQ worker + cron scheduler behind a Redis lock) |
| api | `packages/api` | Hono REST; owns search/ask orchestration |
| mcp | `packages/mcp` | streamable-HTTP MCP, 9 tools proxying the API |
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
  `{entry_id, project, source_type, component, session_id, occurred_at}`, point id
  = deterministic UUID of (project, sourcePath, entryId, seq).
- **Session** (`sessions`): one Claude Code transcript; files-touched and counts
  merged across incremental tail reads.

## Sources and parsers

| Source | Parser | Incremental strategy |
|---|---|---|
| kdb changelog/session/backlog/component logs | `parsers/kdbLog.ts` | whole-file on mtime/size change (files are small; dedup makes it idempotent) |
| kdb loose reports (`kdb/*.md` not generated views) | `parsers/docsMd.ts` | whole-file |
| Claude transcripts (`~/.claude/projects/**.jsonl`) | `parsers/claudeJsonl.ts` | **byte-offset tail reads** — only appended lines are parsed/embedded |
| git history | `parsers/gitLog.ts` | `git log <lastSha>..HEAD` |
| docs (`README.md`, `docs/**/*.md`) | `parsers/docsMd.ts` | whole-file on change |

The Claude distiller keeps user prompts, assistant prose ≥ 280 chars, and
file-edit tool calls; it drops tool results, thinking, progress noise. This is
what turns 11 GB of transcripts into a few hundred MB of meaningful text.

## Search pipeline

```
query ──► sparse encode (local, no network)
      └─► dense embed (provider) ──► Qdrant Query API
                                     prefetch: dense + sparse, fusion: RRF
                                     └─► hydrate entries from Postgres
degradation: hybrid → sparse-only (embedder down) → Postgres FTS (qdrant down)
```

Ask mode: top-k retrieval → numbered context blocks → OpenAI-compatible
`chat/completions` (G2P preset or any endpoint) → answer with `[n]` citations.

## Claude-dir ↔ project mapping

Claude Code encodes a session's cwd as a directory name by replacing every char
outside `[A-Za-z0-9-]` with `-`. That is lossy, so KDBScope never decodes: it
encodes each discovered project root the same way and picks the deepest prefix
match. Unmatched dirs become standalone projects so no history is invisible.
