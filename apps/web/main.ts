import {
  CollectionNodeView,
  EntityRegistry,
  GraphStore,
  GraphStoreSelection,
  Guid,
  STANDARD_ENTITIES_CATALOG,
  StrategicGraphMerger,
  convertTextToEntity,
  createPropertyBag,
  getPartPrimaryValue,
  type EntityID,
  type MaltegoEntityData,
  type MaltegoLinkData,
  type Point2D,
} from '@cangrejo/core';
import {
  BOOKMARK_PALETTE_RGBA,
  GraphCanvas,
  LayoutPipeline,
  type LayoutMode,
} from '@cangrejo/renderer';
import {
  ThemeBridge,
  resolveCategoryVisual,
  type ThemePaletteTokens,
} from '@cangrejo/design-tokens';

// =============================================================================
// 1. Core Engine & Design Token Bridge Instances
// =============================================================================
const store = new GraphStore(Guid.generate());
const registry = new EntityRegistry(true);
const merger = new StrategicGraphMerger();
const collectionView = new CollectionNodeView(store, {
  enabled: true,
  minRequiredEntitiesPerNode: 4,
});
const selection = new GraphStoreSelection(collectionView);
const graphCanvas = new GraphCanvas(store, {
  collectionView,
  selection,
  viewportWidth: 1200,
  viewportHeight: 800,
});
const layoutPipeline = new LayoutPipeline();
const themeBridge = ThemeBridge.getInstance();
let activeTokens: ThemePaletteTokens = themeBridge.getTokens();

const SWATCH_HEX = [
  '#EF4444',
  '#F59E0B',
  '#10B981',
  '#06B6D4',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#64748B',
];

function makeSimpleLink(
  id: Guid,
  label: string,
  color = '#3B82F6',
  weight = 1
): MaltegoLinkData {
  return {
    id,
    typeName: 'maltego.link.transform-link',
    weight,
    bookmark: -1,
    notes: { value: '', show: false },
    displayInfo: [],
    properties: createPropertyBag([
      {
        descriptor: {
          name: 'maltego.link.label',
          displayName: 'Label',
          type: 'string',
          nullable: true,
          hidden: false,
          readonly: false,
          specialRoles: ['VALUE', 'DISPLAY_VALUE'],
          matchingRule: 'STRICT',
        },
        value: label,
      },
      {
        descriptor: {
          name: 'maltego.link.color',
          displayName: 'Color',
          type: 'color',
          nullable: true,
          hidden: false,
          readonly: false,
          specialRoles: [],
          matchingRule: 'LOOSE',
        },
        value: color,
      },
    ]),
  };
}

// Interactive UI State
type CursorTool = 'pointer' | 'marquee' | 'lasso' | 'link';
let currentTool: CursorTool = 'pointer';
let currentLayout: LayoutMode = 'organic';
let lastLayoutElapsedMs = 0;

let isPanning = false;
let panStartScreen: Point2D = { x: 0, y: 0 };
let draggingEntityId: EntityID | null = null;
let dragStartWorldPos: Point2D = { x: 0, y: 0 };
let marqueeStartWorld: Point2D | null = null;
let marqueeCurrentWorld: Point2D | null = null;
let lassoPolygonWorld: Point2D[] = [];
let linkSourceEntityId: EntityID | null = null;
let linkPreviewWorld: Point2D | null = null;
let contextTargetEntityId: EntityID | null = null;

// Console state
let activeConsoleTab: 'log' | 'xml' | 'json' = 'log';
const consoleBuffers = {
  log: 'Listo. Haz clic derecho sobre cualquier nodo del grafo o pulsa "Run OSINT Transforms" para ejecutar consultas en vivo.\n',
  xml: '<!-- Ejecuta un Transform para inspeccionar el payload <MaltegoTransformResponseMessage> XML v2 -->',
  json: '// Ejecuta un Transform o el Cifrado Zero-Knowledge .mtgj para inspeccionar el JSON v3 / AES-256-GCM',
};

function appendLog(msg: string): void {
  const ts = new Date().toLocaleTimeString();
  consoleBuffers.log = `[${ts}] ${msg}\n` + consoleBuffers.log;
  renderConsole();
}

function renderConsole(): void {
  const out = document.getElementById('console-output');
  if (!out) return;
  out.textContent = consoleBuffers[activeConsoleTab];
}

// =============================================================================
// 2. DOM Elements, Theme Bridge & Canvas Initialization
// =============================================================================
const canvasEl = document.getElementById('graph-canvas') as HTMLCanvasElement;
const ctx = canvasEl.getContext('2d')!;
const minimapEl = document.getElementById('minimap-canvas') as HTMLCanvasElement;
const minimapCtx = minimapEl.getContext('2d')!;

function resizeCanvas(): void {
  const rect = canvasEl.parentElement!.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvasEl.width = Math.floor(rect.width * dpr);
  canvasEl.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  graphCanvas.setViewportSize(rect.width, rect.height);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

themeBridge.subscribe((mode, tokens) => {
  activeTokens = tokens;
  const lbl = document.getElementById('lbl-theme-mode');
  if (lbl) {
    lbl.textContent = mode === 'dark' ? '☀ Daylight' : '🌙 Obsidian';
  }
  renderPalette();
});

document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
  const next = themeBridge.toggleMode();
  appendLog(
    `Tema cambiado a [${next === 'light' ? 'Paper Clean Daylight Report (WCAG AAA 17.8:1)' : 'Obsidian Studio Dark (WCAG AAA 16.5:1)'}].`
  );
});

function syncSceneAndUi(runLayoutAfter = false): void {
  if (runLayoutAfter && store.entityCount > 0) {
    const res = layoutPipeline.executeLayout(store, currentLayout, {
      preferTier: 'tier2-wasm',
    });
    lastLayoutElapsedMs = res.elapsedMs;
  }

  collectionView.recomputeCollections();
  graphCanvas.syncAllLayers();
  const metrics = graphCanvas.renderFrame();

  document.getElementById('hud-entities')!.textContent = String(store.entityCount);
  document.getElementById('hud-links')!.textContent = String(store.linkCount);
  document.getElementById('hud-view-entities')!.textContent = String(
    collectionView.getViewEntities().size
  );
  document.getElementById('hud-collections')!.textContent = String(
    collectionView.getCollectionNodes().length
  );
  document.getElementById('hud-selected')!.textContent = String(
    selection.getModelSelectedEntities().size
  );
  document.getElementById('hud-zoom')!.textContent =
    `${graphCanvas.getCameraState().zoom.toFixed(2)}x`;
  document.getElementById('hud-draw-calls')!.textContent = String(metrics.drawCalls);
  document.getElementById('hud-layout-ms')!.textContent = `${lastLayoutElapsedMs.toFixed(1)} ms`;

  document.getElementById('cnt-undo')!.textContent = String(store.undoRedoManager.undoCount);
  document.getElementById('cnt-redo')!.textContent = String(store.undoRedoManager.redoCount);

  renderInspector();
}

// =============================================================================
// 3. Sample Investigation Presets
// =============================================================================
function loadPreset(presetId: string): void {
  store.clear();
  selection.clearSelection();
  store.undoRedoManager.clear();

  if (presetId === 'apt29') {
    store.runInBatch(() => {
      const actor = registry.createEntity('maltego.ThreatActor', 'APT29 (Midnight Blizzard)', {
        weight: 100,
        bookmark: 0,
        extraProperties: { mitre_id: 'G0016', attribution: 'SVR Foreign Intelligence' },
      });
      actor.notes = {
        value: 'Primary threat actor targeting diplomatic & cloud tenants.',
        show: true,
      };
      store.addEntity(actor, { x: 0, y: -150, z: 0 }, true);

      const cve = registry.createEntity('maltego.CVE', 'CVE-2024-21412', {
        weight: 95,
        bookmark: 1,
        extraProperties: { cvss: '8.1 HIGH', vector: 'SmartScreen Bypass' },
      });
      store.addEntity(cve, { x: -250, y: -10, z: 0 });

      const hash = registry.createEntity(
        'maltego.Hash',
        '94b8f12c77d0e1a9bc82144f0019c8a21e7731094b8f12c77d0e1a9bc82144f0',
        {
          weight: 90,
          bookmark: 0,
          extraProperties: { family: 'WINELOADER Stage-2', algorithm: 'SHA-256' },
        }
      );
      store.addEntity(hash, { x: 0, y: -10, z: 0 });

      const c2Domain = registry.createEntity('maltego.Domain', 'cloudflare.com', {
        weight: 95,
        bookmark: 4,
        extraProperties: { registrar: 'Cloudflare Inc.', role: 'Redirector / CDN Front' },
      });
      c2Domain.notes = {
        value: 'Haz clic derecho aquí o pulsa "Run OSINT Transforms" para DNS A/MX/NS en vivo.',
        show: true,
      };
      store.addEntity(c2Domain, { x: 250, y: -10, z: 0 });

      const c2Ip = registry.createEntity('maltego.IPv4Address', '104.16.132.229', {
        weight: 90,
        bookmark: 3,
        extraProperties: { asn: 'AS13335' },
      });
      store.addEntity(c2Ip, { x: 250, y: 150, z: 0 });

      store.addLink(makeSimpleLink(Guid.generate(), 'weaponizes', '#EF4444'), actor.id, cve.id);
      store.addLink(makeSimpleLink(Guid.generate(), 'deploys loader', '#EF4444'), actor.id, hash.id);
      store.addLink(
        makeSimpleLink(Guid.generate(), 'beacons HTTPS', '#3B82F6'),
        hash.id,
        c2Domain.id
      );
      store.addLink(
        makeSimpleLink(Guid.generate(), 'resolves A', '#38BDF8'),
        c2Domain.id,
        c2Ip.id
      );

      const leafSubs = ['auth', 'vpn-gw', 'mail-relay', 'update-srv', 'telemetry', 'cdn-static'];
      leafSubs.forEach((sub, idx) => {
        const subEnt = registry.createEntity(
          'maltego.DNSName',
          `${sub}.svr-ops-telemetry.net`,
          { weight: 70 }
        );
        store.addEntity(subEnt, { x: -280 + idx * 100, y: 155, z: 0 });
        store.addLink(
          makeSimpleLink(Guid.generate(), 'DGA fallback', '#8B5CF6'),
          hash.id,
          subEnt.id
        );
      });

      selection.selectInModel([c2Domain.id]);
    });
    appendLog('Cargado caso APT29 / Midnight Blizzard Infrastructure (11 entidades, 10 enlaces).');
  } else if (presetId === 'cloudflare') {
    store.runInBatch(() => {
      const d1 = registry.createEntity('maltego.Domain', 'cloudflare.com', {
        weight: 100,
        bookmark: 4,
      });
      d1.notes = { value: 'Clic derecho -> DNS A / MX / NS en vivo', show: true };
      store.addEntity(d1, { x: -180, y: 0, z: 0 });

      const d2 = registry.createEntity('maltego.Domain', 'github.com', {
        weight: 100,
        bookmark: 2,
      });
      d2.notes = { value: 'Clic derecho -> Ejecutar Todos los Transforms', show: true };
      store.addEntity(d2, { x: 180, y: 0, z: 0 });

      selection.selectInModel([d1.id]);
    });
    appendLog(
      'Cargado caso Superficie DNS en Vivo (cloudflare.com & github.com). Pulsa "Run OSINT Transforms" para lanzar consultas DNS reales.'
    );
  } else if (presetId === 'crypto') {
    store.runInBatch(() => {
      const ransomWallet = registry.createEntity(
        'maltego.BitcoinAddress',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        {
          weight: 100,
          bookmark: 1,
          extraProperties: { cluster: 'BlackCat / ALPHV Treasury', balance: '148.42 BTC' },
        }
      );
      ransomWallet.notes = { value: 'Main ransom collection wallet', show: true };
      store.addEntity(ransomWallet, { x: 0, y: -140, z: 0 });

      for (let i = 1; i <= 5; i++) {
        const hop = registry.createEntity(
          'maltego.BitcoinAddress',
          `bc1qmixerhop00${i}99x8877aabbccddeeff00112233`,
          {
            weight: 80,
            bookmark: 5,
            extraProperties: { hop: String(i), amount: `${(12.5 * i).toFixed(2)} BTC` },
          }
        );
        store.addEntity(hop, { x: -240 + i * 80, y: 90, z: 0 });
        store.addLink(
          makeSimpleLink(Guid.generate(), `peel chain #${i}`, '#F59E0B'),
          ransomWallet.id,
          hop.id
        );
      }
      selection.selectInModel([ransomWallet.id]);
    });
    appendLog('Cargado caso Ransomware BTC Treasury & Mixer Trace.');
  } else if (presetId === 'stress250') {
    store.runInBatch(() => {
      const hubs: EntityID[] = [];
      for (let h = 0; h < 5; h++) {
        const hub = registry.createEntity('maltego.AS', `AS1333${h}`, {
          weight: 100,
          bookmark: h % 6,
        });
        store.addEntity(hub, {
          x: Math.cos((h * 2 * Math.PI) / 5) * 260,
          y: Math.sin((h * 2 * Math.PI) / 5) * 260,
          z: 0,
        });
        hubs.push(hub.id);
        if (h > 0) {
          store.addLink(
            makeSimpleLink(Guid.generate(), 'BGP peer', '#3B82F6'),
            hubs[h - 1]!,
            hub.id
          );
        }
      }
      for (let i = 0; i < 245; i++) {
        const parentHub = hubs[i % hubs.length]!;
        const leaf = registry.createEntity(
          i % 2 === 0 ? 'maltego.IPv4Address' : 'maltego.DNSName',
          i % 2 === 0
            ? `172.67.${Math.floor(i / 25)}.${(i % 250) + 1}`
            : `edge-${i}.cloudflare-dns.com`,
          { weight: 70 }
        );
        store.addEntity(leaf, {
          x: (Math.random() - 0.5) * 900,
          y: (Math.random() - 0.5) * 700,
          z: 0,
        });
        store.addLink(makeSimpleLink(Guid.generate(), 'announces', '#64748B'), parentHub, leaf.id);
      }
    });
    syncSceneAndUi(true);
    appendLog(
      'Cargado Benchmark de 250 Nodos con Barnes-Hut ForceAtlas2 y agrupación automática en Collection Nodes.'
    );
    return;
  }

  syncSceneAndUi(false);
}

// =============================================================================
// 4. Left Sidebar: Crisp Vector SVG Entity Palette (107 Standard Entities)
// =============================================================================
const categorySelect = document.getElementById('sel-palette-category') as HTMLSelectElement;
for (const cat of registry.getCategories()) {
  const vis = resolveCategoryVisual(cat);
  const opt = document.createElement('option');
  opt.value = cat;
  opt.textContent = `[${vis.code}] ${vis.label} (${cat})`;
  categorySelect.appendChild(opt);
}

function renderPalette(): void {
  const query = (document.getElementById('inp-palette-search') as HTMLInputElement).value
    .trim()
    .toLowerCase();
  const catFilter = categorySelect.value;
  const listEl = document.getElementById('palette-list')!;
  listEl.innerHTML = '';

  const filtered = STANDARD_ENTITIES_CATALOG.filter((spec) => {
    if (catFilter !== 'ALL' && spec.category !== catFilter) return false;
    if (!query) return true;
    return (
      spec.displayName.toLowerCase().includes(query) ||
      spec.id.toLowerCase().includes(query) ||
      spec.category.toLowerCase().includes(query)
    );
  });

  document.getElementById('lbl-entity-catalog-count')!.textContent = String(filtered.length);
  const isLight = themeBridge.getMode() === 'light';

  for (const spec of filtered) {
    const vis = resolveCategoryVisual(spec.category);
    const catColor = isLight ? vis.colorLight : vis.colorDark;
    const row = document.createElement('div');
    row.className = 'palette-item';
    row.setAttribute('role', 'listitem');
    row.setAttribute('tabindex', '0');
    row.title = `Añadir ${spec.displayName} (${spec.id}) al grafo`;
    row.innerHTML = `
      <div class="palette-icon-well" style="background: ${catColor}18; border: 1px solid ${catColor}45; color: ${catColor}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${vis.svgPath}"/></svg>
      </div>
      <div class="palette-info">
        <div class="palette-title">${escapeHtml(spec.displayName)}</div>
        <div class="palette-meta">${escapeHtml(spec.id)} • ${escapeHtml(spec.category)}</div>
      </div>
    `;
    const spawnFn = () => {
      const centerWorld = graphCanvas.screenToWorld(
        graphCanvas.getCameraState().viewportWidth * 0.5,
        graphCanvas.getCameraState().viewportHeight * 0.5
      );
      const jitterX = centerWorld.x + (Math.random() - 0.5) * 180;
      const jitterY = centerWorld.y + (Math.random() - 0.5) * 160;
      const sampleVal = getDefaultSampleValue(spec.id, spec.displayName);

      const created = registry.createEntity(spec.id, sampleVal, { weight: 85 });
      store.addEntity(created, { x: jitterX, y: jitterY, z: 0 });
      selection.selectInModel([created.id]);
      syncSceneAndUi(false);
      appendLog(`Añadida entidad ${spec.displayName} (${sampleVal}) al grafo.`);
    };
    row.addEventListener('click', spawnFn);
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        spawnFn();
      }
    });
    listEl.appendChild(row);
  }
}

function getDefaultSampleValue(typeName: string, displayName: string): string {
  switch (typeName) {
    case 'maltego.Domain':
      return 'cloudflare.com';
    case 'maltego.DNSName':
      return 'api.cloudflare.com';
    case 'maltego.IPv4Address':
      return '1.1.1.1';
    case 'maltego.EmailAddress':
      return 'soc@cloudflare.com';
    case 'maltego.BitcoinAddress':
      return 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    case 'maltego.CVE':
      return 'CVE-2024-21412';
    case 'maltego.AS':
      return 'AS13335';
    default:
      return `New ${displayName}`;
  }
}

document.getElementById('inp-palette-search')!.addEventListener('input', renderPalette);
categorySelect.addEventListener('change', renderPalette);
renderPalette();

// IOC Regex Extraction Tray Handler
document.getElementById('btn-smart-paste')!.addEventListener('click', () => {
  const raw = (document.getElementById('txt-smart-paste') as HTMLTextAreaElement).value;
  const lines = raw
    .split(/[\r\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    appendLog('No se encontraron indicadores en el cuadro IOC Regex Extraction.');
    return;
  }

  const centerWorld = graphCanvas.screenToWorld(
    graphCanvas.getCameraState().viewportWidth * 0.5,
    graphCanvas.getCameraState().viewportHeight * 0.5
  );

  const createdIds: EntityID[] = [];
  store.runInBatch(() => {
    lines.forEach((line, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(1, lines.length);
      const r = 155;
      const ent = convertTextToEntity(line, registry);
      ent.bookmark = 4;
      store.addEntity(ent, {
        x: centerWorld.x + Math.cos(angle) * r,
        y: centerWorld.y + Math.sin(angle) * r,
        z: 0,
      });
      createdIds.push(ent.id);
    });
  });

  selection.selectInModel(createdIds);
  syncSceneAndUi(false);
  appendLog(
    `Smart Regex Paste: creadas ${createdIds.length} entidades clasificadas automáticamente.`
  );
});

// =============================================================================
// 5. Right Sidebar: Entity Inspector & Bookmark Swatch Palette
// =============================================================================
function renderInspector(): void {
  const container = document.getElementById('inspector-content')!;
  const viewSelected = Array.from(selection.getViewSelectedEntities());

  if (viewSelected.length === 0) {
    container.innerHTML = `
      <div class="inspector-empty">
        Selecciona cualquier nodo del grafo para inspeccionar o editar sus propiedades dinámicas, peso, color de marcador, notas y jerarquía ontológica.<br/><br/>
        Haz clic derecho sobre un nodo o pulsa <strong>Run OSINT Transforms</strong> en la barra superior.
      </div>
    `;
    return;
  }

  const firstViewId = viewSelected[0]!;
  const viewEntity = collectionView.getViewEntities().get(firstViewId);

  if (viewEntity && viewEntity.isCollectionNode) {
    const memberNames = viewEntity.underlyingEntities
      .toArray()
      .slice(0, 12)
      .map((id) => {
        const e = store.dataStore.tryGetEntity(id);
        return e ? getPartPrimaryValue(e) : id.toString();
      });

    container.innerHTML = `
      <div class="insp-field">
        <label>Collection Plinth (${viewEntity.ruleName ?? 'Neighbour'} Rule)</label>
        <input type="text" readonly value="${escapeHtml(viewEntity.typeName)} [${viewEntity.underlyingEntities.size} entities]" />
      </div>
      <div class="insp-field">
        <label>Entidades Físicas Contenidas (Primeras 12)</label>
        <div class="insp-ancestry">
          ${memberNames.map((m) => `<span class="ancestry-chip">${escapeHtml(m)}</span>`).join('')}
        </div>
      </div>
      <button id="btn-uncollect-node" class="btn btn-primary btn-block">
        Expandir / Desagrupar Collection Node
      </button>
    `;
    document.getElementById('btn-uncollect-node')?.addEventListener('click', () => {
      collectionView.uncollectNode(viewEntity.id);
      syncSceneAndUi(false);
      appendLog(
        `Collection Node expandido (${viewEntity.underlyingEntities.size} entidades individuales).`
      );
    });
    return;
  }

  const modelSelected = Array.from(selection.getModelSelectedEntities());
  const firstModelId = modelSelected[0] ?? firstViewId;
  const entity = store.dataStore.tryGetEntity(firstModelId);
  if (!entity) {
    container.innerHTML = `<div class="inspector-empty">Entidad no encontrada.</div>`;
    return;
  }

  const spec = registry.get(entity.typeName);
  const ancestry = registry.getInheritanceChain(entity.typeName);
  const pos = store.layoutStore.getPosition(entity.id);
  const isPinned = store.layoutStore.isPinned(entity.id);
  const primaryValue = getPartPrimaryValue(entity);

  const propsRows = Array.from(entity.properties.values.entries())
    .map(
      ([k, v]) => `
      <tr>
        <td>${escapeHtml(k)}</td>
        <td>${escapeHtml(String(v ?? ''))}</td>
      </tr>`
    )
    .join('');

  const swatchesHtml = SWATCH_HEX.map(
    (hex, idx) =>
      `<button type="button" data-bm="${idx}" class="swatch-dot ${entity.bookmark === idx ? 'active' : ''}" style="background:${hex}" title="Bookmark #${idx}" aria-label="Bookmark color ${idx}"></button>`
  ).join('');

  container.innerHTML = `
    <div class="insp-field">
      <label>Valor Principal (${escapeHtml(spec?.displayName ?? entity.typeName)})</label>
      <input id="insp-val" type="text" value="${escapeHtml(primaryValue)}" />
    </div>
    <div class="insp-field">
      <label>Jerarquía Ontológica (${ancestry.length} niveles)</label>
      <div class="insp-ancestry">
        ${ancestry.map((a) => `<span class="ancestry-chip">${escapeHtml(a.id)}</span>`).join(' → ')}
      </div>
    </div>
    <div class="insp-field">
      <label class="tabular">Weight (<span id="lbl-insp-weight">${entity.weight}</span>) • Coord (${Math.round(pos.x)}, ${Math.round(pos.y)})</label>
      <input id="insp-weight" type="range" min="1" max="100" value="${Math.min(100, entity.weight)}" />
    </div>
    <div class="insp-field">
      <label>Clasificación Forense (Los Cuatro Cangrejos) &amp; Pin Lock</label>
      <div class="forensic-tier-pills">
        <button type="button" data-bm="1" class="tier-pill-btn ${entity.bookmark === 1 ? 'active' : ''}" title="Cangrejo de Platino — Joya / C2 Maestro">PLATINO</button>
        <button type="button" data-bm="3" class="tier-pill-btn ${entity.bookmark === 3 ? 'active' : ''}" title="Cangrejo de Oro — Eslabón Pivote">ORO</button>
        <button type="button" data-bm="2" class="tier-pill-btn ${entity.bookmark === 2 ? 'active' : ''}" title="Cangrejo de Plata — Evidencia Corroborada">PLATA</button>
        <button type="button" data-bm="4" class="tier-pill-btn ${entity.bookmark === 4 ? 'active' : ''}" title="Cangrejo de Bronce — Rastro Inicial">BRONCE</button>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div class="swatch-row">${swatchesHtml}</div>
        <button id="insp-pin-btn" class="btn ${isPinned ? 'btn-primary' : ''}">${isPinned ? 'Pinned' : 'Pin'}</button>
      </div>
    </div>
    <div class="insp-field">
      <label>Notas del Investigador</label>
      <textarea id="insp-notes" rows="2">${escapeHtml(entity.notes.value)}</textarea>
    </div>
    <div class="insp-field">
      <label>Propiedades Dinámicas (${entity.properties.values.size})</label>
      <table class="props-table">
        <thead><tr><th>Campo</th><th>Valor</th></tr></thead>
        <tbody>${propsRows || '<tr><td colspan="2">Sin propiedades</td></tr>'}</tbody>
      </table>
    </div>
    <button id="insp-run-all-btn" class="btn btn-primary btn-block">
      Ejecutar Pesquisa OSINT en Entidad
    </button>
  `;

  document.getElementById('insp-val')?.addEventListener('change', (e) => {
    const nextVal = (e.target as HTMLInputElement).value;
    const mainProp = registry.getEffectiveMainProperty(entity.typeName);
    entity.properties.values.set(mainProp, nextVal);
    store.updateEntity(entity);
    syncSceneAndUi(false);
  });

  document.getElementById('insp-weight')?.addEventListener('input', (e) => {
    const nextWeight = Number((e.target as HTMLInputElement).value);
    document.getElementById('lbl-insp-weight')!.textContent = String(nextWeight);
    store.updateEntity({ ...entity, weight: nextWeight });
    syncSceneAndUi(false);
  });

  container.querySelectorAll('.swatch-dot, .tier-pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number((btn as HTMLElement).getAttribute('data-bm'));
      store.updateEntity({ ...entity, bookmark: idx });
      syncSceneAndUi(false);
    });
  });

  document.getElementById('insp-pin-btn')?.addEventListener('click', () => {
    store.setEntityPinned(entity.id, !isPinned);
    syncSceneAndUi(false);
  });

  document.getElementById('insp-notes')?.addEventListener('change', (e) => {
    const nextText = (e.target as HTMLTextAreaElement).value;
    store.updateEntity({
      ...entity,
      notes: { value: nextText, show: nextText.length > 0 },
    });
    syncSceneAndUi(false);
  });

  document.getElementById('insp-run-all-btn')?.addEventListener('click', () => {
    void executeTransformOnEntity(entity, 'all');
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =============================================================================
// 6. Live OSINT Transform Execution (XML v2 + JSON v3 + StrategicGraphMerger)
// =============================================================================
async function executeTransformOnEntity(
  entity: MaltegoEntityData,
  transformId: string
): Promise<void> {
  const primaryValue = getPartPrimaryValue(entity);
  const t0 = performance.now();
  appendLog(`Ejecutando Transform [${transformId}] sobre ${entity.typeName}="${primaryValue}"...`);

  try {
    const fieldsObj: Record<string, string> = {};
    for (const [k, v] of entity.properties.values.entries()) {
      fieldsObj[k] = String(v ?? '');
    }

    const res = await fetch('/api/transforms/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transformId,
        entityType: entity.typeName,
        entityValue: primaryValue,
        entityFields: fieldsObj,
        sliderLimit: 12,
      }),
    });

    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      xmlRequest: string;
      xmlResponse: string;
      entities?: Array<{
        typeName: string;
        value: string;
        weight: number;
        fields: Record<string, string>;
        linkLabel: string;
        linkColor: string;
      }>;
      messages?: Array<{ type: string; text: string }>;
      v3Delta?: unknown;
    };

    if (!data.ok || !data.entities) {
      appendLog(`Error en Transform: ${data.error ?? 'Respuesta inválida'}`);
      return;
    }

    consoleBuffers.xml = `<!-- REQUEST -->\n${data.xmlRequest}\n\n<!-- RESPONSE -->\n${data.xmlResponse}`;
    consoleBuffers.json = JSON.stringify(data.v3Delta, null, 2);
    renderConsole();

    const parentPos = store.layoutStore.getPosition(entity.id);
    const returnedEntities = data.entities;

    const incomingEntities = returnedEntities.map((parsedEnt, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(1, returnedEntities.length);
      const radius = 210;
      const entData = registry.createEntity(parsedEnt.typeName, parsedEnt.value, {
        weight: parsedEnt.weight,
        extraProperties: parsedEnt.fields,
      });
      return {
        data: entData,
        position: {
          x: parentPos.x + Math.cos(angle) * radius,
          y: parentPos.y + Math.sin(angle) * radius,
          z: 0,
        },
        linkLabel: parsedEnt.linkLabel,
        linkColor: parsedEnt.linkColor,
      };
    });

    const incomingLinks = incomingEntities.map((item) => ({
      data: makeSimpleLink(Guid.generate(), item.linkLabel, item.linkColor),
      source: entity.id,
      target: item.data.id,
    }));

    const mergeResult = merger.merge(store, {
      entities: incomingEntities,
      links: incomingLinks,
    });

    const latencyBadge = document.getElementById('insp-latency-badge');
    if (latencyBadge) {
      latencyBadge.textContent = `${(performance.now() - t0).toFixed(2)} ms`;
    }

    for (const msg of data.messages ?? []) {
      appendLog(`${msg.text}`);
    }
    appendLog(
      `StrategicGraphMerger: +${mergeResult.addedEntities.length} nuevas entidades, ~${mergeResult.mergedEntities.length} fusionadas (${mergeResult.elapsedMs.toFixed(2)} ms).`
    );
    syncSceneAndUi(false);
  } catch (err) {
    appendLog(
      `Fallo de red ejecutando Transform: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// Primary Ribbon CTA button
document.getElementById('btn-primary-run-transforms')?.addEventListener('click', () => {
  const selectedIds = Array.from(selection.getModelSelectedEntities());
  const firstId =
    selectedIds[0] ?? Array.from(store.dataStore.getEntities().keys())[0];
  if (!firstId) {
    appendLog('Añade o selecciona una entidad primero para ejecutar Transforms.');
    return;
  }
  const ent = store.dataStore.tryGetEntity(firstId);
  if (ent) {
    void executeTransformOnEntity(ent, 'all');
  }
});

// =============================================================================
// 7. Interactive Canvas Mouse / Wheel / Context Menu Events
// =============================================================================
const contextMenuEl = document.getElementById('context-menu')!;

function hideContextMenu(): void {
  contextMenuEl.classList.add('hidden');
}

function getCanvasMousePos(e: MouseEvent): Point2D {
  const rect = canvasEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvasEl.addEventListener('mousedown', (e) => {
  hideContextMenu();
  const screenPt = getCanvasMousePos(e);
  const worldPt = graphCanvas.screenToWorld(screenPt.x, screenPt.y);

  if (e.button === 2) {
    return;
  }

  const hitId = graphCanvas.selectAtScreenPoint(screenPt.x, screenPt.y, e.shiftKey);

  if (currentTool === 'link') {
    if (hitId && store.dataStore.hasEntity(hitId)) {
      linkSourceEntityId = hitId;
      linkPreviewWorld = worldPt;
    }
    return;
  }

  if (currentTool === 'marquee') {
    marqueeStartWorld = worldPt;
    marqueeCurrentWorld = worldPt;
    return;
  }

  if (currentTool === 'lasso') {
    lassoPolygonWorld = [worldPt];
    return;
  }

  if (hitId) {
    if (store.dataStore.hasEntity(hitId)) {
      draggingEntityId = hitId;
      dragStartWorldPos = store.layoutStore.getPosition(hitId);
    }
    syncSceneAndUi(false);
  } else {
    syncSceneAndUi(false);
    isPanning = true;
    panStartScreen = screenPt;
  }
});

window.addEventListener('mousemove', (e) => {
  const screenPt = getCanvasMousePos(e);
  const worldPt = graphCanvas.screenToWorld(screenPt.x, screenPt.y);

  if (draggingEntityId) {
    store.setEntityPosition(draggingEntityId, { x: worldPt.x, y: worldPt.y, z: 0 });
    syncSceneAndUi(false);
    return;
  }

  if (isPanning) {
    const dx = screenPt.x - panStartScreen.x;
    const dy = screenPt.y - panStartScreen.y;
    panStartScreen = screenPt;
    graphCanvas.panBy(dx, dy);
    syncSceneAndUi(false);
    return;
  }

  if (marqueeStartWorld) {
    marqueeCurrentWorld = worldPt;
    return;
  }

  if (lassoPolygonWorld.length > 0 && e.buttons === 1) {
    lassoPolygonWorld.push(worldPt);
    return;
  }

  if (linkSourceEntityId) {
    linkPreviewWorld = worldPt;
  }
});

window.addEventListener('mouseup', (e) => {
  const screenPt = getCanvasMousePos(e);

  if (draggingEntityId) {
    const endPos = store.layoutStore.getPosition(draggingEntityId);
    if (Math.hypot(endPos.x - dragStartWorldPos.x, endPos.y - dragStartWorldPos.y) > 2) {
      store.setEntityPinned(draggingEntityId, true);
    }
    draggingEntityId = null;
    syncSceneAndUi(false);
  }

  if (isPanning) {
    isPanning = false;
  }

  if (marqueeStartWorld && marqueeCurrentWorld) {
    graphCanvas.selectMarqueeWorldBox(
      {
        minX: Math.min(marqueeStartWorld.x, marqueeCurrentWorld.x),
        minY: Math.min(marqueeStartWorld.y, marqueeCurrentWorld.y),
        maxX: Math.max(marqueeStartWorld.x, marqueeCurrentWorld.x),
        maxY: Math.max(marqueeStartWorld.y, marqueeCurrentWorld.y),
      },
      e.shiftKey
    );
    marqueeStartWorld = null;
    marqueeCurrentWorld = null;
    syncSceneAndUi(false);
  }

  if (lassoPolygonWorld.length >= 3) {
    graphCanvas.selectLassoWorldPolygon(lassoPolygonWorld, e.shiftKey);
    lassoPolygonWorld = [];
    syncSceneAndUi(false);
  } else {
    lassoPolygonWorld = [];
  }

  if (linkSourceEntityId) {
    const targetHit = graphCanvas.selectAtScreenPoint(screenPt.x, screenPt.y, false);
    if (
      targetHit &&
      !targetHit.equals(linkSourceEntityId) &&
      store.dataStore.hasEntity(linkSourceEntityId) &&
      store.dataStore.hasEntity(targetHit)
    ) {
      store.addLink(
        makeSimpleLink(Guid.generate(), 'connected to', '#3B82F6'),
        linkSourceEntityId,
        targetHit
      );
      appendLog('Creado enlace dirigido manual entre las dos entidades.');
    }
    linkSourceEntityId = null;
    linkPreviewWorld = null;
    syncSceneAndUi(false);
  }
});

canvasEl.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const screenPt = getCanvasMousePos(e);
    const currentZoom = graphCanvas.getCameraState().zoom;
    const factor = e.deltaY < 0 ? 1.14 : 0.88;
    graphCanvas.setZoom(currentZoom * factor, screenPt.x, screenPt.y);
    syncSceneAndUi(false);
  },
  { passive: false }
);

canvasEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const screenPt = getCanvasMousePos(e);
  const hitId = graphCanvas.selectAtScreenPoint(screenPt.x, screenPt.y, false);
  if (!hitId) {
    hideContextMenu();
    return;
  }

  const physicalEntity = store.dataStore.tryGetEntity(hitId);
  if (!physicalEntity) {
    appendLog(
      'Este nodo es un Collection Plinth virtual. Haz clic en "Expandir / Desagrupar" en el inspector derecho.'
    );
    syncSceneAndUi(false);
    return;
  }

  contextTargetEntityId = hitId;
  syncSceneAndUi(false);

  document.getElementById('ctx-entity-title')!.textContent =
    `${getPartPrimaryValue(physicalEntity)} (${physicalEntity.typeName})`;

  const stageRect = canvasEl.parentElement!.getBoundingClientRect();
  const menuX = Math.min(screenPt.x, stageRect.width - 298);
  const menuY = Math.min(screenPt.y, stageRect.height - 340);
  contextMenuEl.style.left = `${Math.max(8, menuX)}px`;
  contextMenuEl.style.top = `${Math.max(8, menuY)}px`;
  contextMenuEl.classList.remove('hidden');
});

document.querySelectorAll('#context-menu [data-transform]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const transformId = (btn as HTMLElement).getAttribute('data-transform')!;
    hideContextMenu();
    if (!contextTargetEntityId) return;
    const ent = store.dataStore.tryGetEntity(contextTargetEntityId);
    if (ent) {
      void executeTransformOnEntity(ent, transformId);
    }
  });
});

document.getElementById('ctx-pin-toggle')!.addEventListener('click', () => {
  hideContextMenu();
  if (!contextTargetEntityId) return;
  const pinned = store.layoutStore.isPinned(contextTargetEntityId);
  store.setEntityPinned(contextTargetEntityId, !pinned);
  syncSceneAndUi(false);
});

document.getElementById('ctx-delete-entity')!.addEventListener('click', () => {
  hideContextMenu();
  if (!contextTargetEntityId) return;
  store.removeEntity(contextTargetEntityId);
  selection.clearSelection();
  syncSceneAndUi(false);
  appendLog('Entidad eliminada junto con sus enlaces incidentes en cascada.');
});

// =============================================================================
// 8. Ribbon Controls (Presets, Layouts, Tools, Collection Nodes, Undo/Redo, Export)
// =============================================================================
document.getElementById('btn-load-preset')!.addEventListener('click', () => {
  const val = (document.getElementById('preset-select') as HTMLSelectElement).value;
  loadPreset(val);
});

document.querySelectorAll('.btn-layout').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-layout').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentLayout = (btn as HTMLElement).getAttribute('data-layout') as LayoutMode;
    syncSceneAndUi(true);
    appendLog(`Ejecutado layout [${currentLayout}] en ${lastLayoutElapsedMs.toFixed(2)} ms.`);
  });
});

document.querySelectorAll('.btn-tool').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-tool').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = (btn as HTMLElement).getAttribute('data-tool') as CursorTool;
  });
});

document.getElementById('chk-collect')!.addEventListener('change', (e) => {
  const enabled = (e.target as HTMLInputElement).checked;
  collectionView.setEnabled(enabled);
  syncSceneAndUi(false);
});

document.getElementById('rng-collect-min')!.addEventListener('input', (e) => {
  const val = Number((e.target as HTMLInputElement).value);
  document.getElementById('lbl-collect-min')!.textContent = String(val);
  collectionView.setMinRequiredEntitiesPerNode(val);
  syncSceneAndUi(false);
});

document.getElementById('btn-undo')!.addEventListener('click', () => {
  if (store.undoRedoManager.undo()) {
    syncSceneAndUi(false);
    appendLog('Deshecha última transacción (Undo).');
  }
});

document.getElementById('btn-redo')!.addEventListener('click', () => {
  if (store.undoRedoManager.redo()) {
    syncSceneAndUi(false);
    appendLog('Rehecha transacción (Redo).');
  }
});

document.getElementById('btn-fit')!.addEventListener('click', () => {
  graphCanvas.zoomToFit(90);
  syncSceneAndUi(false);
});

document.getElementById('btn-clear')!.addEventListener('click', () => {
  store.clear();
  selection.clearSelection();
  store.undoRedoManager.clear();
  syncSceneAndUi(false);
  appendLog('Grafo limpiado.');
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeConsoleTab = (btn as HTMLElement).getAttribute('data-tab') as 'log' | 'xml' | 'json';
    renderConsole();
  });
});

function serializeCurrentStore() {
  const entities = Array.from(store.dataStore.getEntities().values()).map((ent) => {
    const propsObj: Record<string, string> = {};
    for (const [k, v] of ent.properties.values.entries()) {
      propsObj[k] = String(v ?? '');
    }
    return {
      id: ent.id.toString(),
      typeName: ent.typeName,
      value: getPartPrimaryValue(ent),
      weight: ent.weight,
      bookmark: ent.bookmark,
      notes: ent.notes,
      properties: propsObj,
      position: store.layoutStore.getPosition(ent.id),
      pinned: store.layoutStore.isPinned(ent.id),
    };
  });

  const links = Array.from(store.structureStore.links.entries()).map(([lid, edge]) => {
    const ldata = store.dataStore.getLink(lid);
    const colorVal = ldata.properties.values.get('maltego.link.color');
    return {
      id: lid.toString(),
      sourceId: edge.source.toString(),
      targetId: edge.target.toString(),
      label: getPartPrimaryValue(ldata),
      color: typeof colorVal === 'string' ? colorVal : '#3B82F6',
      isReversed: edge.isReversed,
      path: store.layoutStore.getLinkPath(lid),
    };
  });

  return { entities, links };
}

document.getElementById('btn-export-mtgx')!.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/export/mtgx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serializeCurrentStore()),
    });
    const data = (await res.json()) as {
      ok: boolean;
      mtgxBase64?: string;
      mtgxSizeBytes?: number;
      error?: string;
    };
    if (!data.ok || !data.mtgxBase64) {
      appendLog(`Error exportando expediente .cgrx: ${data.error}`);
      return;
    }
    const binStr = atob(data.mtgxBase64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cangrejo_expediente_${Date.now()}.cgrx`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog(
      `Expediente Forense .cgrx (PKZIP + GraphML) exportado con éxito (${data.mtgxSizeBytes} bytes).`
    );
  } catch (err) {
    appendLog(`Error exportando expediente .cgrx: ${String(err)}`);
  }
});

document.getElementById('inp-import-mtgx')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  const mtgxBase64 = btoa(binary);

  const res = await fetch('/api/import/mtgx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mtgxBase64 }),
  });
  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    entities?: Array<{
      id: string;
      typeName: string;
      value: string;
      weight: number;
      bookmark: number;
      notes: { value: string; show: boolean };
      properties: Record<string, string>;
      position: { x: number; y: number; z: number };
      pinned: boolean;
    }>;
    links?: Array<{
      id: string;
      sourceId: string;
      targetId: string;
      label: string;
      color?: string;
      isReversed?: boolean;
      path: Array<{ x: number; y: number }>;
    }>;
  };

  if (!data.ok || !data.entities || !data.links) {
    appendLog(`Error importando .mtgx: ${data.error}`);
    return;
  }

  store.clear();
  selection.clearSelection();
  store.runInBatch(() => {
    for (const ent of data.entities!) {
      const created = registry.createEntity(ent.typeName, ent.value, {
        id: Guid.parse(ent.id),
        weight: ent.weight,
        bookmark: ent.bookmark,
        extraProperties: ent.properties,
      });
      created.notes = ent.notes;
      store.addEntity(created, ent.position, ent.pinned);
    }
    for (const lnk of data.links!) {
      store.addLink(
        makeSimpleLink(Guid.parse(lnk.id), lnk.label, lnk.color ?? '#3B82F6'),
        Guid.parse(lnk.sourceId),
        Guid.parse(lnk.targetId),
        lnk.isReversed ?? false,
        lnk.path
      );
    }
  });
  syncSceneAndUi(false);
  appendLog(
    `Importado archivo .mtgx "${file.name}" (${store.entityCount} entidades, ${store.linkCount} enlaces).`
  );
});

document.getElementById('btn-encrypt-mtgj')!.addEventListener('click', async () => {
  const passphrase = window.prompt(
    'Introduce la frase de paso para el Cifrado Selectivo Zero-Knowledge (PBKDF2-SHA256 600k + AES-256-GCM + AES-GMAC):',
    'correct-horse-battery-staple-osint-2026'
  );
  if (!passphrase) return;

  const res = await fetch('/api/export/mtgj-encrypted', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...serializeCurrentStore(), passphrase }),
  });
  const data = (await res.json()) as { ok: boolean; envelope?: unknown; error?: string };
  if (!data.ok) {
    appendLog(`Error cifrando .mtgj: ${data.error}`);
    return;
  }
  consoleBuffers.json = JSON.stringify(data.envelope, null, 2);
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="json"]')?.classList.add('active');
  activeConsoleTab = 'json';
  renderConsole();
  appendLog(
    `Bóveda Cero: Expediente .cgrj cifrado con Zero-Knowledge AES-256-GCM (PKCS7 256B padding) + firma topológica AES-GMAC.`
  );
});

// =============================================================================
// 9. 60 FPS Impeccable Style Scenegraph Renderer (Micro-Badges + Backed Edge Pills + Radar Minimap)
// =============================================================================
function drawRoundedRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function renderFrame(): void {
  const rect = canvasEl.parentElement!.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const cam = graphCanvas.getCameraState();
  const worldCenter = graphCanvas.screenToWorld(width * 0.5, height * 0.5);
  const isLight = activeTokens.mode === 'light';

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = activeTokens.surfaceCanvas;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width * 0.5 + cam.panX, height * 0.5 + cam.panY);
  ctx.scale(cam.zoom, cam.zoom);

  // 1. Subtle 24px Architectural Dot Grid
  const gridStep = 28;
  const startX = Math.floor((worldCenter.x - width / (2 * cam.zoom)) / gridStep) * gridStep;
  const endX = worldCenter.x + width / (2 * cam.zoom);
  const startY = Math.floor((worldCenter.y - height / (2 * cam.zoom)) / gridStep) * gridStep;
  const endY = worldCenter.y + height / (2 * cam.zoom);

  if (cam.zoom >= 0.35) {
    ctx.fillStyle = activeTokens.canvasGridDots;
    const dotSize = 1.4 / cam.zoom;
    for (let gx = startX; gx <= endX; gx += gridStep) {
      for (let gy = startY; gy <= endY; gy += gridStep) {
        ctx.fillRect(gx - dotSize * 0.5, gy - dotSize * 0.5, dotSize, dotSize);
      }
    }
  }

  // 2. Draw Directed Edges & Pill-Shielded Edge Annotations (Zero Occlusion)
  const viewEntitiesMap = collectionView.getViewEntities();
  for (const vl of collectionView.getViewLinks().values()) {
    const srcVe = viewEntitiesMap.get(vl.sourceViewEntityId);
    const dstVe = viewEntitiesMap.get(vl.targetViewEntityId);
    if (!srcVe || !dstVe) continue;

    const firstUnderlying = vl.underlyingLinks.values().next().value;
    const physLink = firstUnderlying ? store.dataStore.tryGetLink(firstUnderlying) : undefined;
    const colorVal = physLink?.properties.values.get('maltego.link.color');
    const edgeColor = vl.isProxy
      ? activeTokens.edgeProxy
      : typeof colorVal === 'string'
        ? colorVal
        : activeTokens.edgeDefault;
    const edgeLabel = vl.isProxy
      ? `${vl.underlyingLinks.size} links`
      : physLink
        ? getPartPrimaryValue(physLink)
        : '';

    const srcPos = srcVe.position;
    const dstPos = dstVe.position;
    const dx = dstPos.x - srcPos.x;
    const dy = dstPos.y - srcPos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) continue;

    ctx.save();
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = vl.isProxy ? 2.0 : 1.5;
    if (vl.isProxy) {
      ctx.setLineDash([6, 4]);
    }
    ctx.beginPath();
    ctx.moveTo(srcPos.x, srcPos.y);
    ctx.lineTo(dstPos.x, dstPos.y);
    ctx.stroke();

    // Directed Arrowhead
    const ux = dx / dist;
    const uy = dy / dist;
    const arrowTipX = dstPos.x - ux * 34;
    const arrowTipY = dstPos.y - uy * 24;
    const arrowLen = 8;
    const arrowWing = 4;

    ctx.setLineDash([]);
    ctx.fillStyle = edgeColor;
    ctx.beginPath();
    ctx.moveTo(arrowTipX, arrowTipY);
    ctx.lineTo(
      arrowTipX - ux * arrowLen - uy * arrowWing,
      arrowTipY - uy * arrowLen + ux * arrowWing
    );
    ctx.lineTo(
      arrowTipX - ux * arrowLen + uy * arrowWing,
      arrowTipY - uy * arrowLen - ux * arrowWing
    );
    ctx.closePath();
    ctx.fill();

    // Pill-Shielded Edge Label (Backed Plate eliminating text occlusion)
    if (cam.zoom >= 0.45 && edgeLabel) {
      const midX = (srcPos.x + dstPos.x) * 0.5;
      const midY = (srcPos.y + dstPos.y) * 0.5;
      ctx.font = '500 10px "Geist Mono", "JetBrains Mono", monospace';
      const textMetrics = ctx.measureText(edgeLabel);
      const pillW = textMetrics.width + 12;
      const pillH = 16;

      drawRoundedRect(ctx, midX - pillW * 0.5, midY - pillH * 0.5, pillW, pillH, 4);
      ctx.fillStyle = activeTokens.edgeLabelBg;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = activeTokens.edgeLabelBorder;
      ctx.stroke();

      ctx.fillStyle = activeTokens.edgeLabelText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(edgeLabel, midX, midY + 0.5);
    }
    ctx.restore();
  }

  // Link Builder preview line
  if (linkSourceEntityId && linkPreviewWorld) {
    const srcVe = viewEntitiesMap.get(linkSourceEntityId);
    if (srcVe) {
      ctx.save();
      ctx.strokeStyle = activeTokens.accentPrimary;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(srcVe.position.x, srcVe.position.y);
      ctx.lineTo(linkPreviewWorld.x, linkPreviewWorld.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 3. Draw Structured Micro-Badge Capsule Nodes & Stacked Collection Plinths
  for (const ve of viewEntitiesMap.values()) {
    const phys = store.dataStore.tryGetEntity(ve.id);
    const spec = registry.get(ve.typeName);
    const vis = resolveCategoryVisual(spec?.category ?? 'infrastructure');
    const catColor = isLight ? vis.colorLight : vis.colorDark;
    const isSelected = selection.isViewEntitySelected(ve.id);

    const cardW = 168;
    const cardH = 42;
    const halfW = cardW * 0.5;
    const halfH = cardH * 0.5;
    const x0 = ve.position.x - halfW;
    const y0 = ve.position.y - halfH;

    const rawTitle = ve.isCollectionNode
      ? `${spec?.displayName ?? ve.typeName}`
      : phys
        ? getPartPrimaryValue(phys)
        : ve.id.toString();
    const displayTitle = rawTitle.length > 18 ? rawTitle.slice(0, 17) + '…' : rawTitle;
    const subLabel = ve.isCollectionNode
      ? `${ve.ruleName ?? 'Cluster'} Collection`
      : (spec?.displayName ?? ve.typeName);

    const bookmarkIdx = phys?.bookmark ?? -1;
    const hasNotes = Boolean(phys?.notes.show && phys?.notes.value);

    ctx.save();

    // Stacked Collection Plinth Depth Layers
    if (ve.isCollectionNode) {
      drawRoundedRect(ctx, x0 + 6, y0 + 6, cardW, cardH, 6);
      ctx.fillStyle = activeTokens.nodeCollectionPlinthBg;
      ctx.strokeStyle = activeTokens.borderDefault;
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();

      drawRoundedRect(ctx, x0 + 3, y0 + 3, cardW, cardH, 6);
      ctx.fillStyle = activeTokens.nodeCollectionPlinthBg;
      ctx.strokeStyle = activeTokens.nodeCollectionPlinthBorder;
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    }

    // Main Capsule Micro-Badge Card
    drawRoundedRect(ctx, x0, y0, cardW, cardH, 6);
    ctx.fillStyle = isSelected ? activeTokens.nodeCardBgSelected : activeTokens.nodeCardBg;
    ctx.fill();

    ctx.lineWidth = isSelected ? 2 : 1.2;
    ctx.strokeStyle = isSelected
      ? activeTokens.borderFocus
      : ve.isCollectionNode
        ? activeTokens.nodeCollectionPlinthBorder
        : activeTokens.nodeCardBorder;
    ctx.stroke();

    // Left 30x30 Category Icon Tile
    const tileX = x0 + 6;
    const tileY = y0 + 6;
    const tileSize = 30;
    drawRoundedRect(ctx, tileX, tileY, tileSize, tileSize, 4);
    ctx.fillStyle = `${catColor}22`;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = `${catColor}66`;
    ctx.stroke();

    ctx.font = '700 9.5px "Geist Mono", "JetBrains Mono", monospace';
    ctx.fillStyle = catColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ve.isCollectionNode ? 'COL' : vis.code, tileX + tileSize * 0.5, tileY + tileSize * 0.5);

    // Bookmark Accent Bar on Left Edge
    if (bookmarkIdx >= 0) {
      const bmRgba = BOOKMARK_PALETTE_RGBA[bookmarkIdx % BOOKMARK_PALETTE_RGBA.length]!;
      const bmColor =
        SWATCH_HEX[bookmarkIdx % SWATCH_HEX.length] ??
        `rgb(${Math.round(bmRgba[0] * 255)}, ${Math.round(bmRgba[1] * 255)}, ${Math.round(bmRgba[2] * 255)})`;
      drawRoundedRect(ctx, x0, y0 + 6, 3, cardH - 12, 2);
      ctx.fillStyle = bmColor;
      ctx.fill();
    }

    // Primary Title & Secondary Monospace Type Subtitle
    if (cam.zoom >= 0.25) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '600 11.5px "Geist Sans", "Inter", sans-serif';
      ctx.fillStyle = activeTokens.textPrimary;
      ctx.fillText(displayTitle, tileX + tileSize + 8, y0 + 7);

      ctx.font = '500 9.5px "Geist Mono", "JetBrains Mono", monospace';
      ctx.fillStyle = activeTokens.textSecondary;
      ctx.fillText(
        subLabel.length > 20 ? subLabel.slice(0, 19) + '…' : subLabel,
        tileX + tileSize + 8,
        y0 + 23
      );
    }

    // Collection Count Chip `[ N ]` or Pin / Note Micro-Indicator
    if (ve.isCollectionNode) {
      const chipText = `${ve.underlyingEntities.size}`;
      const chipW = 24;
      const chipH = 16;
      drawRoundedRect(ctx, x0 + cardW - chipW - 6, y0 + 6, chipW, chipH, 4);
      ctx.fillStyle = activeTokens.accentPrimary;
      ctx.fill();
      ctx.font = '700 9.5px "Geist Mono", monospace';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(chipText, x0 + cardW - chipW * 0.5 - 6, y0 + 14);
    } else if (ve.pinned || hasNotes) {
      const tag = ve.pinned ? 'PIN' : 'DOC';
      drawRoundedRect(ctx, x0 + cardW - 26, y0 + 5, 21, 13, 3);
      ctx.fillStyle = activeTokens.surfacePanelElevated;
      ctx.fill();
      ctx.font = '600 8px "Geist Mono", monospace';
      ctx.fillStyle = activeTokens.textSecondary;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, x0 + cardW - 15.5, y0 + 11.5);
    }

    ctx.restore();
  }

  // 4. Draw Marquee Box or Polygon Lasso Overlay
  if (marqueeStartWorld && marqueeCurrentWorld) {
    ctx.save();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.14)';
    ctx.strokeStyle = activeTokens.borderFocus;
    ctx.lineWidth = 1.5 / cam.zoom;
    const rx = Math.min(marqueeStartWorld.x, marqueeCurrentWorld.x);
    const ry = Math.min(marqueeStartWorld.y, marqueeCurrentWorld.y);
    const rw = Math.abs(marqueeCurrentWorld.x - marqueeStartWorld.x);
    const rh = Math.abs(marqueeCurrentWorld.y - marqueeStartWorld.y);
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();
  }

  if (lassoPolygonWorld.length >= 2) {
    ctx.save();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.14)';
    ctx.strokeStyle = activeTokens.borderFocus;
    ctx.lineWidth = 1.8 / cam.zoom;
    ctx.beginPath();
    ctx.moveTo(lassoPolygonWorld[0]!.x, lassoPolygonWorld[0]!.y);
    for (let i = 1; i < lassoPolygonWorld.length; i++) {
      ctx.lineTo(lassoPolygonWorld[i]!.x, lassoPolygonWorld[i]!.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  // 5. Render Overview Radar Minimap
  renderMinimap(width, height);

  requestAnimationFrame(renderFrame);
}

function renderMinimap(stageW: number, stageH: number): void {
  const mw = minimapEl.width;
  const mh = minimapEl.height;
  minimapCtx.clearRect(0, 0, mw, mh);
  minimapCtx.fillStyle = activeTokens.minimapBg;
  minimapCtx.fillRect(0, 0, mw, mh);

  const viewEntities = Array.from(collectionView.getViewEntities().values());
  if (viewEntities.length === 0) return;

  let minX = -400;
  let maxX = 400;
  let minY = -300;
  let maxY = 300;
  for (const ve of viewEntities) {
    if (ve.position.x - 100 < minX) minX = ve.position.x - 100;
    if (ve.position.x + 100 > maxX) maxX = ve.position.x + 100;
    if (ve.position.y - 80 < minY) minY = ve.position.y - 80;
    if (ve.position.y + 80 > maxY) maxY = ve.position.y + 80;
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((mw - 16) / spanX, (mh - 16) / spanY);
  const offsetX = (mw - spanX * scale) * 0.5;
  const offsetY = (mh - spanY * scale) * 0.5;

  const toMini = (wx: number, wy: number) => ({
    x: offsetX + (wx - minX) * scale,
    y: offsetY + (wy - minY) * scale,
  });

  // Draw mini links
  minimapCtx.strokeStyle = activeTokens.edgeDefault;
  minimapCtx.lineWidth = 0.8;
  const map = collectionView.getViewEntities();
  for (const vl of collectionView.getViewLinks().values()) {
    const s = map.get(vl.sourceViewEntityId);
    const t = map.get(vl.targetViewEntityId);
    if (!s || !t) continue;
    const p0 = toMini(s.position.x, s.position.y);
    const p1 = toMini(t.position.x, t.position.y);
    minimapCtx.beginPath();
    minimapCtx.moveTo(p0.x, p0.y);
    minimapCtx.lineTo(p1.x, p1.y);
    minimapCtx.stroke();
  }

  // Draw mini nodes
  for (const ve of viewEntities) {
    const pt = toMini(ve.position.x, ve.position.y);
    minimapCtx.fillStyle = selection.isViewEntitySelected(ve.id)
      ? activeTokens.borderFocus
      : ve.isCollectionNode
        ? '#8B5CF6'
        : activeTokens.textSecondary;
    minimapCtx.fillRect(pt.x - 2.5, pt.y - 1.5, 5, 3);
  }

  // Draw camera viewport box
  const topLeftWorld = graphCanvas.screenToWorld(0, 0);
  const bottomRightWorld = graphCanvas.screenToWorld(stageW, stageH);
  const v0 = toMini(topLeftWorld.x, topLeftWorld.y);
  const v1 = toMini(bottomRightWorld.x, bottomRightWorld.y);
  minimapCtx.strokeStyle = activeTokens.minimapViewportStroke;
  minimapCtx.lineWidth = 1.2;
  minimapCtx.strokeRect(v0.x, v0.y, Math.max(8, v1.x - v0.x), Math.max(6, v1.y - v0.y));
}

// Keyboard Shortcuts (Ctrl+K / Ctrl+Z / Ctrl+Y / Delete)
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    (document.getElementById('inp-palette-search') as HTMLInputElement)?.focus();
    return;
  }
  if (
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLTextAreaElement
  ) {
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (store.undoRedoManager.undo()) syncSceneAndUi(false);
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    if (store.undoRedoManager.redo()) syncSceneAndUi(false);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    const selected = Array.from(selection.getModelSelectedEntities());
    if (selected.length > 0) {
      store.runInBatch(() => {
        for (const id of selected) {
          if (store.dataStore.hasEntity(id)) {
            store.removeEntity(id);
          }
        }
      });
      selection.clearSelection();
      syncSceneAndUi(false);
    }
  }
});

// Boot with APT29 preset & wire Cangrejo de Oro Lore Modal
const loreModalBackdrop = document.getElementById('lore-modal-backdrop');
document.getElementById('btn-brand-lore')?.addEventListener('click', () => {
  loreModalBackdrop?.classList.remove('hidden');
});
document.getElementById('btn-close-lore')?.addEventListener('click', () => {
  loreModalBackdrop?.classList.add('hidden');
});
loreModalBackdrop?.addEventListener('click', (e) => {
  if (e.target === loreModalBackdrop) {
    loreModalBackdrop.classList.add('hidden');
  }
});

loadPreset('apt29');
requestAnimationFrame(renderFrame);
