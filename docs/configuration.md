2026-07-09 01:20 UTC

# Configuration

## Revision History
- 2026-07-09 01:20 UTC — Initial version.

All configuration is environment-driven through the central module
`packages/core/src/config.ts` (§3.1: no inline constants anywhere).
Compose reads `.env` (create with `make env`).

## Host paths

| Var | Default | Meaning |
|---|---|---|
| `CODE_ROOT_HOST` | `/Users/nasta/__CODING NEW` | projects root, mounted **read-only** at `/data/code` |
| `CLAUDE_PROJECTS_HOST` | `/Users/nasta/.claude/projects` | transcripts, mounted **read-only** at `/data/claude/projects` |

## Indexing

| Var | Default | Meaning |
|---|---|---|
| `SCAN_INTERVAL_MIN` | `5` | incremental scan cadence |
| `WORKER_CONCURRENCY` | `4` | parallel scan jobs per indexer |

## Embeddings

| Var | Default | Meaning |
|---|---|---|
| `EMBEDDINGS_PROVIDER` | `auto` | `auto` \| `ollama` \| `bundled` \| `openai` \| `g2p` |
| `EMBEDDINGS_MODEL` | `nomic-embed-text` | model name for ollama/openai/g2p |
| `EMBEDDINGS_BASE_URL` | — | required for `openai`; optional override for `g2p` |
| `EMBEDDINGS_API_KEY` | — | bearer token when the endpoint needs one |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | probed by `auto`/`ollama` |

`auto` = Ollama if reachable, else the bundled CPU model
(`Xenova/all-MiniLM-L6-v2`, cached in the `hf_cache` volume).
**Switching provider/model creates a new Qdrant collection** — run
`make reindex-full` afterwards; the indexer publishes the active collection in
the `settings` table so api/mcp follow automatically after restart.

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
