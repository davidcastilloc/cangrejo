# BRIEFING — 2026-11-05T21:10:00Z

## Mission
Thoroughly investigate and survey Subsystem 3 (Persistencia y bóvedas) and Subsystem 4 (Servidor MCP multi-tenant y sesiones) of the Cangrejo platform.

## 🔒 My Identity
- Archetype: explorer
- Roles: explorer, synthesis
- Working directory: /home/dcastillo/Projects/cangrejo/.agents/teamwork/explorer_survey_3
- Original parent: 9f7c882c-f2b4-47a7-b417-e4548b827d89
- Milestone: Subsystem 3 & 4 Survey & QA Architecture Analysis

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Strictly read-only to source code: write only in /home/dcastillo/Projects/cangrejo/.agents/teamwork/explorer_survey_3/
- Verify all findings with exact file paths and line numbers
- CodeGraph first before search/grep

## Current Parent
- Conversation ID: 9f7c882c-f2b4-47a7-b417-e4548b827d89
- Updated: 2026-11-05T21:10:00Z

## Investigation State
- **Explored paths**:
  - Subsystem 3: `packages/database-d1` (`BunSqliteVault.ts`, `D1SchemaRunner.ts`, migrations `0001`–`0004`), `packages/transforms/src/formats/` (`MtgjJsonHandler.ts`, `ZipContainerCodec.ts`, `Stix21Exporter.ts`, `ForensicDossierGenerator.ts`), `packages/transforms/src/ai/CloudflareWorkersAiEngine.ts`
  - Subsystem 4: `apps/web/cloudflareWorker.ts`, `apps/web/honoApp.ts`, `apps/web/mcpStdioServer.ts`, `packages/core/src/collaboration/CollaborationRoomHub.ts`
  - Test gates: `tests/gate0` to `gate13`, `bun test` (81 pass), `bun run typecheck` (clean), `bun run moon:check` (19 tasks clean)
  - Production probes: `https://cangrejo-osint-workstation.pc911itservices.workers.dev` (`/api/health`, `/api/auth/register`, `/api/mcp`, `/api/mcp/codemode.d.ts`, `/api/vault/expedientes`, `/api/edition/status`, MCP JSON-RPC `cangrejo_session_state`, `cangrejo_session_mutate_graph`, `cangrejo_codemode_run`, `cangrejo_session_vault`, `cangrejo_import_stix21_bundle`)
- **Key findings**:
  - Subsystem 3 & 4 architectures are fully implemented, robust, and verified against production edge and local runtimes.
  - BUG 1 (High): Production D1 Foreign Key error (`SQLITE_CONSTRAINT_FOREIGNKEY`) on room switching with `cgrj_usr_*` user tokens in `honoApp.ts:4133`.
  - BUG 2 (Critical Security): AES-GCM IV reuse across all fields within an `.mtgj` document in `MtgjJsonHandler.ts:96-133`.
  - BUG 3 (Medium): `Stix21Exporter.ts:211-217` uses arbitrary first string property instead of `getPartPrimaryValue(entity)`, corrupting exported indicators.
  - BUG 4 (Low/Medium): Unbounded entity upsert in `cangrejo_session_mutate_graph` lacks quota check against `maxEntitiesPerSession`.
  - BUG 5 (Low): STIX import accepts `"0"` for `x_cangrejo_entity_id`, violating Gate 0 non-zero Guid invariant.
- **Unexplored areas**: None within Subsystems 3 & 4 scope.

## Key Decisions Made
- Executed end-to-end verification across both local environment and production deployment (`cangrejo-osint-workstation.pc911itservices.workers.dev`).
- Successfully reproduced and confirmed all 5 bugs with standalone test scripts.

## Artifact Index
- DISPATCH.md — Task assignment and instructions
- BRIEFING.md — Persistent working memory
- progress.md — Heartbeat and progress tracking
- handoff.md — Comprehensive 5-component handoff report
