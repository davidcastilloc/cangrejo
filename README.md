<div align="center">

<img src="./docs/brand/cangrejo_hero_banner.png" alt="CANGREJO — Open-Source OSINT & Forensic Link-Analysis Engine" width="100%" />

<br />

# 🦀 CANGREJO

### **Untangle the Impossible Case**
*High-Performance Open-Source OSINT, Threat Intelligence & Forensic Link-Analysis Graph Platform*

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-F59E0B.svg?style=flat-square)](./LICENSE)
[![Runtime: Bun 1.4](https://img.shields.io/badge/Runtime-Bun%201.4.3-FBF0DF.svg?style=flat-square&logo=bun&logoColor=000000)](./.prototools)
[![Monorepo: moon 2.6](https://img.shields.io/badge/Monorepo-moon%202.6.5-6366F1.svg?style=flat-square)](./.moon/workspace.yml)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8%20Strict-2563EB.svg?style=flat-square)](./tsconfig.json)
[![WebGPU / WGSL](https://img.shields.io/badge/Renderer-WebGPU%20%2B%20WGSL%2060FPS-22D3EE.svg?style=flat-square)](./packages/renderer)
[![Zero-Knowledge Vault](https://img.shields.io/badge/Vault-AES--256--GCM%20%2B%20GMAC-10B981.svg?style=flat-square)](./packages/transforms)
[![Accessibility](https://img.shields.io/badge/WCAG%202.1-AAA%20Verified-8B5CF6.svg?style=flat-square)](./docs/brand/BRAND_IDENTITY.md)

**[English](./README.md)** · **[Español (Documentación Oficial y Glosario Venezolano)](./README.es.md)** · **[Brand Identity Manifesto](./docs/brand/BRAND_IDENTITY.md)** · **[Architecture & UI/UX Specs](./docs/ui_ux_accessibility_and_css_framework_recommendations.md)**

</div>

---

## 🇻🇪 The Story Behind the Name: *El Cangrejo de Oro*

In Venezuelan scientific criminalistics and investigative lore — dating back to **1971–1972** in the historic *Cuerpo Técnico de Policía Judicial (PTJ)* and later the *CICPC* — detectives coined the term ***"Caso Cangrejo"*** (*"Crab Case"*) to describe an extraordinarily complex, labyrinthine investigation whose clues, shell entities, and actors appear to move sideways and backwards in an impenetrable tangle, just like the erratic walk of a crab.

To honor investigators who untangle the most enigmatic, seemingly impossible cases through scientific rigor, forensic deduction, and link analysis, Venezuela established its highest investigative distinction: the legendary **Premio Cangrejo de Oro** (*Golden Crab Award* — alongside *Platino*, *Plata*, and *Bronce*).

**CANGREJO** brings that half-century investigative philosophy to global **Open-Source Intelligence (OSINT)**, **Cyber Threat Intelligence (CTI)**, and **Digital Forensics**:
- **Sideways-Moving Adversaries → Clear Directed Graphs**: When threat actors (`APT29`, ransomware syndicates, illicit financial networks) hide behind fast-flux DNS, BGP prefixes, mixers, and shell companies, **Cangrejo** untangles the web in real time.
- **Systems-Grade Engineering**: Built from the ground up in strict TypeScript, WebGPU (`WGSL`), and a 3-Tier layout pipeline (`WebGPU Compute` + `Wasm Barnes-Hut/Sugiyama` + `Native Rayon`).

---

## ✨ Visual Tour (`Obsidian Studio` & `Daylight Forensic Report`)

<p align="center">
  <img src="./docs/screenshots/cangrejo_studio_dark_apt29.png" alt="Cangrejo Obsidian Studio Dark Mode — APT29 Investigation" width="100%" />
  <em><strong>Obsidian Studio (Dark Mode)</strong> — Single-line 52px Investigator Ribbon, 168×42px Micro-Badge Capsule Nodes, Stacked Collection Plinths, and Overview Radar Minimap.</em>
</p>

<p align="center">
  <img src="./docs/screenshots/cangrejo_studio_live_pesquisa.png" alt="Cangrejo Live Pesquisa OSINT Execution & Zero-Knowledge Vault" width="49%" />
  <img src="./docs/screenshots/cangrejo_studio_daylight_report.png" alt="Cangrejo Daylight Forensic Report Mode (WCAG 2.1 AAA)" width="49%" />
</p>

---

## 🏗️ System Architecture & Monorepo Packages

Cangrejo enforces a strict inward-flowing clean architecture across **9 polyglot moonrepo projects** (`7` `@cangrejo/*` TypeScript packages, `1` native Rust `cdylib` crate `cangrejo-layout-rs`, and `1` web workstation & Hono/Bun server `@cangrejo/web`):

```mermaid
flowchart TD
  subgraph UI["Web Workstation & Hono/Bun Server (apps/web)"]
    Ribbon["52px Investigator Command Ribbon + Collab Presence"]
    CanvasUI["Interactive 60 FPS Scenegraph Canvas + Frustum Culling + Radar Minimap"]
    Inspector["Dynamic Ontology Inspector, Forensic Analytics & Pesquisa Telemetry"]
    HonoAPI["Hono Web-Standard API + Standalone Bun.serve Production Host"]
  end

  subgraph Packages["@cangrejo/* Polyglot Monorepo (TypeScript + Rust)"]
    Tokens["@cangrejo/design-tokens\nOKLCH Tokens • ThemeBridge • WCAG AAA"]
    Renderer["@cangrejo/renderer\n64B Node / 48B Edge Instanced Buffers • WGSL Shaders • Frustum Culling"]
    LayoutRS["cangrejo-layout-rs (Rust cdylib)\nO(V log V) Barnes-Hut Quadtree • Rayon SIMD • Zero-Copy bun:ffi"]
    Transforms["@cangrejo/transforms\nLive DNS/CT/RDAP/BGP • STIX 2.1 • HTML5 Dossier • Bóveda Cero AES-256-GCM"]
    Core["@cangrejo/core\nTripartite GraphStore • 107 Entities • ForensicGraphAnalytics • CollaborationRoomHub"]
    Schemas["@cangrejo/schemas\nJSON Schema 2020-12 + Zod (.passthrough) Contracts"]
    Bridge["@cangrejo/platform-bridge\nWeb PWA • Tauri Desktop • VS Code Host Abstraction"]
    D1["@cangrejo/database-d1\nBunSqliteVault (WAL + Singleflight TTL Cache) & Cloudflare D1"]
  end

  UI --> Tokens
  UI --> Renderer
  UI --> Transforms
  UI --> HonoAPI
  Renderer --> Core
  Renderer --> LayoutRS
  Transforms --> Core
  Transforms --> Schemas
  Renderer --> Bridge
  HonoAPI --> D1
```

| Project | Responsibility & Key Engineering Highlights |
| :--- | :--- |
| [`@cangrejo/core`](./packages/core) | **Expediente Tripartite Graph Engine & Forensic Analytics**: Strictly separated `GraphStructureStore` (CSR adjacency), `GraphDataStore` (typed property bags), and `GraphLayoutStore` (`Float32Array` coordinates + pin locks). Includes **107 standard OSINT entities**, **17 IOC Regex auto-detection converters**, `StrategicGraphMerger` (`STRICT`/`LOOSE` rules, 10k merge in `< 120ms`), `ForensicGraphAnalytics` (Shortest Path BFS, PageRank centrality, Directed Cycle detection), `CollaborationRoomHub`, `CollectionNodeView` clustering, and atomic `UndoRedoCommandManager`. |
| [`@cangrejo/renderer`](./packages/renderer) | **Catatumbo WebGPU Renderer, Frustum Culling & 3-Tier Layout Engine**: `4096×4096` `IconAtlasManager`, 4 custom `WGSL` shaders, `64-byte` node & `48-byte` edge GPU buffers, 60 FPS viewport `queryVisibleFrustum` culling, Golden Path (`#F59E0B`) overlay, spatial hash grid `SelectionOverlay` (marquee + polygon lasso), and `NativeRayonBridge` zero-copy `bun:ffi` integration. |
| [`cangrejo-layout-rs`](./packages/layout-rs) | **Native Rust Barnes-Hut Quadtree & Rayon Engine (`cdylib`)**: Contiguous-arena `BarnesHutQuadtree` ($\theta = 0.8$, $O(V \log V)$) + Rayon multi-core force-directed layout (`cangrejo_barnes_hut_stride6_step` C-ABI) invoked directly via `bun:ffi` `ptr(Float32Array)`. |
| [`@cangrejo/transforms`](./packages/transforms) | **Pesquisa Transform, STIX 2.1, Forensic Dossier & Bóveda Cero Engine**: Live OSINT execution (`DNS A/AAAA/MX/NS/TXT`, live `crt.sh` Certificate Transparency, live `rdap.org` RFC 9083 WHOIS, `BGP/ASN`, `Threat Intel CVE/SHA-256`, `UTXO Crypto Trace`), OASIS **STIX 2.1 Bundle Exporter (`Stix21Exporter`)**, **Printable HTML5/PDF Forensic Dossier (`ForensicDossierGenerator`)**, PKZIP `.cgrx` archive codec, and **Bóveda Cero** Zero-Knowledge Selective Encryption (`PBKDF2-HMAC-SHA256` 600k iterations + `AES-256-GCM` + `AES-GMAC` topology signature). |
| [`@cangrejo/design-tokens`](./packages/design-tokens) | **OKLCH Design System & `ThemeBridge`**: Dual-theme tokens (`Obsidian Studio` dark & `Daylight Forensic Report` light) with verified **WCAG 2.1 AAA** contrast ($\ge 7:1$) and single-frame DOM + Canvas synchronization. |
| [`@cangrejo/schemas`](./packages/schemas) | **JSON Schema Draft 2020-12 & CSP-Safe `Zod` Contracts**: Strict structural validation for `.cgrj` graph documents, encrypted envelopes, and HTTP boundaries with mandatory `.passthrough()` zero-pruning invariants. |
| [`@cangrejo/platform-bridge`](./packages/platform-bridge) | **Multi-Host Runtime Bridge**: Unified interface (`IPlatformBridge`) for Web PWA, Tauri Native Desktop (Rayon multi-core offload), and VS Code Webview extensions. |
| [`@cangrejo/database-d1`](./packages/database-d1) | **`BunSqliteVault` (`bun:sqlite` WAL) & Cloudflare D1 Persistence**: Native SQLite WAL storage for Expedientes, audit trail, and persistent Pesquisa TTL cache (`cangrejo_pesquisa_cache`). |
| [`@cangrejo/web`](./apps/web) | **Interactive OSINT Workstation & Standalone `Bun.serve` Host**: Vite frontend workstation + Hono Web-Standard API (`apps/web/honoApp.ts`) + standalone single-command production server (`apps/web/bunServer.ts`). |

---

## ⚡ Verified Performance & Security Gates (Gates 0–6)

Every change is verified against **53 deterministic automated tests (`50` TypeScript tests + `3` Rust `cargo test` tests) across 7 architectural gates**:

| Gate Suite | Benchmark / Invariant | Verified Result |
| :--- | :--- | :--- |
| **Gate 0: Foundations** (`tests/gate0-foundations.test.ts`) | `100,000` 64-bit cryptographic `Guid` generations (`0 collisions`, non-zero invariant) + JSON Schema 2020-12 validation | **11/11 PASS** |
| **Gate 1: Graph Engine** (`tests/gate1-graph-engine.test.ts`) | `10,000`-entity `StrategicGraphMerger` (`5,000` updates + `5,000` inserts) + single-step atomic Undo + `CollectionNodeView` clustering | **13/13 PASS** (`< 120 ms`) |
| **Gate 2: Renderer & Layout** (`tests/gate2-renderer-layout.test.ts`) | Scale S4 benchmark: `100,000` nodes & `100,000` edges @ 60 FPS (`<= 4` GPU draw calls, `< 16.66 ms/frame`, `< 180 MB` VRAM) | **6/6 PASS** |
| **Gate 3: Transforms & Vault** (`tests/gate3-transforms-formats.test.ts`) | Zero-Knowledge `AES-256-GCM` + `AES-GMAC` tamper detection, `.cgrx` PKZIP round-trip, and `OAuth 2.0 PKCE` (RFC 7636) | **6/6 PASS** |
| **Gate 4: Stack Enhancements** (`tests/gate4-stack-enhancements.test.ts`) | Hono Web-Standard API, `BunSqliteVault` WAL persistence, CSP-safe `Zod` `.passthrough()` contracts, and `CollaborationRoomHub` | **5/5 PASS** |
| **Gate 5: Forensic Optimizations** (`tests/gate5-forensic-optimizations.test.ts`) | Native Rust `bun:ffi` Barnes-Hut Quadtree ($O(V \log V)$, `< 15 ms`), `ForensicGraphAnalytics`, Frustum Culling, Singleflight TTL cache & OASIS STIX 2.1 export | **5/5 PASS** (+ **3/3 Rust**) |
| **Gate 6: Production Completeness** (`tests/gate6-production-completeness.test.ts`) | Symmetric `.cgrj` Bóveda Cero decryption (`AES-GMAC`), live DNS TXT (`SPF`/`DMARC`), live collaboration deltas, HTML5 Dossier & standalone `Bun.serve` | **4/4 PASS** |

---

## 🚀 Quick Start (Powered by **Bun**, **Rust** & **moonrepo**)

Cangrejo uses **[Bun (`v1.4.3+`)](https://bun.sh)** as its primary high-speed JavaScript/TypeScript runtime, **Rust (`cargo`)** for native SIMD layout acceleration, and **[moon (`v2.6.5+`)](https://moonrepo.dev)** for content-addressable DAG caching across all **9 polyglot projects**:

```bash
# 1. Install workspace dependencies in milliseconds via Bun
bun install

# 2. Inspect the 9-project polyglot moon dependency graph
bun run moon:projects

# 3. Execute all 19 DAG tasks (typecheck + Rust build + Vite build + Gates 0-6) via moon
#    • Warm cached run: ~248 ms ("❯❯❯❯ to the moon")
bun run moon:check

# 4. Run native Bun test runner directly (50 TS tests across Gates 0-6)
bun test

# 5. Launch the interactive Cangrejo OSINT Workstation on http://127.0.0.1:5173
bun run dev

# 6. Or build & run the standalone single-command Bun production server on http://127.0.0.1:3000
bun run build && bun run start
```

Open **`http://127.0.0.1:5173/`** in your browser to explore:
- **4 Preloaded *Casos Cangrejo*** (*APT29 Infrastructure*, *Live DNS Surface*, *Ransomware BTC Mixer Trace*, and *250-Node Barnes-Hut Stress Benchmark*).
- **Live Pesquisa OSINT Transforms**: Right-click any node (or click **Ejecutar Pesquisa OSINT**) to query real Node.js DNS `A`/`MX`/`NS` records, Certificate Transparency SANs, BGP/ASN prefixes, RDAP WHOIS, and threat indicators.
- **Instant Theme Switching**: Toggle between **Obsidian Studio (Dark)** and **Daylight Forensic Report (Light)** with zero layout shift.

---

## 🛡️ Clean-Room Independence & Trademark Notice

**CANGREJO** is an independent, clean-room open-source software project developed from first-principles graph theory, public RFCs, and open cryptographic standards (`WebGPU`, `GraphML`, `JSON Schema 2020-12`, `NIST SP 800-38D AES-GCM/GMAC`, `RFC 7636 PKCE`).

> **Legal Notice**: *Cangrejo* is **not** affiliated with, endorsed by, or sponsored by Maltego Technologies GmbH, Palantir Technologies, or the Venezuelan CICPC. Any legacy format interoperability (such as optional `.mtgx`/`.mtgl` GraphML import) is provided strictly for analyst data portability under fair-use interoperability principles.

---

## 🤝 Contributing, Security & License

- **Contributing Guide**: Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) to learn how to add new *Pesquisa Transforms*, entity definitions, and layout algorithms.
- **Security Policy**: Read [`SECURITY.md`](./SECURITY.md) for our Zero-Knowledge threat model and responsible vulnerability disclosure process.
- **Code of Conduct**: Governed by the [`Contributor Covenant v2.1`](./CODE_OF_CONDUCT.md).
- **License**: Distributed under the **[Apache License 2.0](./LICENSE)**.
