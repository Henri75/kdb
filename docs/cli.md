2026-07-09 01:20 UTC

# CLI — `kdbs`

## Revision History
- 2026-07-11 04:35 UTC — `search -s/--source` accepts a comma-separated subset (`doc,kdb_component`); `ask` leaves scope soft (widens to all projects when a `-p` scope is empty).
- 2026-07-10 00:00 UTC — `status` reports service health and storage; numbers are thousands-separated.
- 2026-07-09 22:30 UTC — `--kind` filter on `search`.
- 2026-07-09 01:50 UTC — Streaming `ask`, `--no-stream`, richer `status`.
- 2026-07-09 01:20 UTC — Initial version.

Install on the host: `make cli-link` (npm link). Point it elsewhere with
`KDBSCOPE_API_URL` (default `http://127.0.0.1:8710`). Every command accepts
`--json` for scripting and agents.

```bash
kdbs search qdrant timeout fix -p deepcast -n 15
kdbs search "video import" -s git_commit
kdbs search "nexus drain" -s doc,kdb_component   # subset of source types
kdbs search qdrant --kind insight        # only ★ Insight blocks
kdbs search readme --kind summary        # only wrap-ups
kdbs ask "what were the bug fixes in the video import microservice?"   # streams
kdbs ask --no-stream "…"      # wait for the whole answer
kdbs --json ask "…"           # buffered: one valid JSON document
kdbs projects
kdbs timeline deepcast --sources kdb_changelog,git_commit
kdbs components deepcast
kdbs component deepcast analyzer-worker
kdbs sessions deepcast
kdbs session 0075adef
kdbs reindex --full -p deepcast
kdbs status
```
