2026-07-09 01:20 UTC

# MCP Server

## Revision History
- 2026-07-09 01:20 UTC — Initial version.

Streamable HTTP at `http://127.0.0.1:8711/mcp` (stateless). Register once:

```bash
claude mcp add --transport http kdbscope http://127.0.0.1:8711/mcp
```

This repo also ships `.mcp.json`, so Claude Code sessions started inside the
repo pick the server up automatically.

## Tools

| Tool | Use it for |
|---|---|
| `kdb_search` | ranked snippets across all history (query, project?, source?, component?, limit?) |
| `kdb_ask` | synthesized, cited answer to a question (question, project?, k?) |
| `kdb_projects` | list indexed projects |
| `kdb_timeline` | what happened in a project, newest first (project, before?, sources?, limit?) |
| `kdb_components` | list a project's components |
| `kdb_component_history` | full recorded history of one component |
| `kdb_session` | replay one Claude Code session (session_id) |
| `kdb_reindex` | trigger incremental/full reindex (project?, full?) |
| `kdb_status` | index counts and freshness |

Suggested agent flow: `kdb_search` (or `kdb_ask` for prose questions) →
`kdb_component_history` / `kdb_session` to drill into a hit.
