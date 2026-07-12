2026-07-09 01:20 UTC

# Configuration

## Revision History
- 2026-07-12 13:50 UTC — Product renamed to **Atlas**; documented why the `KDBSCOPE_*` / `kdbscope` identifiers survive the rename.
- 2026-07-10 22:24 UTC — Doc staleness knobs: `KDB_DOCS_AGING_MONTHS`, `KDB_ARCHIVED_PENALTY`.
- 2026-07-10 00:00 UTC — QDRANT_STORAGE_PATH for dashboard disk usage.
- 2026-07-09 16:00 UTC — Multiple project roots; why host paths are passed into the containers.
- 2026-07-09 01:50 UTC — Ollama-preferred `auto` + version floor, WORKER_CONCURRENCY default 2, host-path passthrough, model-switch rebuild.
- 2026-07-09 01:20 UTC — Initial version.

All configuration is environment-driven through the central module
`packages/core/src/config.ts` (§3.1: no inline constants anywhere).
Compose reads `.env` (create with `make env`).

### A note on the `kdbscope` / `KDB_` names you will see here

The product is **Atlas**, but several settings still say `kdbscope`, and others
say `KDB_`. Both are intentional; do not "tidy" them.

- `KDBSCOPE_API_URL`, the Postgres db/role `kdbscope`, and the Qdrant collection
  prefix `kdbscope_*` are **legacy datastore identifiers**. They are the keys the
  existing index is stored under. Renaming the collection prefix or the id
  namespace invalidates every dedup key and Qdrant point id and forces a full
  re-index of ~280k entries, so they were deliberately left as-is.
- `KDB_DOCS_AGING_MONTHS` / `KDB_ARCHIVED_PENALTY` refer to **KDB**, the
  append-only knowledge base Atlas indexes — a different thing from Atlas itself.
  See *Naming: Atlas vs KDB* in [architecture.md](architecture.md).

## Host paths

| Var | Default | Meaning |
|---|---|---|
| `CODE_ROOT_HOST` | `/Users/nasta/__CODING NEW` | main projects root, mounted **read-only** at `/data/code` |
| `CODE_ROOT_HOST_2` … `_5` | unset | up to four more project roots, mounted at `/data/code2` … `/data/code5` |
| `CLAUDE_PROJECTS_HOST` | `/Users/nasta/.claude/projects` | transcripts, mounted **read-only** at `/data/claude/projects` |

A `CODE_ROOT_HOST_n` slot is active only when it is set; compose cannot express
an optional mount, so unset slots re-mount root 1 harmlessly and the indexer
ignores them.

These host paths are passed into the containers for two reasons: the API maps an
indexed container path back to a host path for editor deep links, and the indexer
needs them to attribute Claude Code transcripts to projects — Claude names each
transcript directory after the session's **host** working directory, so matching
on container paths finds nothing and splits every project in two.

The container-side mount points (`CODE_ROOT`, `CODE_ROOT_2` …) can be overridden
but rarely need to be.

## Storage

| Var | Default | Meaning |
|---|---|---|
| `QDRANT_STORAGE_PATH` | `/qdrant-storage` | Where Qdrant's data volume is mounted **read-only** into the API, so the dashboard can report real disk usage. Qdrant exposes no API for it. |

## Indexing

| Var | Default | Meaning |
|---|---|---|
| `SCAN_INTERVAL_MIN` | `5` | incremental scan cadence |
| `WORKER_CONCURRENCY` | `2` | parallel scan jobs. Every job embeds, and a local Ollama serves one request at a time — more workers only deepen its queue. Raise for a remote/batched endpoint. |

## Doc staleness

Docs under archive-style paths (`docs/archive`, `_legacy`, `Previous`, `old`,
`deprecated`…) are indexed like everything else but downranked and labeled in
results; docs merely untouched for a long time get an `aging` label with no
rank penalty. All of it is query-time behavior — changing these never requires
a reindex.

| Var | Default | Meaning |
|---|---|---|
| `KDB_DOCS_AGING_MONTHS` | `12` | age (months since file mtime) past which an unarchived doc is labeled `aging` |
| `KDB_ARCHIVED_PENALTY` | `0.6` | multiplier applied to the search score of archived doc hits (0–1; lower buries them deeper) |

## Embeddings

| Var | Default | Meaning |
|---|---|---|
| `EMBEDDINGS_PROVIDER` | `auto` | `auto` \| `ollama` \| `bundled` \| `openai` \| `g2p` |
| `EMBEDDINGS_MODEL` | `nomic-embed-text` | model name for ollama/openai/g2p |
| `EMBEDDINGS_BASE_URL` | — | required for `openai`; optional override for `g2p` |
| `EMBEDDINGS_API_KEY` | — | bearer token when the endpoint needs one |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | probed by `auto`/`ollama` |

`auto` prefers Ollama, pulling `EMBEDDINGS_MODEL` on first boot, and falls back
to the bundled CPU model (`Xenova/all-MiniLM-L6-v2`, cached in the `hf_cache`
volume) — logging loudly whenever it does. **Ollama ≥ 0.13** is required;
0.12.x segfaults inside its embeddings endpoint.

**Switching provider/model creates a new Qdrant collection** (its name encodes
the vector dimension). The indexer rebuilds the vectors from Postgres on the
next boot — no `make reindex-full` needed, and no re-parsing of sources — then
publishes `active_collection`, which api/mcp follow within 15s. Search serves
the previous collection until the new one is ready. See
[operations](operations.md#switching-the-embedding-model).

## Ask-mode LLM

| Var | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | `g2p` | `g2p` \| `openai` (both speak the OpenAI wire protocol) |
| `LLM_MODEL` | `gemini-2.5-flash` | |
| `LLM_BASE_URL` | `http://host.docker.internal:8181/v1` | G2P default; set your endpoint for `openai` |
| `LLM_API_KEY` | — | not needed for G2P |

Retry policy per §3.8: 429/5xx retried ≤ 2 with backoff; other 4xx fail fast.

## Ports (all bound to 127.0.0.1)

| Var | Default | Service |
|---|---|---|
| `API_PORT` | 8710 | REST |
| `MCP_PORT` | 8711 | MCP (`/mcp`) |
| `UI_PORT` | 8712 | web UI |
| `QDRANT_PORT` / `QDRANT_GRPC_PORT` | 6363 / 6364 | qdrant |
| `REDIS_PORT` | 6390 | redis |
| `POSTGRES_PORT` | 5460 | postgres |

Ports were chosen to avoid this machine's existing stacks (G2P on 8181,
kbdv3's qdrant on 6353/6354, DeepCast services).
