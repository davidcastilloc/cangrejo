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
  - **Bóveda Cero** Zero-Knowledge Selective Encryption (`PBKDF2-HMAC-SHA256` 600,000 iterations + `AES-256-GCM` with 256-byte `PKCS#7` padding + `AES-GMAC` whole-graph topological authentication).
- **`@cangrejo/design-tokens` (OKLCH Design System & `ThemeBridge`)**:
  - Dual-theme architecture: **Obsidian Studio** (Dark) and **Daylight Forensic Report** (Light) with verified **WCAG 2.1 AAA** contrast ($\ge 7:1$).
  - Venezuelan Forensic Priority Tiers: *Cangrejo de Platino*, *Cangrejo de Oro*, *Cangrejo de Plata*, and *Cangrejo de Bronce*.
