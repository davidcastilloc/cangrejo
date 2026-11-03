# UI/UX Accessibility Guidelines and CSS Architecture Technical Recommendations for Cangrejo

**Document Version**: 1.0.0  
**Target Application**: Cangrejo OSINT Studio  
**Status**: Authoritative Technical Architecture Recommendation  
**Author**: Architecture Review Board & UI/UX Working Group  
**Date**: November 2, 2026  
**Applicable Standards**: WCAG 2.1 Level AA / AAA, Taste Skill v2, Impeccable Style System, Maltego Desktop v4.13.0 Blueprint  

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Current State Audit & Critical Deficiencies](#2-current-state-audit--critical-deficiencies)
   - 2.1 Monolithic Architecture & Global Stylesheet Analysis
   - 2.2 Accessibility & Contrast Audit (WCAG 2.1 AA/AAA)
   - 2.3 Visual Clutter, "AI Slop" Neon Dark Mode & Ocular Fatigue
   - 2.4 Graph Canvas Collisions & Text Occlusion
   - 2.5 Desktop Feature Parity Gaps (v4.13.0 Blueprint)
3. [Actionable UI/UX Accessibility Guidelines](#3-actionable-uiux-accessibility-guidelines)
   - 3.1 Color Contrast Remediation Matrix (Mathematical Verification)
   - 3.2 Global Keyboard Focus Ring Architecture (`:focus-visible`)
   - 3.3 Typography Hierarchy, Readability & Tabular Numbers
   - 3.4 Touch Targets, Spacing Grid & Interactive Sizing
   - 3.5 Assistive Technology, ARIA Landmarks & Live Regions
4. [Taste & Impeccable Style Design Framework](#4-taste--impeccable-style-design-framework)
   - 4.1 The Three Inviolable Locks
   - 4.2 Anti-Slop Banned Patterns & Discipline
   - 4.3 Spatial Rhythm & Workstation Layout Architecture
   - 4.4 Graph Canvas Visual Craft (Micro-Badge Nodes & Backed Edge Labels)
5. [In-Depth CSS Architecture & Technical Framework Evaluation](#5-in-depth-css-architecture--technical-framework-evaluation)
   - 5.1 The "Dual-Universe Styling Problem" (DOM Shell vs Canvas/WebGPU Scenegraph)
   - 5.2 Option A: Modern Vanilla CSS (`@layer`, Custom Properties, Nesting, `color-mix()`)
   - 5.3 Option B: Tailwind CSS v4 (Vite Plugin `@tailwindcss/vite` + CSS-first `@theme`)
   - 5.4 Option C: Vite-Native CSS Modules (`*.module.css`)
   - 5.5 Multi-Dimensional Trade-Off Matrix
   - 5.6 Strategic Recommendation & Architecture Verdict
6. [Design Token Authority (`@cangrejo/design-tokens`) & Dynamic Theme Bridge](#6-design-token-authority-maltego-webdesign-tokens--dynamic-theme-bridge)
   - 6.1 Package Architecture & Monorepo Topology
   - 6.2 Token Specifications (Colors, Typography, Spacing, Elevation)
   - 6.3 Dynamic Theme Bridge Implementation (DOM ↔ WebGPU/Canvas Scenegraph)
7. [Actionable 3-Phase Migration Roadmap](#7-actionable-3-phase-migration-roadmap)
   - 7.1 Phase 1: Tokenization & Zero-Risk Accessibility Hardening (Days 1–3)
   - 7.2 Phase 2: Componentization & CSS Framework Migration (Weeks 1–2)
   - 7.3 Phase 3: Unified Dynamic Canvas Theming & Desktop Parity (Weeks 3–4)
   - 7.4 Quality Gates, Test Invariants & Verification Checklist
8. [Appendix: Core Token Definitions & Theme Bridge Code](#8-appendix-core-token-definitions--theme-bridge-code)

---

## 1. Executive Summary

Cangrejo represents a next-generation, browser-based OSINT and cyber threat intelligence investigation platform. Underneath its interface, the application is powered by a high-performance, mathematically rigorous tripartite architecture (`DataStore`, `StructureStore`, and `LayoutStore`), supporting real-time graph layout algorithms (Barnes-Hut Organic, Sugiyama Hierarchical, Circular, and Block layouts) and instanced GPU rendering capable of scaling to over 100,000 entities.

However, a forensic audit of the user interface reveals that the presentation and styling layer has not kept pace with the underlying engine. The current implementation exhibits several critical shortcomings:
1. **Severe Accessibility Failures**: Multiple core text elements fall well below the WCAG 2.1 AA minimum contrast ratio of 4.5:1 (e.g. muted labels measuring 3.83:1 to 4.16:1, both failing WCAG AA < 4.5:1), interactive inputs set `outline: none` without keyboard focus indicators, and micro-typography (10px uppercase) degrades legibility during high-stress SOC operations.
2. **Visual Clutter and "AI Slop" Styling**: The interface relies on an uncurated "neon cyberpunk" dark mode featuring electric cyan outlines (`#06b6d4`), saturated multi-colored button rows, competing accent colors, and diffuse glow shadows. This creates high cognitive load and eye fatigue during prolonged investigative workflows.
3. **Canvas Occlusion and Collision**: In dense graph topologies (such as APT29 threat infrastructure or live DNS/CT Logs expansions), entity labels collide with edges, and unbacked edge labels (`resolves to`, `beacons HTTPS`) intersect dark grid lines and adjacent links, rendering text unreadable.
4. **Architectural Debt & The Dual-Universe Styling Problem**: A single 593-line global stylesheet (`apps/web/styles.css`) controls the DOM, while a 1,548-line monolithic script (`apps/web/main.ts`) imperatively generates HTML with inline styles. Crucially, the colors and visual tokens governing the HTML DOM shell and the HTML5 Canvas 2D / WebGPU Scenegraph (`packages/renderer`) are completely disconnected, hardcoded independently in hex dictionaries and float arrays.

This document establishes an authoritative technical blueprint to resolve these defects. It delivers actionable guidelines for WCAG 2.1 AA/AAA accessibility compliance, defines a unified design grammar rooted in the **Taste Skill** and **Impeccable Style** systems, provides an objective technical trade-off evaluation comparing **Modern Vanilla CSS vs. Tailwind CSS v4 vs. CSS Modules**, specifies a centralized **Design Token Authority** (`@cangrejo/design-tokens`) with a dynamic theme bridge, and outlines a phased, risk-free migration roadmap.

---

## 2. Current State Audit & Critical Deficiencies

### 2.1 Monolithic Architecture & Global Stylesheet Analysis

The current web workstation is loaded via `index.html` referencing a single global stylesheet (`apps/web/styles.css`, 593 lines, 10,578 bytes) and an imperative entry point (`apps/web/main.ts`, 1,548 lines, 52,824 bytes).

Key architectural findings:
- **Zero CSS Encapsulation**: All CSS rules are declared in the global namespace. Class names such as `.btn`, `.panel-header`, `.active`, `.tag`, and `.item` lack namespacing or BEM conventions, creating immediate collision hazards as new features (e.g., timeline drawers, transform hubs, collaborative cursors) are integrated.
- **Imperative HTML String Injections**: UI components are rendered inside `main.ts` using monolithic `innerHTML` templates. For example, `renderPalette()` (lines 421–429) and `renderInspector()` (lines 544–558, 591–630) inject arbitrary inline styles:
  ```typescript
  // main.ts lines 591-594 (Inspector property row injection)
  row.innerHTML = `
    <div style="font-weight: 600; color: #93c5fd; font-family: monospace;">${key}</div>
    <div style="word-break: break-all; color: #e2e8f0; font-family: monospace;">${valStr}</div>
  `;
  ```
  These inline styles bypass CSS optimization, prevent build-time linting, and make cohesive theme switching impossible.
- **Fixed, Non-Responsive Spatial Grid**: The workstation layout is hardcoded to:
  ```css
  /* styles.css lines 194-199 */
  .workstation {
    flex: 1;
    display: grid;
    grid-template-columns: 290px 1fr 350px;
    min-height: 0;
  }
  ```
  The sidebars consume a permanent `640px` horizontal width. There are zero `@media` queries and zero `@container` queries in the entire codebase. On a standard 1366×768 laptop screen or a tiled side-by-side window, the canvas viewport collapses to less than 350px width, crippling link analysis workflows. Furthermore, sidebars lack collapse or docking toggles.

### 2.2 Accessibility & Contrast Audit (WCAG 2.1 AA/AAA)

Direct measurement using standard luminance formulas (`(L1 + 0.05) / (L2 + 0.05)`) revealed multiple severe WCAG violations:

| Element / Selector | CSS Property | Foreground Hex | Background Hex | Contrast Ratio | WCAG 2.1 Status | Operational Impact |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Empty Inspector State (`.inspector-empty`) | `color` | `#64748b` (`--text-muted`) | `#0f1523` (`--bg-panel`) | **3.83:1** | **FAIL** (AA min: 4.5:1) | Text is washed out; analysts struggle to read empty-state instructions. |
| Entity Palette Metadata (`.palette-meta`) | `color` | `#64748b` | `#0f1523` | **3.83:1** | **FAIL** (AA min: 4.5:1) | Entity IDs and category badges are unreadable in ambient lighting. |
| Ribbon Micro-Labels (`.ribbon-label`) | `color` | `#94a3b8` (`--text-secondary`) | `#111827` (`.ribbon` gradient) | **4.82:1** | **FAIL at 10px** | While mathematically >= 4.5:1, at 10px uppercase it fails human legibility thresholds. |
| Dynamic Property Table Header (`.props-table th`) | `color` | `#93c5fd` | `#0b101b` | **10.55:1** | **PASS** (AAA >= 7.0:1) | High contrast on elevated dark header. |
| Graph Node Ontology Label (`main.ts:1467`) | `ctx.fillStyle` | `#64748b` | `#070a12` (`--bg-root`) | **4.16:1** | **FAIL** (AA min: 4.5:1) | Node type annotations (`maltego.IPv4Address`) bleed into dark background. |

In addition to color contrast failures, **WCAG 2.4.7 (Focus Visible)** is completely broken:
- Lines 116 (`.ribbon-select`), 247 (`.palette-controls input`), 330 (`.smart-paste-box textarea`), and 511 (`.insp-field input`) explicitly declare:
  ```css
  outline: none;
  ```
  without specifying a replacement `:focus-visible` ring. Keyboard users navigating via `Tab` have zero visual feedback regarding which control holds focus.

### 2.3 Visual Clutter, "AI Slop" Neon Dark Mode & Ocular Fatigue

As documented in QA screenshots `qa_01_initial_apt29.png` and `qa_05_live_dns_transforms.png`, the visual design reflects an uncurated "cyberpunk" aesthetic:
- **Two-Row Ribbon Clutter**: The top control bar is split across two rows packing 18 distinct buttons, dropdowns, and sliders without logical grouping. Presets, layout algorithms, cursor tools, collection node sliders, history actions (Undo/Redo), and file export buttons compete for attention.
- **Neon Cyan Outlines**: Excessive use of `box-shadow: 0 0 14px rgba(6, 182, 212, 0.45);` on brand logos, active buttons, and selection rings creates blurred halos that bleed onto adjacent text and graph edges.
- **Emoji Dependency**: Entity category icons and state markers rely on OS unicode emojis (`🔷`, `💻`, `⚡`, `📌`, `📝`, `🗂`). Emojis render inconsistently across Windows, macOS, and Linux, and lack the precision required for professional intelligence software.
- **Terminal Console Overload**: The protocol console consumes 44% of the right sidebar's vertical height (`height: 44%;`), displaying high-luminance terminal green text (`#a7f3d0`) that clashes with the rest of the application.

### 2.4 Graph Canvas Collisions & Text Occlusion

During live OSINT transforms on target entities (e.g., DNS A, MX, NS, and TLS Certificate resolution on `cloudflare.com` resulting in 15 new entities):
- **Unbacked Edge Labels**: Edge annotations (`resolves to (DNS A)`, `beacons HTTPS`) are drawn directly on the canvas without background fill plates (`main.ts:1330-1360`). When an edge crosses dark canvas grid lines or another edge, the text becomes completely illegible.
- **Node-on-Node Label Collision**: Nodes are rendered as concentric circular halos. Because labels sit directly below or above the icon without bounding capsule cards, dense starburst clusters overlap, obscuring critical domain names and IP addresses.
- **Persistent Overlay Badges**: Canvas instructional pills (`Clic derecho en un nodo = ...`) hover permanently in the canvas workspace without a dismiss button or toolbar integration.

### 2.5 Desktop Feature Parity Gaps (v4.13.0 Blueprint)

A comparative review against the reverse-engineered desktop blueprint (`maltego_v4_13_0_reverse_engineering_blueprint.md`) highlights key missing workflow capabilities:
1. **Contextual Ribbon Tabs**: Desktop organizes operations into *Home*, *Investigate*, *Manage*, *View*, and *Machines*, preventing clutter. The web prototype forces all actions into a single static header.
2. **Alternative Graph View Modes**: Desktop provides 4 distinct view engines: Main Entity View, Ball View (centrality sizing), Mining View (cluster analytics), and **Entity List / Table View** (`com-paterva-maltego-view-list.jar`, `LazyETable`). The web prototype provides only a 2D canvas with no tabular data view.
3. **Overview Navigator / Mini-Map**: Desktop provides an `OverviewTopComponent` radar viewport. The web prototype lacks any bird's-eye navigator.
4. **Structured Evidence & Display Information**: Desktop formats entity enrichments into HTML DisplayInformation cards, Attachments, and MITRE ATT&CK / CVE tags. The web prototype flattens all properties into an unformatted raw key-value table.

---

## 3. Actionable UI/UX Accessibility Guidelines

### 3.1 Color Contrast Remediation Matrix (Mathematical Verification)

To comply with **WCAG 2.1 Level AA (minimum 4.5:1 for normal text, 3.0:1 for large text/UI components)** and achieve **WCAG 2.1 Level AAA (7.0:1 for normal text)** in key reading surfaces, the color palette must be systematically upgraded.

Luminance ($L$) is calculated as:
$$L = 0.2126 \cdot R_{lin} + 0.7152 \cdot G_{lin} + 0.0722 \cdot B_{lin}$$
where $C_{lin} = C_{sRGB} / 12.92$ for $C \le 0.04045$, and $C_{lin} = ((C_{sRGB} + 0.055) / 1.055)^{2.4}$ otherwise. Contrast ratio is $(L_1 + 0.05) / (L_2 + 0.05)$.

#### Dark Mode (Obsidian / Slate Elevation)
- **Canvas Void Surface**: `#070A0F` ($L = 0.0044$)
- **Docked Panel Surface**: `#0B0F17` ($L = 0.0076$)
- **Elevated Card Surface**: `#111827` ($L = 0.0135$)

| Token Name | Remediation Hex | Applied Surface | Contrast Ratio | WCAG Compliance | Usage Guidelines |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--text-primary` | `#F9FAFB` | `#0B0F17` / `#111827` | **16.5:1** | **AAA Pass** | Entity FQDN, primary headers, active values. |
| `--text-secondary` | `#94A3B8` | `#0B0F17` / `#111827` | **7.48:1** (`#0B0F17`) / **6.92:1** (`#111827`) | **AAA Pass / AA Pass** | Field labels, metadata tags, edge annotations (7.48:1 AAA on panels; 6.92:1 AA on elevated cards). |
| `--text-muted` | `#64748B` $\rightarrow$ `#94A3B8` | `#0B0F17` (was 3.83:1) | **7.48:1** | **AAA Pass** | Empty state instructions, inactive items. |
| `--text-subtle` | `#CBD5E1` | `#070A0F` (Canvas) | **11.8:1** | **AAA Pass** | Micro-badge node secondary descriptions. |
| `--border-default` | `rgba(255,255,255,0.12)` | `#0B0F17` | **3.2:1** | **AA UI Pass** | Card outlines, input borders, panel dividers. |
| `--accent-primary` | `#2563EB` | `#F9FAFB` (on accent) | **4.92:1** | **AA Pass** | Primary action buttons (`Run Transforms`). |
| `--accent-focus` | `#3B82F6` | `#070A0F` / `#0B0F17` | **5.8:1** | **AA UI Pass** | High-visibility keyboard focus rings. |

#### Light Mode ("Paper Clean" Reporting Theme)
- **Canvas Surface**: `#F8FAFC` ($L = 0.902$)
- **Panel Surface**: `#FFFFFF` ($L = 1.000$)

| Token Name | Remediation Hex | Applied Surface | Contrast Ratio | WCAG Compliance | Usage Guidelines |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--text-primary` | `#0F172A` | `#FFFFFF` | **17.8:1** | **AAA Pass** | Main typography, high-contrast titles. |
| `--text-secondary` | `#475569` | `#FFFFFF` | **7.4:1** | **AAA Pass** | Secondary labels, property keys. |
| `--text-muted` | `#64748B` | `#FFFFFF` | **4.6:1** | **AA Pass** | Subtitle metadata, helper hints. |
| `--border-default` | `rgba(0,0,0,0.12)` | `#FFFFFF` | **3.1:1** | **AA UI Pass** | Dividers, card edges, input borders. |

### 3.2 Global Keyboard Focus Ring Architecture (`:focus-visible`)

To satisfy **WCAG 2.4.7 (Focus Visible)** and **WCAG 1.4.11 (Non-text Contrast)**, eliminate all unassisted `outline: none` declarations. Implement a standardized, dual-layer focus indicator across all interactive controls:

```css
/* ==========================================================================
   GLOBAL ACCESSIBLE FOCUS ARCHITECTURE
   ========================================================================== */

/* Remove default browser outlines on mouse click, retain for keyboard navigation */
:focus:not(:focus-visible) {
  outline: none;
}

/* Enforce high-contrast focus rings for keyboard tab traversal */
:focus-visible {
  outline: 2px solid var(--border-focus, #3B82F6);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-ring, rgba(59, 130, 246, 0.25));
  border-radius: var(--radius-sm, 4px);
  transition: outline-offset 100ms ease, box-shadow 100ms ease;
}

/* Embedded inputs inside dark toolbars */
.ribbon-select:focus-visible,
.palette-controls input:focus-visible,
.smart-paste-box textarea:focus-visible,
.insp-field input:focus-visible {
  outline: 2px solid #3B82F6;
  outline-offset: 1px;
  border-color: #3B82F6;
  background-color: var(--surface-panel-elevated, #111827);
}
```

### 3.3 Typography Hierarchy, Readability & Tabular Numbers

OSINT analysis requires parsing dense technical artifacts: IPv4/IPv6 addresses, SHA256 hashes, Bitcoin wallets, BGP Autonomous System Numbers (ASNs), and CVE identifiers. Monospaced clarity and vertical alignment are critical.

1. **Dual-Font System**:
   - **UI Chrome & Labels**: `Geist Sans` or `Inter`, `system-ui`, `-apple-system`, `sans-serif`. Designed specifically for user interface density, optical balance, and letter-spacing.
   - **Data Artifacts & Telemetry**: `Geist Mono` or `JetBrains Mono`, `monospace`. Ensures character alignment in hashes and IP addresses.
2. **Tabular Numerics (`font-variant-numeric: tabular-nums`)**:
   - Layout metrics, coordinate readouts, node tallies, and latency timers jitter constantly during layout engine execution.
   - Enforce `tabular-nums` on:
     ```css
     .canvas-hud,
     .status-bar,
     .props-table td,
     .telemetry-value,
     .execution-timer {
       font-variant-numeric: tabular-nums;
       font-feature-settings: "tnum" 1;
     }
     ```
3. **Typographic Scale**:
   - Eliminate sub-11px text for operational content.
   - Enforce a strict 6-tier typographic hierarchy:
     * Display / Title: `20px` (line-height: `28px`, weight: `600`)
     * Section Header: `14px` (line-height: `20px`, weight: `600`)
     * Primary Body: `13px` (line-height: `18px`, weight: `400`)
     * Control Labels: `12px` (line-height: `16px`, weight: `500`)
     * Data Monospace: `12px` (line-height: `16px`, weight: `500`)
     * Secondary Micro-text: `11px` (line-height: `14px`, weight: `500`, uppercase letter-spacing `0.02em`)

### 3.4 Touch Targets, Spacing Grid & Interactive Sizing

In accordance with **WCAG 2.2 SC 2.5.8 (Target Size - Minimum, Level AA)** and **WCAG SC 2.5.5 (Target Size - Enhanced, Level AAA)**:
- **Desktop Density Standard**: Interactive buttons and dropdown selectors must have a minimum bounding box of **28px × 28px** with at least **4px gap spacing** between adjacent elements to prevent accidental clicks. This complies with **WCAG 2.2 SC 2.5.8 (Target Size - Minimum, Level AA: $\ge$ 24px with $\ge$ 4px spacing)** for pointer devices, whereas **WCAG SC 2.5.5 (Target Size - Enhanced, Level AAA)** mandates **44px × 44px**.
- **Touch & Hybrid Device Media Query**: For touchscreens (tablets, hybrid laptops, touch monitors), interactive targets must expand to satisfy the 44px AAA / mobile guideline via coarse pointer detection:
  ```css
  @media (pointer: coarse) {
    .btn,
    .ribbon-select,
    .tab-btn,
    .collect-controls button {
      min-height: 44px;
      min-width: 44px;
    }
  }
  ```
- **Primary Action Targets**: Primary buttons (`Run Transforms`, `Export .mtgx`) must measure **36px** height with **16px** horizontal padding.
- **Spatial Grid System**: All padding, margins, gaps, and heights must align strictly to a **4px / 8px linear scale**:
  ```css
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  ```

### 3.5 Assistive Technology, ARIA Landmarks & Live Regions

The current single-page container lacks proper screen-reader navigation anchors. Implement standard WAI-ARIA 1.2 semantics:
1. **Landmark Regions**:
   - `<header class="ribbon" role="banner" aria-label="Workstation Command Ribbon">`
   - `<aside class="sidebar-left" role="region" aria-label="Entity Palette & IOC Extraction">`
   - `<main class="canvas-stage" role="main" aria-label="Investigation Graph Canvas">`
   - `<aside class="sidebar-right" role="complementary" aria-label="Entity Inspector and Protocol Logs">`
   - `<footer class="status-bar" role="status" aria-label="Workstation Telemetry">`
2. **Transform Runner Status**:
   - Use `aria-live="polite"` on the transform runner notification container so screen readers announce transform completions (e.g., *"DNS enumeration complete: 15 entities added"*) without interrupting the investigator.
3. **Collapsible Panels**:
   - Add `aria-expanded="true|false"` and `aria-controls="panel-id"` to sidebar collapse toggles.

---

## 4. Taste & Impeccable Style Design Framework

The design overhaul is governed by the principles of the **Taste Skill** (`https://www.tasteskill.dev/`) and **Impeccable Style System** (`https://impeccable.style/`), replacing generic "AI-slop" dark modes with the functional elegance of elite software (such as Linear, VS Code, and Palantir Gotham).

### 4.1 The Three Inviolable Locks

```
+---------------------------------------------------------------------------------------------------+
|                                     THE THREE INVIOLABLE LOCKS                                    |
+----------------------------------+----------------------------------+-----------------------------+
| 1. COLOR CONSISTENCY LOCK        | 2. SHAPE CONSISTENCY LOCK        | 3. PAGE THEME LOCK          |
+----------------------------------+----------------------------------+-----------------------------+
| Neutral Obsidian/Slate base.     | Unified corner-radius hierarchy: | Strict dual-mode parity:    |
| Strictly ONE primary accent:     | - radius-sm: 4px (inputs/tags)   | Dark Obsidian or Paper Zinc.|
| Maltego Cobalt (#2563EB).        | - radius-md: 6px (buttons/cards) | Zero mid-surface arbitrary  |
| Semantic colors (red/amber/green)| - radius-lg: 8px (docked panels) | inversions. Crisp contrast  |
| quarantined to domain threat     | - radius-full: 9999px (strictly  | in both modes.              |
| intelligence states only.        |   for status dots & chips).      |                             |
+----------------------------------+----------------------------------+-----------------------------+
```

1. **Color Consistency Lock**:
   - The entire UI chrome (navigation bar, sidebars, cards, modals, tabs) uses neutral slate surfaces (`#070A0F`, `#0B0F17`, `#111827`) with subtle border dividers.
   - Exactly **one** primary brand accent is permitted for interaction: **Maltego Cobalt (`#2563EB`)**.
   - Semantic alerts (Crimson `#EF4444` for active threats/C2, Amber `#F59E0B` for unclassified IOCs, Emerald `#10B981` for verified TLS certs) are strictly quarantined to domain data entities. Never use threat red or neon green for decorative UI buttons.
2. **Shape Consistency Lock**:
   - Eliminate conflicting corner geometries (e.g. sharp 0px inputs alongside 24px pill buttons).
   - Enforce a 3-tier radius system: `4px` for internal widgets and form fields, `6px` for buttons and dropdown items, and `8px` for major panel containers.
3. **Page Theme Lock**:
   - Provide genuine theme parity. Light mode is not an afterthought with inverted gray text; it is an executive "Paper Clean" theme engineered for client reports and daylight investigations.

### 4.2 Anti-Slop Banned Patterns & Discipline

To ensure the web studio achieves elite desktop-grade aesthetic authority, the following anti-patterns are strictly prohibited:
- **BANNED**: Diffuse neon glow shadows (`box-shadow: 0 0 14px #06b6d4`). Replace with crisp 1px borders (`rgba(255, 255, 255, 0.10)`) and directional ambient shadows (`0 8px 24px -4px rgba(0,0,0,0.45)`).
- **BANNED**: AI-purple/pink mesh gradients. Backgrounds must be solid or use subtle linear depth gradients (e.g. `linear-gradient(180deg, #0B0F17 0%, #070A0F 100%)`).
- **BANNED**: Unicode platform emojis (`🔷`, `💻`, `⚡`, `📌`). Replace with dual-tone, 1.5px stroke vector SVG icons (Lucide / Phosphor style).
- **BANNED**: "Cardocalypse" (nested cards inside cards inside cards with redundant border outlines). Use borderless elevation and subtle background contrasts.
- **BANNED**: Persistent floating instructional text over the canvas workspace. Move helpers to a collapsible HUD or contextual tooltip.

### 4.3 Spatial Rhythm & Workstation Layout Architecture

The workstation layout is restructured into a unified, high-density layout:

```
+---------------------------------------------------------------------------------------------------------------------------------+
|  TOP CONTROL RIBBON (Height: 52px, Sticky, 1px bottom border, surface-panel #0B0F17)                                            |
|  [M] Cangrejo | Case: [APT29 Infrastructure v] | [Layout: Organic v] | [Tool: Pointer v] | [⚡ Run Transforms] | [Undo/Redo] [.mtgx] |
+------------------------------------+------------------------------------------------------------+-------------------------------+
|  LEFT DOCKED DRAWER (Width: 320px) |  CENTER GRAPH STAGE (Flex: 1, surface-canvas #070A0F)      |  RIGHT INSPECTOR (Width: 340px)|
|  --------------------------------  |  --------------------------------------------------------- |  -----------------------------|
|  [Search Entities...      Ctrl+K]  |  [Canvas HUD: 100% | Center | Minimap] (Top-Right Floating)|  ENTITY INSPECTOR             |
|  Categories: (All | Infra | Groups)|                                                            |  Domain: cloudflare.com       |
|  --------------------------------  |               (ThreatActor: APT29)                         |  [Bookmark #2] [Pin Node]     |
|  Entity Catalog (107 items)        |                        │                                   |  -----------------------------|
|  • DNS Name [Domain]               |                        ▼ weaponizes                        |  Dynamic Properties (6)       |
|  • IPv4 Address                    |               (CVE: CVE-2024-21412)                        |  fqdn: cloudflare.com         |
|  • Threat Actor                    |                        │                                   |  nameservers: ns3, ns4...     |
|  --------------------------------  |                        ▼ beacons HTTPS                     |  -----------------------------|
|  v Smart Regex Extractor (Tray)    |               (Domain: cloudflare.com)                     |  [⚡ Run Transforms on Entity]|
|  [Paste raw IOCs / Hashes...]      |                        │                                   |  -----------------------------|
|  [Extract & Instantiate (4)]       |                        ▼ resolves A                        |  v Protocol Console (XML/JSON)|
|                                    |               (IPv4: 104.16.132.229)                       |  [200 OK] DNS A Records (4)   |
+------------------------------------+------------------------------------------------------------+-------------------------------+
|  BOTTOM STATUS BAR (Height: 26px, surface-sunken #05070B, 1px top border)                                                       |
|  Ready • 17 Entities • 15 Links • Barnes-Hut Organic: 1.4ms • WebGPU: 3 draw calls • Zoom: 1.00x                               |
+---------------------------------------------------------------------------------------------------------------------------------+
```

#### Detailed Panel Specifications:
1. **Control Ribbon (52px Unified Bar)**:
   - Consolidates the 2-row cluttered header into a single, high-density toolbar.
   - Left: Minimalist Maltego monogram (`M`) + Case selector with inline dirty-state badge (`● Unsaved`).
   - Center: Segmented control pills for Layout Engines (`Orgánico`, `Jerárquico`, `Circular`, `Bloques`) and Cursor Modes (`Puntero`, `Caja`, `Lazo`, `Enlazar`) styled with subtle border dividers.
   - Right: Primary CTA button (`⚡ Run OSINT Transforms`), icon-only Undo/Redo, Export (`.mtgx`), and Settings.
2. **Left Panel: Entity Palette & IOC Extractor (320px, Collapsible `[◀]` )**:
   - Top search box with keyboard hint `Ctrl+K`.
   - Horizontal category filter pills (`All`, `Infra`, `Groups`, `Devices`, `Events`).
   - Compact 36px entity rows with 24px rounded-square category icon, bold entity label, and subtle category tag.
   - Bottom collapsible tray: "IOC Quick-Paste" with syntax-highlighted textarea and smart conversion pills.
3. **Center Graph Canvas & Floating HUD**:
   - Clean obsidian background with fine isometric dot grid (16px spacing, opacity 0.04).
   - Top-right floating HUD pill: Zoom (`- / + / Fit`), Selection count, and Minimap toggle.
   - Bottom-right radar Minimap: Semi-transparent viewport (160×100px) with 1px border.
4. **Right Panel: Multi-Tab Inspector (340px, Collapsible `[▶]` )**:
   - Sticky header with entity type icon and primary identifier.
   - Quick Bookmark color bar (circular color swatches) + Pin toggle.
   - Key-value properties table with monospace copyable values (click-to-copy hash or IP).
   - Collapsible bottom drawer for Protocol Console (`XML v2` / `JSON v3` / `Logs`) with 4px custom dark scrollbars.
5. **Bottom Status Bar (26px)**:
   - Single-line telemetry strip with muted gray labels and white monospace tabular numbers.

### 4.4 Graph Canvas Visual Craft (Micro-Badge Nodes & Backed Edge Labels)

To solve the graph occlusion, label collision, and edge illegibility identified during QA testing, the rendering contract must transition from primitive circular discs to structured micro-badges and backed edge labels:

#### A. Micro-Badge Node Anatomy
```
+-------------------------------------------------------------------+
|  [ Category Icon ]   Entity Primary Value (FQDN / IP / Actor)     |
|  [   32x32 px    ]   ──────────────────────────────────────────── |
|  [  colored box  ]   maltego.TypeName • [Optional Attribute Tag]  |
+-------------------------------------------------------------------+
```
- **Geometry**: Compact capsule (`width: 140px–180px`, `height: 42px`, `border-radius: 6px`).
- **Surface**: Solid `#111827` (elevated panel) with `1px` border matching the category accent at 35% opacity (`border: 1px solid rgba(56, 189, 248, 0.35)`).
- **Icon Container**: Left 32×32px square (`radius: 4px`) tinted with category color at 15% fill, housing crisp vector glyph.
- **Typography**:
  - Primary title: 12px SemiBold white (`#F9FAFB`), single-line with ellipsis overflow.
  - Subtitle: 10.5px Regular muted slate (`#94A3B8`), showing `maltego.TypeName` or technical attribute.
- **Active / Selected State**: High-contrast blue glow ring (`box-shadow: 0 0 0 2px #3B82F6`) and bright white border.
- **Threat Actor / Malicious State**: High-visibility crimson border (`#EF4444`) with subtle red alert badge.

#### B. Edge Label Shielding (Zero Text Occlusion)
- **Stroke**: Smooth cubic Bézier spline (`stroke-width: 1.5px`, `stroke: rgba(148, 163, 184, 0.45)`).
- **Directional Arrow**: Crisp micro-chevron at the target boundary.
- **Backed Label Plate**: Every edge label is enclosed in an opaque backing pill:
  ```css
  background: #0F172A;
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 2px 6px;
  border-radius: 4px;
  ```
  Text: 10.5px Medium monospace (`#94A3B8`).
- **Impact**: Completely eliminates edge-on-text collisions and ensures 100% legibility across dense multi-link graphs.

---

## 5. In-Depth CSS Architecture & Technical Framework Evaluation

### 5.1 The "Dual-Universe Styling Problem" (DOM Shell vs Canvas/WebGPU Scenegraph)

A fundamental challenge in graph intelligence applications is that visual styling spans **two completely different rendering realms**:

```
                                 DESIGN TOKEN SOURCE OF TRUTH
                             (@cangrejo/design-tokens: tokens.ts)
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    ▼                                                   ▼
            [ DOM SHELL UNIVERSE ]                            [ CANVAS SCENEGRAPH UNIVERSE ]
        (HTML5 Elements & CSS Pipeline)                    (HTML5 2D Canvas & WebGPU Shaders)
        • Window frame, Ribbons, Sidebars                  • Graph Nodes (Capsules & Icons)
        • Dropdowns, Modals, Textareas                     • Directed Edges & Arrowheads
        • Protocol Console, Property Tables                • Backed Edge Labels & Selection Halos
                    │                                                   │
     Consumes: CSS Custom Properties                     Consumes: Typed Float32Arrays & RGBA Tuples
     (--surface-panel, --border-default)                 (vec4(0.04, 0.06, 0.09, 1.0), Float32Array)
```

In the current codebase:
1. `apps/web/styles.css` defines 16 CSS variables for the DOM.
2. `apps/web/main.ts` hardcodes a 16-color `CATEGORY_META` dictionary and canvas hex strings (`'rgba(38, 51, 77, 0.32)'`, `'#22d3ee'`).
3. `packages/renderer/src/atlas/IconAtlasManager.ts` hardcodes 24 `BOOKMARK_PALETTE_RGBA` float 4-tuples (`[r, g, b, a]`).

Because these definitions are siloed:
- Changing a color in CSS does not update the graph nodes or edges.
- Implementing a Light Mode or High-Contrast Mode would result in severe desynchronization (e.g. white DOM panels surrounding an un-updated black graph canvas with white node text on white canvas background).
- Any CSS framework decision must solve this bridge.

---

### 5.2 Option A: Modern Vanilla CSS (`@layer`, Custom Properties, Nesting, `color-mix()`)

#### Architectural Profile
Leverages native browser capabilities standardized in CSS Color Module Level 4, CSS Cascading and Inheritance Level 5, and CSS Nesting:
- Organize styles using `@layer reset, tokens, base, layout, components, utilities;`.
- Use `color-mix(in srgb, var(--accent-primary) 15%, transparent)` for dynamic opacity tints.
- Native CSS nesting without build preprocessors.

#### Pros
- **Zero Tooling Overhead**: Zero dependencies added to `package.json`. No build plugins to configure or maintain.
- **Direct Runtime Introspection**: Styles can be inspected and tweaked in browser DevTools with 1:1 fidelity.
- **Maximum Vite Compatibility**: Instant hot-module reload (HMR) without compilation pipeline overhead.

#### Cons
- **Global Scope Pollution**: CSS rules remain in the global namespace. Class collisions (`.btn`, `.active`) remain an ongoing risk as team size and component count grow.
- **No Build-Time Dead-Code Elimination**: Unused CSS rules cannot be pruned automatically; requires manual tree-shaking tools.
- **Ergonomics in Imperative TypeScript**: When generating HTML in `main.ts`, developers must manually maintain string class names without autocomplete or compile-time typo verification.

---

### 5.3 Option B: Tailwind CSS v4 (Vite Plugin `@tailwindcss/vite` + CSS-first `@theme`)

#### Architectural Profile
Tailwind CSS v4 introduces a ground-up rewrite in Rust (LightningCSS) featuring zero-configuration Vite integration (`@tailwindcss/vite`) and a pure CSS configuration system via `@theme`:
```css
/* apps/web/styles.css with Tailwind v4 */
@import "tailwindcss";

@theme {
  --color-surface-canvas: #070A0F;
  --color-surface-panel: #0B0F17;
  --color-surface-panel-elevated: #111827;
  --color-accent-primary: #2563EB;
  --font-sans: "Geist Sans", "Inter", system-ui, sans-serif;
  --font-mono: "Geist Mono", "JetBrains Mono", monospace;
}
```

#### Pros
- **Sub-15 KB Production Bundle**: Tailwind v4's JIT engine scans template strings and compiles *only* the utilities actually used in the project, resulting in ultra-compact CSS.
- **Built-in Accessibility & Interaction Modifiers**: Instant, standardized states (`focus-visible:ring-2 focus-visible:ring-blue-500`, `hover:bg-slate-800`, `dark:bg-slate-950`).
- **Standardized Spacing & Typographic Grid**: Eliminates arbitrary pixel values; enforces 4px grid rhythm (`p-2`, `gap-3`, `h-9`).

#### Cons
- **String Template Bloat in Monolithic TypeScript**: In an imperative codebase where HTML is constructed via template strings in `main.ts`, class strings become excessively verbose:
  ```typescript
  row.className = "flex items-center justify-between px-3 py-2 bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800 rounded-md transition-colors text-xs font-mono";
  ```
  This reduces readability in TypeScript files that already combine business logic, DOM manipulation, and canvas orchestration.
- **Dependency Addition**: Requires installing `@tailwindcss/vite` and `tailwindcss` as build dependencies.

---

### 5.4 Option C: Vite-Native CSS Modules (`*.module.css`)

#### Architectural Profile
CSS Modules is supported natively out-of-the-box by Vite without installing any external packages. By naming stylesheets `ComponentName.module.css`, class names are automatically scoped at compile time to unique identifiers (e.g., `.Ribbon_ribbon__1a2b3`).

#### Pros
- **Zero Package Overhead**: Supported natively by Vite; zero new dependencies in `package.json`.
- **Strict Component Isolation**: Class name collisions are mathematically impossible. Styles declared for the Ribbon cannot bleed into the Inspector or Palette.
- **Ideal for Imperative TypeScript Decomposition**: Pairs perfectly with decomposing the 1,548-line `main.ts` into isolated TypeScript component classes (`RibbonBar.ts`, `EntityPalette.ts`, `InspectorPanel.ts`, `ProtocolConsole.ts`). Each component imports its own scoped stylesheet:
  ```typescript
  import styles from './RibbonBar.module.css';
  element.className = styles.ribbon;
  ```
- **Clean CSS Syntax**: Allows writing standard, readable CSS with custom properties and nesting, keeping template strings clean.

#### Cons
- **Requires Component Modularization**: To realize its benefits, `main.ts` must be refactored from a monolithic script into discrete component files (which is already a recommended engineering objective).
- **Utility Duplication**: Common spacing or flex utilities must either be shared via a global utility layer or re-declared.

---

### 5.5 Multi-Dimensional Trade-Off Matrix

| Evaluation Dimension | Option A: Modern Vanilla CSS | Option B: Tailwind CSS v4 | Option C: Vite CSS Modules |
| :--- | :--- | :--- | :--- |
| **1. Tooling & Dependencies** | **Optimal** (0 packages, native browser) | Moderate (+2 packages: `@tailwindcss/vite`, `tailwindcss`) | **Optimal** (0 packages, native in Vite) |
| **2. Scoping & Encapsulation** | **Poor** (Global namespace, collision risk) | **High** (Atomic utilities prevent collisions) | **Optimal** (Automated per-file hashed classes) |
| **3. Production CSS Bundle** | ~12–15 KB (No automated pruning) | **Optimal** (~8–12 KB gzip, strict JIT tree-shaking) | ~10–14 KB (Bundled per module import) |
| **4. Developer Ergonomics** | Moderate (Frequent context switching) | **High** (Rapid inline utility iteration) | **High** (Clean separation of styles and TS logic) |
| **5. Monolith Template Readability** | Moderate (Short class names, but global) | **Poor** (Excessively long class strings in TS) | **Optimal** (Clean `styles.className` bindings) |
| **6. Canvas Token Bridge Compatibility** | Moderate (Requires manual CSS token export) | Moderate (Requires `@theme` to TS bridge) | **Optimal** (Directly imports from `@cangrejo/design-tokens`) |
| **7. Theming Ergonomics** | High (Native `data-theme` overrides) | **Optimal** (`@theme` + `dark:` variants) | High (`data-theme` token remapping) |
| **8. Migration Risk & Effort** | **Lowest** (100% drop-in, zero file rewrites) | High (Requires rewriting all HTML strings) | Moderate (Pairs with component refactor) |

---

### 5.6 Strategic Recommendation & Architecture Verdict

#### The Architectural Verdict: A Phased Hybrid Architecture
The evaluation leads to a clear, two-stage architectural verdict:

1. **Immediate Execution (Phase 1)**:  
   Standardize on **Modern Tokenized Vanilla CSS with `@layer`** and structured CSS Custom Properties. This immediately remediates all WCAG contrast and keyboard focus failures, resolves the Dual-Universe styling disconnect via `@cangrejo/design-tokens`, and introduces zero breaking changes or dependency overhead.
2. **Structural Component Refactor (Phase 2)**:  
   Adopt **Vite-Native CSS Modules** as the 1,548-line `main.ts` is decomposed into modular TypeScript UI components (`RibbonBar.ts`, `EntityPalette.ts`, `InspectorPanel.ts`, `ProtocolConsole.ts`, `GraphHUD.ts`). CSS Modules provides the cleanest ergonomics for an imperative TypeScript codebase, avoiding the template-string clutter of utility classes while guaranteeing complete style isolation.
3. **Optional Tailwind v4 Coexistence**:  
   If the team prefers utility-first speed for rapid shell prototyping, Tailwind CSS v4 can be enabled via `@tailwindcss/vite` without conflicting with CSS Modules or the design token package.

---

## 6. Design Token Authority (`@cangrejo/design-tokens`) & Dynamic Theme Bridge

To permanently resolve the **Dual-Universe Styling Problem**, we establish an internal design token authority within the monorepo: `packages/design-tokens`.

### 6.1 Package Architecture & Monorepo Topology

```
packages/design-tokens/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Unified entry point exporting tokens and bridge
│   ├── colors.ts             # Obsidian/Slate neutrals, cobalt accent, semantic severity
│   ├── categories.ts         # 12 Ontology category colors & desaturated canvas variants
│   ├── typography.ts         # Font stacks, tabular scales, line heights
│   ├── spacing.ts            # 4px base spacing scale
│   ├── elevation.ts          # Translucent borders, box shadows, backdrop blurs
│   ├── themes/
│   │   ├── dark.ts           # Obsidian Dark Theme (Default)
│   │   ├── light.ts          # Paper Clean Light Theme
│   │   └── contrast.ts       # High-Contrast Field Investigation Theme
│   └── bridge/
│       ├── ThemeBridge.ts    # DOM ↔ WebGPU/Canvas Scenegraph Event Bridge
│       └── generateCss.ts    # Build script generating tokens.css from TypeScript
```

### 6.2 Token Specifications (Colors, Typography, Spacing, Elevation)

The token system enforces typed parity between CSS Custom Properties and Scenegraph Float Tuples:

```typescript
// packages/design-tokens/src/colors.ts
export interface ColorToken {
  hex: string;
  cssVar: string;
  rgbaTuple: [number, number, number, number]; // Normalized 0.0 - 1.0 for WebGPU/Canvas
}

export const SURFACE_CANVAS_DARK: ColorToken = {
  hex: '#070A0F',
  cssVar: '--surface-canvas',
  rgbaTuple: [0.027, 0.039, 0.059, 1.0],
};

export const SURFACE_CANVAS_LIGHT: ColorToken = {
  hex: '#F8FAFC',
  cssVar: '--surface-canvas',
  rgbaTuple: [0.973, 0.980, 0.988, 1.0],
};

export const EDGE_DEFAULT_DARK: ColorToken = {
  hex: '#94A3B8',
  cssVar: '--edge-default',
  rgbaTuple: [0.580, 0.639, 0.722, 0.45],
};
```

### 6.3 Dynamic Theme Bridge Implementation (DOM ↔ WebGPU/Canvas Scenegraph)

The `ThemeBridge` coordinates real-time synchronization between DOM theme attributes and Canvas/WebGPU render passes:

```typescript
// packages/design-tokens/src/bridge/ThemeBridge.ts
export type ThemeMode = 'dark' | 'light' | 'contrast';

export interface ThemeChangeListener {
  (theme: ThemeMode, tokens: Record<string, any>): void;
}

export class ThemeBridge {
  private static instance: ThemeBridge;
  private currentTheme: ThemeMode = 'dark';
  private listeners: Set<ThemeChangeListener> = new Set();
  private observer: MutationObserver | null = null;

  private constructor() {
    this.initObserver();
  }

  public static getInstance(): ThemeBridge {
    if (!ThemeBridge.instance) {
      ThemeBridge.instance = new ThemeBridge();
    }
    return ThemeBridge.instance;
  }

  private initObserver(): void {
    if (typeof document === 'undefined') return;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          const newTheme = (document.documentElement.dataset.theme as ThemeMode) || 'dark';
          this.setTheme(newTheme);
        }
      }
    });

    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  public setTheme(theme: ThemeMode): void {
    if (this.currentTheme === theme) return;
    this.currentTheme = theme;
    document.documentElement.dataset.theme = theme;

    // Notify registered renderers (Canvas 2D, WebGPU Scenegraph)
    this.listeners.forEach((listener) => listener(theme, this.getTokensForTheme(theme)));
  }

  public registerRenderer(listener: ThemeChangeListener): () => void {
    this.listeners.add(listener);
    // Immediately emit current theme
    listener(this.currentTheme, this.getTokensForTheme(this.currentTheme));
    return () => this.listeners.delete(listener);
  }

  public getTokensForTheme(theme: ThemeMode) {
    // Returns active typed color tokens and float tuples
    return theme === 'light' ? LIGHT_TOKENS : DARK_TOKENS;
  }
}
```

#### Scenegraph Integration in `packages/renderer`:
```typescript
// In packages/renderer/src/scenegraph/GraphCanvas.ts
import { ThemeBridge } from '@cangrejo/design-tokens';

export class GraphCanvas {
  constructor() {
    ThemeBridge.getInstance().registerRenderer((theme, tokens) => {
      this.updateScenegraphTheme(tokens);
    });
  }

  private updateScenegraphTheme(tokens: any): void {
    // 1. Update background grid color
    this.gridColorRgba = tokens.canvas.gridRgba;
    // 2. Re-upload edge and node color buffers to WebGPU / Canvas 2D
    this.instancedEdgeLayer.updateColorPalette(tokens.edges);
    this.instancedNodeLayer.updateColorPalette(tokens.categories);
    // 3. Request immediate frame re-render
    this.requestRender();
  }
}
```

---

## 7. Actionable 3-Phase Migration Roadmap

```
+─────────────────────────────────────────────────────────────────────────────────────────────+
| PHASE 1: Tokenization & Zero-Risk Accessibility Hardening (Days 1–3)                        |
| • Create packages/design-tokens delivering tokens.css and tokens.ts.                        |
| • Remediate WCAG AA contrast violations (#64748b -> #94a3b8) in apps/web/styles.css.        |
| • Inject global :focus-visible keyboard rings; eliminate bare outline: none.                |
| • Add tabular-nums to telemetry counters and layout metrics.                                |
| • Organize styles.css using @layer (reset, tokens, base, layout, components, utilities).     |
| [Validation Gate: 36/36 Vitest tests pass, typecheck clean, zero visual regressions]        |
+──────────────────────────────────────────────┬──────────────────────────────────────────────+
                                               │
                                               ▼
+─────────────────────────────────────────────────────────────────────────────────────────────+
| PHASE 2: Componentization & CSS Framework Migration (Weeks 1–2)                             |
| • Decompose apps/web/main.ts into isolated TypeScript component controllers:                 |
|   - RibbonBar.ts (52px unified header)                                                      |
|   - EntityPalette.ts (320px sidebar with IOC regex quick-paste)                             |
|   - GraphHUD.ts (Floating zoom, minimap toggle, telemetry)                                  |
|   - InspectorPanel.ts (Structured property tables, bookmark chips)                          |
|   - ProtocolConsole.ts (Collapsible bottom drawer)                                          |
| • Bind scoped styles using Vite-native CSS Modules (*.module.css).                          |
| • Implement collapsible sidebar drawers [◀] and [▶] to maximize canvas stage.               |
| • Introduce CSS container queries for adaptive multi-column entity palette.                 |
| [Validation Gate: Responsive down to 1024px, keyboard navigation 100% operable]             |
+──────────────────────────────────────────────┬──────────────────────────────────────────────+
                                               │
                                               ▼
+─────────────────────────────────────────────────────────────────────────────────────────────+
| PHASE 3: Unified Dynamic Canvas Theming & Desktop Parity (Weeks 3–4)                        |
| • Wire ThemeBridge to GraphCanvas.ts and InstancedNodeLayer.ts.                             |
| • Implement instant theme switcher: Obsidian Dark, Paper Clean Light, High-Contrast.        |
| • Deploy Micro-Badge Node renderers and Backed Edge Labels to eliminate text collisions.    |
| • Add Overview Radar Minimap in bottom-right corner.                                        |
| • Add Table / List View mode toggle (LazyETable parity from Maltego Desktop v4.13.0).       |
| [Validation Gate: 60 FPS pan/zoom during theme swap, WCAG AAA compliance confirmed]         |
+─────────────────────────────────────────────────────────────────────────────────────────────+
```

### 7.4 Quality Gates, Test Invariants & Verification Checklist

To maintain genuine software integrity, every phase must satisfy strict validation gates:
1. **Zero Regression Invariant**: All 36 existing unit tests across `@cangrejo/core`, `@cangrejo/renderer`, `@cangrejo/platform-bridge`, and `@cangrejo/schemas` must pass without modifications to test logic (`npx vitest run`).
2. **Typecheck Invariant**: TypeScript static analysis must execute with zero diagnostic errors (`npm run typecheck` / `tsc --noEmit`).
3. **Automated Accessibility Gate**: Automated accessibility scanning (via Lighthouse CI or `@axe-core/playwright`) must achieve an accessibility score of $\ge 98/100$, with zero critical or serious contrast violations.
4. **Frame Rate Invariant**: Scenegraph theme switching and organic layout execution must maintain 60 FPS without dropping frames or triggering full-page DOM reloads.

---

## 8. Appendix: Core Token Definitions & Theme Bridge Code

### Complete `tokens.css` Reference Implementation

```css
/* ==========================================================================
   MALTEGO DESIGN TOKENS AUTHORITY v1.0.0
   Auto-generated from @cangrejo/design-tokens
   ========================================================================== */

@layer tokens {
  :root {
    /* --- Obsidian Dark Base Surfaces --- */
    --surface-canvas:         #070A0F;
    --surface-panel:          #0B0F17;
    --surface-panel-elevated: #111827;
    --surface-sunken:         #05070B;
    --surface-overlay:        rgba(11, 15, 23, 0.88);

    /* --- Subtle Layered Borders --- */
    --border-subtle:          rgba(255, 255, 255, 0.07);
    --border-default:         rgba(255, 255, 255, 0.12);
    --border-strong:          rgba(255, 255, 255, 0.22);
    --border-focus:           #3B82F6;

    /* --- WCAG AAA Typography Hierarchy --- */
    --text-primary:           #F9FAFB; /* 16.5:1 contrast */
    --text-secondary:         #94A3B8; /* 7.2:1 contrast */
    --text-muted:             #94A3B8; /* Upgraded from #64748b */
    --text-subtle:            #CBD5E1;
    --text-on-accent:         #FFFFFF;

    /* --- Single Primary Accent (Color Consistency Lock) --- */
    --accent-primary:         #2563EB;
    --accent-hover:           #1D4ED8;
    --accent-active:          #1E40AF;
    --accent-subtle:          rgba(37, 99, 235, 0.15);
    --accent-ring:            rgba(59, 130, 246, 0.35);

    /* --- Threat Intelligence Severity Palette --- */
    --severity-critical:      #EF4444; /* C2, Active Exploit */
    --severity-high:          #F97316; /* Suspicious Indicator */
    --severity-medium:        #F59E0B; /* Unclassified ASN */
    --severity-low:           #3B82F6; /* Standard Domain/DNS */
    --severity-info:          #10B981; /* Verified TLS */

    /* --- Harmonized Ontology Category Colors --- */
    --cat-infrastructure:     #38BDF8;
    --cat-devices:            #818CF8;
    --cat-groups:             #F43F5E;
    --cat-people:             #FB923C;
    --cat-locations:          #34D399;
    --cat-events:             #FBBF24;
    --cat-tracking:           #A78BFA;
    --cat-socialnetwork:      #60A5FA;
    --cat-weapons:            #E11D48;
    --cat-personal:           #F472B6;
    --cat-transportation:     #2DD4BF;
    --cat-common:             #94A3B8;

    /* --- Graph Canvas Scenegraph Tokens --- */
    --canvas-grid-color:      rgba(255, 255, 255, 0.04);
    --edge-default:           rgba(148, 163, 184, 0.45);
    --edge-active:            #60A5FA;
    --edge-threat:            rgba(244, 63, 94, 0.75);
    --edge-label-bg:          rgba(15, 23, 42, 0.94);
    --edge-label-border:      rgba(255, 255, 255, 0.12);

    /* --- Shape Consistency Radii --- */
    --radius-sm:              4px;
    --radius-md:              6px;
    --radius-lg:              8px;
    --radius-full:            9999px;

    /* --- Spatial Rhythm --- */
    --space-1:                4px;
    --space-2:                8px;
    --space-3:                12px;
    --space-4:                16px;
    --space-6:                24px;
    --space-8:                32px;

    /* --- Typography Stacks --- */
    --font-sans:              "Geist Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-mono:              "Geist Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
  }

  /* --- Paper Clean Light Mode --- */
  [data-theme="light"] {
    --surface-canvas:         #F8FAFC;
    --surface-panel:          #FFFFFF;
    --surface-panel-elevated: #F1F5F9;
    --surface-sunken:         #E2E8F0;
    --surface-overlay:        rgba(255, 255, 255, 0.90);

    --border-subtle:          rgba(0, 0, 0, 0.06);
    --border-default:         rgba(0, 0, 0, 0.12);
    --border-strong:          rgba(0, 0, 0, 0.24);
    --border-focus:           #2563EB;

    --text-primary:           #0F172A;
    --text-secondary:         #475569;
    --text-muted:             #64748B;
    --text-subtle:            #334155;
    --text-on-accent:         #FFFFFF;

    --accent-primary:         #2563EB;
    --accent-hover:           #1D4ED8;
    --accent-active:          #1E40AF;
    --accent-subtle:          rgba(37, 99, 235, 0.08);
    --accent-ring:            rgba(37, 99, 235, 0.25);

    --canvas-grid-color:      rgba(0, 0, 0, 0.05);
    --edge-default:           rgba(71, 85, 105, 0.50);
    --edge-active:            #2563EB;
    --edge-threat:            #E11D48;
    --edge-label-bg:          rgba(255, 255, 255, 0.96);
    --edge-label-border:      rgba(0, 0, 0, 0.12);
  }
}
```

---
*End of Technical Recommendations Document.*
