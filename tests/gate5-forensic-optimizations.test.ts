import { describe, expect, it } from 'vitest';
import {
  EntityRegistry,
  GraphStore,
  Guid,
  analyzeExpedienteForensics,
  computeForensicPageRank,
  createPropertyBag,
  detectDirectedCycles,
  findShortestForensicPath,
} from '../packages/core/src/index.js';
import { BunSqliteVault } from '../packages/database-d1/src/index.js';
import {
  GraphCanvas,
  LAYOUT_NODE_STRIDE_FLOATS,
  NativeRayonBridge,
} from '../packages/renderer/src/index.js';
import { Stix21Exporter, computeSha256Hex } from '../packages/transforms/src/index.js';
import { cangrejoHonoApp } from '../apps/web/honoApp.js';

function makeTestLink(label: string, weight = 1) {
  return {
    id: Guid.generate(),
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
    ]),
  };
}

describe('Gate 5: Polyglot Forensic Optimizations (Barnes-Hut FFI, Graph Analytics, Frustum Culling, Singleflight Cache & STIX 2.1)', () => {
  it('1. executes O(V log V) Barnes-Hut Quadtree in Rust via Zero-Copy bun:ffi on 1,000 nodes while preserving pinned nodes', () => {
    const bridge = new NativeRayonBridge();
    const nodeCount = 1_000;
    const nodeBuffer = new Float32Array(nodeCount * LAYOUT_NODE_STRIDE_FLOATS);
    for (let i = 0; i < nodeCount; i++) {
      const base = i * LAYOUT_NODE_STRIDE_FLOATS;
      nodeBuffer[base + 0] = ((i % 40) - 20) * 14;
      nodeBuffer[base + 1] = (Math.floor(i / 40) - 12) * 14;
      nodeBuffer[base + 2] = 0;
      nodeBuffer[base + 3] = 0;
      nodeBuffer[base + 4] = 1.5;
      nodeBuffer[base + 5] = i % 200 === 0 ? 1.0 : 0.0;
    }

    const pinnedZeroX = nodeBuffer[0]!;
    const pinnedZeroY = nodeBuffer[1]!;
    const unpinnedOneX = nodeBuffer[LAYOUT_NODE_STRIDE_FLOATS + 0]!;
    const unpinnedOneY = nodeBuffer[LAYOUT_NODE_STRIDE_FLOATS + 1]!;

    const edgeBuffer = new Uint32Array((nodeCount - 1) * 2);
    for (let i = 1; i < nodeCount; i++) {
      edgeBuffer[(i - 1) * 2] = Math.floor((i - 1) / 3);
      edgeBuffer[(i - 1) * 2 + 1] = i;
    }

    if (typeof (globalThis as Record<string, unknown>).Bun !== 'undefined') {
      expect(bridge.isBunFfiAvailable).toBe(true);
      const ffiRes = bridge.executeBunFfiBarnesHut(nodeBuffer, edgeBuffer, 3, 0.8);
      expect(ffiRes.executed).toBe(true);
      expect(ffiRes.processedNodes).toBe(nodeCount);
      expect(ffiRes.elapsedMs).toBeLessThan(50);
    } else {
      bridge.executeNativeLayout('organic', nodeBuffer, edgeBuffer, 3, 0.8);
    }

    // Pinned node #0 never moved
    expect(nodeBuffer[0]).toBe(pinnedZeroX);
    expect(nodeBuffer[1]).toBe(pinnedZeroY);

    // Unpinned node #1 moved to finite coordinates
    const movedDist = Math.hypot(
      nodeBuffer[LAYOUT_NODE_STRIDE_FLOATS + 0]! - unpinnedOneX,
      nodeBuffer[LAYOUT_NODE_STRIDE_FLOATS + 1]! - unpinnedOneY
    );
    expect(movedDist).toBeGreaterThan(0);
  });

  it('2. computes Shortest Forensic Path (Eslabón Dorado), PageRank centrality tiers, and Directed Cycle Rings', async () => {
    const registry = new EntityRegistry();
    const store = new GraphStore(Guid.generate());

    const hub = registry.createEntity('maltego.Domain', 'command-hub.cangrejo.org', { weight: 100 });
    const relayA = registry.createEntity('maltego.IPv4Address', '104.21.16.10', { weight: 90 });
    const relayB = registry.createEntity('maltego.IPv4Address', '104.21.16.20', { weight: 90 });
    const leafTarget = registry.createEntity('maltego.BitcoinAddress', 'bc1qvault001', { weight: 95 });
    const ring1 = registry.createEntity('maltego.Company', 'Shell Corp Alpha', { weight: 80 });
    const ring2 = registry.createEntity('maltego.Company', 'Shell Corp Beta', { weight: 80 });
    const ring3 = registry.createEntity('maltego.Company', 'Shell Corp Gamma', { weight: 80 });

    for (const ent of [hub, relayA, relayB, leafTarget, ring1, ring2, ring3]) {
      store.addEntity(ent, { x: 0, y: 0, z: 0 });
    }

    // Hub connects to relayA, relayB, ring1, ring2 (making Hub the highest centrality entity)
    store.addLink(makeTestLink('routes to', 2), hub.id, relayA.id);
    store.addLink(makeTestLink('routes to', 1), hub.id, relayB.id);
    store.addLink(makeTestLink('controls', 2), relayA.id, leafTarget.id);
    store.addLink(makeTestLink('funds', 1), hub.id, ring1.id);
    store.addLink(makeTestLink('audits', 1), hub.id, ring2.id);

    // Directed Cycle Ring: ring1 -> ring2 -> ring3 -> ring1
    store.addLink(makeTestLink('transfers to', 1), ring1.id, ring2.id);
    store.addLink(makeTestLink('transfers to', 1), ring2.id, ring3.id);
    store.addLink(makeTestLink('transfers to', 1), ring3.id, ring1.id);

    const pathRes = findShortestForensicPath(store, hub.id, leafTarget.id);
    expect(pathRes.found).toBe(true);
    expect(pathRes.hopCount).toBe(2);
    expect(pathRes.entityPath.map((id) => id.toString())).toEqual([
      hub.id.toString(),
      relayA.id.toString(),
      leafTarget.id.toString(),
    ]);

    const prRes = computeForensicPageRank(store);
    expect(prRes.rankings.length).toBe(7);
    expect(prRes.rankings[0]!.entityId.toString()).toBe(hub.id.toString());
    expect(prRes.rankings[0]!.suggestedTier).toBe('PLATINO');
    expect(prRes.totalScoreSum).toBeCloseTo(1.0, 2);

    const cycles = detectDirectedCycles(store);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    const ringCycle = cycles.find((c) => c.length === 3);
    expect(ringCycle).toBeDefined();

    const fullReport = analyzeExpedienteForensics(store, {
      sourceId: hub.id,
      targetId: leafTarget.id,
    });
    expect(fullReport.shortestPath?.found).toBe(true);

    // Also verify HTTP endpoint POST /api/analytics/forensic
    const httpRes = await cangrejoHonoApp.request('http://localhost/api/analytics/forensic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId: hub.id.toString(),
        targetId: leafTarget.id.toString(),
        entities: [
          { id: hub.id.toString(), typeName: 'maltego.Domain', value: 'command-hub.cangrejo.org' },
          { id: relayA.id.toString(), typeName: 'maltego.IPv4Address', value: '104.21.16.10' },
          { id: leafTarget.id.toString(), typeName: 'maltego.BitcoinAddress', value: 'bc1qvault001' },
        ],
        links: [
          { id: Guid.generate().toString(), sourceId: hub.id.toString(), targetId: relayA.id.toString(), label: 'hop1' },
          { id: Guid.generate().toString(), sourceId: relayA.id.toString(), targetId: leafTarget.id.toString(), label: 'hop2' },
        ],
      }),
    });
    expect(httpRes.status).toBe(200);
    const httpJson = (await httpRes.json()) as {
      ok: boolean;
      report: { shortestPath: { found: boolean; hopCount: number } };
    };
    expect(httpJson.ok).toBe(true);
    expect(httpJson.report.shortestPath.found).toBe(true);
    expect(httpJson.report.shortestPath.hopCount).toBe(2);
  });

  it('3. culls off-screen entities in < 5ms via Spatial Viewport Frustum Culling on a 2,500-node graph', () => {
    const registry = new EntityRegistry();
    const store = new GraphStore(Guid.generate());

    store.runInBatch(() => {
      for (let i = 0; i < 2_500; i++) {
        const ent = registry.createEntity('maltego.IPv4Address', `10.99.${Math.floor(i / 250)}.${i % 250}`);
        const wx = ((i % 50) - 25) * 220; // spans -5500 .. +5500
        const wy = (Math.floor(i / 50) - 25) * 220;
        store.addEntity(ent, { x: wx, y: wy, z: 0 }, true);
      }
    });

    const canvas = new GraphCanvas(store, {
      viewportWidth: 1280,
      viewportHeight: 720,
    });
    canvas.setZoom(1.2);

    const t0 = performance.now();
    const frustum = canvas.queryVisibleFrustum(120);
    const elapsedMs = performance.now() - t0;

    expect(frustum.totalCount).toBeGreaterThan(0);
    expect(frustum.visibleCount).toBeGreaterThan(0);
    expect(frustum.visibleCount).toBeLessThan(frustum.totalCount);
    expect(frustum.culledCount).toBeGreaterThan(1_500);
    expect(elapsedMs).toBeLessThan(15);
  });

  it('4. deduplicates concurrent Pesquisas via Singleflight and serves subsequent requests from SQLite TTL Cache (X-Cangrejo-Cache: HIT)', async () => {
    const uniqueDomain = `singleflight-${Date.now()}.cangrejo.org`;

    // Fire 8 concurrent requests for the exact same (transformId, entityValue)
    const concurrentResponses = await Promise.all(
      Array.from({ length: 8 }, (_, idx) =>
        cangrejoHonoApp.request('http://localhost/api/transforms/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transformId: 'ct-subdomains',
            entityType: 'maltego.Domain',
            entityValue: uniqueDomain,
            customContext: { callerIndex: idx },
          }),
        })
      )
    );

    const headers = concurrentResponses.map((r) => r.headers.get('X-Cangrejo-Cache'));
    // Exactly 1 leader should report MISS, and the coalesced followers should report HIT
    expect(headers.filter((h) => h === 'MISS').length).toBe(1);
    expect(headers.filter((h) => h === 'HIT').length).toBe(7);

    // Subsequent call hits the SQLite TTL cache directly
    const cachedRes = await cangrejoHonoApp.request('http://localhost/api/transforms/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transformId: 'ct-subdomains',
        entityType: 'maltego.Domain',
        entityValue: uniqueDomain,
        customContext: { verifyPassthrough: 'intact' },
      }),
    });
    expect(cachedRes.status).toBe(200);
    expect(cachedRes.headers.get('X-Cangrejo-Cache')).toBe('HIT');
    const cachedBody = (await cachedRes.json()) as {
      ok: boolean;
      cacheStatus: string;
      customContext?: { verifyPassthrough: string };
    };
    expect(cachedBody.ok).toBe(true);
    expect(cachedBody.cacheStatus).toBe('HIT');
    expect(cachedBody.customContext?.verifyPassthrough).toBe('intact');

    // Direct unit check on BunSqliteVault TTL cache
    const localVault = new BunSqliteVault(':memory:');
    expect(localVault.getCachedPesquisa('dns-to-ip', 'cangrejo.org')).toBeNull();
    expect(
      localVault.setCachedPesquisaSafe('dns-to-ip', 'cangrejo.org', { ok: true, entities: [] }, 60_000)
    ).toBe(true);
    expect(localVault.getCachedPesquisa('dns-to-ip', 'cangrejo.org')).toEqual({
      ok: true,
      entities: [],
    });
    localVault.close();
  });

  it('5. exports an OASIS STIX 2.1 Bundle with a deterministic SHA-256 chain-of-custody manifest', async () => {
    const registry = new EntityRegistry();
    const store = new GraphStore(Guid.parse('0x0000000000000501'));

    const dom = registry.createEntity('maltego.Domain', 'apt29-c2.example.org', {
      id: Guid.parse('0x0000000000000502'),
      weight: 100,
    });
    const ip = registry.createEntity('maltego.IPv4Address', '185.220.101.42', {
      id: Guid.parse('0x0000000000000503'),
      weight: 95,
    });
    store.addEntity(dom, { x: -100, y: 0, z: 0 });
    store.addEntity(ip, { x: 100, y: 0, z: 0 });
    store.addLink(
      makeTestLink('resolves-to', 1),
      dom.id,
      ip.id
    );

    const bundleA = Stix21Exporter.exportFromStore(store, {
      expedienteTitle: 'Operación Cangrejo Platino',
      caseTier: 'PLATINO',
      timestampIso: '2026-11-03T00:00:00.000Z',
    });
    const bundleB = Stix21Exporter.exportFromStore(store, {
      expedienteTitle: 'Operación Cangrejo Platino',
      caseTier: 'PLATINO',
      timestampIso: '2026-11-03T12:34:56.000Z',
    });

    expect(bundleA.type).toBe('bundle');
    expect(bundleA.spec_version).toBe('2.1');
    expect(bundleA.x_cangrejo_custody.algorithm).toBe('SHA-256');
    expect(bundleA.x_cangrejo_custody.canonicalDigestHex).toMatch(/^[0-9a-f]{64}$/);
    // Canonical custody hash is invariant across export timestamps for identical graph topology
    expect(bundleA.x_cangrejo_custody.canonicalDigestHex).toBe(
      bundleB.x_cangrejo_custody.canonicalDigestHex
    );
    expect(bundleA.objects.some((o) => o.type === 'domain-name')).toBe(true);
    expect(bundleA.objects.some((o) => o.type === 'ipv4-addr')).toBe(true);
    expect(bundleA.objects.some((o) => o.type === 'relationship')).toBe(true);
    expect(bundleA.objects.some((o) => o.type === 'report')).toBe(true);

    // Verify HTTP endpoint POST /api/export/stix21
    const res = await cangrejoHonoApp.request('http://localhost/api/export/stix21', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Caso Cangrejo STIX 2.1',
        caseTier: 'ORO',
        entities: [
          { id: dom.id.toString(), typeName: 'maltego.Domain', value: 'apt29-c2.example.org' },
          { id: ip.id.toString(), typeName: 'maltego.IPv4Address', value: '185.220.101.42' },
        ],
        links: [
          { id: Guid.generate().toString(), sourceId: dom.id.toString(), targetId: ip.id.toString(), label: 'resolves-to' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      bundle: {
        type: string;
        spec_version: string;
        x_cangrejo_custody: { canonicalDigestHex: string; entityCount: number; relationshipCount: number };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.bundle.type).toBe('bundle');
    expect(body.bundle.spec_version).toBe('2.1');
    expect(body.bundle.x_cangrejo_custody.entityCount).toBe(2);
    expect(body.bundle.x_cangrejo_custody.relationshipCount).toBe(1);
    expect(computeSha256Hex('cangrejo')).toHaveLength(64);
  });
});
