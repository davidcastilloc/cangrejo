# Dispatch: Survey Explorer 2 — Subsystem 2 (Pesquisas OSINT en vivo & Conectores de red)

## Context
Original Request: /home/dcastillo/Projects/cangrejo/.agents/teamwork/ORIGINAL_REQUEST.md
Working directory: /home/dcastillo/Projects/cangrejo/.agents/teamwork/explorer_survey_2/
Role: teamwork_explorer
Target: Subsystem 2 — Pesquisas OSINT en vivo y conectores de red

## Objectives
1. Read `/home/dcastillo/Projects/cangrejo/.agents/teamwork/ORIGINAL_REQUEST.md` completely.
2. Investigate the codebase for Subsystem 2:
   - Live OSINT Pesquisas & connectors in `packages/transforms`, `packages/database-d1`, `apps/web/src/honoApp.ts`, etc.
   - Specific connectors: DNS, crt.sh (Certificate Transparency), RDAP (WHOIS), RIPEstat (BGP/ASN), Shodan InternetDB, Mempool (Bitcoin/UTXO), ThreatFox, VirusTotal, AbuseIPDB.
   - Investigate how transforms are invoked locally (CLI / API / UI) vs production (`https://cangrejo-osint-workstation.pc911itservices.workers.dev/api/transforms/*`).
   - Check rate-limiting, timeout handling, error propagation, API keys / fallback behavior, cache (`cangrejo_pesquisa_cache` singleflight TTL cache), mock modes vs real network calls.
3. Check both local code and production endpoints via curl / probing to see what's actually responding vs throwing errors.
4. Document the feature inventory, testable scenarios, observed behavior, and existing test coverage for Subsystem 2.
5. Write your findings to `/home/dcastillo/Projects/cangrejo/.agents/teamwork/explorer_survey_2/handoff.md` following the Handoff Protocol (Observation, Logic Chain, Caveats, Conclusion, Verification Method).
6. Send a completion message to the orchestrator with your report path.
