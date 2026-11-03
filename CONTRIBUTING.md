# Contributing to CANGREJO 🦀

Thank you for your interest in contributing to **CANGREJO** (*Open-Source OSINT & Forensic Link-Analysis Platform*). Whether you are building a new *Pesquisa* OSINT transform, adding entity definitions, optimizing WebGPU shaders, or improving accessibility, your contributions are welcome!

---

## 1. Architecture & Dependency Direction

Cangrejo enforces a strict inward dependency flow across its workspace packages:

1. **`@cangrejo/core`**: Pure domain graph data structures (`GraphStore`, `EntityRegistry`, `StrategicGraphMerger`, `CollectionNodeView`). Zero DOM or WebGPU dependencies.
2. **`@cangrejo/schemas`**: JSON Schema Draft 2020-12 structural validators.
3. **`@cangrejo/platform-bridge`**: Host environment abstractions (`Web PWA`, `Tauri Desktop`, `VS Code Webview`).
4. **`@cangrejo/design-tokens`**: Semantic OKLCH tokens (`DARK_TOKENS`, `LIGHT_TOKENS`), `CATEGORY_VISUAL_TOKENS`, and `ThemeBridge`.
5. **`@cangrejo/renderer`**: WebGPU/Canvas2D instanced layers, `IconAtlasManager`, `SelectionOverlay`, and 3-tier `LayoutPipeline`.
6. **`@cangrejo/transforms`**: OSINT *Pesquisa* runners, `.cgrx` PKZIP archives, and *Bóveda Cero* Zero-Knowledge encryption (`AES-256-GCM` + `AES-GMAC`).
7. **`@cangrejo/database-d1`**: Edge SQLite / Cloudflare D1 persistence.

---

## 2. Development Setup & Verification Gates

Before opening a Pull Request, verify that all typechecks and architectural gates pass locally:

```bash
# Install dependencies
npm install

# Run strict TypeScript check across all packages
npm run typecheck

# Run all 4 architectural test gates (36 tests)
npm test
```

### Performance & Quality Invariants
- **Gate 0**: 64-bit `Guid` generation must remain collision-free and non-zero (`value !== 0n`).
- **Gate 1**: `StrategicGraphMerger` must merge `10,000` entities (`5,000` updates + `5,000` inserts) in `< 120 ms` with single-step atomic Undo.
- **Gate 2**: `GraphCanvas` must render `100,000` nodes and `100,000` edges in `<= 4` GPU draw calls at `< 16.66 ms/frame` (`60 FPS`) and `< 180 MB` buffer memory.
- **Gate 3**: Zero-Knowledge *Bóveda Cero* encryption must reject any tampered entity or link topology via `AES-GMAC` verification.
- **Accessibility**: All UI changes must preserve **WCAG 2.1 AAA** text contrast ($\ge 7:1$) in both `Obsidian Studio` (dark) and `Daylight Report` (light) themes.

---

## 3. Conventional Commits & Pull Requests

We follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat(transforms): add Shodan & Censys passive service transform`
- `fix(renderer): preserve capsule hit-box bounds on high-DPI displays`
- `docs(brand): document Cangrejo de Oro priority tiers`

By submitting a contribution, you agree that your work will be licensed under the **[Apache License 2.0](./LICENSE)**.
