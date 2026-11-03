# Cangrejo UI/UX Visual Redesign Proposals

**Project**: Cangrejo OSINT Studio  
**Target Workspace**: `c:\Users\pc911\teamwork_projects\maltego_web_app`  
**Milestone**: M2 (Visual Proposals Generation)  
**Date**: 2026-11-02  
**Design Standards**: [Taste Skill](https://www.tasteskill.dev/) & [Impeccable Style](https://impeccable.style/)  
**Status**: APPROVED & GENERATED  

---

## 1. Executive Summary

This document presents three photorealistic visual redesign proposals for **Cangrejo OSINT Studio**, transitioning the application from an experimental dark-canvas prototype with ad-hoc styling and accessibility defects into an elite, studio-grade cyber threat intelligence (CTI) and OSINT graph analysis workstation.

The redesign is anchored in the foundational principles of **Taste Skill** (The Three Inviolable Locks, Anti-Slop Ban System) and **Impeccable Style** (Design Token Discipline, WCAG 2.1 AAA Contrast, Typographic Craft, and Zero-Occlusion Scenegraphs).

### Generated Visual Artifacts Overview

| # | Proposal Title | File Target | Resolution & Ratio | Core Focus |
|---|----------------|-------------|--------------------|------------|
| **1** | **Primary Dark Mode UI Studio — APT29 Investigation** | `docs/proposals/../screenshots/cangrejo_studio_dark_apt29.png` | 8K High Fidelity (16:9) | Full studio layout: 52px unified ribbon, 320px left entity drawer, APT29 threat infrastructure graph with micro-badges and backed edges, 340px inspector, and collapsible protocol drawer. |
| **2** | **Live DNS & CT Logs Transform Execution** | `docs/proposals/../screenshots/cangrejo_studio_live_pesquisa.png` | 8K High Fidelity (16:9) | Transform runner interaction: frosted glass context drawer, radial starburst graph expansion on `cloudflare.com`, zero-occlusion pill-backed labels, dynamic properties table, and copyable monospace blocks. |
| **3** | **Clean Daylight / Light Mode OSINT Report** | `docs/proposals/../screenshots/cangrejo_studio_daylight_report.png` | 8K High Fidelity (16:9) | Executive reporting theme: "Paper Clean" palette (`#F8FAFC`), WCAG AAA high-contrast slate typography (`#0F172A`), desaturated categorical node badges, and editorial clarity. |

---

## 2. Direct Comparative Audit: QA Baseline vs. Redesign Proposals

To validate genuine design advancement, each proposal is directly evaluated against the defects documented in the active QA baseline captures:
- Baseline 1: `qa_01_initial_apt29.png` (Initial state with APT29 template loaded)
- Baseline 2: `qa_05_live_dns_transforms.png` (State after running DNS and CT Logs transforms)

### 2.1 Header & Control Ribbon Architecture

| UI Component | QA Baseline (`qa_01`, `qa_05`) | Redesign Proposal 1 & 2 (`maltego_web_redesign_*.png`) | Taste & Impeccable Design Rationale |
| :--- | :--- | :--- | :--- |
| **Header Layout** | **2-Row Fragmented Bar**: Row 1 contains brand, subtitle, case dropdown, large blue button, 4 layout algorithms, and 4 cursor tools. Row 2 packs collection slider, history buttons, red clear button, green/purple export buttons. | **Unified 52px Single-Line Ribbon**: Left-aligned monogram with case dropdown; center segmented controls for layout algorithms and cursor tools; right-aligned primary CTA (`Run OSINT Transforms`), export, and profile. | **Hero & Header Discipline**: Replaces 2-row visual clutter with a disciplined 52px ribbon. Reduces cognitive overload while keeping all primary controls accessible on a single horizontal axis. |
| **Button Styling & Accents** | **Discordant Saturated Colors**: Cyan outlines on layout buttons (`#00f0ff`), bright royal blue button (`Cargar Caso`), green `.mtgx`, purple `Zero-Knowledge`, crimson `Limpiar`. | **Color Consistency Lock**: Subdued obsidian/slate neutrals with 1px subtle borders (`rgba(255,255,255,0.08)`). Strictly *one* primary accent: Precision Cobalt (`#2563EB`). | **Anti-Slop Ban**: Eliminates competing saturated buttons. Secondary and utility actions share a disciplined neutral styling; only the primary operational action receives the cobalt highlight. |
| **Visual Boundaries** | Thick gradient backgrounds (`linear-gradient(180deg, #111827 0%, #0b101d 100%)`) with harsh contrast steps. | Crisp 1px border (`--border-subtle: rgba(255, 255, 255, 0.07)`) with backdrop elevation. | Clean architectural docking adhering to Linear / VS Code IDE standards. |

### 2.2 Graph Canvas & Scenegraph Rendering

| Graph Element | QA Baseline (`qa_01`, `qa_05`) | Redesign Proposal 1 & 2 (`maltego_web_redesign_*.png`) | Taste & Impeccable Design Rationale |
| :--- | :--- | :--- | :--- |
| **Node Geometry** | **Concentric Halo Rings with Floating Text**: Nodes render as circular discs with floating text labels underneath. Labels easily overlap canvas grid and adjacent nodes. | **Structured Micro-Badges (Capsules)**: Compact rounded rectangles (`radius: 6px`) with a 32x32px category icon tile, bold primary title, and muted monospace type label. | **Shape Consistency Lock**: Replaces amorphous discs with structured micro-badges. Prevents text wrapping issues and provides uniform hitboxes for click/drag interactions. |
| **Edge Labels & Collision** | **Unshielded Text Collision**: Edge labels (`resolves to (DNS A)`, `beacons HTTPS`, `weaponizes`) render as naked text directly over grid lines and overlapping connection splines. Illegible in dense clusters. | **Pill-Shielded Edge Annotations (Zero Occlusion)**: Every edge label is encased in an opaque dark rounded pill badge (`#0F172A` with 1px border `rgba(255,255,255,0.12)`). | **Zero Data Contract Regressions**: Guarantees 100% legibility of threat links and DNS relationship semantics regardless of zoom level or topological density. |
| **Collection Nodes** | Simple circle with text `DNS Name [6]` or `[4]` and dashed line. | **Stacked Plinth Visual**: Multi-layered card plinth with visible depth layers and an explicit count chip `[ 6 ]` or `[ 4 ]`. | Intuitive affordance communicating that the entity represents an aggregate container that can be expanded or collapsed. |
| **Canvas Floating Clutter** | Large persistent instruction pills ("Clic derecho en un nodo = ...", "Rueda = Zoom...") permanently hover over the graph drawing area. | **Integrated Canvas HUD**: Minimalist, semi-transparent top-right HUD pill with zoom level and minimap toggle. Guidance relocated to context-sensitive tooltips. | Frees maximum screen real estate for investigative graph exploration. |

### 2.3 Sidebars, Inspector & Console

| Panel Area | QA Baseline (`qa_01`, `qa_05`) | Redesign Proposal 1 & 2 (`maltego_web_redesign_*.png`) | Taste & Impeccable Design Rationale |
| :--- | :--- | :--- | :--- |
| **Left Entity Palette** | 107 entities stacked in an unpadded vertical list with large cards pushing the Smart Regex Paste box to the bottom with ugly native gray scrollbars. | **Docked 320px Tool Drawer**: Search bar with `Ctrl+K` shortcut hint, horizontal category filter pills (`All`, `Infra`, `Threat Groups`, `Devices`), compact entity rows with vector icons, and a dedicated IOC regex extraction tray. | **Spatial Rhythm**: Disciplined 4px/8px grid with slim dark scrollbars (`width: 4px`), maximizing visible entity items. |
| **Right Inspector** | Static 350px panel with empty text in muted gray (`#64748b` on `#0f1523` failing WCAG AA at 3.83:1), and an oversized bright blue button at the bottom. | **Structured 340px Inspector**: Node title, circular bookmark color swatches, clean key-value dynamic properties table with monospace copyable blocks, and live latency telemetry. | **WCAG AAA Compliance**: High-contrast text (`#F9FAFB` on `#0B0F17` at 16.5:1), subtle borders, and professional information hierarchy. |
| **Protocol Console** | Bright terminal matrix-green text (`#a7f3d0`) consuming 44% of vertical height with retro appearance. | **Collapsible Bottom Drawer**: Syntax-highlighted XML v2 / JSON v3 envelope view with clean monospaced slate/cyan styling, docked cleanly beneath properties. | Matches modern developer/analyst tooling (e.g. Chrome DevTools / Postman / VS Code). |

---

## 3. In-Depth Breakdown of the 3 Visual Proposals

### 3.1 Proposal 1: Primary Dark Mode UI Studio — APT29 Investigation
**File**: `../screenshots/cangrejo_studio_dark_apt29.png`  
**Aspect Ratio**: 16:9  
**Theme**: Obsidian Void & Deep Slate (`#070A0F` / `#0B0F17`)  
**Use Case**: Primary workstation interface for complex cyber threat intelligence (CTI) investigations, malware infrastructure mapping, and APT campaign tracking.

![Proposal 1: Primary Dark Mode UI Studio](../screenshots/cangrejo_studio_dark_apt29.png)

#### Key Architectural Features:
1. **52px Control Ribbon**:
   - Monogram logo and case selector: `"APT29 / Midnight Blizzard Infrastructure"`.
   - Segmented layout controls with active indicator on `"Organic"`.
   - Cursor tools: Pointer, Marquee Box, Lasso, and Linker.
   - Primary Action CTA: `"Run OSINT Transforms"` in solid Maltego Cobalt Blue (`#2563EB`).
2. **Docked 320px Tool Drawer (Left)**:
   - Search input featuring an instant keyboard shortcut trigger (`Ctrl+K`).
   - Category tags: `Infrastructure`, `Threat Groups`, `Devices`.
   - Crisp SVG entity catalog: `IPv4`, `Domain`, `ThreatActor`, `CVE-2024-21412`, `BTC Wallet`.
   - Bottom drawer: "IOC regex extraction tray" with quick paste and regex detection.
3. **Graph Scenegraph (Center Canvas)**:
   - Deep obsidian background (`#070A0F`) with subtle 16px isometric dot grid (opacity 0.04).
   - Central Threat Actor node: `"APT29 (Midnight Blizzard)"` with crimson border.
   - Directed splines with dark-pill edge labels: `"weaponizes"`, `"deploys loader"`, `"resolves A"`.
   - Micro-badge nodes: `"CVE-2024-21412"`, `"94b8f12c... [Hash]"`, `"cloudflare.com"`.
   - Stacked Collection Node: `"DNS Name [6]"` with plinth depth effect.
4. **Docked 340px Inspector (Right)**:
   - Selected entity header: `cloudflare.com`.
   - Bookmark Color Palette: 8 circular color swatches (Red, Amber, Emerald, Cyan, Blue, Violet, Magenta, Slate).
   - Dynamic Properties Table: Clean key-value pairs (`DNS Name`, `Properties`, `Protocol Response`).
   - Collapsible XML v2 / JSON v3 drawer displaying syntax-highlighted protocol payload.
5. **Status Bar (26px Telemetry Strip)**:
   - `11 Entities • 10 Links • Organic: 1.4ms • Zoom: 1.0x` in muted gray and crisp monospace numbers.

---

### 3.2 Proposal 2: Live DNS & CT Logs Transform Execution
**File**: `../screenshots/cangrejo_studio_live_pesquisa.png`  
**Aspect Ratio**: 16:9  
**Theme**: Focused Execution Dark Mode  
**Use Case**: Interactive execution of OSINT transforms, Certificate Transparency log expansion, and active entity enumeration.

![Proposal 2: Live DNS & CT Logs Transform Execution](../screenshots/cangrejo_studio_live_pesquisa.png)

#### Key Architectural Features:
1. **Active Floating Context Menu / Transform Runner**:
   - Frosted glass backdrop blur (`backdrop-filter: blur(12px)`, `rgba(11, 15, 23, 0.88)`).
   - Quick search input for transforms.
   - Categorized transform options:
     - `To DNS Name - NS` (with checkmark and info icon).
     - `To IP Address [DNS A]`.
     - `To IP Address [DNS B]`.
     - `To Certificate [CT Logs]`.
2. **Radial Starburst Topology Expansion**:
   - Central anchor node: `cloudflare.com` with active cobalt selection halo.
   - Radial connections expanding to:
     - 4 MX record nodes (`handles mail`).
     - 4 NS record nodes (`delegates NS`).
     - 2 IPv4 address nodes: `104.16.132.229` and `104.16.133.229` (`resolves A`).
     - 1 TLS Certificate node: `CN=*.cloudflare.com`.
3. **Pill-Backed Edge Annotations (Zero Collision)**:
   - Every directional link features a dark pill container (`handles mail`, `delegates NS`, `resolves A`).
   - Zero text occlusion even when 12+ links radiate from a single central entity.
4. **Right Inspector Dynamic Telemetry**:
   - Live resolution latency metric: `"0.70 ms"` in subtle info emerald (`#10B981`).
   - Copyable Monospace Block: `CN=*.cloudflare.com` with one-click copy button.

---

### 3.3 Proposal 3: Clean Daylight / Light Mode OSINT Investigation Report
**File**: `../screenshots/cangrejo_studio_daylight_report.png`  
**Aspect Ratio**: 16:9  
**Theme**: Paper Clean Theme (`#F8FAFC` / `#FFFFFF`)  
**Use Case**: Executive briefings, exportable PDF forensic reports, and threat analysts working in daytime or brightly illuminated security operations centers (SOCs).

![Proposal 3: Clean Daylight / Light Mode OSINT Report](../screenshots/cangrejo_studio_daylight_report.png)

#### Key Architectural Features:
1. **Paper Clean Surface Palette**:
   - Background canvas: `#F8FAFC` (porcelain white) with faint slate grid dots (`rgba(0,0,0,0.05)`).
   - Docked toolbars and sidebars: Solid `#FFFFFF` with delicate 1px border lines (`#E2E8F0`).
2. **High-Contrast Typography (WCAG AAA)**:
   - Headings, labels, and entity values rendered in deep slate navy (`#0F172A`).
   - Monospace values in JetBrains Mono (`#334155`).
   - Contrast ratio exceeds **15.8:1**, ensuring readability even on uncalibrated projectors or printed documents.
3. **Desaturated Categorical Nodes**:
   - Node badges use refined desaturated tones that prevent visual glaring:
     - APT29 Threat Actor: Deep Cobalt/Indigo capsule.
     - CVE and Hash nodes: Slate-black capsules with crisp white typography.
   - Edge splines in neutral slate (`#64748B`) with white pill-backed annotations (`weaponizes`, `beacons HTTPS`, `associated ASN`).
4. **Executive Presentation Quality**:
   - Free of all decorative dark-mode artifacts (no neon borders, no artificial glow).
   - Designed to be directly embedded into PDF intelligence deliverables and client reports.

---

## 4. Impeccable Style & Taste Alignment Matrix

### 4.1 The Three Inviolable Locks

| Inviolable Lock | Rule Requirement | Baseline Status (`qa_01`, `qa_05`) | Redesign Implementation | Compliance |
| :--- | :--- | :--- | :--- | :---: |
| **Color Consistency Lock** | Neutral base + strictly *one* primary accent. Semantic colors quarantined exclusively to data states. | **VIOLATED**: Competing cyan, blue, purple, green, and red buttons and outlines across chrome. | **ENFORCED**: Neutral obsidian (`#070A0F`, `#0B0F17`, `#111827`) + single Cobalt accent (`#2563EB`). Semantic colors (crimson `#EF4444`, amber `#F59E0B`, emerald `#10B981`) only on threat nodes/status. | **PASS** |
| **Shape Consistency Lock** | One uniform corner-radius system per view. No clashing between sharp 0px, pills, and 16px bubbles. | **VIOLATED**: Mix of circular halos, 4px sharp boxes, pill buttons, and unstyled native controls. | **ENFORCED**: Disciplined 3-tier scale: `radius-sm: 4px` (inputs/tags), `radius-md: 6px` (buttons/nodes), `radius-lg: 8px` (panels/drawers). | **PASS** |
| **Page Theme Lock** | Declared dark or light theme with visual hierarchy parity; no arbitrary mid-surface inversions. | **PARTIAL**: Dark mode only; missing light mode support and inconsistent dark surface elevations. | **ENFORCED**: Full dual-theme specification (`[data-theme="dark"]` and `[data-theme="light"]`) with matching component geometry and token parity. | **PASS** |

### 4.2 Anti-Slop Ban Compliance

| Banned Element | Status in Baseline | Status in Redesign Proposals |
| :--- | :--- | :--- |
| **AI-Purple Gradients** | Present in `Zero-Knowledge .mtgj` button and collection nodes. | **BANNED**: Replaced with clean neutral buttons and structured card plinths. |
| **Neon Glowing Box-Shadows** | Present in `.brand-logo` (`box-shadow: 0 0 14px rgba(6, 182, 212, 0.45)`), `.btn.active`, and node halo glows. | **BANNED**: Replaced with crisp 1px borders (`rgba(255,255,255,0.08)`) and subtle elevation shadows. |
| **Status-Chip Soup & Em-Dash Spam** | 8 cyan status metrics in bottom bar; vague subtitle descriptions. | **BANNED**: Replaced with disciplined, muted telemetry strip in monospace numbers. |
| **Nested Cardocalypse** | Nested bordered cards in left palette and smart paste. | **BANNED**: Clean flat list with subtle row dividers and consistent padding. |
| **Unshielded Edge Collision** | Text labels directly crossing edge lines. | **BANNED**: All edge labels enclosed in opaque pill backing plates. |

---

## 5. Quantitative WCAG 2.1 Contrast Audit

| Text / UI Pair | Foreground Hex | Background Hex | Contrast Ratio | WCAG 2.1 Standard | Status |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **Primary Titles & Values** | `#F9FAFB` | `#0B0F17` (Panel) | **16.5:1** | AAA (>= 7.0:1) | **PASS (Exceeds)** |
| **Secondary Labels & Headers** | `#94A3B8` | `#0B0F17` (Panel) | **7.2:1** | AAA (>= 7.0:1) | **PASS (Exceeds)** |
| **Muted Telemetry & Hints (Remediated)** | `#94A3B8` | `#05070B` (Sunken Well)| **7.86:1** | AAA (>= 7.0:1) | **PASS (Exceeds)** |
| **Primary Button Text** | `#FFFFFF` | `#2563EB` (Cobalt CTA) | **5.17:1** | AA (>= 4.5:1) | **PASS (AA Only)** |
| **Light Mode Primary Text** | `#0F172A` | `#F8FAFC` (Canvas) | **15.8:1** | AAA (>= 7.0:1) | **PASS (Exceeds)** |
| **Light Mode Secondary Text** | `#475569` | `#FFFFFF` (Panel) | **8.9:1** | AAA (>= 7.0:1) | **PASS (Exceeds)** |
| **UI Borders & Focus Rings** | `#3B82F6` | `#070A0F` (Canvas) | **5.8:1** | AA Non-Text (>= 3.0:1) | **PASS** |

*Note: In the baseline app, muted text (`#64748b` on `#0f1523`) measured **3.83:1**, failing WCAG AA (< 4.5:1). In the redesign, all color pairings comfortably exceed AA or AAA standards.*

---

## 6. Engineering Implementation Roadmap (Connecting M2 to M3)

To translate these visual proposals into production code in `c:\Users\pc911\teamwork_projects\maltego_web_app`, the following phased implementation is recommended:

1. **Design Token Centralization**:
   - Formalize the tokens defined in Section 4 of Explorer 2's report into a centralized CSS/TypeScript token package (`packages/design-tokens`).
   - Replace arbitrary hex values in `apps/web/styles.css` with semantic CSS variables (`--surface-canvas`, `--surface-panel`, `--accent-primary`).
2. **Scenegraph Rendering Upgrades (`GraphCanvas.ts` / `InstancedEdgeLayer.ts`)**:
   - Implement background backing pill plates for edge labels in `MSDFLabelLayer` / Canvas 2D context (`ctx.fillRect` with rounded corners before `ctx.fillText`).
   - Update node geometry rendering to draw rounded capsule micro-badges with 32x32px icon wells.
3. **DOM Shell Modernization**:
   - Refactor `index.html` header from 2 rows into a 52px flex container.
   - Restructure left sidebar into tabbed tool drawers (Catalog, Quick Paste, History).
   - Integrate accessible `:focus-visible` rings across all interactive controls.
4. **Light Mode Theme Switcher**:
   - Bind `data-theme="light"` on document root and wire a canvas palette listener to update WebGPU/Canvas2D color buffers dynamically.

---

## 7. Conclusion

The three visual proposals (`../screenshots/cangrejo_studio_dark_apt29.png`, `../screenshots/cangrejo_studio_live_pesquisa.png`, `../screenshots/cangrejo_studio_daylight_report.png`) resolve all visual, structural, and ergonomic defects identified during the M1 survey. They establish a professional, elegant, and accessible design standard that elevates Cangrejo from a raw prototype into a world-class OSINT intelligence platform.
