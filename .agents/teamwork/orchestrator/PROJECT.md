# Project: CANGREJO OSINT & Forensic Link-Analysis Platform — QA & Audit Ecosystem

## Architecture
- **Monorepo**: Bun 1.4.3+, TypeScript 5.8 strict, Rust cdylib (`packages/layout-rs`), WebGPU/Canvas2D (`packages/renderer`), Hono Web-Standard API, Cloudflare Workers D1 + R2 + Durable Objects + Workers AI (`apps/web`).
- **Data Flow**: Dependencies flow strictly inward: `apps/web` -> `packages/renderer` / `packages/transforms` / `packages/database-d1` -> `packages/core` / `packages/schemas` / `packages/design-tokens` / `packages/platform-bridge`.
- **Runtimes**:
  - Local workstation: Bun standalone (`apps/web/bunServer.ts`), Vite workstation (`http://127.0.0.1:5173`), `bun:sqlite` WAL.
  - Production edge: Cloudflare Workers (`https://cangrejo-osint-workstation.pc911itservices.workers.dev`), Cloudflare D1 `DB`, Cloudflare R2 `CANGREJO_VAULT_R2`, Durable Objects `CangrejoSessionRoomDO`.

## Feature Inventory
| # | Feature | Subsystem | Description | Milestone | Source |
|---|---------|-----------|-------------|-----------|--------|
| F1 | 107 Entity Taxonomy | Subsystem 1 | 107 standard OSINT entities across 12 categories | M1 | survey_1 |
| F2 | Entity & Link Manipulation | Subsystem 1 | Creation, editing, dynamic property inspection, deletion | M1 | survey_1 |
| F3 | Link Inversion | Subsystem 1 | Swapping link direction (`btn-insp-reverse-link`) | M1 | survey_1 |
| F4 | Scenegraph & Camera | Subsystem 1 | Viewport matrix, world-to-screen projection, frustum culling | M1 | survey_1 |
| F5 | Selection Overlay | Subsystem 1 | 256px spatial hash point/marquee/lasso hit-testing | M1 | survey_1 |
| F6 | 3-Tier Layout Engine | Subsystem 1 | WebGPU compute, Wasm Barnes-Hut quadtree, Rust Rayon FFI | M1 | survey_1 |
| F7 | CollectionNodeView | Subsystem 1 | Virtual clustering of leaf/neighbour nodes | M1 | survey_1 |
| F8 | Omnichannel Search | Subsystem 1 | ⌘K palette search & IOC regex auto-converter | M1 | survey_1 |
| F9 | GraphViewUndoRedoManager | Subsystem 1 | Reversible graph operations (100-capacity undo stack) | M1 | survey_1 |
| F10 | ThemeBridge & Tokens | Subsystem 1 | WCAG 2.1 AAA Obsidian Studio (dark) & Daylight (light) | M1 | survey_1 |
| F11 | Multi-format Exporters | Subsystem 1 | .cgrx, STIX 2.1, Bóveda Cero .cgrj, HTML5/PDF Dossier, PNG | M1 | survey_1 |
| F12 | DNS Connector | Subsystem 2 | Live resolution of A, MX, NS, TXT records | M1 | survey_2 |
| F13 | crt.sh CT Connector | Subsystem 2 | Live Certificate Transparency subdomain enumeration | M1 | survey_2 |
| F14 | RDAP WHOIS Connector | Subsystem 2 | Live WHOIS registrant/abuse extraction via rdap.org | M1 | survey_2 |
| F15 | RIPEstat BGP Connector | Subsystem 2 | Live BGP ASN, routing prefixes, and GeoIP lookup | M1 | survey_2 |
| F16 | Shodan InternetDB & BYOK | Subsystem 2 | Zero-key open port/CPE lookup + BYOK Enterprise API | M1 | survey_2 |
| F17 | Mempool Bitcoin Tracer | Subsystem 2 | Blockchain UTXO & transaction tracer | M1 | survey_2 |
| F18 | ThreatFox CTI Connector | Subsystem 2 | abuse.ch threat intelligence IOC search | M1 | survey_2 |
| F19 | VirusTotal v3 Connector | Subsystem 2 | Domain/IP malware reputation and detection ratios | M1 | survey_2 |
| F20 | AbuseIPDB v2 Connector | Subsystem 2 | IP abuse confidence score and reporting history | M1 | survey_2 |
| F21 | Multi-protocol Transforms | Subsystem 2 | Protocol v2 XML, Protocol v3 JSON delta, UI entity array | M1 | survey_2 |
| F22 | Singleflight TTL Cache | Subsystem 2 | Cache key deduplication & 5-min TTL persistence | M1 | survey_2 |
| F23 | BunSqliteVault Engine | Subsystem 3 | Dual-engine SQLite (bun:sqlite, node:sqlite, memory) | M2 | survey_3 |
| F24 | Cloudflare D1 Persistence | Subsystem 3 | Relational schema migrations 0001–0004 & prepared statements | M2 | survey_3 |
| F25 | Two-Tier Snapshot Storage | Subsystem 3 | Inline D1 BLOB (<=1.5MB) vs R2 offload (>1.5MB) with SHA-256 | M2 | survey_3 |
| F26 | Monotonic WAL & OCC | Subsystem 3 | Atomic mutation batches with optimistic concurrency retry | M2 | survey_3 |
| F27 | Bóveda Cero Cryptography | Subsystem 3 | PBKDF2 100k + AES-256-GCM field encryption + AES-GMAC topology | M2 | survey_3 |
| F28 | ZipContainerCodec | Subsystem 3 | PKZIP container packaging for .cgrx archives | M2 | survey_3 |
| F29 | STIX 2.1 Export/Import | Subsystem 3 | OASIS STIX 2.1 bundles with x_cangrejo_custody SHA-256 manifests | M2 | survey_3 |
| F30 | Forensic Dossier Generator | Subsystem 3 | Daubert / FRE 702 sworn narrative with Ed25519 signature | M2 | survey_3 |
| F31 | Multi-tenant MCP Server | Subsystem 4 | JSON-RPC 2.0 /api/mcp endpoint with session routing | M2 | survey_3 |
| F32 | 3-Tier MCP Authentication | Subsystem 4 | CGRJ.* HMAC license, ses_sec_* D1 tokens, cgrj_usr_* user tokens | M2 | survey_3 |
| F33 | 13 MCP Tools Catalog | Subsystem 4 | Full suite of OSINT & forensic manipulation tools | M2 | survey_3 |
| F34 | MCP Resources & Templates | Subsystem 4 | 6 resources & 3 URI templates for graph/analytics inspection | M2 | survey_3 |
| F35 | MCP Prompts Catalog | Subsystem 4 | 4 guided investigation workflow prompts | M2 | survey_3 |
| F36 | Durable Objects Pinning | Subsystem 4 | CangrejoSessionRoomDO isolation per room | M2 | survey_3 |
| F37 | Real-Time SSE Streams | Subsystem 4 | Collaborative cursor & delta sync (/api/collab/rooms/:id) | M2 | survey_3 |
| F38 | Cloudflare Code Mode | Subsystem 4 | AST-parsed sandboxed pipeline execution (92.1% token savings) | M2 | survey_3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | UI & Pesquisas QA & Stress Testing | Subsystems 1 & 2: Canvas UI, Layout, Undo/Redo, Live OSINT Connectors, rate-limits | none | DONE |
| M2 | Persistence, Bóvedas & MCP Server QA | Subsystems 3 & 4: BunSqliteVault, D1/R2, Bóveda Cero, STIX 2.1, MCP tools, Code Mode | M1 | DONE |
| M3 | Master QA Synthesis & Forensic Integrity Report | Consolidate all findings into `QA_FINDINGS_REPORT.md` at project root, verify Gates 0-13, run Challenger & Auditor | M2 | DONE |

## Code Layout
- `apps/web`: Web workstation frontend (`main.ts`, `styles.css`), Hono API (`honoApp.ts`), standalone server (`bunServer.ts`), Cloudflare Worker (`cloudflareWorker.ts`).
- `packages/core`: Tripartite `GraphStore`, 64-bit non-zero `Guid`, 107 OSINT entities, converters, merger, analytics, collection views, undo/redo.
- `packages/renderer`: Catatumbo WebGPU/Canvas2D renderer, instanced buffers, icon atlas, layout pipeline.
- `packages/layout-rs`: Native Rust Barnes-Hut force-directed layout cdylib.
- `packages/transforms`: Live OSINT transforms, STIX 2.1, Bóveda Cero codecs, Forensic Dossier.
- `packages/database-d1`: BunSqliteVault (bun:sqlite / Cloudflare D1 / R2 / memory fallback).
- `packages/schemas`: Zod schemas with `.passthrough()`.
- `packages/design-tokens`: Obsidian Studio (dark) and Daylight Forensic Report (light) OKLCH tokens.
- `packages/platform-bridge`: Host abstraction for Web PWA, Tauri, VS Code.
