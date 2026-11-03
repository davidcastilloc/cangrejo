import { describe, expect, it } from 'vitest';
import {
  CollaborationRoomHub,
  EntityRegistry,
  GraphStore,
  Guid,
  createPropertyBag,
  getPartPrimaryValue,
} from '@cangrejo/core';
import { BunSqliteVault } from '@cangrejo/database-d1';
import {
  MtgjSchemaValidator,
  validateCgrjWithZod,
} from '@cangrejo/schemas';
import { cangrejoHonoApp } from '../apps/web/honoApp.js';

describe('Gate 4: Polyglot Stack — Hono Web-Standard API, BunSqliteVault, Zod (.passthrough) & Multiplayer Collaboration', () => {
  const registry = new EntityRegistry();

  describe('1. Hono Web-Standard API & Zero-Pruning HTTP Contract Tests', () => {
    it('serves /api/health and /api/openapi.json with X-Cangrejo-Engine header', async () => {
      const healthRes = await cangrejoHonoApp.request('http://127.0.0.1:5173/api/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.headers.get('X-Cangrejo-Engine')).toBe('Cangrejo-Oro-v1.0');

      const healthJson = (await healthRes.json()) as {
        ok: boolean;
        engine: string;
        activeAnalysts: number;
      };
      expect(healthJson.ok).toBe(true);
      expect(healthJson.engine).toContain('CANGREJO');
      expect(healthJson.activeAnalysts).toBeGreaterThanOrEqual(2);

      const openApiRes = await cangrejoHonoApp.request('http://127.0.0.1:5173/api/openapi.json');
      expect(openApiRes.status).toBe(200);
      const spec = (await openApiRes.json()) as { openapi: string; paths: Record<string, unknown> };
      expect(spec.openapi).toBe('3.1.0');
      expect(spec.paths['/api/transforms/run']).toBeDefined();
    });

    it('accepts polymorphic entityValue inputs and preserves custom attributes via Zod .passthrough()', async () => {
      const res = await cangrejoHonoApp.request('http://127.0.0.1:5173/api/transforms/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transformId: 'threat-intel',
          entityType: 'maltego.Domain',
          // Polymorphic object input instead of primitive string
          entityValue: { value: 'c2-Dropper.apt29.example' },
          entityFields: { custom_analyst_tag: 'CICPC-Cangrejo-Oro', confidence: 99 },
          customContext: {
            investigationCode: 'CASO-CANGREJO-1972',
            baggageAllowanceTest: { preservedNestedField: true },
          },
        }),
      });

      expect(res.status).toBe(200);
      const payload = (await res.json()) as {
        ok: boolean;
        entities: Array<{
          typeName: string;
          value: string;
          forensicTier?: string;
          fields: Record<string, string>;
        }>;
        customContext?: {
          investigationCode: string;
          baggageAllowanceTest: { preservedNestedField: boolean };
        };
      };

      expect(payload.ok).toBe(true);
      expect(payload.entities.length).toBeGreaterThanOrEqual(3);
      // Verify extra fields (forensicTier & customContext) were NOT pruned by Zod response validation
      expect(payload.entities[0]!.forensicTier).toBe('PLATINO');
      expect(payload.customContext?.investigationCode).toBe('CASO-CANGREJO-1972');
      expect(payload.customContext?.baggageAllowanceTest.preservedNestedField).toBe(true);
    });
  });

  describe('2. BunSqliteVault Native Persistence & Polymorphic Defensive Input', () => {
    it('persists and queries forensic Expedientes with both primitive and object metadata and logs audits safely', () => {
      const vault = new BunSqliteVault(':memory:');

      // Save with primitive string title
      const exp1 = vault.saveExpediente({
        id: 'exp-001',
        titleOrMeta: 'Operación Río Guaire 1971',
        entityCount: 14,
        linkCount: 19,
        cgrjPayload: { id: 'exp-001', entities: [], links: [] },
      });
      expect(exp1.title).toBe('Operación Río Guaire 1971');
      expect(exp1.caseTier).toBe('ORO');

      // Save with polymorphic object metadata
      const exp2 = vault.saveExpediente({
        id: 'exp-002',
        titleOrMeta: { title: 'Operación Relámpago Catatumbo', caseTier: 'PLATINO' },
        entityCount: 42,
        linkCount: 68,
        cgrjPayload: { id: 'exp-002', entities: [], links: [] },
      });
      expect(exp2.caseTier).toBe('PLATINO');

      const loaded = vault.getExpediente('exp-002');
      expect(loaded?.title).toBe('Operación Relámpago Catatumbo');
      expect(vault.listExpedientes()).toHaveLength(2);

      // Secondary audit log with graceful degradation
      const auditOk = vault.recordPesquisaAuditSafe({
        id: 'audit-1',
        transformId: 'dns-to-ip',
        targetValue: 'cloudflare.com',
        discoveredCount: 4,
        elapsedMs: 12.4,
      });
      expect(auditOk).toBe(true);
      expect(vault.listPesquisaAudits()).toHaveLength(1);

      vault.close();
    });
  });

  describe('3. CSP-Safe Zod Schema Validation (.passthrough() Invariant)', () => {
    it('validates .cgrj v2.0.0 documents without eval() and preserves custom provider fields at all levels', () => {
      const store = new GraphStore(new Guid(777n));
      const ent = registry.createEntity('maltego.Domain', 'oro.cangrejo.ve', {
        id: new Guid(10n),
        weight: 100,
      });
      store.addEntity(ent, { x: 12, y: 34, z: 0 }, true);

      const validator = new MtgjSchemaValidator();
      const serialized = validator.serializeGraphStore(store, {
        name: 'ExpedienteZod',
      }) as unknown as Record<string, unknown>;

      // Inject custom provider attributes at root and entity level
      serialized.customForensicAgency = 'CICPC-Div-Informatica';
      (serialized.entities as Array<Record<string, unknown>>)[0]!.customProviderEnrichment = {
        passiveDnsFirstSeen: '2026-01-15',
        tlpLevel: 'AMBER',
      };

      const outcome = validateCgrjWithZod(serialized);
      expect(outcome.valid).toBe(true);

      const parsedData = outcome.data as Record<string, unknown>;
      expect(parsedData.customForensicAgency).toBe('CICPC-Div-Informatica');
      const parsedEnt = (parsedData.entities as Array<Record<string, unknown>>)[0]!;
      expect(parsedEnt.customProviderEnrichment).toEqual({
        passiveDnsFirstSeen: '2026-01-15',
        tlpLevel: 'AMBER',
      });
    });
  });

  describe('4. Real-Time Collaborative GraphMods Synchronization (CollaborationRoomHub)', () => {
    it('synchronizes GraphMods deltas idempotently across multiple analysts in real time', () => {
      const hub = new CollaborationRoomHub();
      const roomId = 'caso-cangrejo-multiplayer';

      hub.joinRoom(roomId, {
        analystId: 'yerena',
        displayName: 'Inspector Yerena',
        forensicRank: 'PLATINO',
        colorHex: '#38BDF8',
        cursorWorld: { x: 0, y: 0 },
        selectedEntityIds: [],
      });

      const storeAnalystA = new GraphStore(new Guid(100n));
      const storeAnalystB = new GraphStore(new Guid(100n));

      // Subscribe Analyst A's store to automatically publish consolidated GraphMods deltas to the room
      storeAnalystA.subscribe((mods) => {
        const delta = hub.serializeModsToDelta(roomId, 'yerena', storeAnalystA, mods);
        hub.publishDelta(delta);
      });

      // Subscribe Analyst B's store to room deltas
      hub.subscribeRoom(roomId, (delta) => {
        hub.applyDeltaToStore(storeAnalystB, delta, registry);
      });

      // Analyst A adds 2 entities and 1 directed link inside a batch
      const domain = registry.createEntity('maltego.Domain', 'red-oculta.org', {
        id: new Guid(501n),
        weight: 100,
        bookmark: 1,
      });
      const ip = registry.createEntity('maltego.IPv4Address', '198.51.100.42', {
        id: new Guid(502n),
        weight: 90,
        bookmark: 3,
      });

      storeAnalystA.runInBatch(() => {
        storeAnalystA.addEntity(domain, { x: -100, y: 50, z: 0 }, true);
        storeAnalystA.addEntity(ip, { x: 200, y: 50, z: 0 }, false);
        storeAnalystA.addLink(
          {
            id: new Guid(900n),
            typeName: 'maltego.link.transform-link',
            weight: 1,
            bookmark: -1,
            notes: { value: '', show: false },
            displayInfo: [],
            properties: createPropertyBag(),
          },
          domain.id,
          ip.id
        );
      });

      const recordedDeltas = hub.getRoomDeltaHistory(roomId);
      expect(recordedDeltas).toHaveLength(1);
      const delta = recordedDeltas[0]!;

      // Analyst B's store immediately converged to Analyst A's state
      expect(storeAnalystB.entityCount).toBe(2);
      expect(storeAnalystB.linkCount).toBe(1);
      expect(getPartPrimaryValue(storeAnalystB.dataStore.getEntity(domain.id))).toBe(
        'red-oculta.org'
      );
      expect(storeAnalystB.layoutStore.isPinned(domain.id)).toBe(true);

      // Re-applying the exact same delta is a safe idempotent no-op
      const appliedAgain = hub.applyDeltaToStore(storeAnalystB, delta, registry);
      expect(appliedAgain).toBe(false);
    });
  });
});
