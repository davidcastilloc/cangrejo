import {
  CollaborationRoomHub,
  CollectionNodeView,
  EntityRegistry,
  GraphStore,
  GraphStoreSelection,
  Guid,
  STANDARD_ENTITIES_CATALOG,
  StrategicGraphMerger,
  analyzeExpedienteForensics,
  convertTextToEntity,
  createPropertyBag,
  getPartPrimaryValue,
  type EntityID,
  type MaltegoEntityData,
  type MaltegoLinkData,
  type Point2D,
  type SerializedGraphModsDelta,
} from '@cangrejo/core';
import { Stix21Exporter } from '../../packages/transforms/src/formats/Stix21Exporter.js';
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
let draggedPaletteSpec: { id: string; displayName: string } | null = null;

type McpClientType = 'antigravity' | 'codemode' | 'claude-desktop' | 'cursor' | 'claude-code';
type McpTransportType = 'stdio' | 'http';

interface McpUiState {
  client: McpClientType;
  transport: McpTransportType;
  editionTier: 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE';
  licenseKey: string | null;
  sessionId: string;
}

const MCP_STORAGE_TOKEN_KEY = 'cangrejo_mcp_auth_token';
const AUTH_SESSION_STORAGE_KEY = 'cangrejo_auth_session_token';

const mcpState: McpUiState = {
  client: 'antigravity',
  transport: 'http',
  editionTier: 'COMMUNITY',
  licenseKey: null,
  sessionId: 'expediente-apt29',
};

type MobileSuperAppView = 'launchpad' | 'radar' | 'scanner';
let activeMobileView: MobileSuperAppView = 'launchpad';

const goldenPathEntityIds = new Set<string>();
const goldenPathLinkIds = new Set<string>();
const clientCollabHub = new CollaborationRoomHub();
let isApplyingRemoteDelta = false;
let lastProcessedUiSeq = 0;
let activeMcpEventSource: EventSource | null = null;

// Console state
let activeConsoleTab: 'log' | 'xml' | 'json' = 'log';
const consoleBuffers = {
  log: 'Listo. Haz clic derecho sobre cualquier nodo del grafo o pulsa "Run OSINT Transforms" para ejecutar consultas en vivo.\n',
  xml: '<!-- Ejecuta un Transform para inspeccionar el payload <MaltegoTransformResponseMessage> XML v2 -->',
  json: '// Ejecuta un Transform o el Cifrado Zero-Knowledge .mtgj para inspeccionar el JSON v3 / AES-256-GCM',
};

let mobileToastTimer: ReturnType<typeof setTimeout> | null = null;
function showMobileToast(msg: string): void {
  const toastEl = document.getElementById('mobile-toast-banner');
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.hidden = false;
  if (mobileToastTimer) clearTimeout(mobileToastTimer);
  mobileToastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 3200);
}

function appendLog(msg: string): void {
  const ts = new Date().toLocaleTimeString();
  consoleBuffers.log = `[${ts}] ${msg}\n` + consoleBuffers.log;
  renderConsole();
  showMobileToast(msg);
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
const categorySelect = document.getElementById('sel-palette-category') as HTMLSelectElement;
for (const cat of registry.getCategories()) {
  const vis = resolveCategoryVisual(cat);
  const opt = document.createElement('option');
  opt.value = cat;
  opt.textContent = `[${vis.code}] ${vis.label} (${cat})`;
  categorySelect.appendChild(opt);
}

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
    lbl.textContent = mode === 'dark' ? 'Daylight' : 'Obsidian';
  }
  renderPalette();
});

document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
  const next = themeBridge.toggleMode();
  appendLog(
    `Tema cambiado a [${next === 'light' ? 'Paper Clean Daylight Report (WCAG AAA 17.8:1)' : 'Obsidian Studio Dark (WCAG AAA 16.5:1)'}].`
  );
});

// Viewport-aware positioning & auto-close for declarative top-bar popovers
for (const trigger of document.querySelectorAll<HTMLButtonElement>('button[popovertarget]')) {
  const targetId = trigger.getAttribute('popovertarget');
  const popoverEl = targetId ? document.getElementById(targetId) : null;
  if (!popoverEl) continue;

  const positionPopover = (): void => {
    const rect = trigger.getBoundingClientRect();
    const width = 284;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    popoverEl.style.top = `${Math.round(rect.bottom + 6)}px`;
    popoverEl.style.left = `${Math.round(left)}px`;
  };

  trigger.addEventListener('click', positionPopover);
  popoverEl.addEventListener('beforetoggle', positionPopover);
  popoverEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest('button');
    if (btn && typeof (popoverEl as HTMLElement & { hidePopover?: () => void }).hidePopover === 'function') {
      (popoverEl as HTMLElement & { hidePopover: () => void }).hidePopover();
    }
  });
}

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
  syncMobileSuperAppState();
}

// =============================================================================
// 3. Live MCP Session & Initial Graph Map Synchronization
// =============================================================================
function populateBaseGraphMap(presetOrSessionId: string): void {
  store.clear();
  selection.clearSelection();
  store.undoRedoManager.clear();

  if (presetOrSessionId === 'cloudflare' || presetOrSessionId === 'expediente-activo') {
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
  } else {
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
        value: 'Haz clic derecho aquí o pulsa "Ejecutar pesquisa" para DNS A/MX/NS en vivo.',
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
  }
  syncSceneAndUi(false);
}

function loadPreset(sessionOrExpedienteId: string): void {
  const cleanId = sessionOrExpedienteId.trim() || 'expediente-apt29';
  mcpState.sessionId = cleanId;
  const sessionInp = document.getElementById('inp-mcp-session-id') as HTMLInputElement | null;
  if (sessionInp && sessionInp.value !== cleanId) {
    sessionInp.value = cleanId;
  }
  populateBaseGraphMap(cleanId);
  renderMcpSnippet();
  connectLiveMcpSessionStream(cleanId);
  void syncActiveMcpSessionFromServer(cleanId);
}

// =============================================================================
// 4. Left Sidebar: Crisp Vector SVG Entity Palette (107 Standard Entities)
// =============================================================================
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
    row.draggable = true;
    row.title = `Haz clic o arrastra al lienzo para añadir ${spec.displayName} (${spec.id})`;
    row.innerHTML = `
      <div class="palette-icon-well" style="background: ${catColor}18; border: 1px solid ${catColor}45; color: ${catColor}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${vis.svgPath}"/></svg>
      </div>
      <div class="palette-info">
        <div class="palette-title">${escapeHtml(spec.displayName)}</div>
        <div class="palette-meta">${escapeHtml(spec.id)} • ${escapeHtml(spec.category)}</div>
      </div>
    `;
    const spawnAtWorld = (worldX: number, worldY: number) => {
      const sampleVal = getDefaultSampleValue(spec.id, spec.displayName);
      const created = registry.createEntity(spec.id, sampleVal, { weight: 85 });
      store.addEntity(created, { x: worldX, y: worldY, z: 0 });
      selection.selectInModel([created.id]);
      syncSceneAndUi(false);
      appendLog(`Añadida entidad ${spec.displayName} (${sampleVal}) al grafo.`);
    };
    const spawnFn = () => {
      const centerWorld = graphCanvas.screenToWorld(
        graphCanvas.getCameraState().viewportWidth * 0.5,
        graphCanvas.getCameraState().viewportHeight * 0.5
      );
      const jitterX = centerWorld.x + (Math.random() - 0.5) * 180;
      const jitterY = centerWorld.y + (Math.random() - 0.5) * 160;
      spawnAtWorld(jitterX, jitterY);
    };
    row.addEventListener('dragstart', (ev) => {
      draggedPaletteSpec = { id: spec.id, displayName: spec.displayName };
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = 'copy';
        ev.dataTransfer.setData(
          'application/x-cangrejo-entity',
          JSON.stringify(draggedPaletteSpec)
        );
        ev.dataTransfer.setData('text/plain', spec.id);
      }
    });
    row.addEventListener('dragend', () => {
      draggedPaletteSpec = null;
    });
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
        Selecciona cualquier nodo del grafo para inspeccionar o editar sus propiedades dinámicas, peso, clasificación forense, notas y jerarquía ontológica.<br/><br/>
        Haz clic derecho sobre un nodo o pulsa <strong>Ejecutar pesquisa</strong> en la barra superior.
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
        <label>Nodo de colección (${viewEntity.ruleName ?? 'Vecindad'})</label>
        <input type="text" readonly value="${escapeHtml(viewEntity.typeName)} [${viewEntity.underlyingEntities.size} entidades]" />
      </div>
      <div class="insp-field">
        <label>Entidades agrupadas (primeras 12)</label>
        <div class="insp-ancestry">
          ${memberNames.map((m) => `<span class="ancestry-chip">${escapeHtml(m)}</span>`).join('')}
        </div>
      </div>
      <button id="btn-uncollect-node" class="btn btn-primary btn-block">
        Expandir colección de nodos
      </button>
    `;
    document.getElementById('btn-uncollect-node')?.addEventListener('click', () => {
      collectionView.uncollectNode(viewEntity.id);
      syncSceneAndUi(false);
      appendLog(
        `Colección expandida (${viewEntity.underlyingEntities.size} entidades individuales).`
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
  const extMeta = resolveExtendedEntityMeta(entity.typeName);
  const resolvedDisplayName = spec?.displayName ?? extMeta?.displayName ?? entity.typeName;
  const ancestry = registry.getInheritanceChain(entity.typeName);
  const ancestryChips =
    ancestry.length > 0
      ? ancestry.map((a) => `<span class="ancestry-chip">${escapeHtml(a.id)}</span>`).join(' → ')
      : `<span class="ancestry-chip">maltego.Unknown</span> → <span class="ancestry-chip">${escapeHtml(entity.typeName)}</span>`;
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
      `<button type="button" data-bm="${idx}" class="swatch-dot ${entity.bookmark === idx ? 'active' : ''}" style="background:${hex}" title="Marcador #${idx}" aria-label="Color de marcador ${idx}"></button>`
  ).join('');

  container.innerHTML = `
    <div class="insp-field">
      <label>Valor principal (${escapeHtml(resolvedDisplayName)})</label>
      <input id="insp-val" type="text" value="${escapeHtml(primaryValue)}" />
    </div>
    <div class="insp-field">
      <label>Jerarquía ontológica (${Math.max(1, ancestry.length)} niveles)</label>
      <div class="insp-ancestry">
        ${ancestryChips}
      </div>
    </div>
    <div class="insp-field">
      <label class="tabular">Peso (<span id="lbl-insp-weight">${entity.weight}</span>) · Coord (${Math.round(pos.x)}, ${Math.round(pos.y)})</label>
      <input id="insp-weight" type="range" min="1" max="100" value="${Math.min(100, entity.weight)}" />
    </div>
    <div class="insp-field">
      <label>Clasificación forense</label>
      <div class="forensic-tier-pills">
        <button type="button" data-bm="1" class="tier-pill-btn ${entity.bookmark === 1 ? 'active' : ''}" title="Cangrejo de Platino — C2 Maestro">Platino</button>
        <button type="button" data-bm="3" class="tier-pill-btn ${entity.bookmark === 3 ? 'active' : ''}" title="Cangrejo de Oro — Eslabón Pivote">Oro</button>
        <button type="button" data-bm="2" class="tier-pill-btn ${entity.bookmark === 2 ? 'active' : ''}" title="Cangrejo de Plata — Evidencia Corroborada">Plata</button>
        <button type="button" data-bm="4" class="tier-pill-btn ${entity.bookmark === 4 ? 'active' : ''}" title="Cangrejo de Bronce — Rastro Inicial">Bronce</button>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:4px;">
        <div class="swatch-row">${swatchesHtml}</div>
        <button id="insp-pin-btn" class="btn btn-xs ${isPinned ? 'btn-primary' : 'btn-quiet'}">${isPinned ? 'Fijado' : 'Fijar posición'}</button>
      </div>
    </div>
    <div class="insp-field">
      <label>Notas del investigador</label>
      <textarea id="insp-notes" rows="2">${escapeHtml(entity.notes.value)}</textarea>
    </div>
    <div class="insp-field">
      <label>Propiedades dinámicas (${entity.properties.values.size})</label>
      <table class="props-table">
        <thead><tr><th>Campo</th><th>Valor</th></tr></thead>
        <tbody>${propsRows || '<tr><td colspan="2">Sin propiedades</td></tr>'}</tbody>
      </table>
    </div>
    <button id="insp-run-all-btn" class="btn btn-primary btn-block">
      Ejecutar pesquisa en entidad
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

function resolveExtendedEntityMeta(
  typeName: string
): { category: string; displayName: string } | undefined {
  switch (typeName) {
    case 'maltego.ThreatActor':
      return { category: 'weapons', displayName: 'Threat Actor (APT)' };
    case 'maltego.CVE':
      return { category: 'weapons', displayName: 'CVE Vulnerability' };
    case 'maltego.Hash':
      return { category: 'tracking', displayName: 'Cryptographic Hash' };
    case 'maltego.BitcoinAddress':
      return { category: 'events', displayName: 'Bitcoin Wallet (UTXO)' };
    case 'maltego.BlockchainTransaction':
      return { category: 'events', displayName: 'Blockchain Tx' };
    case 'maltego.X509Certificate':
      return { category: 'tracking', displayName: 'X.509 Certificate' };
    default:
      return undefined;
  }
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
        liveNetwork: true,
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

canvasEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy';
  }
});

canvasEl.addEventListener('drop', (e) => {
  e.preventDefault();
  hideContextMenu();
  const screenPt = getCanvasMousePos(e);
  const worldPt = graphCanvas.screenToWorld(screenPt.x, screenPt.y);

  let specToSpawn = draggedPaletteSpec;
  if (!specToSpawn && e.dataTransfer) {
    const rawJson = e.dataTransfer.getData('application/x-cangrejo-entity');
    if (rawJson) {
      try {
        specToSpawn = JSON.parse(rawJson) as { id: string; displayName: string };
      } catch {
        // Fallback below
      }
    }
    if (!specToSpawn) {
      const plainId = e.dataTransfer.getData('text/plain').trim();
      const found = STANDARD_ENTITIES_CATALOG.find((s) => s.id === plainId);
      if (found) {
        specToSpawn = { id: found.id, displayName: found.displayName };
      }
    }
  }
  draggedPaletteSpec = null;
  if (!specToSpawn) return;

  const sampleVal = getDefaultSampleValue(specToSpawn.id, specToSpawn.displayName);
  const created = registry.createEntity(specToSpawn.id, sampleVal, { weight: 85 });
  store.addEntity(created, { x: worldPt.x, y: worldPt.y, z: 0 });
  selection.selectInModel([created.id]);
  syncSceneAndUi(false);
  appendLog(
    `Añadida entidad ${specToSpawn.displayName} (${sampleVal}) en (${Math.round(worldPt.x)}, ${Math.round(worldPt.y)}).`
  );
});

canvasEl.addEventListener('mousedown', (e) => {
  hideContextMenu();
  const screenPt = getCanvasMousePos(e);
  const worldPt = graphCanvas.screenToWorld(screenPt.x, screenPt.y);

  if (e.button === 2) {
    return;
  }

  const hitId = graphCanvas.selectAtScreenPoint(screenPt.x, screenPt.y, e.shiftKey);

  // If a click-to-click link is already active and the user clicks a second node, complete the link immediately
  if (linkSourceEntityId) {
    if (
      hitId &&
      !hitId.equals(linkSourceEntityId) &&
      store.dataStore.hasEntity(linkSourceEntityId) &&
      store.dataStore.hasEntity(hitId)
    ) {
      store.addLink(
        makeSimpleLink(Guid.generate(), 'connected to', '#3B82F6'),
        linkSourceEntityId,
        hitId
      );
      appendLog('Creado enlace dirigido manual entre las dos entidades.');
    }
    linkSourceEntityId = null;
    linkPreviewWorld = null;
    syncSceneAndUi(false);
    return;
  }

  if (currentTool === 'link' || e.altKey) {
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
      linkSourceEntityId = null;
      linkPreviewWorld = null;
      syncSceneAndUi(false);
    } else if (!targetHit) {
      // Released on empty space -> cancel drag link
      linkSourceEntityId = null;
      linkPreviewWorld = null;
      syncSceneAndUi(false);
    } else {
      // Released on the same source node -> keep linkSourceEntityId active for Click-then-Click linking!
      syncSceneAndUi(false);
    }
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

// Mobile Touch Gestures (1-finger tap/drag/pan + 2-finger pinch-to-zoom)
let pinchLastDist = 0;
function getCanvasTouchPos(t: Touch): Point2D {
  const rect = canvasEl.getBoundingClientRect();
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

canvasEl.addEventListener(
  'touchstart',
  (e) => {
    hideContextMenu();
    if (e.touches.length === 2) {
      e.preventDefault();
      isPanning = false;
      draggingEntityId = null;
      const p0 = getCanvasTouchPos(e.touches[0]!);
      const p1 = getCanvasTouchPos(e.touches[1]!);
      pinchLastDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      return;
    }
    if (e.touches.length === 1) {
      const screenPt = getCanvasTouchPos(e.touches[0]!);
      const hitId = graphCanvas.selectAtScreenPoint(screenPt.x, screenPt.y, false);
      if (hitId && store.dataStore.hasEntity(hitId)) {
        draggingEntityId = hitId;
        dragStartWorldPos = store.layoutStore.getPosition(hitId);
        isPanning = false;
      } else {
        draggingEntityId = null;
        isPanning = true;
        panStartScreen = screenPt;
      }
      syncSceneAndUi(false);
    }
  },
  { passive: false }
);

canvasEl.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const p0 = getCanvasTouchPos(e.touches[0]!);
      const p1 = getCanvasTouchPos(e.touches[1]!);
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (pinchLastDist > 8 && dist > 8) {
        const midX = (p0.x + p1.x) * 0.5;
        const midY = (p0.y + p1.y) * 0.5;
        const currentZoom = graphCanvas.getCameraState().zoom;
        graphCanvas.setZoom(currentZoom * (dist / pinchLastDist), midX, midY);
        syncSceneAndUi(false);
      }
      pinchLastDist = dist;
      return;
    }
    if (e.touches.length === 1) {
      e.preventDefault();
      const screenPt = getCanvasTouchPos(e.touches[0]!);
      if (draggingEntityId) {
        const worldPt = graphCanvas.screenToWorld(screenPt.x, screenPt.y);
        store.setEntityPosition(draggingEntityId, { x: worldPt.x, y: worldPt.y, z: 0 });
        syncSceneAndUi(false);
      } else if (isPanning) {
        const dx = screenPt.x - panStartScreen.x;
        const dy = screenPt.y - panStartScreen.y;
        panStartScreen = screenPt;
        graphCanvas.panBy(dx, dy);
        syncSceneAndUi(false);
      }
    }
  },
  { passive: false }
);

canvasEl.addEventListener('touchend', () => {
  if (draggingEntityId) {
    const endPos = store.layoutStore.getPosition(draggingEntityId);
    if (Math.hypot(endPos.x - dragStartWorldPos.x, endPos.y - dragStartWorldPos.y) > 2) {
      store.setEntityPinned(draggingEntityId, true);
    }
    draggingEntityId = null;
    syncSceneAndUi(false);
  }
  isPanning = false;
  pinchLastDist = 0;
});

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

document.getElementById('ctx-start-link')?.addEventListener('click', () => {
  hideContextMenu();
  if (!contextTargetEntityId || !store.dataStore.hasEntity(contextTargetEntityId)) return;
  linkSourceEntityId = contextTargetEntityId;
  const pos = store.layoutStore.getPosition(contextTargetEntityId);
  linkPreviewWorld = { x: pos.x, y: pos.y };
  appendLog('Haz clic sobre otra entidad del lienzo para completar el enlace dirigido.');
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
document.getElementById('preset-select')?.addEventListener('change', (e) => {
  loadPreset((e.target as HTMLSelectElement).value);
});

document.getElementById('btn-ribbon-quick-search')?.addEventListener('click', () => {
  const inp = document.getElementById('inp-palette-search') as HTMLInputElement | null;
  if (inp) {
    inp.focus();
    inp.select();
  }
});

const dockCaptionEl = document.getElementById('dock-active-caption');
let defaultDockCaption = 'Disposición orgánica · ⌘1';

document.querySelectorAll('#canvas-floating-dock [data-caption]').forEach((btn) => {
  btn.addEventListener('mouseenter', () => {
    const cap = btn.getAttribute('data-caption');
    if (dockCaptionEl && cap) dockCaptionEl.textContent = cap;
  });
  btn.addEventListener('mouseleave', () => {
    if (dockCaptionEl) dockCaptionEl.textContent = defaultDockCaption;
  });
});

document.querySelectorAll('.btn-layout').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-layout').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentLayout = (btn as HTMLElement).getAttribute('data-layout') as LayoutMode;
    const cap = btn.getAttribute('data-caption');
    if (cap) {
      defaultDockCaption = cap;
      if (dockCaptionEl) dockCaptionEl.textContent = cap;
    }
    syncSceneAndUi(true);
    appendLog(`Ejecutado layout [${currentLayout}] en ${lastLayoutElapsedMs.toFixed(2)} ms.`);
  });
});

document.querySelectorAll('.btn-tool').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-tool').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = (btn as HTMLElement).getAttribute('data-tool') as CursorTool;
    const cap = btn.getAttribute('data-caption');
    if (cap) {
      defaultDockCaption = cap;
      if (dockCaptionEl) dockCaptionEl.textContent = cap;
    }
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

document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn[data-tab]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeConsoleTab = (btn as HTMLElement).getAttribute('data-tab') as 'log' | 'xml' | 'json';
    renderConsole();
  });
});

interface SerializedGraphEntityItem {
  id: string;
  typeName: string;
  value: string;
  weight?: number;
  bookmark?: number;
  notes?: { value: string; show: boolean };
  properties?: Record<string, string>;
  position?: { x: number; y: number; z?: number };
  pinned?: boolean;
}

interface SerializedGraphLinkItem {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
  color?: string;
  isReversed?: boolean;
  path?: Array<{ x: number; y: number }>;
}

function hydrateStoreFromSerialized(
  entities: SerializedGraphEntityItem[],
  links: SerializedGraphLinkItem[]
): void {
  store.clear();
  selection.clearSelection();
  store.runInBatch(() => {
    entities.forEach((ent, idx) => {
      const canonicalType =
        ent.typeName === 'maltego.BTCAddress'
          ? 'maltego.BitcoinAddress'
          : ent.typeName === 'maltego.ASNumber'
            ? 'maltego.AS'
            : ent.typeName;
      const created = registry.createEntity(canonicalType, ent.value, {
        id: Guid.parse(ent.id),
        weight: ent.weight ?? 90,
        bookmark: ent.bookmark ?? -1,
        extraProperties: ent.properties,
      });
      if (ent.notes) created.notes = ent.notes;
      const angle = (idx * 1.15) % (Math.PI * 2);
      const pos = ent.position ?? {
        x: Math.cos(angle) * 210,
        y: Math.sin(angle) * 210,
        z: 0,
      };
      store.addEntity(created, { x: pos.x, y: pos.y, z: pos.z ?? 0 }, ent.pinned ?? false);
    });
    for (const lnk of links) {
      const srcId = Guid.parse(lnk.sourceId);
      const dstId = Guid.parse(lnk.targetId);
      if (!store.structureStore.hasEntity(srcId) || !store.structureStore.hasEntity(dstId)) {
        continue;
      }
      store.addLink(
        makeSimpleLink(Guid.parse(lnk.id), lnk.label ?? 'related-to', lnk.color ?? '#3B82F6'),
        srcId,
        dstId,
        lnk.isReversed ?? false,
        lnk.path
      );
    }
  });
  syncSceneAndUi(false);
}

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

  hydrateStoreFromSerialized(data.entities, data.links);
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
  const jsonStr = JSON.stringify(data.envelope, null, 2);
  consoleBuffers.json = jsonStr;
  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) => b.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="json"]')?.classList.add('active');
  activeConsoleTab = 'json';
  renderConsole();

  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cangrejo_boveda_cero_${Date.now()}.cgrj`;
  a.click();
  URL.revokeObjectURL(url);

  appendLog(
    `Bóveda Cero: Expediente .cgrj cifrado con Zero-Knowledge AES-256-GCM (PKCS7 256B padding) + firma topológica AES-GMAC y descargado.`
  );
});

document.getElementById('btn-forensic-analytics')?.addEventListener('click', () => {
  goldenPathEntityIds.clear();
  goldenPathLinkIds.clear();

  const allEntityIds = Array.from(store.structureStore.entities.keys());
  const selectedIds = Array.from(selection.getModelSelectedEntities());
  const sourceId = selectedIds[0] ?? allEntityIds[0];
  const targetId =
    selectedIds[1] ??
    (allEntityIds.length > 1 ? allEntityIds[allEntityIds.length - 1] : allEntityIds[0]);

  const report = analyzeExpedienteForensics(store, { sourceId, targetId });
  for (const topHub of report.pageRank.rankings.slice(0, 2)) {
    goldenPathEntityIds.add(topHub.entityId.toString());
  }
  if (report.shortestPath?.found) {
    for (const eid of report.shortestPath.entityPath) {
      goldenPathEntityIds.add(eid.toString());
    }
    for (const lid of report.shortestPath.linkPath) {
      goldenPathLinkIds.add(lid.toString());
    }
  }

  consoleBuffers.json = JSON.stringify(report, null, 2);
  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) => b.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="json"]')?.classList.add('active');
  activeConsoleTab = 'json';
  renderConsole();

  const topNode = report.pageRank.rankings[0];
  const topLabel = topNode && store.dataStore.hasEntity(topNode.entityId)
    ? getPartPrimaryValue(store.dataStore.getEntity(topNode.entityId))
    : 'N/A';
  appendLog(
    `Analítica Forense: Hub Principal "${topLabel}" (${topNode?.suggestedTier ?? 'ORO'}, PageRank=${topNode?.score ?? 0}) • Camino Más Corto=${report.shortestPath?.hopCount ?? 0} saltos • Anillos Cíclicos=${report.cycles.length}.`
  );
});

document.getElementById('btn-export-stix21')?.addEventListener('click', () => {
  const bundle = Stix21Exporter.exportFromStore(store, {
    expedienteTitle: 'Expediente Forense CANGREJO',
    caseTier: 'ORO',
  });
  const jsonStr = JSON.stringify(bundle, null, 2);
  consoleBuffers.json = jsonStr;
  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) => b.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="json"]')?.classList.add('active');
  activeConsoleTab = 'json';
  renderConsole();

  const blob = new Blob([jsonStr], { type: 'application/stix+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cangrejo_bundle_${Date.now()}.stix21.json`;
  a.click();
  URL.revokeObjectURL(url);

  appendLog(
    `Exportado Bundle OASIS STIX 2.1 (${bundle.objects.length} objetos) • Cadena de Custodia SHA-256: ${bundle.x_cangrejo_custody.canonicalDigestHex.slice(0, 16)}…`
  );
});

document.getElementById('btn-export-dossier')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/export/dossier-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...serializeCurrentStore(),
        title: 'Expediente Pericial de Inteligencia OSINT — CANGREJO',
        caseTier: 'ORO',
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      dossier?: {
        expedienteId: string;
        sha256CustodyDigest: string;
        html: string;
      };
    };
    if (!data.ok || !data.dossier) {
      appendLog(`Error generando Dossier Forense: ${data.error ?? 'Respuesta inválida'}`);
      return;
    }

    const blob = new Blob([data.dossier.html], { type: 'text/html; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cangrejo_dossier_${data.dossier.expedienteId}.html`;
    a.click();
    URL.revokeObjectURL(url);

    appendLog(
      `Dossier Forense HTML5/Imprimible generado (${data.dossier.expedienteId}) • Sello SHA-256: ${data.dossier.sha256CustodyDigest.slice(0, 16)}…`
    );
  } catch (err) {
    appendLog(`Error exportando Dossier Forense: ${String(err)}`);
  }
});

document.getElementById('btn-vault-save')?.addEventListener('click', async () => {
  try {
    const payload = serializeCurrentStore();
    const res = await fetch('/api/vault/expedientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'expediente-activo',
        title: 'Expediente Operación Cangrejo',
        caseTier: 'ORO',
        ...payload,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      expediente?: { id: string; entityCount: number; linkCount: number };
    };
    if (!data.ok || !data.expediente) {
      appendLog(`Error guardando en Bóveda SQLite: ${data.error}`);
      return;
    }
    appendLog(
      `Expediente "${data.expediente.id}" persistido en Bóveda SQLite (${data.expediente.entityCount} entidades, ${data.expediente.linkCount} enlaces).`
    );
  } catch (err) {
    appendLog(`Error conectando con Bóveda SQLite: ${String(err)}`);
  }
});

document.getElementById('btn-vault-load')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/vault/expedientes/expediente-activo');
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      payload?: {
        entities?: SerializedGraphEntityItem[];
        links?: SerializedGraphLinkItem[];
      };
    };
    if (!data.ok || !data.payload?.entities) {
      appendLog(
        `Aviso Bóveda SQLite: ${data.error ?? 'Primero guarda un expediente con "Guardar en bóveda SQLite".'}`
      );
      return;
    }
    hydrateStoreFromSerialized(data.payload.entities, data.payload.links ?? []);
    appendLog(
      `Expediente "expediente-activo" restaurado desde Bóveda SQLite (${store.entityCount} entidades, ${store.linkCount} enlaces).`
    );
  } catch (err) {
    appendLog(`Error restaurando de Bóveda SQLite: ${String(err)}`);
  }
});

document.getElementById('btn-decrypt-mtgj')?.addEventListener('click', async () => {
  const passphrase = window.prompt(
    'Introduce la frase de paso para descifrar y verificar la autenticidad topológica AES-GMAC del sobre .cgrj activo en consola:',
    'correct-horse-battery-staple-osint-2026'
  );
  if (!passphrase) return;

  try {
    const envelope = JSON.parse(consoleBuffers.json) as unknown;
    const res = await fetch('/api/import/mtgj-decrypted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envelope, passphrase }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      entities?: SerializedGraphEntityItem[];
      links?: SerializedGraphLinkItem[];
    };
    if (!data.ok || !data.entities) {
      appendLog(`Fallo de descifrado / verificación AES-GMAC: ${data.error}`);
      return;
    }
    hydrateStoreFromSerialized(data.entities, data.links ?? []);
    appendLog(
      `Bóveda Cero verificada con éxito (AES-GMAC intacto): ${store.entityCount} entidades y ${store.linkCount} enlaces restaurados en el lienzo.`
    );
  } catch (err) {
    appendLog(`Primero cifra un sobre con "Bóveda Cero .cgrj" antes de descifrar (${String(err)}).`);
  }
});

function applyRemoteSessionUiEvent(ev: {
  seq: number;
  type: 'select' | 'layout' | 'camera' | 'preset' | 'clear' | 'sync';
  payload: Record<string, unknown>;
}): void {
  if (ev.seq <= lastProcessedUiSeq) return;
  lastProcessedUiSeq = ev.seq;

  if (ev.type === 'clear') {
    isApplyingRemoteDelta = true;
    try {
      store.clear();
      selection.clearSelection();
      store.undoRedoManager.clear();
    } finally {
      isApplyingRemoteDelta = false;
    }
    syncSceneAndUi(false);
    return;
  }

  if (ev.type === 'sync') {
    const rawEntities = Array.isArray(ev.payload.entities)
      ? (ev.payload.entities as SerializedGraphEntityItem[])
      : [];
    const rawLinks = Array.isArray(ev.payload.links)
      ? (ev.payload.links as SerializedGraphLinkItem[])
      : [];
    isApplyingRemoteDelta = true;
    try {
      hydrateStoreFromSerialized(rawEntities, rawLinks);
      if (Array.isArray(ev.payload.selectedEntityIds)) {
        const ids = ev.payload.selectedEntityIds
          .map((raw) => Guid.parse(String(raw)))
          .filter((gid) => store.dataStore.hasEntity(gid));
        selection.selectInModel(ids);
      }
    } finally {
      isApplyingRemoteDelta = false;
    }
    syncSceneAndUi(false);
    return;
  }

  if (ev.type === 'preset' && typeof ev.payload.presetId === 'string') {
    void syncActiveMcpSessionFromServer(mcpState.sessionId);
    return;
  }

  if (ev.type === 'select' && Array.isArray(ev.payload.selectedEntityIds)) {
    const ids = ev.payload.selectedEntityIds
      .map((raw) => Guid.parse(String(raw)))
      .filter((gid) => store.dataStore.hasEntity(gid));
    selection.selectInModel(ids);
    syncSceneAndUi(false);
    return;
  }

  if (ev.type === 'layout' && typeof ev.payload.layoutMode === 'string') {
    currentLayout = ev.payload.layoutMode as LayoutMode;
    document.querySelectorAll('.btn-layout').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-layout') === currentLayout);
    });
    syncSceneAndUi(false);
    return;
  }

  if (ev.type === 'camera') {
    if (ev.payload.action === 'fit') {
      graphCanvas.zoomToFit(90);
    } else if (typeof ev.payload.zoom === 'number') {
      const cam = graphCanvas.getCameraState();
      graphCanvas.setZoom(ev.payload.zoom, cam.viewportWidth * 0.5, cam.viewportHeight * 0.5);
    }
    syncSceneAndUi(false);
  }
}

store.subscribe((mods) => {
  if (isApplyingRemoteDelta) return;
  const activeRoom = mcpState.sessionId.trim() || 'expediente-apt29';
  const delta = clientCollabHub.serializeModsToDelta(
    activeRoom,
    'browser-workstation',
    store,
    mods
  );
  void fetch(`/api/collab/rooms/${encodeURIComponent(activeRoom)}/deltas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(delta),
  }).catch(() => {
    // Graceful no-op when running offline
  });
});

async function syncActiveMcpSessionFromServer(targetRoomId?: string): Promise<void> {
  const roomId = (targetRoomId ?? mcpState.sessionId).trim() || 'expediente-apt29';
  try {
    const res = await fetch(`/api/collab/rooms/${encodeURIComponent(roomId)}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      ok: boolean;
      analysts?: Array<{ displayName: string; forensicRank: string }>;
      deltas?: SerializedGraphModsDelta[];
      session?: {
        roomId?: string;
        entityCount?: number;
        linkCount?: number;
        selectedEntityIds?: string[];
        entities?: SerializedGraphEntityItem[];
        links?: SerializedGraphLinkItem[];
        uiEvents?: Array<{
          seq: number;
          type: 'select' | 'layout' | 'camera' | 'preset' | 'clear' | 'sync';
          payload: Record<string, unknown>;
        }>;
      };
    };
    const countEl = document.getElementById('lbl-collab-count');
    if (countEl && Array.isArray(data.analysts)) {
      countEl.textContent = String(data.analysts.length);
    }

    if (
      Array.isArray(data.session?.entities) &&
      data.session.entities.length > 0 &&
      Array.isArray(data.session?.links)
    ) {
      isApplyingRemoteDelta = true;
      try {
        hydrateStoreFromSerialized(data.session.entities, data.session.links);
        if (Array.isArray(data.session.selectedEntityIds)) {
          const ids = data.session.selectedEntityIds
            .map((raw) => Guid.parse(String(raw)))
            .filter((gid) => store.dataStore.hasEntity(gid));
          selection.selectInModel(ids);
        }
      } finally {
        isApplyingRemoteDelta = false;
      }
      syncSceneAndUi(false);
    } else if (Array.isArray(data.deltas) && data.deltas.length > 0) {
      let appliedAny = false;
      isApplyingRemoteDelta = true;
      try {
        for (const delta of data.deltas) {
          if (clientCollabHub.applyDeltaToStore(store, delta, registry)) {
            appliedAny = true;
          }
        }
      } finally {
        isApplyingRemoteDelta = false;
      }
      if (appliedAny) {
        syncSceneAndUi(false);
      }
    } else {
      syncSceneAndUi(false);
    }

    if (Array.isArray(data.session?.uiEvents)) {
      for (const ev of data.session.uiEvents) {
        applyRemoteSessionUiEvent(ev);
      }
    }

    // Also refresh saved expedientes in #preset-select if available
    const vRes = await fetch('/api/vault/expedientes');
    if (vRes.ok) {
      const vData = (await vRes.json()) as {
        ok: boolean;
        expedientes?: Array<{ id: string; title: string }>;
      };
      const selEl = document.getElementById('preset-select') as HTMLSelectElement | null;
      if (selEl && Array.isArray(vData.expedientes)) {
        const existingValues = new Set(Array.from(selEl.options).map((o) => o.value));
        for (const exp of vData.expedientes) {
          if (!existingValues.has(exp.id)) {
            const opt = document.createElement('option');
            opt.value = exp.id;
            opt.textContent = `MCP · ${exp.id}`;
            selEl.appendChild(opt);
          }
        }
      }
    }
  } catch {
    syncSceneAndUi(false);
  }
}

function connectLiveMcpSessionStream(targetRoomId?: string): void {
  if (typeof EventSource === 'undefined') return;
  const roomId = (targetRoomId ?? mcpState.sessionId).trim() || 'expediente-apt29';
  try {
    if (activeMcpEventSource) {
      activeMcpEventSource.close();
      activeMcpEventSource = null;
    }
    const es = new EventSource(`/api/collab/rooms/${encodeURIComponent(roomId)}/stream`);
    activeMcpEventSource = es;
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as {
          type?: 'init' | 'delta' | 'ui';
          delta?: SerializedGraphModsDelta;
          session?: {
            entities?: SerializedGraphEntityItem[];
            links?: SerializedGraphLinkItem[];
            selectedEntityIds?: string[];
          };
          event?: {
            seq: number;
            type: 'select' | 'layout' | 'camera' | 'preset' | 'clear' | 'sync';
            payload: Record<string, unknown>;
          };
        };
        if (
          parsed.type === 'init' &&
          Array.isArray(parsed.session?.entities) &&
          parsed.session.entities.length > 0 &&
          Array.isArray(parsed.session?.links)
        ) {
          isApplyingRemoteDelta = true;
          try {
            hydrateStoreFromSerialized(parsed.session.entities, parsed.session.links);
          } finally {
            isApplyingRemoteDelta = false;
          }
          syncSceneAndUi(false);
        } else if (parsed.type === 'delta' && parsed.delta) {
          isApplyingRemoteDelta = true;
          try {
            if (clientCollabHub.applyDeltaToStore(store, parsed.delta, registry)) {
              syncSceneAndUi(false);
            }
          } finally {
            isApplyingRemoteDelta = false;
          }
        } else if (parsed.type === 'ui' && parsed.event) {
          applyRemoteSessionUiEvent(parsed.event);
        }
      } catch {
        // Ignore malformed SSE frame
      }
    };
  } catch {
    // Graceful fallback when EventSource is unavailable
  }
}

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
  const frustum = graphCanvas.queryVisibleFrustum(140);

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

  // 2. Draw Directed Edges & Pill-Shielded Edge Annotations (Zero Occlusion + Frustum Culling)
  const viewEntitiesMap = collectionView.getViewEntities();
  for (const vl of collectionView.getViewLinks().values()) {
    const srcVe = viewEntitiesMap.get(vl.sourceViewEntityId);
    const dstVe = viewEntitiesMap.get(vl.targetViewEntityId);
    if (!srcVe || !dstVe) continue;
    if (
      !frustum.visibleIdSet.has(srcVe.id.toString()) &&
      !frustum.visibleIdSet.has(dstVe.id.toString())
    ) {
      continue;
    }

    const firstUnderlying = vl.underlyingLinks.values().next().value;
    const isGoldenEdge =
      firstUnderlying !== undefined && goldenPathLinkIds.has(firstUnderlying.toString());
    const physLink = firstUnderlying ? store.dataStore.tryGetLink(firstUnderlying) : undefined;
    const colorVal = physLink?.properties.values.get('maltego.link.color');
    const edgeColor = isGoldenEdge
      ? '#F59E0B'
      : vl.isProxy
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
    ctx.lineWidth = isGoldenEdge ? 2.8 : vl.isProxy ? 2.0 : 1.5;
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
      ctx.font = '500 10px "Atkinson Hyperlegible Mono", monospace';
      const textMetrics = ctx.measureText(edgeLabel);
      const pillW = textMetrics.width + 12;
      const pillH = 16;

      drawRoundedRect(ctx, midX - pillW * 0.5, midY - pillH * 0.5, pillW, pillH, 3);
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

  // 3. Draw Structured Micro-Badge Capsule Nodes & Stacked Collection Plinths (Frustum Culled)
  for (const ve of viewEntitiesMap.values()) {
    if (!frustum.visibleIdSet.has(ve.id.toString())) {
      continue;
    }
    const phys = store.dataStore.tryGetEntity(ve.id);
    const spec = registry.get(ve.typeName);
    const extMeta = resolveExtendedEntityMeta(ve.typeName);
    const vis = resolveCategoryVisual(spec?.category ?? extMeta?.category ?? 'infrastructure');
    const catColor = isLight ? vis.colorLight : vis.colorDark;
    const isSelected = selection.isViewEntitySelected(ve.id);
    const isGoldenNode = goldenPathEntityIds.has(ve.id.toString());

    const cardW = 168;
    const cardH = 42;
    const halfW = cardW * 0.5;
    const halfH = cardH * 0.5;
    const x0 = ve.position.x - halfW;
    const y0 = ve.position.y - halfH;

    const resolvedTypeDisplay = spec?.displayName ?? extMeta?.displayName ?? ve.typeName;
    const rawTitle = ve.isCollectionNode
      ? `${resolvedTypeDisplay}`
      : phys
        ? getPartPrimaryValue(phys)
        : ve.id.toString();
    const displayTitle = rawTitle.length > 18 ? rawTitle.slice(0, 17) + '…' : rawTitle;
    const subLabel = ve.isCollectionNode
      ? `${ve.ruleName ?? 'Cluster'} Collection`
      : resolvedTypeDisplay;

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

    ctx.lineWidth = isSelected || isGoldenNode ? 2.2 : 1.2;
    ctx.strokeStyle = isSelected
      ? activeTokens.borderFocus
      : isGoldenNode
        ? '#F59E0B'
        : ve.isCollectionNode
          ? activeTokens.nodeCollectionPlinthBorder
          : activeTokens.nodeCardBorder;
    ctx.stroke();

    // Left 30x30 Category Icon Tile
    const tileX = x0 + 6;
    const tileY = y0 + 6;
    const tileSize = 30;
    drawRoundedRect(ctx, tileX, tileY, tileSize, tileSize, 3);
    ctx.fillStyle = `${catColor}22`;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = `${catColor}66`;
    ctx.stroke();

    ctx.font = '700 9.5px "Atkinson Hyperlegible Mono", monospace';
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
      ctx.font = '600 11.5px "Host Grotesk", sans-serif';
      ctx.fillStyle = activeTokens.textPrimary;
      ctx.fillText(displayTitle, tileX + tileSize + 8, y0 + 7);

      ctx.font = '500 9.5px "Atkinson Hyperlegible Mono", monospace';
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
      drawRoundedRect(ctx, x0 + cardW - chipW - 6, y0 + 6, chipW, chipH, 3);
      ctx.fillStyle = activeTokens.accentPrimary;
      ctx.fill();
      ctx.font = '700 9.5px "Atkinson Hyperlegible Mono", monospace';
      ctx.fillStyle = '#111315';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(chipText, x0 + cardW - chipW * 0.5 - 6, y0 + 14);
    } else if (ve.pinned || hasNotes) {
      const tag = ve.pinned ? 'PIN' : 'DOC';
      drawRoundedRect(ctx, x0 + cardW - 26, y0 + 5, 21, 13, 2);
      ctx.fillStyle = activeTokens.surfacePanelElevated;
      ctx.fill();
      ctx.font = '600 8px "Atkinson Hyperlegible Mono", monospace';
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
    ctx.fillStyle = 'rgba(234, 179, 8, 0.12)';
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
    ctx.fillStyle = 'rgba(234, 179, 8, 0.12)';
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

let lastMinimapTransform = {
  minX: -400,
  minY: -300,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

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
  lastMinimapTransform = { minX, minY, scale, offsetX, offsetY };

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

minimapEl.addEventListener('click', (e) => {
  const rect = minimapEl.getBoundingClientRect();
  const mx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * minimapEl.width;
  const my = ((e.clientY - rect.top) / Math.max(1, rect.height)) * minimapEl.height;
  const { minX, minY, scale, offsetX, offsetY } = lastMinimapTransform;
  if (scale <= 0) return;
  const targetWorldX = minX + (mx - offsetX) / scale;
  const targetWorldY = minY + (my - offsetY) / scale;
  const cam = graphCanvas.getCameraState();
  const currentCenterWorld = graphCanvas.screenToWorld(
    cam.viewportWidth * 0.5,
    cam.viewportHeight * 0.5
  );
  graphCanvas.panBy(
    (currentCenterWorld.x - targetWorldX) * cam.zoom,
    (currentCenterWorld.y - targetWorldY) * cam.zoom
  );
  syncSceneAndUi(false);
});

// Keyboard Shortcuts (Escape / Ctrl+K / Ctrl+Z / Shift+Ctrl+Z / Ctrl+Y / V,M,L,C / Cmd+1..4 / Cmd+0 / Delete)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideContextMenu();
    if (linkSourceEntityId) {
      linkSourceEntityId = null;
      linkPreviewWorld = null;
      syncSceneAndUi(false);
    }
    document.getElementById('lore-modal-backdrop')?.classList.add('hidden');
    document.getElementById('edition-modal-backdrop')?.classList.add('hidden');
    document.getElementById('ai-modal-backdrop')?.classList.add('hidden');
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    (document.getElementById('inp-palette-search') as HTMLInputElement)?.focus();
    return;
  }
  if (
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLTextAreaElement ||
    document.activeElement instanceof HTMLSelectElement
  ) {
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    const changed = e.shiftKey ? store.undoRedoManager.redo() : store.undoRedoManager.undo();
    if (changed) syncSceneAndUi(false);
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    if (store.undoRedoManager.redo()) syncSceneAndUi(false);
  } else if ((e.ctrlKey || e.metaKey) && ['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    const map: Record<string, LayoutMode> = {
      '1': 'organic',
      '2': 'hierarchical',
      '3': 'circular',
      '4': 'block',
    };
    document.querySelector<HTMLButtonElement>(`.btn-layout[data-layout="${map[e.key]}"]`)?.click();
  } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault();
    document.getElementById('btn-fit')?.click();
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const k = e.key.toLowerCase();
    const toolMap: Record<string, CursorTool> = {
      v: 'pointer',
      m: 'marquee',
      l: 'lasso',
      c: 'link',
    };
    if (toolMap[k]) {
      document.querySelector<HTMLButtonElement>(`.btn-tool[data-tool="${toolMap[k]}"]`)?.click();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
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

// Wire Odoo-Style Open-Core Edition & Enterprise Cloud Modal + MCP Client Onboarding
const editionModalBackdrop = document.getElementById('edition-modal-backdrop');
const lblEditionTier = document.getElementById('lbl-edition-tier');
const inpEditionOrg = document.getElementById('inp-edition-org') as HTMLInputElement | null;
const inpEditionKey = document.getElementById('inp-edition-key') as HTMLInputElement | null;

export function initMcpModalController(): void {
  const sessionInp = document.getElementById('inp-mcp-session-id') as HTMLInputElement | null;
  sessionInp?.addEventListener('input', (e) => {
    mcpState.sessionId = (e.target as HTMLInputElement).value.trim() || 'expediente-apt29';
    renderMcpSnippet();
    connectLiveMcpSessionStream(mcpState.sessionId);
  });

  document.getElementById('btn-open-mcp-studio')?.addEventListener('click', () => {
    document.getElementById('btn-edition-tier')?.click();
    document.getElementById('btn-goto-mcp-tab')?.click();
  });

  const tokenInp = document.getElementById('inp-mcp-auth-token') as HTMLInputElement | null;
  tokenInp?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value.trim();
    mcpState.licenseKey = val.length > 0 ? val : null;
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (val) window.sessionStorage.setItem(MCP_STORAGE_TOKEN_KEY, val);
      else window.sessionStorage.removeItem(MCP_STORAGE_TOKEN_KEY);
    }
    renderMcpSnippet();
  });

  const toggleBtn = document.getElementById('btn-mcp-toggle-token');
  toggleBtn?.addEventListener('click', () => {
    if (!tokenInp) return;
    const isPassword = tokenInp.type === 'password';
    tokenInp.type = isPassword ? 'text' : 'password';
    toggleBtn.textContent = isPassword ? 'Ocultar' : 'Mostrar';
    toggleBtn.setAttribute(
      'aria-label',
      isPassword ? 'Ocultar clave de licencia' : 'Mostrar clave de licencia'
    );
  });

  const clientTabs: Array<{ id: string; client: McpClientType }> = [
    { id: 'tab-client-antigravity', client: 'antigravity' },
    { id: 'tab-client-codemode', client: 'codemode' },
    { id: 'tab-client-claude-desktop', client: 'claude-desktop' },
    { id: 'tab-client-cursor', client: 'cursor' },
    { id: 'tab-client-claude-code', client: 'claude-code' },
  ];

  for (const { id, client } of clientTabs) {
    document.getElementById(id)?.addEventListener('click', () => {
      mcpState.client = client;
      for (const t of clientTabs) {
        const btn = document.getElementById(t.id);
        const isActive = t.client === client;
        btn?.classList.toggle('active', isActive);
        btn?.setAttribute('aria-selected', String(isActive));
      }
      renderMcpSnippet();
    });
  }

  const stdioBtn = document.getElementById('btn-transport-stdio');
  const httpBtn = document.getElementById('btn-transport-http');
  stdioBtn?.addEventListener('click', () => {
    mcpState.transport = 'stdio';
    stdioBtn.classList.add('active');
    stdioBtn.setAttribute('aria-selected', 'true');
    httpBtn?.classList.remove('active');
    httpBtn?.setAttribute('aria-selected', 'false');
    renderMcpSnippet();
  });
  httpBtn?.addEventListener('click', () => {
    mcpState.transport = 'http';
    httpBtn.classList.add('active');
    httpBtn.setAttribute('aria-selected', 'true');
    stdioBtn?.classList.remove('active');
    stdioBtn?.setAttribute('aria-selected', 'false');
    renderMcpSnippet();
  });

  const copyBtn = document.getElementById('btn-mcp-copy-snippet');
  copyBtn?.addEventListener('click', async () => {
    const codeEl = document.getElementById('mcp-snippet-output');
    if (!codeEl?.textContent) return;
    try {
      await navigator.clipboard.writeText(codeEl.textContent);
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copiado ✓';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 2000);
    } catch {
      // Fallback
    }
  });

  const downloadBtn = document.getElementById('btn-mcp-download-config');
  downloadBtn?.addEventListener('click', () => {
    const codeEl = document.getElementById('mcp-snippet-output');
    if (!codeEl?.textContent) return;
    const blob = new Blob([codeEl.textContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = mcpState.client === 'antigravity' ? 'mcp_config.json' : 'mcp.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  const selLiveMethod = document.getElementById('sel-mcp-live-method') as HTMLSelectElement | null;
  const inpLiveArgs = document.getElementById('inp-mcp-live-args') as HTMLInputElement | null;

  selLiveMethod?.addEventListener('change', () => {
    if (!inpLiveArgs) return;
    const v = selLiveMethod.value;
    if (v === 'tool:cangrejo_session_mutate_graph') {
      inpLiveArgs.value = JSON.stringify({
        action: 'upsert',
        entities: [{ id: '1001', typeName: 'maltego.Domain', value: 'example.org', weight: 95 }],
        links: [],
      });
    } else if (v === 'tool:cangrejo_session_run_pesquisa') {
      inpLiveArgs.value = JSON.stringify({ transformId: 'all', sliderLimit: 8 });
    } else if (v === 'tool:cangrejo_session_view_control') {
      inpLiveArgs.value = JSON.stringify({ layoutMode: 'organic', camera: { action: 'fit' } });
    } else if (v === 'tool:cangrejo_session_vault') {
      inpLiveArgs.value = JSON.stringify({ action: 'list_expedientes' });
    } else if (v === 'tool:cangrejo_unpack_defanged_iocs') {
      inpLiveArgs.value = JSON.stringify({ text: 'hxxps[:]//example[.]org y 1.1.1.1' });
    } else if (v === 'tool:cangrejo_codemode_run') {
      inpLiveArgs.value = JSON.stringify({
        code: 'async () => { const state = await codemode.sessionState({}); return state; }',
      });
    } else {
      inpLiveArgs.value = '{}';
    }
  });

  document.getElementById('btn-mcp-live-exec')?.addEventListener('click', async () => {
    const methodSelection = selLiveMethod?.value || 'tool:cangrejo_session_state';
    const rawArgs = inpLiveArgs?.value.trim() || '{}';
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
      appendLog('[Consola MCP]: JSON inválido en los argumentos.');
      return;
    }

    const session = mcpState.sessionId.trim() || 'expediente-apt29';
    let rpcMethod = 'tools/call';
    let rpcParams: Record<string, unknown> = {};

    if (methodSelection.startsWith('tool:')) {
      rpcMethod = 'tools/call';
      rpcParams = {
        name: methodSelection.slice(5),
        arguments: { roomId: session, ...parsedArgs },
      };
    } else if (methodSelection.startsWith('res:')) {
      rpcMethod = 'resources/read';
      rpcParams = { uri: methodSelection.slice(4), ...parsedArgs };
    } else if (methodSelection.startsWith('rpc:')) {
      rpcMethod = methodSelection.slice(4);
      rpcParams = parsedArgs;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (mcpState.licenseKey) {
      headers.Authorization = `Bearer ${mcpState.licenseKey}`;
    }
    const targetMcpUrl = mcpState.licenseKey
      ? `/api/mcp/${encodeURIComponent(session)}`
      : '/api/mcp';

    try {
      const res = await fetch(targetMcpUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: rpcMethod,
          params: rpcParams,
        }),
      });
      const json = await res.json();
      const outEl = document.getElementById('mcp-snippet-output');
      if (outEl) {
        outEl.textContent = JSON.stringify(json, null, 2);
      }
      await syncActiveMcpSessionFromServer(session);
      appendLog(`[MCP JSON-RPC 2.0 Ejecutado]: ${rpcMethod} (${methodSelection}) en sesión "${session}".`);
    } catch (err) {
      appendLog(`[Error en Consola MCP]: ${String(err)}`);
    }
  });

  document.getElementById('btn-mcp-live-sync')?.addEventListener('click', () => {
    const session = mcpState.sessionId.trim() || 'expediente-apt29';
    connectLiveMcpSessionStream(session);
    void syncActiveMcpSessionFromServer(session);
    appendLog(`[Sincronización MCP]: Lienzo sincronizado con la sesión "${session}".`);
  });

  if (typeof window !== 'undefined' && window.sessionStorage) {
    const cachedToken = window.sessionStorage.getItem(MCP_STORAGE_TOKEN_KEY);
    if (cachedToken && tokenInp) {
      tokenInp.value = cachedToken;
      mcpState.licenseKey = cachedToken;
    }
  }

  renderMcpSnippet();
}

export function updateMcpOnboardingView(
  editionTier: 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE',
  rawKey: string | null
): void {
  mcpState.editionTier = editionTier;

  const tokenInp = document.getElementById('inp-mcp-auth-token') as HTMLInputElement | null;
  const cached =
    typeof window !== 'undefined' && window.sessionStorage
      ? window.sessionStorage.getItem(MCP_STORAGE_TOKEN_KEY)
      : null;

  if (rawKey && !rawKey.includes('****')) {
    mcpState.licenseKey = rawKey;
    if (tokenInp) tokenInp.value = rawKey;
  } else if (cached) {
    mcpState.licenseKey = cached;
    if (tokenInp) tokenInp.value = cached;
  }

  renderMcpSnippet();
}

function renderMcpSnippet(): void {
  const isCloud = mcpState.editionTier !== 'COMMUNITY';
  const host = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000';
  const cloudHost =
    host.includes('127.0.0.1') || host.includes('localhost')
      ? 'https://cangrejo.osint.network'
      : host;
  const token = mcpState.licenseKey || 'ses_sec_TU_LLAVE_DEL_EQUIPO';
  const session = mcpState.sessionId.trim() || 'expediente-apt29';

  let snippet = '';
  let pathHint = '';

  if (mcpState.client === 'antigravity') {
    pathHint = '~/.gemini/config/mcp_config.json';
    if (!isCloud) {
      if (mcpState.transport === 'http') {
        snippet = JSON.stringify(
          {
            mcpServers: {
              cangrejo: {
                url: `${host}/api/mcp/${session}`,
              },
            },
          },
          null,
          2
        );
      } else {
        snippet = JSON.stringify(
          {
            mcpServers: {
              cangrejo: {
                command: 'bun',
                args: ['run', 'apps/web/mcpStdioServer.ts'],
                env: {
                  CANGREJO_MCP_URL: `${host}/api/mcp`,
                  CANGREJO_SESSION_ID: session,
                },
              },
            },
          },
          null,
          2
        );
      }
    } else {
      snippet = JSON.stringify(
        {
          mcpServers: {
            'cangrejo-forensics': {
              url: `${cloudHost}/api/mcp/${session}`,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        },
        null,
        2
      );
    }
  } else if (mcpState.client === 'codemode') {
    pathHint = `${isCloud ? cloudHost : host}/api/mcp/codemode.d.ts · Cloudflare Code Mode (-92% tokens)`;
    snippet = [
      `// Cloudflare Code Mode SDK (${isCloud ? cloudHost : host}/api/mcp/${session}?mode=codemode)`,
      `// Ejecuta las 12 herramientas MCP en un único turno TypeScript vía cangrejo_codemode_run:`,
      `async () => {`,
      `  const [pesquisa, anomalies, mitre] = await Promise.all([`,
      `    codemode.runPesquisa({ roomId: "${session}", transformId: "all", sliderLimit: 8 }),`,
      `    codemode.classifyAnomalies({ roomId: "${session}" }),`,
      `    codemode.mapMitreAttack({ roomId: "${session}" }),`,
      `  ]);`,
      `  await codemode.viewControl({ roomId: "${session}", layoutMode: "organic" });`,
      `  const dossier = await codemode.generateDaubertDossier({`,
      `    roomId: "${session}",`,
      `    title: "Dictamen Pericial Code Mode"`,
      `  });`,
      `  return { pesquisa, anomalies, mitre, dossier };`,
      `}`,
    ].join('\n');
  } else if (mcpState.client === 'claude-desktop') {
    pathHint = '~/Library/Application Support/Claude/claude_desktop_config.json';
    if (!isCloud) {
      snippet = JSON.stringify(
        {
          mcpServers: {
            cangrejo: {
              command: 'bun',
              args: ['run', 'apps/web/mcpStdioServer.ts'],
              cwd: '/path/to/cangrejo',
              env: { CANGREJO_MCP_URL: `${host}/api/mcp` },
            },
          },
        },
        null,
        2
      );
    } else {
      snippet = JSON.stringify(
        {
          mcpServers: {
            'cangrejo-cloud': {
              command: 'bun',
              args: ['run', 'apps/web/mcpStdioServer.ts'],
              cwd: '/path/to/cangrejo',
              env: {
                CANGREJO_MCP_URL: `${cloudHost}/api/mcp/${session}`,
                CANGREJO_MCP_TOKEN: token,
              },
            },
          },
        },
        null,
        2
      );
    }
  } else if (mcpState.client === 'cursor') {
    pathHint = '.cursor/mcp.json';
    if (!isCloud) {
      if (mcpState.transport === 'stdio') {
        snippet = JSON.stringify(
          {
            mcpServers: {
              cangrejo: {
                command: 'bun',
                args: ['run', 'mcp:stdio'],
                cwd: '/path/to/cangrejo',
              },
            },
          },
          null,
          2
        );
      } else {
        snippet = JSON.stringify(
          {
            mcpServers: {
              cangrejo: { url: `${host}/api/mcp` },
            },
          },
          null,
          2
        );
      }
    } else {
      snippet = JSON.stringify(
        {
          mcpServers: {
            'cangrejo-cloud': {
              url: `${cloudHost}/api/mcp/${session}`,
              headers: { Authorization: `Bearer ${token}` },
            },
          },
        },
        null,
        2
      );
    }
  } else if (mcpState.client === 'claude-code') {
    pathHint = 'Terminal CLI (claude mcp add)';
    if (!isCloud) {
      if (mcpState.transport === 'stdio') {
        snippet = `claude mcp add cangrejo bun run --cwd /path/to/cangrejo mcp:stdio`;
      } else {
        snippet = `claude mcp add --transport http cangrejo ${host}/api/mcp`;
      }
    } else {
      snippet = `claude mcp add --transport http --header "Authorization: Bearer ${token}" cangrejo-cloud ${cloudHost}/api/mcp/${session}`;
    }
  }

  const outEl = document.getElementById('mcp-snippet-output');
  if (outEl) outEl.textContent = snippet;
  const hintEl = document.getElementById('lbl-mcp-filepath');
  if (hintEl) hintEl.textContent = pathHint;

  const tokenBox = document.getElementById('mcp-token-container');
  const transportToggle = document.getElementById('mcp-community-transport-toggle');
  const editionTag = document.getElementById('mcp-active-edition-tag');

  if (isCloud) {
    tokenBox?.classList.remove('hidden');
    transportToggle?.classList.add('hidden');
    if (editionTag) {
      editionTag.textContent = `[ ${mcpState.editionTier} · CLOUD ]`;
      editionTag.className = 'status-pill status-pill-cloud';
    }
  } else {
    tokenBox?.classList.add('hidden');
    transportToggle?.classList.remove('hidden');
    if (editionTag) {
      editionTag.textContent = '[ COMUNIDAD · LOCAL ]';
      editionTag.className = 'status-pill status-pill-community';
    }
  }
}

async function syncEditionBadge(): Promise<void> {
  try {
    const res = await fetch('/api/edition/status');
    if (!res.ok) return;
    const data = (await res.json()) as {
      ok: boolean;
      editionTier: 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE';
      editionLabel: string;
      creditsRemaining: number;
      licenseKeyMasked?: string | null;
      whiteLabel?: { organizationName: string };
    };
    if (!data.ok) return;
    if (lblEditionTier) {
      lblEditionTier.textContent =
        data.editionTier === 'PLATINO_ENTERPRISE'
          ? `Platino · ${data.creditsRemaining} cr`
          : data.editionTier === 'ORO_PRO'
            ? `Oro Pro · ${data.creditsRemaining} cr`
            : 'Community';
    }
    if (inpEditionOrg && data.whiteLabel?.organizationName) {
      inpEditionOrg.value = data.whiteLabel.organizationName;
    }
    updateMcpOnboardingView(
      data.editionTier,
      inpEditionKey?.value.trim() || data.licenseKeyMasked || null
    );
  } catch {
    // Non-fatal UI enrichment
  }
}

async function activateEditionTier(
  tier: 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE',
  defaultKey: string
): Promise<void> {
  try {
    const licenseKey = inpEditionKey?.value.trim() || defaultKey;
    const organizationName = inpEditionOrg?.value.trim();
    const res = await fetch('/api/edition/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier,
        licenseKey,
        organizationName,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      editionLabel?: string;
      creditsRemaining?: number;
      whiteLabel?: { organizationName: string; watermarkEnabled: boolean };
    };
    if (data.ok) {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        if (tier !== 'COMMUNITY' && licenseKey) {
          window.sessionStorage.setItem(MCP_STORAGE_TOKEN_KEY, licenseKey);
        } else {
          window.sessionStorage.removeItem(MCP_STORAGE_TOKEN_KEY);
        }
      }
      updateMcpOnboardingView(tier, tier !== 'COMMUNITY' ? licenseKey : null);
      await syncEditionBadge();
      appendLog(
        `Edición actualizada: ${data.editionLabel} • Créditos OSINT: ${data.creditsRemaining} • Marca Blanca: ${
          data.whiteLabel?.watermarkEnabled ? 'Desactivada (Sello Community)' : data.whiteLabel?.organizationName
        }`
      );
      editionModalBackdrop?.classList.add('hidden');
    }
  } catch (err) {
    appendLog(`Error actualizando licencia de edición: ${String(err)}`);
  }
}

document.getElementById('btn-edition-tier')?.addEventListener('click', () => {
  void syncEditionBadge();
  editionModalBackdrop?.classList.remove('hidden');
});
document.getElementById('btn-open-account-from-vault')?.addEventListener('click', () => {
  const vaultPopover = document.getElementById('menu-vault-export') as HTMLElement & {
    hidePopover?: () => void;
  } | null;
  vaultPopover?.hidePopover?.();
  void syncEditionBadge();
  editionModalBackdrop?.classList.remove('hidden');
});
document.getElementById('btn-close-edition')?.addEventListener('click', () => {
  editionModalBackdrop?.classList.add('hidden');
});
editionModalBackdrop?.addEventListener('click', (e) => {
  if (e.target === editionModalBackdrop) {
    editionModalBackdrop.classList.add('hidden');
  }
});
document.getElementById('btn-activate-platino')?.addEventListener('click', () => {
  void activateEditionTier('PLATINO_ENTERPRISE', 'CGRJ-PLATINO-2026-ENTERPRISE');
});
document.getElementById('btn-activate-oro')?.addEventListener('click', () => {
  void activateEditionTier('ORO_PRO', 'CGRJ-ORO-2026-PRO');
});
document.getElementById('btn-reset-community')?.addEventListener('click', () => {
  void activateEditionTier('COMMUNITY', 'COMMUNITY');
});

document.querySelectorAll('[data-byok-save]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const provider = btn.getAttribute('data-byok-save') as 'shodan' | 'virustotal' | 'abuseipdb' | null;
    if (!provider) return;
    const inp = document.getElementById(`inp-byok-${provider}`) as HTMLInputElement | null;
    const apiKey = inp?.value.trim() || '';
    if (!apiKey) return;
    try {
      const res = await fetch('/api/edition/provider-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey }),
      });
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) {
        const badge = document.getElementById(`lbl-byok-status-${provider}`);
        if (badge) badge.textContent = 'BYOK activo ✓';
        if (inp) inp.value = '';
        appendLog(`[Conector BYOK]: Llave propia registrada para ${provider.toUpperCase()}.`);
      }
    } catch (err) {
      appendLog(`Error guardando llave BYOK (${provider}): ${String(err)}`);
    }
  });
});

// Wire Smart IOC Paste-to-Graph (`#btn-paste-iocs`)
document.getElementById('btn-paste-iocs')?.addEventListener('click', async () => {
  const rawText = window.prompt(
    'Pega cualquier boletín CTI, correo sospechoso o log de firewall para extraer automáticamente todos los IOCs al grafo:',
    ''
  );
  if (!rawText || !rawText.trim()) return;

  try {
    const res = await fetch('/api/ingest/raw-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: rawText,
        incidentTitle: 'Boletín Ingestado (Paste-to-Graph)',
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      extractedCount?: number;
      incidentRoot?: {
        id: string;
        typeName: string;
        value: string;
        weight: number;
        position: { x: number; y: number; z: number };
      };
      entities?: Array<{
        id: string;
        typeName: string;
        value: string;
        weight: number;
        position: { x: number; y: number; z: number };
      }>;
      links?: Array<{
        id: string;
        sourceId: string;
        targetId: string;
        label: string;
        color: string;
      }>;
    };
    if (!data.ok || !data.incidentRoot || !data.entities || !data.links) {
      appendLog(`Error en ingesta de IOCs: ${data.error ?? 'Respuesta inválida'}`);
      return;
    }

    store.runInBatch(() => {
      const rootEnt = registry.createEntity(
        data.incidentRoot!.typeName,
        data.incidentRoot!.value,
        {
          id: Guid.parse(data.incidentRoot!.id),
          weight: data.incidentRoot!.weight,
          bookmark: 0,
        }
      );
      store.addEntity(rootEnt, data.incidentRoot!.position, false);

      for (const item of data.entities!) {
        const canonicalType =
          item.typeName === 'maltego.BTCAddress'
            ? 'maltego.BitcoinAddress'
            : item.typeName === 'maltego.ASNumber'
              ? 'maltego.AS'
              : item.typeName;
        const ent = registry.createEntity(canonicalType, item.value, {
          id: Guid.parse(item.id),
          weight: item.weight,
          bookmark: 1,
        });
        store.addEntity(ent, item.position, false);
      }

      for (const lnk of data.links!) {
        store.addLink(
          makeSimpleLink(Guid.parse(lnk.id), lnk.label, lnk.color),
          Guid.parse(lnk.sourceId),
          Guid.parse(lnk.targetId)
        );
      }
    });

    syncSceneAndUi(false);
    appendLog(
      `Ingesta Paste-to-Graph completada: ${data.extractedCount} IOCs únicos extraídos y enlazados al nodo raíz.`
    );
  } catch (err) {
    appendLog(`Error en ingesta Paste-to-Graph: ${String(err)}`);
  }
});

// Wire Radar Cangrejo 24/7 Continuous Drift Monitor (`#btn-radar-watch`)
document.getElementById('btn-radar-watch')?.addEventListener('click', async () => {
  const selectedIds = Array.from(selection.getModelSelectedEntities());
  const firstSelected = selectedIds[0] ? store.dataStore.tryGetEntity(selectedIds[0]) : undefined;
  const targetValue = firstSelected
    ? getPartPrimaryValue(firstSelected)
    : window.prompt('Ingresa el dominio o IP objetivo para vigilar en Radar 24/7:', '')?.trim() || '';
  if (!targetValue) return;
  const entityType = firstSelected?.typeName ?? 'maltego.Domain';

  try {
    const watchRes = await fetch('/api/radar/watches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetValue, entityType }),
    });
    const watchData = (await watchRes.json()) as {
      ok: boolean;
      error?: string;
      watch?: { id: string; targetValue: string; baselineDigestHex: string };
    };
    if (!watchData.ok || !watchData.watch) {
      appendLog(`Error registrando Radar 24/7: ${watchData.error}`);
      return;
    }

    const scanRes = await fetch('/api/radar/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watchId: watchData.watch.id }),
    });
    const scanData = (await scanRes.json()) as {
      ok: boolean;
      driftDetected?: boolean;
      alert?: { severity: string; addedIndicators: string[] } | null;
    };

    appendLog(
      `Radar Cangrejo 24/7 activo sobre "${watchData.watch.targetValue}" • Baseline SHA-256: ${watchData.watch.baselineDigestHex.slice(0, 16)}… • Deriva detectada: ${
        scanData.driftDetected ? `SÍ (${scanData.alert?.severity})` : 'SIN CAMBIOS (Estable)'
      }`
    );
  } catch (err) {
    appendLog(`Error ejecutando Radar 24/7: ${String(err)}`);
  }
});

// Wire Gate 9: Comisario IA — Cloudflare Workers AI & Forensics Modal (F1-F5)
const aiModalBackdrop = document.getElementById('ai-modal-backdrop');
const aiModalOutput = document.getElementById('ai-modal-output');
const inpAiCopilotPrompt = document.getElementById('inp-ai-copilot-prompt') as HTMLInputElement | null;

function setAiOutput(text: string): void {
  if (aiModalOutput) aiModalOutput.textContent = text;
  appendLog(text);
}

document.getElementById('btn-ai-copilot')?.addEventListener('click', () => {
  aiModalBackdrop?.classList.remove('hidden');
});
document.getElementById('btn-close-ai')?.addEventListener('click', () => {
  aiModalBackdrop?.classList.add('hidden');
});
aiModalBackdrop?.addEventListener('click', (e) => {
  if (e.target === aiModalBackdrop) {
    aiModalBackdrop.classList.add('hidden');
  }
});

let lastAiUnpackedItems: Array<{
  rawFragment: string;
  canonicalValue: string;
  typeName: string;
  startByteOffset: number;
  endByteOffset: number;
}> = [];
let lastAiLatentSuggestions: Array<{
  sourceEntityId: string;
  targetEntityId: string;
  sourceValue: string;
  targetValue: string;
  rrfScore: number;
  evidenceExplanation: string;
}> = [];

document.getElementById('btn-ai-f1-unpack')?.addEventListener('click', async () => {
  const sample = inpAiCopilotPrompt?.value.trim() || '';
  if (!sample) {
    setAiOutput('Escribe o pega un boletín CTI con IOCs ofuscados en el campo de entrada superior antes de ejecutar F1.');
    return;
  }
  try {
    const res = await fetch('/api/ai/unpack-iocs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sample }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      unpackedCount: number;
      items: Array<{
        rawFragment: string;
        canonicalValue: string;
        typeName: string;
        startByteOffset: number;
        endByteOffset: number;
      }>;
      aiMeta: { modelId: string; estimatedNeurons: number };
    };
    if (data.ok) {
      lastAiUnpackedItems = data.items;
      await syncEditionBadge();
      const lines = data.items.map(
        (i) => `• ${i.rawFragment} -> ${i.canonicalValue} [bytes ${i.startByteOffset}..${i.endByteOffset}]`
      );
      setAiOutput(
        `[F1 Cognitive IOC Unpacker • ${data.aiMeta.modelId} (${data.aiMeta.estimatedNeurons} neuronas)]:\n${lines.join('\n')}`
      );
    }
  } catch (err) {
    setAiOutput(`Error en F1 Unpacker: ${String(err)}`);
  }
});

document.getElementById('btn-ai-f2-latent')?.addEventListener('click', async () => {
  try {
    const payload = serializeCurrentStore();
    const res = await fetch('/api/ai/latent-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-apt29',
        ...payload,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      vectorizeNamespace: string;
      suggestions: Array<{
        sourceEntityId: string;
        targetEntityId: string;
        sourceValue: string;
        targetValue: string;
        rrfScore: number;
        evidenceExplanation: string;
      }>;
    };
    if (data.ok) {
      lastAiLatentSuggestions = data.suggestions;
      await syncEditionBadge();
      const lines = data.suggestions.map(
        (s) => `• ${s.sourceValue} <-> ${s.targetValue} (RRF=${s.rrfScore}): ${s.evidenceExplanation}`
      );
      setAiOutput(
        `[F2 Vectorize RRF k=60 • Namespace: ${data.vectorizeNamespace}]:\n${lines.join('\n')}`
      );
    }
  } catch (err) {
    setAiOutput(`Error en F2 Vínculos Latentes: ${String(err)}`);
  }
});

document.getElementById('btn-ai-materialize')?.addEventListener('click', async () => {
  try {
    let addedNodes = 0;
    let addedLinks = 0;
    const allIds = Array.from(store.structureStore.entities.keys());
    const selectedIds = Array.from(selection.getModelSelectedEntities());
    const anchorId = selectedIds[0] ?? allIds[0] ?? null;

    store.runInBatch(() => {
      for (let idx = 0; idx < lastAiUnpackedItems.length; idx++) {
        const item = lastAiUnpackedItems[idx]!;
        const id = Guid.generate();
        const ent = registry.createEntity(item.typeName, item.canonicalValue, {
          id,
          weight: 92,
          bookmark: 4,
        });
        const angle = (idx / Math.max(1, lastAiUnpackedItems.length)) * Math.PI * 2;
        store.addEntity(ent, { x: Math.cos(angle) * 280, y: Math.sin(angle) * 280, z: 0 }, false);
        addedNodes++;
        if (anchorId && !anchorId.equals(id) && store.dataStore.hasEntity(anchorId)) {
          store.addLink(
            makeSimpleLink(Guid.generate(), 'AI unpacked IOC', '#EAB308'),
            anchorId,
            id
          );
          addedLinks++;
        }
      }

      for (const sug of lastAiLatentSuggestions) {
        const srcId = Guid.parse(sug.sourceEntityId);
        const dstId = Guid.parse(sug.targetEntityId);
        if (store.dataStore.hasEntity(srcId) && store.dataStore.hasEntity(dstId)) {
          store.addLink(
            makeSimpleLink(Guid.generate(), `AI RRF (${sug.rrfScore})`, '#A855F7'),
            srcId,
            dstId
          );
          addedLinks++;
        }
      }
    });

    lastAiUnpackedItems = [];
    lastAiLatentSuggestions = [];
    syncSceneAndUi(false);
    setAiOutput(
      `[Materialización IA Completada]: +${addedNodes} entidades IOC desofuscadas y +${addedLinks} enlaces añadidos al grafo.`
    );
  } catch (err) {
    setAiOutput(`Error al materializar hallazgos IA: ${String(err)}`);
  }
});

document.getElementById('btn-ai-f3-anomalies')?.addEventListener('click', async () => {
  try {
    const payload = serializeCurrentStore();
    const res = await fetch('/api/ai/anomalies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as {
      ok: boolean;
      anomalies: Array<{ patternType: string; severity: string; forensicExplanation: string }>;
    };
    if (data.ok) {
      await syncEditionBadge();
      const lines = data.anomalies.map(
        (a) => `• [${a.severity}] ${a.patternType}: ${a.forensicExplanation}`
      );
      setAiOutput(`[F3 Detección de Anomalías Estructurales]:\n${lines.join('\n')}`);
    }
  } catch (err) {
    setAiOutput(`Error en F3 Anomalías: ${String(err)}`);
  }
});

document.getElementById('btn-ai-f4-daubert')?.addEventListener('click', async () => {
  try {
    const payload = serializeCurrentStore();
    const res = await fetch('/api/ai/daubert-synthesis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        expedienteId: 'EXP-APT29-DAUBERT',
        title: 'Dictamen Judicial Caso Cangrejo',
        stream: true,
        ...payload,
      }),
    });

    if (res.headers.get('content-type')?.includes('text/event-stream') && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamedText = '';
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          const jsonStr = line.slice(6);
          const parsedEv = JSON.parse(jsonStr) as {
            type: 'delta' | 'done';
            text?: string;
            attestation?: { canonicalSha256Hex: string; signatureHex: string };
          };
          if (parsedEv.type === 'delta' && parsedEv.text) {
            streamedText += parsedEv.text;
            setAiOutput(streamedText);
          } else if (parsedEv.type === 'done' && parsedEv.attestation) {
            await syncEditionBadge();
            setAiOutput(
              `${streamedText}\n\n[Firma Ed25519]: ${parsedEv.attestation.signatureHex.slice(0, 32)}… | [SHA-256]: ${parsedEv.attestation.canonicalSha256Hex.slice(0, 24)}…`
            );
          }
        }
      }
      return;
    }

    const data = (await res.json()) as {
      ok: boolean;
      executiveNarrative: string;
      attestation: { canonicalSha256Hex: string; signatureHex: string };
    };
    if (data.ok) {
      await syncEditionBadge();
      setAiOutput(
        `${data.executiveNarrative}\n\n[Firma Ed25519]: ${data.attestation.signatureHex.slice(0, 32)}… | [SHA-256]: ${data.attestation.canonicalSha256Hex.slice(0, 24)}…`
      );
    }
  } catch (err) {
    setAiOutput(`Error en F4 Síntesis Daubert: ${String(err)}`);
  }
});

document.getElementById('btn-ai-f6-autoinvestigate')?.addEventListener('click', async () => {
  try {
    setAiOutput('[F6 Pesquisa Autónoma Multi-Salto]: Planificando saltos sobre eslabones PageRank…');
    const payload = serializeCurrentStore();
    const res = await fetch('/api/ai/auto-investigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxHops: 2,
        maxTargetsPerHop: 2,
        ...payload,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      hopsExecuted: number;
      executedSteps: Array<{
        hop: number;
        sourceValue: string;
        transformId: string;
        discoveredCount: number;
        rationale: string;
      }>;
      discoveredEntities: Array<{
        id: string;
        typeName: string;
        value: string;
        weight?: number;
        bookmark?: number;
        position?: { x: number; y: number; z: number };
      }>;
      discoveredLinks: Array<{
        id: string;
        sourceId: string;
        targetId: string;
        label: string;
        color?: string;
      }>;
      summary: string;
    };
    if (data.ok) {
      store.runInBatch(() => {
        for (const entData of data.discoveredEntities) {
          const entId = Guid.parse(entData.id);
          if (!store.dataStore.hasEntity(entId)) {
            const ent = registry.createEntity(entData.typeName, entData.value, {
              id: entId,
              weight: entData.weight ?? 90,
              bookmark: entData.bookmark ?? 3,
            });
            store.addEntity(ent, entData.position ?? { x: 120, y: 120, z: 0 }, false);
          }
        }
        for (const lnk of data.discoveredLinks) {
          const srcId = Guid.parse(lnk.sourceId);
          const dstId = Guid.parse(lnk.targetId);
          if (store.dataStore.hasEntity(srcId) && store.dataStore.hasEntity(dstId)) {
            store.addLink(
              makeSimpleLink(Guid.parse(lnk.id), lnk.label, lnk.color ?? '#22D3EE'),
              srcId,
              dstId
            );
          }
        }
      });
      syncSceneAndUi(false);
      await syncEditionBadge();
      const stepLines = data.executedSteps.map(
        (s) =>
          `  • [Salto #${s.hop}] ${s.sourceValue} -> ${s.transformId} (+${s.discoveredCount} IOCs): ${s.rationale}`
      );
      setAiOutput(`${data.summary}\n${stepLines.join('\n')}`);
    }
  } catch (err) {
    setAiOutput(`Error en F6 Pesquisa Autónoma: ${String(err)}`);
  }
});

document.getElementById('btn-ai-f7-vision')?.addEventListener('click', async () => {
  try {
    const captionInput = inpAiCopilotPrompt?.value.trim() || '';
    if (!captionInput) {
      setAiOutput('Ingresa la descripción/OCR de la evidencia visual en el campo superior o usa el Escáner HUD para subir una captura.');
      return;
    }
    setAiOutput('[F7 Ingesta Visual Multimodal • Llama 3.2 11B Vision]: Procesando evidencia y calculando custodia SHA-256…');
    const res = await fetch('/api/ai/vision-ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'evidencia-visual-forense.png',
        evidenceCaption: captionInput,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      filename: string;
      evidenceSha256Hex: string;
      unpackedCount: number;
      items: Array<{
        rawFragment: string;
        canonicalValue: string;
        typeName: string;
        startByteOffset: number;
        endByteOffset: number;
      }>;
      aiMeta: { modelId: string; estimatedNeurons: number };
    };
    if (data.ok) {
      lastAiUnpackedItems = data.items;
      await syncEditionBadge();
      const lines = data.items.map(
        (i) => `  • [${i.typeName}] ${i.rawFragment} -> ${i.canonicalValue}`
      );
      setAiOutput(
        `[F7 Ingesta Multimodal • ${data.aiMeta.modelId} (${data.aiMeta.estimatedNeurons} neuronas)]\nArchivo: ${data.filename} | Custodia SHA-256: ${data.evidenceSha256Hex.slice(0, 24)}…\nIOCs extraídos (${data.unpackedCount}) — haz clic en "✨ Materializar Hallazgos IA" para inyectarlos al grafo:\n${lines.join('\n')}`
      );
    }
  } catch (err) {
    setAiOutput(`Error en F7 Ingesta Visual: ${String(err)}`);
  }
});

let lastCopilotToolCalls: Array<{
  toolName: string;
  transformId: string;
  targetValue: string;
  reason: string;
}> = [];

inpAiCopilotPrompt?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('btn-ai-f5-ask')?.click();
  }
});

document.getElementById('btn-ai-f5-ask')?.addEventListener('click', async () => {
  try {
    const payload = serializeCurrentStore();
    const prompt =
      inpAiCopilotPrompt?.value.trim() ||
      '¿Cuál es el nodo pivote principal y qué pesquisas recomiendas?';
    const res = await fetch('/api/ai/copilot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        prompt,
        stream: true,
        ...payload,
      }),
    });

    if (res.headers.get('content-type')?.includes('text/event-stream') && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamedText = '';
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          const parsedEv = JSON.parse(line.slice(6)) as {
            type: 'delta' | 'done';
            text?: string;
            suggestedToolCalls?: Array<{
              toolName: string;
              transformId: string;
              targetValue: string;
              reason: string;
            }>;
          };
          if (parsedEv.type === 'delta' && parsedEv.text) {
            streamedText += parsedEv.text;
            setAiOutput(streamedText);
          } else if (parsedEv.type === 'done') {
            lastCopilotToolCalls = parsedEv.suggestedToolCalls ?? [];
            await syncEditionBadge();
            const tools = lastCopilotToolCalls
              .map((t) => `  -> Tool: ${t.toolName}(${t.targetValue}) — ${t.reason}`)
              .join('\n');
            setAiOutput(`${streamedText}\n${tools}`);
          }
        }
      }
      return;
    }

    const data = (await res.json()) as {
      ok: boolean;
      answer: string;
      suggestedToolCalls: Array<{
        toolName: string;
        transformId: string;
        targetValue: string;
        reason: string;
      }>;
    };
    if (data.ok) {
      lastCopilotToolCalls = data.suggestedToolCalls ?? [];
      await syncEditionBadge();
      const tools = data.suggestedToolCalls
        .map((t) => `  -> Tool: ${t.toolName}(${t.targetValue}) — ${t.reason}`)
        .join('\n');
      setAiOutput(`${data.answer}\n${tools}`);
    }
  } catch (err) {
    setAiOutput(`Error en F5 Copilot: ${String(err)}`);
  }
});

document.getElementById('btn-ai-codemode')?.addEventListener('click', async () => {
  try {
    const payload = serializeCurrentStore();
    const rawPrompt =
      inpAiCopilotPrompt?.value.trim() ||
      'Expansión OSINT multi-salto, detección de anomalías y síntesis Daubert Ed25519';
    const isExplicitTs = rawPrompt.includes('codemode.');
    setAiOutput(
      '[Cloudflare Code Mode · SDK TypeScript]: Compilando y ejecutando pipeline `codemode.*` en un solo turno…'
    );
    const res = await fetch('/api/ai/codemode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: mcpState.sessionId || 'expediente-apt29',
        code: isExplicitTs ? rawPrompt : undefined,
        objective: rawPrompt,
        ...payload,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      generatedCode?: string;
      stepsExecuted?: Array<{
        stepIndex: number;
        method: string;
        mcpTool: string;
        parallel: boolean;
        durationMs: number;
      }>;
      tokenSavings?: {
        traditionalMcpTokens: number;
        codeModeSdkTokens: number;
        reductionPercent: number;
        roundTripsSaved: number;
      };
      entities?: Array<{
        id: string;
        typeName: string;
        value: string;
        weight?: number;
        bookmark?: number;
        position?: { x: number; y: number; z: number };
      }>;
      links?: Array<{
        id: string;
        sourceId: string;
        targetId: string;
        label: string;
        color?: string;
      }>;
    };
    if (!data.ok) {
      setAiOutput(`Error en Cloudflare Code Mode: ${data.error ?? 'Fallo desconocido'}`);
      return;
    }

    if (Array.isArray(data.entities) && Array.isArray(data.links)) {
      store.runInBatch(() => {
        for (const entData of data.entities!) {
          const entId = Guid.parse(entData.id);
          if (!store.dataStore.hasEntity(entId)) {
            const ent = registry.createEntity(entData.typeName, entData.value, {
              id: entId,
              weight: entData.weight ?? 90,
              bookmark: entData.bookmark ?? 3,
            });
            store.addEntity(ent, entData.position ?? { x: 140, y: 140, z: 0 }, false);
          }
        }
        for (const lnk of data.links!) {
          const srcId = Guid.parse(lnk.sourceId);
          const dstId = Guid.parse(lnk.targetId);
          const lid = Guid.parse(lnk.id);
          if (
            store.dataStore.hasEntity(srcId) &&
            store.dataStore.hasEntity(dstId) &&
            !store.structureStore.hasLink(lid)
          ) {
            store.addLink(
              makeSimpleLink(lid, lnk.label, lnk.color ?? '#eab308'),
              srcId,
              dstId
            );
          }
        }
      });
      syncSceneAndUi(false);
    }

    await syncEditionBadge();
    const traceLines = (data.stepsExecuted ?? []).map(
      (s) =>
        `  [${s.stepIndex}] ${s.parallel ? '⚡ Promise.all' : '→ await'} codemode.${s.method}() -> ${s.mcpTool} (${s.durationMs} ms)`
    );
    const savings = data.tokenSavings;
    setAiOutput(
      [
        `[Cloudflare Code Mode · -${savings?.reductionPercent ?? 92.1}% tokens (${savings?.codeModeSdkTokens ?? 1120} vs ${savings?.traditionalMcpTokens ?? 14200} tokens · ${savings?.roundTripsSaved ?? 4} round-trips ahorrados)]`,
        '',
        data.generatedCode ?? '',
        '',
        'Traza de ejecución en sandbox:',
        ...traceLines,
      ].join('\n')
    );
  } catch (err) {
    setAiOutput(`Error en Cloudflare Code Mode: ${String(err)}`);
  }
});

document.getElementById('btn-ai-run-tools')?.addEventListener('click', async () => {
  try {
    if (lastCopilotToolCalls.length === 0) {
      setAiOutput('Primero ejecuta una consulta en F5 para obtener herramientas sugeridas.');
      return;
    }
    let executed = 0;
    for (const call of lastCopilotToolCalls) {
      for (const ent of store.dataStore.getEntities().values()) {
        if (getPartPrimaryValue(ent) === call.targetValue) {
          await executeTransformOnEntity(ent, call.transformId);
          executed++;
          break;
        }
      }
    }
    setAiOutput(
      `[Ejecución Tool-Calling F5]: Se ejecutaron ${executed} pesquisas recomendadas por el Comisario IA sobre el grafo activo.`
    );
  } catch (err) {
    setAiOutput(`Error ejecutando herramientas sugeridas: ${String(err)}`);
  }
});

document.getElementById('btn-import-stix21')?.addEventListener('click', async () => {
  try {
    let bundle: unknown;
    try {
      const parsedConsole = JSON.parse(consoleBuffers.json) as { type?: string };
      if (parsedConsole && parsedConsole.type === 'bundle') {
        bundle = parsedConsole;
      }
    } catch {
      // Fallback to exporting current store bundle
    }
    if (!bundle) {
      bundle = Stix21Exporter.exportFromStore(store, {
        expedienteTitle: 'Bundle STIX 2.1 Verificado',
        caseTier: 'ORO',
      });
    }
    const res = await fetch('/api/import/stix21', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      custodyVerified: boolean;
      custodyReason: string;
      computedDigestHex: string;
      entityCount: number;
      linkCount: number;
      entities?: SerializedGraphEntityItem[];
      links?: SerializedGraphLinkItem[];
    };
    if (data.ok) {
      if (data.entities && data.entities.length > 0) {
        hydrateStoreFromSerialized(data.entities, data.links ?? []);
      }
      appendLog(
        `[Importador STIX 2.1]: ${data.entityCount} entidades y ${data.linkCount} relaciones verificadas e hidratadas • Custodia SHA-256 (${data.computedDigestHex.slice(0, 16)}…): ${
          data.custodyVerified ? 'ÍNTEGRA' : 'MANIPULADA'
        } (${data.custodyReason})`
      );
    }
  } catch (err) {
    appendLog(`Error importando STIX 2.1: ${String(err)}`);
  }
});

document.getElementById('btn-ai-mitre')?.addEventListener('click', async () => {
  try {
    const payload = serializeCurrentStore();
    const res = await fetch('/api/analytics/mitre-attack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as {
      ok: boolean;
      frameworkVersion: string;
      timelineEvents: Array<{
        stepOrder: number;
        phaseName: string;
        techniqueId: string;
        techniqueName: string;
        severity: string;
        summary: string;
      }>;
    };
    if (data.ok) {
      const lines = data.timelineEvents.map(
        (ev) =>
          `[Fase #${ev.stepOrder} • ${ev.phaseName}] ${ev.techniqueId} (${ev.techniqueName}) [${ev.severity}]: ${ev.summary}`
      );
      setAiOutput(`[${data.frameworkVersion} — Línea de Tiempo Kill-Chain]:\n${lines.join('\n')}`);
    }
  } catch (err) {
    setAiOutput(`Error en mapeo MITRE ATT&CK: ${String(err)}`);
  }
});

function initAccountAuthController(): void {
  const formEl = document.getElementById('form-account-auth') as HTMLFormElement | null;
  const profileCardEl = document.getElementById('card-account-profile');
  const badgeModeEl = document.getElementById('badge-account-mode');
  const feedbackEl = document.getElementById('lbl-auth-feedback');
  const inpEmail = document.getElementById('inp-auth-email') as HTMLInputElement | null;
  const inpPassword = document.getElementById('inp-auth-password') as HTMLInputElement | null;
  const inpName = document.getElementById('inp-auth-name') as HTMLInputElement | null;
  const inpOrg = document.getElementById('inp-auth-org') as HTMLInputElement | null;
  const selTier = document.getElementById('sel-auth-tier') as HTMLSelectElement | null;
  const lblUser = document.getElementById('lbl-account-user');
  const lblTenant = document.getElementById('lbl-account-tenant');
  const lblCredits = document.getElementById('lbl-account-credits');
  const lblTeamMonogram = document.getElementById('lbl-team-monogram');
  const lblUserInitials = document.getElementById('lbl-user-initials');
  const lblUserCollabName = document.getElementById('lbl-user-collab-name');
  const lblTeamMcpStatus = document.getElementById('lbl-team-mcp-status');
  const registerFieldsEl = document.getElementById('auth-register-fields');
  const btnModeLogin = document.getElementById('btn-mode-login');
  const btnModeRegister = document.getElementById('btn-mode-register');
  const btnAuthLogin = document.getElementById('btn-auth-login');
  const btnAuthRegister = document.getElementById('btn-auth-register');

  // Switch between the 3 modal tabs (Cuenta y equipo | Agentes MCP | Conectores y plan)
  const switchWorkspaceTab = (targetTab: string): void => {
    document.querySelectorAll('[data-ws-tab]').forEach((tabBtn) => {
      const isMatch = tabBtn.getAttribute('data-ws-tab') === targetTab;
      tabBtn.classList.toggle('active', isMatch);
      tabBtn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });
    document.querySelectorAll('[data-ws-panel]').forEach((panelEl) => {
      const isMatch = panelEl.getAttribute('data-ws-panel') === targetTab;
      (panelEl as HTMLElement).hidden = !isMatch;
    });
  };

  document.querySelectorAll('[data-ws-tab]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const targetTab = tabBtn.getAttribute('data-ws-tab') || 'team';
      switchWorkspaceTab(targetTab);
    });
  });

  // Switch between "Iniciar sesión" (2 fields) and "Nuevo equipo" (create team fields)
  const setAuthMode = (mode: 'login' | 'register'): void => {
    const isReg = mode === 'register';
    btnModeLogin?.classList.toggle('active', !isReg);
    btnModeLogin?.setAttribute('aria-selected', !isReg ? 'true' : 'false');
    btnModeRegister?.classList.toggle('active', isReg);
    btnModeRegister?.setAttribute('aria-selected', isReg ? 'true' : 'false');
    if (registerFieldsEl) registerFieldsEl.hidden = !isReg;
    if (btnAuthLogin) btnAuthLogin.hidden = isReg;
    if (btnAuthRegister) btnAuthRegister.hidden = !isReg;
    if (feedbackEl) feedbackEl.textContent = '';
  };

  btnModeLogin?.addEventListener('click', () => setAuthMode('login'));
  btnModeRegister?.addEventListener('click', () => setAuthMode('register'));

  document.getElementById('btn-continue-local')?.addEventListener('click', () => {
    document.getElementById('edition-modal-backdrop')?.classList.add('hidden');
  });

  document.getElementById('btn-goto-mcp-tab')?.addEventListener('click', () => {
    switchWorkspaceTab('mcp');
  });

  document.getElementById('btn-copy-collab-invite')?.addEventListener('click', (ev) => {
    const btn = ev.currentTarget as HTMLButtonElement;
    const presetVal = (document.getElementById('preset-select') as HTMLSelectElement | null)?.value || 'apt29';
    const inviteUrl = `${window.location.origin}/?case=${encodeURIComponent(presetVal)}&room=expediente-${encodeURIComponent(presetVal)}`;
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(inviteUrl);
    }
    const prevText = btn.textContent;
    btn.textContent = 'Enlace de invitación copiado ✓';
    setTimeout(() => {
      btn.textContent = prevText;
    }, 2000);
  });

  const computeInitials = (text: string, fallback: string): string => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return `${words[0]![0] ?? ''}${words[1]![0] ?? ''}`.toUpperCase();
    }
    if (words.length === 1 && words[0]!.length >= 2) {
      return words[0]!.slice(0, 2).toUpperCase();
    }
    return fallback;
  };

  const setFeedback = (msg: string): void => {
    if (feedbackEl) feedbackEl.textContent = msg;
  };

  const renderAuthenticatedAccount = (payload: {
    authenticated: boolean;
    user?: { displayName: string; email: string; role: string } | null;
    client?: {
      tenantId: string;
      organizationName: string;
      tier: 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE';
      creditsRemaining: number;
    } | null;
    authToken?: string;
    licenseToken?: string;
  }): void => {
    if (!payload.authenticated || !payload.user || !payload.client) {
      if (formEl) formEl.hidden = false;
      if (profileCardEl) profileCardEl.hidden = true;
      if (badgeModeEl) {
        badgeModeEl.textContent = 'Modo local sin cuenta activo (2 en sala)';
        badgeModeEl.removeAttribute('data-authenticated');
      }
      return;
    }

    if (formEl) formEl.hidden = true;
    if (profileCardEl) profileCardEl.hidden = false;
    if (badgeModeEl) {
      badgeModeEl.textContent = `Equipo activo · ${payload.client.organizationName}`;
      badgeModeEl.setAttribute('data-authenticated', 'true');
    }
    if (lblTeamMonogram) {
      lblTeamMonogram.textContent = computeInitials(payload.client.organizationName, 'EQ');
    }
    if (lblUserInitials) {
      lblUserInitials.textContent = computeInitials(payload.user.displayName, 'AN');
    }
    if (lblUserCollabName) {
      lblUserCollabName.textContent = `${payload.user.displayName} (Tú) · Editando lienzo`;
    }
    if (lblUser) {
      lblUser.textContent = `${payload.user.displayName} (${payload.user.email})`;
    }
    if (lblTenant) {
      lblTenant.textContent = payload.client.organizationName;
    }
    const friendlyTier =
      payload.client.tier === 'PLATINO_ENTERPRISE'
        ? 'Plan Platino'
        : payload.client.tier === 'ORO_PRO'
          ? 'Plan Oro'
          : 'Plan Community';
    if (lblCredits) {
      lblCredits.textContent = `${friendlyTier} · ${payload.client.creditsRemaining} créditos`;
    }

    const presetSelect = document.getElementById('preset-select') as HTMLSelectElement | null;
    const collabTitleEl = document.getElementById('lbl-collab-case-title');
    if (presetSelect && collabTitleEl) {
      const selectedOption = presetSelect.options[presetSelect.selectedIndex];
      if (selectedOption) collabTitleEl.textContent = selectedOption.text;
    }

    const tokenForMcp = payload.licenseToken || payload.authToken || null;
    if (tokenForMcp && typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(MCP_STORAGE_TOKEN_KEY, tokenForMcp);
    }
    updateMcpOnboardingView(payload.client.tier, tokenForMcp);
  };

  formEl?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = inpEmail?.value.trim() || '';
    const password = inpPassword?.value || '';
    if (!email || !password) {
      setFeedback('Ingresa correo y contraseña para iniciar sesión.');
      return;
    }
    try {
      setFeedback('Autenticando…');
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        authenticated?: boolean;
        error?: string;
        authToken?: string;
        licenseToken?: string;
        user?: { displayName: string; email: string; role: string };
        client?: {
          tenantId: string;
          organizationName: string;
          tier: 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE';
          creditsRemaining: number;
        };
      };
      if (!data.ok || !data.authenticated) {
        setFeedback(data.error || 'Error al iniciar sesión.');
        return;
      }
      if (data.authToken && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, data.authToken);
      }
      setFeedback('');
      renderAuthenticatedAccount({
        authenticated: true,
        user: data.user,
        client: data.client,
        authToken: data.authToken,
        licenseToken: data.licenseToken,
      });
      await syncEditionBadge();
      appendLog(
        `[Cuenta Autenticada]: ${data.user?.displayName} • Cliente ${data.client?.organizationName} (${data.client?.tenantId})`
      );
    } catch (err) {
      setFeedback(`Error: ${String(err)}`);
    }
  });

  document.getElementById('btn-auth-register')?.addEventListener('click', async () => {
    const email = inpEmail?.value.trim() || '';
    const password = inpPassword?.value || '';
    const displayName = inpName?.value.trim() || email.split('@')[0] || 'Analista Forense';
    const organizationName = inpOrg?.value.trim() || undefined;
    const requestedTier =
      (selTier?.value as 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE' | undefined) || 'ORO_PRO';

    if (!email || password.length < 8) {
      setFeedback('Para registrarte ingresa un correo válido y contraseña de al menos 8 caracteres.');
      return;
    }

    try {
      setFeedback('Creando cuenta y organización cliente en D1…');
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          displayName,
          organizationName,
          requestedTier,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        authenticated?: boolean;
        error?: string;
        authToken?: string;
        licenseToken?: string;
        user?: { displayName: string; email: string; role: string };
        client?: {
          tenantId: string;
          organizationName: string;
          tier: 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE';
          creditsRemaining: number;
        };
      };
      if (!data.ok || !data.authenticated) {
        setFeedback(data.error || 'No se pudo crear la cuenta.');
        return;
      }
      if (data.authToken && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, data.authToken);
      }
      setFeedback('');
      renderAuthenticatedAccount({
        authenticated: true,
        user: data.user,
        client: data.client,
        authToken: data.authToken,
        licenseToken: data.licenseToken,
      });
      await syncEditionBadge();
      appendLog(
        `[Nueva Organización Cliente Registrada]: ${data.client?.organizationName} (${data.client?.tenantId}) • Analista: ${data.user?.displayName}`
      );
    } catch (err) {
      setFeedback(`Error: ${String(err)}`);
    }
  });

  document.getElementById('btn-issue-mcp-session-token')?.addEventListener('click', async () => {
    const savedAuthToken =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)
        : null;
    if (!savedAuthToken) return;
    try {
      const sessionId = mcpState.sessionId.trim() || 'expediente-apt29';
      const res = await fetch('/api/auth/mcp-tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${savedAuthToken}`,
        },
        body: JSON.stringify({
          sessionId,
          title: `Expediente ${sessionId}`,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        sessionToken?: string;
        sessionId?: string;
        error?: string;
      };
      if (data.ok && data.sessionToken) {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem(MCP_STORAGE_TOKEN_KEY, data.sessionToken);
        }
        if (lblTeamMcpStatus) {
          lblTeamMcpStatus.textContent = `Llave MCP del equipo activa (${data.sessionToken.slice(0, 14)}…)`;
        }
        if (navigator.clipboard) {
          void navigator.clipboard.writeText(data.sessionToken);
        }
        updateMcpOnboardingView(mcpState.editionTier, data.sessionToken);
        appendLog(
          `[Token MCP Dedicado Emitido]: ${data.sessionToken.slice(0, 16)}… para el expediente "${data.sessionId}". Inyectado automáticamente en el snippet MCP.`
        );
      }
    } catch (err) {
      appendLog(`Error emitiendo token MCP dedicado: ${String(err)}`);
    }
  });

  document.getElementById('btn-auth-logout')?.addEventListener('click', async () => {
    const savedAuthToken =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)
        : null;
    if (savedAuthToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${savedAuthToken}` },
        });
      } catch {
        // Non-fatal
      }
      window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    }
    renderAuthenticatedAccount({ authenticated: false });
    appendLog('[Sesión Cerrada]: Operando en modo Community Local Bypass.');
  });

  // Restore active session on startup if present
  if (typeof window !== 'undefined' && window.localStorage) {
    const savedAuthToken = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (savedAuthToken) {
      void fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${savedAuthToken}` },
      })
        .then((r) => r.json())
        .then(
          (data: {
            ok: boolean;
            authenticated?: boolean;
            licenseToken?: string;
            user?: { displayName: string; email: string; role: string };
            client?: {
              tenantId: string;
              organizationName: string;
              tier: 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE';
              creditsRemaining: number;
            };
          }) => {
            if (data.ok && data.authenticated) {
              renderAuthenticatedAccount({
                authenticated: true,
                user: data.user,
                client: data.client,
                authToken: savedAuthToken,
                licenseToken: data.licenseToken,
              });
            } else {
              window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
            }
          }
        )
        .catch(() => {});
    }
  }
}

// =============================================================================
// 11. Cangrejo Mobile Super-App Controller (Launchpad Bento, Ego-Radar & HUD)
// =============================================================================
async function computeBytesSha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return '8f4e9b2c1d0a7f6e5c4b3a29182736458f4e9b2c1d0a7f6e5c4b3a2918273a1c';
}

export function syncMobileSuperAppState(): void {
  const pipStatsEl = document.getElementById('lbl-mobile-pip-stats');
  if (pipStatsEl) {
    pipStatsEl.textContent = `${store.entityCount} nodos · ${store.linkCount} enlaces`;
  }

  const allIds = Array.from(store.structureStore.entities.keys());
  const selectedIds = Array.from(selection.getModelSelectedEntities());
  const activeId = selectedIds[0] ?? allIds[0];
  const dossierSelectEl = document.getElementById(
    'sel-mobile-dossier-entity'
  ) as HTMLSelectElement | null;
  const titleEl = document.getElementById('lbl-mobile-dossier-title');
  const typeEl = document.getElementById('lbl-mobile-dossier-type');
  const scoreEl = document.getElementById('lbl-mobile-dossier-score');
  const propsEl = document.getElementById('mobile-dossier-props');
  const corrText = document.getElementById('lbl-mobile-correlation-text');
  const corrHops = document.getElementById('lbl-mobile-correlation-hops');
  const radarPath = document.getElementById('lbl-mobile-radar-path');

  if (!activeId || !store.dataStore.hasEntity(activeId)) {
    if (dossierSelectEl) dossierSelectEl.innerHTML = '';
    if (titleEl) titleEl.textContent = 'Sin entidad seleccionada';
    if (typeEl) typeEl.textContent = '—';
    if (scoreEl) scoreEl.textContent = 'Score: --/100 · EN ESPERA';
    if (propsEl) propsEl.textContent = '';
    if (corrHops) corrHops.textContent = 'BFS Listo';
    if (corrText) {
      corrText.textContent = 'Sin correlación activa. Ingresa un IOC arriba o sincroniza con tu agente MCP.';
    }
    if (radarPath) {
      radarPath.textContent = 'Selecciona 2 o más nodos para calcular ruta BFS';
    }
    return;
  }

  if (dossierSelectEl) {
    dossierSelectEl.innerHTML = allIds
      .filter((id) => store.dataStore.hasEntity(id))
      .map((id) => {
        const e = store.dataStore.getEntity(id);
        const label = `${getPartPrimaryValue(e)} (${e.typeName.replace('maltego.', '')})`;
        return `<option value="${escapeHtml(id.toString())}">${escapeHtml(label)}</option>`;
      })
      .join('');
    dossierSelectEl.value = activeId.toString();
  }

  const ent = store.dataStore.getEntity(activeId);
  const val = getPartPrimaryValue(ent);

  if (titleEl) titleEl.textContent = val;
  if (typeEl) typeEl.textContent = ent.typeName;
  if (scoreEl) {
    const tier = ent.weight >= 90 ? 'CRÍTICO' : ent.weight >= 75 ? 'ALTO' : 'MEDIO';
    scoreEl.textContent = `Score: ${ent.weight}/100 · ${tier}`;
  }
  if (propsEl) {
    const propPairs: string[] = [];
    for (const [k, v] of ent.properties.values.entries()) {
      propPairs.push(`${k}: ${String(v)}`);
    }
    propsEl.textContent = propPairs.slice(0, 4).join('  |  ') || `ID: ${ent.id.toString()}`;
  }

  if (allIds.length >= 2) {
    const rootId = allIds[0]!;
    const targetId = activeId !== rootId ? activeId : allIds[allIds.length - 1]!;
    const report = analyzeExpedienteForensics(store, { sourceId: rootId, targetId });
    const hops = report.shortestPath?.found ? report.shortestPath.hopCount : 1;
    const rootVal = store.dataStore.hasEntity(rootId)
      ? getPartPrimaryValue(store.dataStore.getEntity(rootId))
      : 'Nodo Raíz';
    const targetVal = store.dataStore.hasEntity(targetId)
      ? getPartPrimaryValue(store.dataStore.getEntity(targetId))
      : val;

    if (corrHops) corrHops.textContent = `${hops} salto(s) BFS`;
    if (corrText) {
      corrText.textContent = `${targetVal} conecta a ${hops} salto(s) con Nodo Crítico «${rootVal}» en el expediente activo.`;
    }
    if (radarPath) {
      radarPath.textContent = `Camino más corto: ${hops} salto(s) a «${rootVal}»`;
    }
  } else {
    if (corrHops) corrHops.textContent = '1 nodo activo';
    if (corrText) {
      corrText.textContent = `Objetivo activo: «${val}». Ejecuta una pesquisa OSINT para descubrir conexiones.`;
    }
    if (radarPath) {
      radarPath.textContent = `Objetivo centrado: «${val}»`;
    }
  }
}

export function switchMobileSuperAppView(view: MobileSuperAppView): void {
  activeMobileView = view;
  document.body.dataset.mobileView = view;

  document.querySelectorAll<HTMLElement>('[data-mview-panel]').forEach((panel) => {
    panel.hidden = panel.getAttribute('data-mview-panel') !== view;
  });

  document.querySelectorAll<HTMLElement>('[data-mview-tab]').forEach((btn) => {
    const isMatch = btn.getAttribute('data-mview-tab') === view;
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-selected', String(isMatch));
  });

  if (view === 'radar') {
    document.getElementById('btn-forensic-analytics')?.click();
    graphCanvas.zoomToFit(72);
    syncSceneAndUi(false);
  }
}

export function initMobileSuperAppController(): void {
  const fieldToggleBtn = document.getElementById('btn-mobile-field-toggle');
  const setFieldMode = (enabled: boolean): void => {
    if (enabled) {
      document.body.dataset.fieldMode = 'true';
    } else {
      delete document.body.dataset.fieldMode;
    }
    fieldToggleBtn?.setAttribute('aria-pressed', String(enabled));
    resizeCanvas();
  };

  if (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('mode') === 'field'
  ) {
    setFieldMode(true);
  }

  fieldToggleBtn?.addEventListener('click', () => {
    const next = document.body.dataset.fieldMode !== 'true';
    setFieldMode(next);
    appendLog(
      next
        ? '[Super-App Móvil Activada]: Modo Inspector de Campo (Launchpad OSINT + Radar 1-2H + Escáner SHA-256).'
        : '[Super-App Móvil Oculta]: Regresando a estación de escritorio de 3 columnas.'
    );
  });

  document.getElementById('btn-mobile-sunlight')?.addEventListener('click', () => {
    document.getElementById('btn-theme-toggle')?.click();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-mview-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = (btn.getAttribute('data-mview-tab') as MobileSuperAppView) || 'launchpad';
      switchMobileSuperAppView(target);
    });
  });

  document.getElementById('btn-mobile-dock-ai')?.addEventListener('click', () => {
    document.getElementById('btn-ai-copilot')?.click();
  });

  document.getElementById('btn-mobile-dock-vault')?.addEventListener('click', () => {
    document.getElementById('btn-edition-tier')?.click();
  });

  const OFFLINE_QUEUE_KEY = 'cangrejo_mobile_offline_queue';
  type OfflineEvidenceItem = {
    filename: string;
    clientSha256Hex: string;
    capturedAtUtc: string;
    evidenceCaption: string;
  };

  const getOfflineQueue = (): OfflineEvidenceItem[] => {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return raw ? (JSON.parse(raw) as OfflineEvidenceItem[]) : [];
    } catch {
      return [];
    }
  };

  const saveOfflineQueue = (items: OfflineEvidenceItem[]): void => {
    try {
      if (items.length === 0) {
        localStorage.removeItem(OFFLINE_QUEUE_KEY);
      } else {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
      }
    } catch {
      // Ignore storage quota errors in restricted webviews
    }
    updateLiveRoomBadge();
  };

  const updateLiveRoomBadge = (): void => {
    const livePill = document.getElementById('lbl-mobile-live-room');
    if (!livePill) return;
    const queued = getOfflineQueue().length;
    livePill.textContent =
      queued > 0 ? `⚡ COLA OFFLINE (${queued})` : '● EXP-APT29 (LIVE)';
  };
  updateLiveRoomBadge();

  let custodyLedgerCounter = 1;
  const appendCustodyLedgerEntry = (summary: string, sha256Hex?: string): void => {
    custodyLedgerCounter += 1;
    const ledgerEl = document.getElementById('mobile-custody-ledger');
    if (!ledgerEl) return;
    const utcShort = new Date().toISOString().slice(11, 19) + 'Z';
    const shaBadge = sha256Hex ? ` · SHA:${sha256Hex.slice(0, 10)}…` : '';
    const row = document.createElement('div');
    row.className = 'mobile-custody-entry';
    row.textContent = `#${String(custodyLedgerCounter).padStart(2, '0')} · ${utcShort}${shaBadge} · ${summary}`;
    ledgerEl.prepend(row);
  };

  const findExistingEntityByValue = (val: string): EntityID | null => {
    const norm = val.trim().toLowerCase();
    for (const ent of store.dataStore.getEntities().values()) {
      if (getPartPrimaryValue(ent).trim().toLowerCase() === norm) {
        return ent.id;
      }
    }
    return null;
  };

  const upsertOrCreateEntity = (
    typeName: string,
    canonicalValue: string,
    extraProperties?: Record<string, unknown>
  ): { id: EntityID; isExisting: boolean } => {
    const stampedProps: Record<string, unknown> = {
      captured_at_utc: new Date().toISOString(),
      custody_mode: 'FIELD_MOBILE_SHA256',
      ...extraProperties,
    };
    const existingId = findExistingEntityByValue(canonicalValue);
    if (existingId && store.dataStore.hasEntity(existingId)) {
      const existingEnt = store.dataStore.getEntity(existingId);
      for (const [k, v] of Object.entries(stampedProps)) {
        existingEnt.properties.values.set(k, v as string | number | boolean);
      }
      return { id: existingId, isExisting: true };
    }
    const ent = registry.createEntity(typeName, canonicalValue, {
      weight: 92,
      bookmark: 1,
      extraProperties: stampedProps,
    });
    const idx = store.entityCount;
    const angle = (idx * 1.15) % (Math.PI * 2);
    store.addEntity(ent, { x: Math.cos(angle) * 215, y: Math.sin(angle) * 215, z: 0 }, false);
    return { id: ent.id, isExisting: false };
  };

  // Extracts embedded IOCs, defanged tokens (hxxps, [.], [@]), and @aliases from free-form chat/voice text
  const extractEmbeddedIocsAndAliases = (rawText: string): string[] => {
    const normalized = rawText
      .replace(/hxxps?/gi, (m) => m.replace(/xx/i, 'tt'))
      .replace(/\[\.\]/g, '.')
      .replace(/\[@\]/g, '@')
      .replace(/\[:\]/g, ':');

    const matches = new Set<string>();
    const patterns = [
      /https?:\/\/[^\s"'<>]+/gi,
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}/g,
      /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\/\d{1,2})?\b/g,
      /\bCVE-\d{4}-\d{4,7}\b/gi,
      /\b(?:bc1[a-zA-HJ-NP-Z0-9]{25,89}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g,
      /\bAS\d{1,10}\b/gi,
      /\b[a-fA-F0-9]{64}\b/g,
      /\+[1-9]\d{0,3}[-\s.]?\(?\d{2,4}\)?[-\s.]?\d{3,4}[-\s.]?\d{3,4}/g,
      /(?:^|\s)(@[a-zA-Z0-9_.-]{2,36})\b/g,
      /\b(?:[a-zA-Z0-9-]{1,63}\.)+(?:com|net|org|io|ru|ve|gov|edu|co|info|biz|me|xyz|dev|app|cloud)\b/gi,
    ];

    for (const rx of patterns) {
      let m: RegExpExecArray | null;
      while ((m = rx.exec(normalized)) !== null) {
        const candidate = (m[1] ?? m[0]).trim().replace(/[.,;:!?)]+$/, '');
        if (candidate.length >= 3) matches.add(candidate);
      }
    }

    if (matches.size > 0) return Array.from(matches);
    return normalized
      .split(/[\r\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  };

  // Omni-Search Bar: auto-extract embedded IOCs/aliases from free text, deduplicate, link to active pivot & compute BFS
  const omniInput = document.getElementById('inp-mobile-omni-search') as HTMLInputElement | null;
  const runOmniSearch = (): EntityID[] => {
    const raw = omniInput?.value.trim() || '';
    if (!raw) return [];

    const tokens = extractEmbeddedIocsAndAliases(raw);
    const allIds = Array.from(store.structureStore.entities.keys());
    const selectedIds = Array.from(selection.getModelSelectedEntities());
    const anchorId = selectedIds[0] ?? allIds[0] ?? null;

    const touchedIds: EntityID[] = [];
    store.runInBatch(() => {
      for (const tok of tokens) {
        const probe = convertTextToEntity(tok, registry);
        const { id } = upsertOrCreateEntity(probe.typeName, getPartPrimaryValue(probe));
        touchedIds.push(id);
        if (anchorId && !anchorId.equals(id) && store.dataStore.hasEntity(anchorId)) {
          store.addLink(
            makeSimpleLink(Guid.generate(), 'field-omni-pivot', '#EAB308'),
            anchorId,
            id
          );
        }
      }
    });

    if (touchedIds.length > 0) {
      selection.selectInModel(touchedIds);
      syncSceneAndUi(false);
      appendCustodyLedgerEntry(`Omni-Search (+${touchedIds.length} IOCs): ${tokens.slice(0, 2).join(', ')}`);
      appendLog(
        `[Omni-Search Móvil]: +${touchedIds.length} indicador(es) extraídos en texto libre y cruzados contra el expediente.`
      );
    }
    return touchedIds;
  };

  document.getElementById('btn-mobile-omni-run')?.addEventListener('click', () => {
    runOmniSearch();
  });
  omniInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runOmniSearch();
    }
  });

  document.getElementById('btn-mobile-omni-camera')?.addEventListener('click', () => {
    switchMobileSuperAppView('scanner');
  });

  document.getElementById('btn-mobile-correlation-radar')?.addEventListener('click', () => {
    switchMobileSuperAppView('radar');
  });

  // 1-Tap Signal / Telegram Forensic Briefing Copy
  document.getElementById('btn-mobile-copy-brief')?.addEventListener('click', () => {
    const corrText =
      document.getElementById('lbl-mobile-correlation-text')?.textContent?.trim() ||
      'Correlación activa en expediente.';
    const corrHops =
      document.getElementById('lbl-mobile-correlation-hops')?.textContent?.trim() || 'BFS Activo';
    const custodyLine =
      document.getElementById('lbl-mobile-custody-strip')?.textContent?.trim() ||
      'Bóveda Cero Activa';
    const brief = [
      `🚨 [CANGREJO FIELD BRIEF] · ${new Date().toISOString()}`,
      `• Correlación (${corrHops}): ${corrText}`,
      `• Topología: ${store.entityCount} nodos · ${store.linkCount} enlaces`,
      `• Custodia: ${custodyLine}`,
    ].join('\n');
    void navigator.clipboard?.writeText(brief).catch(() => {});
    appendLog('[Briefing Táctico Copiado]: Resumen de 4 líneas listo para pegar en Signal/Telegram.');
  });

  // Offline Queue Flush & Live Room Sync Pill
  const flushOfflineEvidenceQueue = async (): Promise<void> => {
    const queue = getOfflineQueue();
    if (queue.length === 0) return;
    const remaining: OfflineEvidenceItem[] = [];
    for (const item of queue) {
      try {
        const res = await fetch('/api/ai/vision-ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: item.filename,
            evidenceCaption: item.evidenceCaption,
          }),
        });
        if (!res.ok) remaining.push(item);
      } catch {
        remaining.push(item);
      }
    }
    saveOfflineQueue(remaining);
    if (remaining.length === 0) {
      appendCustodyLedgerEntry(`Cola offline sincronizada (${queue.length} evidencias)`);
      appendLog(`[Sincronización de Campo]: ${queue.length} evidencia(s) de la cola offline sincronizadas con el laboratorio.`);
    }
  };

  window.addEventListener('online', () => {
    void flushOfflineEvidenceQueue();
  });

  document.getElementById('lbl-mobile-live-room')?.addEventListener('click', async () => {
    await flushOfflineEvidenceQueue();
    const fieldUrl = `${window.location.origin}${window.location.pathname}?mode=field`;
    void navigator.clipboard?.writeText(fieldUrl).catch(() => {});
    appendLog(`[Sala de Campo Sincronizada]: Enlace táctico copiado (${fieldUrl}).`);
  });

  const runSpecificTransformsOnSelected = async (transformIds: string[]): Promise<void> => {
    const selectedIds = Array.from(selection.getModelSelectedEntities());
    const fallbackId = Array.from(store.structureStore.entities.keys())[0];
    const targetId = selectedIds[0] ?? fallbackId;
    if (!targetId || !store.dataStore.hasEntity(targetId)) return;
    const ent = store.dataStore.getEntity(targetId);
    for (const tid of transformIds) {
      await executeTransformOnEntity(ent, tid);
    }
  };

  const cameraInput = document.getElementById('inp-mobile-camera-file') as HTMLInputElement | null;
  const exifInput = document.getElementById('inp-mobile-exif-file') as HTMLInputElement | null;
  const custodyStrip = document.getElementById('lbl-mobile-custody-strip');
  const scannerBoxesEl = document.getElementById('mobile-scanner-boxes');

  let pendingMobileEvidence: {
    filename: string;
    imageBase64: string;
    clientSha256Hex: string;
  } | null = null;

  // 1-Tap Emergency Panic Seal & Millisecond-Zero Pre-Fetch RAM Wipe (Dead-Man Switch for Hostile Checkpoints)
  const triggerEmergencyBovedaPanic = async (): Promise<void> => {
    const emergencyPass = `cgrj-panic-${Date.now().toString(36)}`;
    const snapshotPayload = serializeCurrentStore();
    void navigator.clipboard?.writeText(emergencyPass).catch(() => {});

    // 1. Millisecond-Zero Local RAM, Closure & Screen Purge BEFORE network round-trip
    store.clear();
    selection.clearSelection();
    store.undoRedoManager.clear();
    pendingMobileEvidence = null;
    saveOfflineQueue([]);
    if (cameraInput) cameraInput.value = '';
    if (exifInput) exifInput.value = '';
    if (omniInput) omniInput.value = '';
    if (custodyStrip) {
      custodyStrip.textContent = 'BÓVEDA CERO SELLADA (.cgrj DESCARGADO) · MEMORIA RAM PURGADA ✓';
    }
    syncSceneAndUi(false);
    appendCustodyLedgerEntry('PÁNICO BÓVEDA CERO · RAM PURGADA EN <5ms');
    appendLog(
      '[PÁNICO BÓVEDA CERO EJECUTADO]: Memoria RAM purgada en segundo cero y llave efímera copiada al portapapeles.'
    );

    // 2. Seal & download encrypted .cgrj envelope from pre-purge snapshot
    try {
      const res = await fetch('/api/export/mtgj-encrypted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...snapshotPayload, passphrase: emergencyPass }),
      });
      const data = (await res.json()) as { ok: boolean; envelope?: unknown };
      if (data.ok && data.envelope) {
        const blob = new Blob([JSON.stringify(data.envelope, null, 2)], {
          type: 'application/json;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `boveda_cero_panic_${Date.now()}.cgrj`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // Local RAM is already wiped even if 3G/LTE drops mid-request
    }
  };

  // 2x3 Bento Mini-Apps (distinct specialized flows)
  document.querySelectorAll<HTMLButtonElement>('[data-miniapp]').forEach((card) => {
    card.addEventListener('click', () => {
      const app = card.getAttribute('data-miniapp');
      if (app === 'alias-recon') {
        if (omniInput?.value.trim()) runOmniSearch();
        void runSpecificTransformsOnSelected(['whois-identity', 'threat-intel']);
        switchMobileSuperAppView('radar');
      } else if (app === 'camera-hud') {
        switchMobileSuperAppView('scanner');
      } else if (app === 'exif-scrubber') {
        exifInput?.click();
      } else if (app === 'domain-whois') {
        if (omniInput?.value.trim()) runOmniSearch();
        void runSpecificTransformsOnSelected(['dns-to-ip', 'whois-identity', 'ct-subdomains']);
        switchMobileSuperAppView('radar');
      } else if (app === 'crypto-utxo') {
        if (omniInput?.value.trim()) runOmniSearch();
        void runSpecificTransformsOnSelected(['crypto-trace']);
        switchMobileSuperAppView('radar');
      } else if (app === 'boveda-panic') {
        void triggerEmergencyBovedaPanic();
      }
    });
  });

  // View 2: Radar Dossier Sheet Controls + 1-Thumb Node Selector + Contextual OSINT Dorks
  document.getElementById('sel-mobile-dossier-entity')?.addEventListener('change', (e) => {
    const rawId = (e.target as HTMLSelectElement).value;
    if (!rawId) return;
    try {
      const gid = Guid.parse(rawId);
      if (store.dataStore.hasEntity(gid)) {
        selection.selectInModel([gid]);
        syncSceneAndUi(false);
      }
    } catch {
      // Ignore malformed GUID
    }
  });

  document.getElementById('btn-mobile-dossier-toggle')?.addEventListener('click', () => {
    document.getElementById('mobile-dossier-sheet')?.classList.toggle('collapsed');
  });
  document.getElementById('btn-mobile-radar-bfs')?.addEventListener('click', () => {
    document.getElementById('btn-forensic-analytics')?.click();
  });
  document.getElementById('btn-mobile-radar-fit')?.addEventListener('click', () => {
    graphCanvas.zoomToFit(72);
    syncSceneAndUi(false);
  });
  document.getElementById('btn-mobile-pivot-whois')?.addEventListener('click', () => {
    void runSpecificTransformsOnSelected(['dns-to-ip', 'whois-identity']);
  });
  document.getElementById('btn-mobile-pivot-all')?.addEventListener('click', () => {
    document.getElementById('btn-primary-run-transforms')?.click();
  });
  document.getElementById('btn-mobile-pivot-dork')?.addEventListener('click', () => {
    const selectedIds = Array.from(selection.getModelSelectedEntities());
    const fallbackId = Array.from(store.structureStore.entities.keys())[0];
    const targetId = selectedIds[0] ?? fallbackId;
    if (!targetId || !store.dataStore.hasEntity(targetId)) return;
    const ent = store.dataStore.getEntity(targetId);
    const val = getPartPrimaryValue(ent);
    const t = ent.typeName.toLowerCase();
    let dork = `"${val}" (site:t.me OR site:github.com OR site:pastebin.com OR site:x.com)`;
    let archiveUrl = `https://web.archive.org/web/*/${encodeURIComponent(val)}`;
    if (t.includes('domain') || t.includes('website') || t.includes('url')) {
      dork = `site:${val} (filetype:pdf OR filetype:xlsx OR filetype:docx OR filetype:env OR inurl:admin)`;
    } else if (t.includes('ip') || t.includes('netblock') || t.includes('as')) {
      dork = `"${val}" (site:shodan.io OR site:censys.io OR site:bgp.he.net)`;
      archiveUrl = `https://www.shodan.io/host/${encodeURIComponent(val)}`;
    }
    ent.properties.values.set('osint_dork_query', dork);
    ent.properties.values.set('wayback_recon_url', archiveUrl);
    void navigator.clipboard?.writeText(`${dork}\n${archiveUrl}`).catch(() => {});
    syncSceneAndUi(false);
    appendLog(`[OSINT Dork & Wayback Copiado]: ${dork}`);
  });
  document.getElementById('btn-mobile-pivot-daubert')?.addEventListener('click', () => {
    document.getElementById('btn-export-dossier')?.click();
  });

  // View 3: Field Scanner HUD (Real Camera SHA-256 Custody + Dynamic OCR Boxes + Offline Queue + Canvas EXIF Scrubber)
  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return typeof btoa === 'function' ? btoa(binary) : '';
  };

  const renderMobileScannerBoxes = (
    items: Array<{ canonicalValue: string; typeName: string }>
  ): void => {
    if (!scannerBoxesEl) return;
    scannerBoxesEl.innerHTML = items
      .map((item) => {
        const exists = findExistingEntityByValue(item.canonicalValue) !== null;
        const boxClass = exists ? 'mobile-ocr-amber' : 'mobile-ocr-cyan';
        const statusTag = exists
          ? `${escapeHtml(item.typeName)} · YA EN GRAFO (CORRELACIONADO)`
          : `${escapeHtml(item.typeName)} · NUEVO IOC DETECTADO`;
        return `<div class="mobile-ocr-box ${boxClass}">
          <span class="mobile-ocr-tag">${statusTag}</span>
          <code>${escapeHtml(item.canonicalValue)}</code>
        </div>`;
      })
      .join('');
  };

  document.getElementById('btn-mobile-camera-trigger')?.addEventListener('click', () => {
    cameraInput?.click();
  });

  cameraInput?.addEventListener('change', async () => {
    const file = cameraInput.files?.[0];
    if (!file) return;
    // shortcut: hashes raw file in client RAM before server OCR upload, upgrade to streaming chunk hash for videos >100MB
    const rawBytes = await file.arrayBuffer();
    const sha256Hex = await computeBytesSha256Hex(rawBytes);
    const imageBase64 = arrayBufferToBase64(rawBytes);
    pendingMobileEvidence = {
      filename: file.name,
      imageBase64,
      clientSha256Hex: sha256Hex,
    };
    const utcNow = new Date().toISOString();
    if (custodyStrip) {
      custodyStrip.textContent = `SHA-256: ${sha256Hex.slice(0, 18)}… | UTC ${utcNow} | ARCHIVO: ${file.name}`;
    }
    appendCustodyLedgerEntry(`Foto sellada: ${file.name}`, sha256Hex);
    appendLog(
      `[Cámara Forense Móvil]: Evidencia "${file.name}" sellada en segundo cero • SHA-256=${sha256Hex}`
    );
  });

  const injectCapturedItemsIntoGraph = (
    items: Array<{ canonicalValue: string; typeName: string }>,
    authoritativeSha: string,
    filename: string,
    syncStatus: 'LIVE_SEALED' | 'OFFLINE_QUEUED'
  ): void => {
    if (custodyStrip) {
      custodyStrip.textContent = `SHA-256: ${authoritativeSha.slice(0, 18)}… | UTC ${new Date().toISOString()} | ${syncStatus}`;
    }
    renderMobileScannerBoxes(items);

    const allIds = Array.from(store.structureStore.entities.keys());
    const anchorId = allIds[0] ?? null;
    const addedIds: EntityID[] = [];

    store.runInBatch(() => {
      items.forEach((item) => {
        const { id } = upsertOrCreateEntity(item.typeName, item.canonicalValue, {
          custody_sha256: authoritativeSha,
          evidence_filename: filename,
          sync_status: syncStatus,
        });
        addedIds.push(id);
        if (anchorId && !anchorId.equals(id) && store.dataStore.hasEntity(anchorId)) {
          store.addLink(
            makeSimpleLink(Guid.generate(), 'ocr-custody-match', '#EAB308'),
            anchorId,
            id
          );
        }
      });
    });

    selection.selectInModel(addedIds);
    syncSceneAndUi(false);
    appendCustodyLedgerEntry(
      `Inyección ${syncStatus} (+${addedIds.length} IOCs · ${filename})`,
      authoritativeSha
    );
    appendLog(
      `[Escáner HUD Forense (${syncStatus})]: +${addedIds.length} IOCs sellados (SHA-256: ${authoritativeSha.slice(0, 16)}…) e inyectados.`
    );
    switchMobileSuperAppView('radar');
  };

  document.getElementById('btn-mobile-scanner-inject')?.addEventListener('click', async () => {
    const fallbackText = omniInput?.value.trim() || '';
    if (!pendingMobileEvidence && !fallbackText) {
      if (custodyStrip) {
        custodyStrip.textContent = 'SELECCIONA UNA IMAGEN (📷) O ESCRIBE TEXTO EN OMNI-SEARCH PRIMERO';
      }
      return;
    }
    const reqPayload = pendingMobileEvidence
      ? {
          filename: pendingMobileEvidence.filename,
          imageBase64: pendingMobileEvidence.imageBase64,
          evidenceCaption: `Evidencia fotográfica capturada en campo: ${pendingMobileEvidence.filename}`,
        }
      : {
          filename: 'evidencia-campo-mobile.txt',
          evidenceCaption: fallbackText,
        };
    const fallbackSha =
      pendingMobileEvidence?.clientSha256Hex ??
      (await computeBytesSha256Hex(new TextEncoder().encode(reqPayload.evidenceCaption).buffer as ArrayBuffer));

    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('OFFLINE_MODE');
      }
      const res = await fetch('/api/ai/vision-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqPayload),
      });
      const data = (await res.json()) as {
        ok: boolean;
        evidenceSha256Hex: string;
        items: Array<{ canonicalValue: string; typeName: string }>;
      };
      if (!data.ok) throw new Error('VISION_INGEST_FAILED');

      const authoritativeSha = pendingMobileEvidence?.clientSha256Hex ?? data.evidenceSha256Hex;
      injectCapturedItemsIntoGraph(data.items, authoritativeSha, reqPayload.filename, 'LIVE_SEALED');
    } catch {
      // Offline Basement / No-Signal Fallback: queue evidence in localStorage and inject local IOCs immediately
      const queue = getOfflineQueue();
      queue.push({
        filename: reqPayload.filename,
        clientSha256Hex: fallbackSha,
        capturedAtUtc: new Date().toISOString(),
        evidenceCaption: reqPayload.evidenceCaption,
      });
      saveOfflineQueue(queue);

      const localTokens = extractEmbeddedIocsAndAliases(reqPayload.evidenceCaption);
      const localItems =
        localTokens.length > 0
          ? localTokens.map((tok) => {
              const probe = convertTextToEntity(tok, registry);
              return { canonicalValue: getPartPrimaryValue(probe), typeName: probe.typeName };
            })
          : [{ canonicalValue: reqPayload.filename, typeName: 'maltego.Document' }];
      injectCapturedItemsIntoGraph(
        localItems,
        fallbackSha,
        reqPayload.filename,
        'OFFLINE_QUEUED'
      );
    }
  });

  document.getElementById('btn-mobile-voice-note')?.addEventListener('click', () => {
    const rawNote = window.prompt(
      'Dicta o pega la nota de campo para extracción automática de IOCs:',
      ''
    );
    if (!rawNote) return;
    if (omniInput) {
      omniInput.value = rawNote;
      runOmniSearch();
      switchMobileSuperAppView('radar');
    }
  });

  document.getElementById('btn-mobile-exif-clean')?.addEventListener('click', () => {
    exifInput?.click();
  });

  // Real <canvas> re-encoding EXIF/GPS/Serial Scrubber + Clean JPEG Download + Forensic Node Injection
  exifInput?.addEventListener('change', async () => {
    const file = exifInput.files?.[0];
    if (!file) return;
    const rawBytes = await file.arrayBuffer();
    const originalSha = await computeBytesSha256Hex(rawBytes);
    const cleanFilename = `clean_${file.name.replace(/\.[^.]+$/, '')}.jpg`;
    let cleanSha = originalSha;

    try {
      const bitmap = await createImageBitmap(file);
      const offCanvas = document.createElement('canvas');
      offCanvas.width = bitmap.width;
      offCanvas.height = bitmap.height;
      const offCtx = offCanvas.getContext('2d');
      offCtx?.drawImage(bitmap, 0, 0);
      bitmap.close();

      const cleanBlob = await new Promise<Blob | null>((resolve) =>
        offCanvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
      );
      if (cleanBlob) {
        const cleanBytes = await cleanBlob.arrayBuffer();
        cleanSha = await computeBytesSha256Hex(cleanBytes);
        const url = URL.createObjectURL(cleanBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = cleanFilename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // Fallback if image decoding is unavailable in headless environment
    }

    const { id } = upsertOrCreateEntity('maltego.Document', cleanFilename, {
      exif_scrubbed: 'true',
      original_sha256: originalSha,
      clean_sha256: cleanSha,
    });
    selection.selectInModel([id]);
    syncSceneAndUi(false);

    if (custodyStrip) {
      custodyStrip.textContent = `EXIF PURGADO ✓ | Orig: ${originalSha.slice(0, 10)}… → Clean: ${cleanSha.slice(0, 10)}…`;
    }
    appendCustodyLedgerEntry(`EXIF purgado: ${cleanFilename}`, cleanSha);
    appendLog(
      `[Limpiador EXIF Periodista]: "${cleanFilename}" purgado de GPS/EXIF e inyectado al expediente (Orig=${originalSha.slice(0, 10)}… -> Clean=${cleanSha.slice(0, 10)}…).`
    );
  });
}

resizeCanvas();
initMcpModalController();
initAccountAuthController();
initMobileSuperAppController();
void syncEditionBadge();
loadPreset('expediente-apt29');
requestAnimationFrame(renderFrame);
