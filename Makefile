# Atlas — single entry point (§3.5).

SHELL := /bin/bash
COMPOSE := docker compose

.PHONY: help env install build test lint up down restart logs ps reindex reindex-full smoke cli-link kdb-rebuild clean

help: ## list targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

env: ## create .env from the example if missing
	@test -f .env || (cp .env.example .env && echo "created .env — review paths/providers")

install: ## install workspace dependencies
	npm install

build: ## typescript builds for all services + ui
	npm run build && npm run build:ui

test: ## unit test suite
	npx vitest run

lint: ## typecheck all packages
	npm run lint

up: env ## build images and start the full stack
	$(COMPOSE) up -d --build
	@echo "UI    → http://127.0.0.1:$${UI_PORT:-8712}"
	@echo "API   → http://127.0.0.1:$${API_PORT:-8710}/api/health"
	@echo "MCP   → http://127.0.0.1:$${MCP_PORT:-8711}/mcp"

down: ## stop the stack (data volumes are kept)
	$(COMPOSE) down

restart: ## restart app services (keeps infra running)
	$(COMPOSE) restart indexer api mcp ui

logs: ## follow service logs
	$(COMPOSE) logs -f --tail 100 indexer api mcp

ps: ## stack status
	$(COMPOSE) ps

reindex: ## trigger an incremental reindex now
	curl -s -X POST http://127.0.0.1:$${API_PORT:-8710}/api/admin/reindex -H 'content-type: application/json' -d '{}' && echo

reindex-full: ## reprocess everything from scratch
	curl -s -X POST http://127.0.0.1:$${API_PORT:-8710}/api/admin/reindex -H 'content-type: application/json' -d '{"full":true}' && echo

smoke: ## poke health + search endpoints of a running stack
	bash scripts/smoke.sh

cli-link: ## make the `atlas` command available on this machine
	npm run build -w packages/cli && npm link --workspace packages/cli
	@echo "try: atlas status"

kdb-rebuild: ## regenerate kdb/*.md views from kdb/*.log (never touches logs)
	node bin/kdb_rebuild.mjs

clean: ## remove build artifacts
	rm -rf packages/*/dist packages/ui/dist
