<!-- GENERATED VIEW — do not edit. Rebuilt from changelog.log by bin/kdb_rebuild.mjs -->

- [IN-PROGRESS] - [2026-07-08 22:40 UTC] - [Feature] - [kdbscope] - [Design + build KDBScope: cross-project knowledge indexer (kdb logs + claude sessions + git + docs) with UI/CLI/REST/MCP]
- [COMPLETED] - [2026-07-08 23:20 UTC] - [Feature] - [kdbscope] - [v0.1.0 built and deployed: 7-service docker stack live, 63 unit tests green, smoke 6/6, first index running (90 projects discovered); fixed pg18 volume path, migration race (advisory lock), fractional mtimeMs vs BIGINT]
- [COMPLETED] - [2026-07-08 23:40 UTC] - [Bugfix] - [kdbscope] - [Search returned 0 hits despite Qdrant matches: pg returns int8 ids as strings, breaking the Map lookup in hydrate; fixed with pg.types.setTypeParser(20, parseInt). Live-verified: hybrid search + Ask (g2p/gemini-2.5-flash cited answer) + MCP tools/list all working]
