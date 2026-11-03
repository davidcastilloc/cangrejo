# 🦀 CANGREJO — Brand Identity & Design System Manifesto

<div align="center">
  <img src="./cangrejo_logo_emblem.png" alt="Cangrejo Official Emblem" width="220" />
</div>

---

## 1. Cultural & Forensic Heritage: Why "CANGREJO"?

In 1971, investigators of Venezuela's scientific criminalistics corps (*Cuerpo Técnico de Policía Judicial — PTJ*, later *CICPC*) investigated a notoriously complex homicide on the banks of the Guaire River in Caracas. Because every lead appeared to move sideways or backwards in a labyrinthine web, detectives called it a ***"Caso Cangrejo"*** (*"Crab Case"*).

In February 1972, Inspector Leopoldo Yerena and Dr. Juan Martín Echeverría institutionalized the **Premio Cangrejo de Oro** (*Golden Crab Award*) to recognize scientific investigators who crack the most intricate, seemingly impossible *casos cangrejo* through forensic rigor and link analysis.

### Dual Resonance in Global Open Source
1. **Venezuelan Forensic Tradition (*El Cangrejo de Oro*)**: Represents scientific tenacity, untangling sideways-moving clues, and illuminating hidden networks.
2. **Systems Engineering Heritage (WebGPU + Rust/Wasm)**: Resonates naturally with the global systems-programming community (where the crab is a beloved symbol of memory-safe, fearless concurrency).

---

## 2. Visual Emblem Anatomy

- **The Faceted Golden Carapace (`Oro Cangrejo` `#F59E0B` → `#FBBF24`)**: Geometric facets represent structured mathematical graph topology (`CSR` adjacency matrices) forged into the iconic Golden Crab trophy.
- **Articulated Graph-Node Limbs**: Each joint of the crab's legs is a graph vertex connected by directed edges, symbolizing how `Cangrejo` traverses multi-hop infrastructure (`DNS` → `IP` → `ASN` → `X.509` → `Threat Actor`).
- **The Cyan Catatumbo Core (`#22D3EE`)**: At the center of the carapace sits an optical aperture lens glowing in *Catatumbo Cyan*, symbolizing perpetual real-time reconnaissance in the dark.

---

## 3. Forensic Priority Tiers (*Los Cuatro Cangrejos*)

In place of generic numbered bookmarks, **Cangrejo** classifies high-value investigative findings using the four historic tiers of the Venezuelan forensic award:

| Tier Name | Hex / OKLCH Token | Operational Meaning in an OSINT Investigation |
| :--- | :--- | :--- |
| **Cangrejo de Platino** | `#38BDF8` (`oklch(0.75 0.14 230)`) | **Tier-0 Crown Jewel / Smoking Gun**: Confirmed C2 master node, root private key, or primary threat actor attribution. |
| **Cangrejo de Oro** | `#F59E0B` (`oklch(0.77 0.17 75)`) | **High-Value Golden Lead**: Critical pivot entity that links previously disconnected clusters together. |
| **Cangrejo de Plata** | `#94A3B8` (`oklch(0.70 0.03 255)`) | **Corroborated Secondary Evidence**: Verified passive DNS, WHOIS registrant, or on-chain transaction hop. |
| **Cangrejo de Bronce** | `#D97706` (`oklch(0.66 0.16 55)`) | **Initial Recon / Unverified Lead**: Newly ingested indicator from regex extraction or bulk subdomain enumeration. |

---

## 4. OKLCH Dual-Theme Color Architecture (WCAG 2.1 AAA)

Cangrejo ships with two first-class themes synchronized across DOM CSS custom properties and WebGPU/Canvas shaders via `ThemeBridge` (`@cangrejo/design-tokens`):

### 4.1 `Obsidian Studio` (Default Dark Mode — Long-Session OSINT Operations)
- **Canvas Background (`--surface-canvas`)**: `#0B0F17` (Deep Forensic Obsidian — eliminates pure-black `#000000` halation)
- **Elevated Panel (`--surface-panel`)**: `#111827`
- **Node Capsule Surface (`--node-card-bg`)**: `#161F33` with `1.2px` crisp border `#26334D`
- **Primary Typography (`--text-primary`)**: `#F8FAFC` (**16.4:1** contrast ratio — exceeds WCAG AAA `7:1`)
- **Secondary Typography (`--text-secondary`)**: `#94A3B8` (**7.2:1** contrast ratio — WCAG AAA verified)

### 4.2 `Daylight Forensic Report` (Light Mode — Courtroom, PDF & Executive Briefings)
- **Canvas Background (`--surface-canvas`)**: `#F8FAFC` (Warm Archival Alabaster)
- **Elevated Panel (`--surface-panel`)**: `#FFFFFF`
- **Node Capsule Surface (`--node-card-bg`)**: `#FFFFFF` with `1.2px` slate border `#CBD5E1`
- **Primary Typography (`--text-primary`)**: `#0F172A` (**17.8:1** contrast ratio — WCAG AAA verified)
- **Secondary Typography (`--text-secondary`)**: `#475569` (**7.4:1** contrast ratio — WCAG AAA verified)

---

## 5. Typography & Scannability Rules

- **UI & Primary Node Labels**: `Geist Sans` / `Inter` (`600` semi-bold, tracked at `-0.01em`).
- **Forensic Telemetry, IPs, Hashes, ASNs & Timings**: `JetBrains Mono` / `Geist Mono` with mandatory `font-variant-numeric: tabular-nums` so live counters and coordinates never jitter at 60 FPS.
- **Backed Edge Pills**: Every directed edge annotation is rendered inside a rounded pill (`#111827` dark / `#FFFFFF` light) with a `1px` border so the edge line never occludes the relationship label.
