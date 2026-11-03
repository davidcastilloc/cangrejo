# Contributing to CANGREJO 🦀

Thank you for your interest in contributing to **CANGREJO** (*Open-Source OSINT & Forensic Link-Analysis Platform*). Whether you are building a new *Pesquisa* OSINT transform, adding entity definitions, optimizing WebGPU shaders, or improving accessibility, your contributions are welcome!

---

## 1. Architecture & Dependency Direction (9 Polyglot Projects)

Cangrejo enforces a strict inward dependency flow across its **9 polyglot moonrepo projects**:

1. **`@cangrejo/core`** (`packages/core`): Pure domain graph data structures (`GraphStore`, `EntityRegistry`, `StrategicGraphMerger`, `ForensicGraphAnalytics`, `CollectionNodeView`, `CollaborationRoomHub`, `UndoRedoCommandManager`). Zero DOM or WebGPU dependencies.
2. **`@cangrejo/schemas`** (`packages/schemas`): JSON Schema Draft 2020-12 & CSP-safe `Zod` (`.passthrough()`) structural validators.
3. **`@cangrejo/platform-bridge`** (`packages/platform-bridge`): Host environment abstractions (`Web PWA`, `Tauri Desktop`, `VS Code Webview`).
4. **`@cangrejo/design-tokens`** (`packages/design-tokens`): Semantic OKLCH tokens (`DARK_TOKENS`, `LIGHT_TOKENS`), `CATEGORY_VISUAL_TOKENS`, and `ThemeBridge`.
5. **`@cangrejo/renderer`** (`packages/renderer`): WebGPU/Canvas2D instanced layers (`64B` node / `48B` edge strides), `IconAtlasManager`, `queryVisibleFrustum`, `SelectionOverlay`, 3-tier `LayoutPipeline`, and `NativeRayonBridge`.
6. **`cangrejo-layout-rs`** (`packages/layout-rs`): Native Rust `cdylib` (`cangrejo_barnes_hut_stride6_step`) contiguous-arena Barnes-Hut Quadtree ($O(V \log V)$) + Rayon SIMD layout via zero-copy `bun:ffi`.
7. **`@cangrejo/transforms`** (`packages/transforms`): Live OSINT *Pesquisa* runners, OASIS STIX 2.1 bidirectional codec, printable HTML5/PDF Forensic Dossier (`Daubert / FRE 702` + `Ed25519`), `.cgrx` PKZIP archives, and *Bóveda Cero* Zero-Knowledge encryption (`AES-256-GCM` + `AES-GMAC`).
8. **`@cangrejo/database-d1`** (`packages/database-d1`): `BunSqliteVault` (`bun:sqlite` WAL + Singleflight TTL cache) & Cloudflare D1 persistence.
9. **`@cangrejo/web`** (`apps/web`): Interactive Vite OSINT workstation (`main.ts`), Hono Web-Standard API (`honoApp.ts`, including `/api/mcp` JSON-RPC 2.0 & Cloudflare Workers AI `F1`–`F5`), standalone `Bun.serve` (`bunServer.ts`), and Cloudflare Worker (`cloudflareWorker.ts`).

---

## 2. Development Setup & Verification Gates (Gates 0–11)

Before opening a Pull Request, verify that all typechecks, builds, and architectural gates pass locally via **Bun** and **moonrepo**:

```bash
# Install workspace dependencies
bun install

# Run strict TypeScript check across all packages
bun run typecheck

# Run all 12 architectural test gates (67 TypeScript tests)
bun test

# Run the complete 19-task polyglot DAG (TypeScript + Vite + Rust cargo test/build)
bun run moon:check
```

### Performance & Quality Invariants
- **Gate 0**: 64-bit `Guid` generation must remain collision-free and non-zero (`value !== 0n`).
- **Gate 1**: `StrategicGraphMerger` must merge `10,000` entities (`5,000` updates + `5,000` inserts) in `< 120 ms` with single-step atomic Undo.
- **Gate 2**: `GraphCanvas` must render `100,000` nodes and `100,000` edges in `<= 4` GPU draw calls at `< 16.66 ms/frame` (`60 FPS`) and `< 180 MB` buffer memory.
- **Gate 3 & Gate 6**: Zero-Knowledge *Bóveda Cero* encryption must reject any tampered entity or link topology via `AES-GMAC` verification.
- **Gate 4**: All Zod boundary schemas must preserve `.passthrough()` so custom analyst properties are never pruned.
- **Gates 5, 9, 10 & 11**: Native Rust `bun:ffi` Barnes-Hut layout (`< 15 ms`), Cloudflare Workers AI Forensics (`F1`–`F5`) with `Ed25519` Daubert attestation, and native MCP JSON-RPC 2.0 (`/api/mcp`) + STIX 2.1 custody verification must pass deterministically.
- **Accessibility**: All UI changes must preserve **WCAG 2.1 AAA** text contrast ($\ge 7:1$) in both `Obsidian Studio` (dark) and `Daylight Forensic Report` (light) themes.

---

## 3. Conventional Commits & Pull Requests

We follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat(transforms): add Shodan & Censys passive service transform`
- `fix(renderer): preserve capsule hit-box bounds on high-DPI displays`
- `docs(brand): document Cangrejo de Oro priority tiers`

By submitting a contribution, you agree that your work will be licensed under the **[Apache License 2.0](./LICENSE)**.
