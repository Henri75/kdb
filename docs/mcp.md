2026-07-09 01:20 UTC

# MCP Server

## Revision History
- 2026-07-12 13:50 UTC — Renamed the product to **Atlas**. The MCP server id is now `atlas` (was `kdbscope`) and every tool is `atlas_*` (was `kdb_*`): `kdb_search` → `atlas_search`, and so on for all ten. The `source` **values** are unchanged — `kdb_changelog`, `kdb_session`, `kdb_component`, `kdb_backlog`, `kdb_report` name kinds of indexed content (KDB logs), not the server, and keep their `kdb_` prefix. Re-register the server (see below); no reindex.
- 2026-07-11 04:35 UTC — `kdb_ask` steers callers away from over-scoping (a wrong `project` slug hides answers in sibling projects) and auto-widens to all projects on an empty scope, returning `scopeFallback`; `kdb_search` `source` accepts a comma-separated subset.
- 2026-07-09 22:30 UTC — kdb_search gains a `kind` filter (insight / plan / summary / action).
- 2026-07-09 02:00 UTC — Added kdb_entry (full entry body + deep link); clarified the agent flow.
- 2026-07-09 01:20 UTC — Initial version.

Streamable HTTP at `http://127.0.0.1:8711/mcp` (stateless). Register once:

```bash
claude mcp add --transport http atlas http://127.0.0.1:8711/mcp
```

This repo also ships `.mcp.json`, so Claude Code sessions started inside the
repo pick the server up automatically.

## Tools

| Tool | Use it for |
|---|---|
| `atlas_search` | ranked snippets across all history (query, project?, source? — one type or a comma-separated subset, component?, kind?, limit?) |
| `atlas_ask` | synthesized, cited answer to a question (question, project?, k?). Prefer leaving `project` unset — a feature may be indexed under a different slug than expected (e.g. G2P → `google-gemini-pool`, not `deepcast`), and a wrong scope is the main reason a real answer looks missing. On an empty scope the search widens to all projects and the result carries `scopeFallback`. |
| `atlas_entry` | the **full body** of one entry, plus its host path and editor link (entry_id) |
| `atlas_projects` | list indexed projects |
| `atlas_timeline` | what happened in a project, newest first (project, before?, sources?, limit?) |
| `atlas_components` | list a project's components |
| `atlas_component_history` | full recorded history of one component |
| `atlas_session` | replay one Claude Code session (session_id) |
| `atlas_reindex` | trigger incremental/full reindex (project?, full?) |
| `atlas_status` | index counts, freshness, queue depth, re-embed progress |

Suggested agent flow: `atlas_search` (or `atlas_ask` for prose questions) → take an
`entryId` from a hit → `atlas_entry` for the full record → `atlas_component_history`
or `atlas_session` to widen the context. Search results are snippets; `atlas_entry`
is how you read one properly.

`atlas_ask` is non-streaming by design: a tool call returns one result. The
streaming endpoint (`POST /api/ask/stream`) serves the UI and CLI.

`atlas_ask` reranks its retrieved context for source-type diversity — authoritative
docs and component logs are boosted and session transcripts are capped at half the
window — so the answer is grounded in documentation rather than in chatter that
merely repeats the question. `atlas_search` is unaffected and returns raw
relevance order.
