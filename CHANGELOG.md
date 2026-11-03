# Changelog

All notable changes to **CANGREJO** (`@cangrejo/*`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-11-03 — *"El Comisario IA & Open-Core Enterprise"*

### Added
- **Odoo-Style Open-Core + Cloud SaaS Edition Engine (`Gate 7` & `Gate 8`)**:
  - Three-tier edition licensing (`COMMUNITY` Open-Source `Apache-2.0`, `ORO_PRO` `500 CR`, `PLATINO_ENTERPRISE` `5,000 CR`) with cryptographic `HMAC-SHA256` token verification (`CGRJ.<TIER>.<payload>.<hmacHex>`) and Stripe/LemonSqueezy billing webhook (`POST /api/billing/webhook`).
  - White-Label Forensic Dossier generation, **Radar Cangrejo 24/7** continuous infrastructure drift detection (`POST /api/radar/watches` & `POST /api/radar/scan`), commercial OSINT connectors (`Shodan`, `VirusTotal v3`, `AbuseIPDB`) with `BYOK` + `Cloud Pool`, and **Smart IOC Paste-to-Graph** raw text ingestion (`POST /api/ingest/raw-text`).
- **Cloudflare Workers AI Forensic Engine (`F1`–`F5`) & Universal CPU Fallback (`Gate 9` & `Gate 10`)**:
  - `CloudflareWorkersAiEngine` supporting Cloudflare Workers AI native bindings (`env.AI`), REST API, and zero-NPU/zero-GPU universal CPU execution (`NONE_UNIVERSAL_CPU_OR_EDGE`), plus in-memory **Bóveda Cero** field sanitization.
  - **`F1`** (`POST /api/ai/unpack-iocs`): Cognitive IOC Unpacker & Defanger (`hxxps://`, `[.]`, `[@]`) with exact UTF-8 byte offsets `[startByteOffset, endByteOffset]`.
  - **`F2`** (`POST /api/ai/latent-links`): Latent Link Discovery via Cloudflare Vectorize (`<= 63`-byte namespace `cgrj_<32hex>`) + SQLite lexical matching fused with **Reciprocal Rank Fusion ($k=60$)**.
  - **`F3`** (`POST /api/ai/anomalies`): Structural Campaign Anomaly Classifier (`CRYPTO_PEEL_CHAIN_LAUNDERING`, `FAST_FLUX_INFRASTRUCTURE`).
  - **`F4`** (`POST /api/ai/daubert-synthesis` & Sección 4 in `ForensicDossierGenerator`): Court-admissible **Daubert / FRE 702** narrative synthesis with Map-Reduce PageRank context pruning (`<= 24k` tokens) and asymmetric **`Ed25519`** digital signature attestation.
  - **`F5`** (`POST /api/ai/copilot`): Contextual Forensic Graph Copilot (*"El Comisario IA"*) with `[EntityID]` citations, tool-calling suggestions, and one-click AI-to-Graph materialization (`#btn-ai-materialize`).
  - `wrangler.jsonc` & `apps/web/cloudflareWorker.ts` serverless edge entrypoint.
- **Native MCP Server, Bidirectional OASIS STIX 2.1 Importer & MITRE ATT&CK v15 (`Gate 11`)**:
  - Web-Standard **Model Context Protocol (`MCP JSON-RPC 2.0`)** server at `GET / POST /api/mcp` (`initialize`, `tools/list`, `tools/call`) exposing 6 forensic tools to external AI agents.
  - `Stix21Exporter.importBundle` (`POST /api/import/stix21`) with cryptographic `SHA-256` `x_cangrejo_custody` verification and tamper detection.
  - `analyzeMitreAttackAndTimeline` (`POST /api/analytics/mitre-attack`) mapping graph topologies to **MITRE ATT&CK Enterprise v15.1** tactics/techniques and ordered kill-chain chronology.

---

## [1.0.0] — 2026-11-03 — *"Cangrejo de Oro"*

### Added
- **`@cangrejo/core` (Expediente Tripartite Graph Engine)**:
  - Strictly decoupled `GraphStructureStore` (CSR adjacency lists), `GraphDataStore` (typed `PropertyBag`), and `GraphLayoutStore` (`Float32Array` coordinates & pin locks).
  - `StandardEntitiesCatalog` with **107 OSINT & Cyber Threat Intelligence entity specifications** across 12 categories and **17 regex auto-detection IOC converters** (`IPv4`, `IPv6`, `Domain`, `URL`, `Email`, `Phone`, `MAC`, `ASN`, `CVE`, `SHA-256`, `Bitcoin`, `Ethereum`, `X.509`, `GPS`, `Social`).
  - `StrategicGraphMerger` implementing `STRICT` and `LOOSE` property matching rules, conflict resolution policies (`REPLACE`, `KEEP_ORIGINAL`, `MERGE`), and atomic `UndoRedoCommandManager` batching (`10,000` entities merged in `< 120 ms`).
  - `CollectionNodeView` topological clustering (`NeighbourRule`, `ChainingRule`, `StandAloneRule`) and `ViewLinkRouter` proxy edge bundling.
- **`@cangrejo/renderer` (Catatumbo WebGPU Renderer & 3-Tier Layout Engine)**:
  - `IconAtlasManager` (`4096×4096` UV slot packer + 24 forensic bookmark colors).
  - 4 custom `WGSL` shaders (`node_instanced.vert.wgsl`, `edge_instanced.vert.wgsl`, `msdf_text.frag.wgsl`, `layout_nbody.compute.wgsl`).
  - `64-byte` instanced node buffer & `48-byte` instanced edge buffer supporting **100,000 nodes & 100,000 edges at 60 FPS (`<= 4` GPU draw calls)**.
  - 3-Tier `LayoutPipeline` (`Organic ForceAtlas2 Barnes-Hut Quadtree`, `Hierarchical Sugiyama DAG`, `Circular`, `Block`).
- **`@cangrejo/transforms` (Pesquisa OSINT & Bóveda Cero Vault)**:
  - Live OSINT execution server (`DNS A/AAAA/MX/NS`, `Certificate Transparency SAN`, `BGP/ASN`, `RDAP WHOIS`, `Threat Intel CVE/SHA-256`, `UTXO Crypto Trace`).
  - `.cgrx` PKZIP + GraphML binary archive codec and `.cgrj` JSON Schema 2020-12 serializer.
  - **Bóveda Cero** Zero-Knowledge Selective Encryption (`PBKDF2-HMAC-SHA256` 600,000 iterations + `AES-256-GCM` with 256-byte `PKCS#7` padding + `AES-GMAC` whole-graph topological authentication) with symmetric decryption (`POST /api/import/mtgj-decrypted`).
  - **OASIS STIX 2.1 Bundle Exporter (`Stix21Exporter`)** with FIPS 180-4 SHA-256 Chain-of-Custody manifest (`x_cangrejo_custody`) and **Printable HTML5/PDF Forensic Dossier Generator (`ForensicDossierGenerator`)**.
- **`cangrejo-layout-rs` (Native Rust `cdylib` + Zero-Copy `bun:ffi`)**:
  - Contiguous-arena `BarnesHutQuadtree` ($\theta = 0.8$, $O(V \log V)$) + Rayon multi-core parallel force-directed layout (`cangrejo_barnes_hut_stride6_step` C-ABI) bridged directly into `NativeRayonBridge` via `bun:ffi` (`dlopen` + `ptr(Float32Array)`).
- **Forensic Graph Analytics, Singleflight Vault & Standalone Production Server**:
  - `ForensicGraphAnalytics` in `@cangrejo/core` (`findShortestForensicPath` bidirectional BFS, `computeForensicPageRank` power-iteration centrality, `detectDirectedCycles` Tarjan/Johnson circuit detection) + Golden Path (`#F59E0B`) canvas highlighting and 60 FPS Spatial Viewport Frustum Culling (`queryVisibleFrustum`).
  - `BunSqliteVault` (`bun:sqlite` WAL mode) with Singleflight in-flight Promise deduplication (`inFlightPesquisas`) and SQLite TTL response cache (`X-Cangrejo-Cache: HIT | MISS`), `CollaborationRoomHub` multi-analyst delta rooms, and standalone `Bun.serve()` production entrypoint (`apps/web/bunServer.ts`).
- **`@cangrejo/design-tokens` (OKLCH Design System & `ThemeBridge`)**:
  - Dual-theme architecture: **Obsidian Studio** (Dark) and **Daylight Forensic Report** (Light) with verified **WCAG 2.1 AAA** contrast ($\ge 7:1$).
  - Venezuelan Forensic Priority Tiers: *Cangrejo de Platino*, *Cangrejo de Oro*, *Cangrejo de Plata*, and *Cangrejo de Bronce*.
