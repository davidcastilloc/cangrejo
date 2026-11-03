# Changelog

All notable changes to **CANGREJO** (`@cangrejo/*`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
