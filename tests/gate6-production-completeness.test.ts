import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cangrejoHonoApp } from '../apps/web/honoApp.js';
import { createCangrejoProductionFetchHandler } from '../apps/web/bunServer.js';
import { EntityRegistry, GraphStore, Guid, createPropertyBag } from '../packages/core/src/index.js';
import { ForensicDossierGenerator } from '../packages/transforms/src/index.js';

describe('Gate 6: Production Packaging, SQLite Vault Retrieval, Symmetric Bóveda Cero (.cgrj), Real OSINT Connectors, Live Collaboration & Forensic Dossier', () => {
  it('1. serves both /api/* Hono routes and compiled static assets via createCangrejoProductionFetchHandler', async () => {
    const tmpDist = path.resolve(process.cwd(), 'dist');
    if (!fs.existsSync(tmpDist)) {
      fs.mkdirSync(tmpDist, { recursive: true });
    }
    const indexHtmlPath = path.resolve(tmpDist, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
      fs.writeFileSync(indexHtmlPath, '<!DOCTYPE html><html><body>CANGREJO</body></html>', 'utf8');
    }

    const prodFetch = createCangrejoProductionFetchHandler(tmpDist);

    const apiRes = await prodFetch(new Request('http://127.0.0.1:8787/api/health'));
    expect(apiRes.status).toBe(200);
    expect(apiRes.headers.get('X-Cangrejo-Engine')).toBe('Cangrejo-Oro-v1.0');
    const apiBody = (await apiRes.json()) as { ok: boolean };
    expect(apiBody.ok).toBe(true);

    const rootRes = await prodFetch(new Request('http://127.0.0.1:8787/'));
    expect(rootRes.status).toBe(200);
    expect(rootRes.headers.get('Content-Type')).toContain('text/html');
    const htmlText = await rootRes.text();
    expect(htmlText).toContain('<!DOCTYPE html>');
  });

  it('2. round-trips Expedientes via GET /api/vault/expedientes/:id and decrypts/verifies Bóveda Cero (.cgrj) envelopes while rejecting tampering', async () => {
    const saveRes = await cangrejoHonoApp.request('http://localhost/api/vault/expedientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'exp-gate6-001',
        title: { title: 'Operación Orinoco', caseTier: 'PLATINO' },
        entities: [{ id: '0x0000000000000701', typeName: 'maltego.Domain', value: 'orinoco.cangrejo.org' }],
        links: [],
      }),
    });
    expect(saveRes.status).toBe(200);

    const getRes = await cangrejoHonoApp.request('http://localhost/api/vault/expedientes/exp-gate6-001');
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      ok: boolean;
      expediente: { id: string; caseTier: string; entityCount: number };
      payload: { entities: Array<{ value: string }> };
    };
    expect(getBody.ok).toBe(true);
    expect(getBody.expediente.caseTier).toBe('PLATINO');
    expect(getBody.payload.entities[0]?.value).toBe('orinoco.cangrejo.org');

    // Encrypt and Decrypt a Bóveda Cero (.cgrj) envelope
    const encRes = await cangrejoHonoApp.request('http://localhost/api/export/mtgj-encrypted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passphrase: 'clave-secreta-cangrejo-oro-2026',
        entities: [
          {
            id: '0x0000000000000701',
            typeName: 'maltego.Domain',
            value: 'boveda-cero.cangrejo.org',
            weight: 100,
            bookmark: 2,
            notes: { value: 'Clasificado Platino', show: true },
            properties: { fqdn: 'boveda-cero.cangrejo.org' },
            position: { x: 15, y: 25, z: 0 },
            pinned: true,
          },
        ],
        links: [],
      }),
    });
    expect(encRes.status).toBe(200);
    const encData = (await encRes.json()) as { ok: boolean; envelope: Record<string, unknown> };
    expect(encData.ok).toBe(true);

    const decRes = await cangrejoHonoApp.request('http://localhost/api/import/mtgj-decrypted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        envelope: encData.envelope,
        passphrase: 'clave-secreta-cangrejo-oro-2026',
      }),
    });
    expect(decRes.status).toBe(200);
    const decData = (await decRes.json()) as {
      ok: boolean;
      verifiedGmac: boolean;
      entities: Array<{ value: string; pinned: boolean }>;
    };
    expect(decData.ok).toBe(true);
    expect(decData.verifiedGmac).toBe(true);
    expect(decData.entities[0]?.value).toBe('boveda-cero.cangrejo.org');
    expect(decData.entities[0]?.pinned).toBe(true);

    // Wrong passphrase must fail closed with HTTP 400
    const badRes = await cangrejoHonoApp.request('http://localhost/api/import/mtgj-decrypted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        envelope: encData.envelope,
        passphrase: 'wrong-passphrase',
      }),
    });
    expect(badRes.status).toBe(400);
  });

  it('3. executes DNS TXT / SPF / DMARC OSINT transform with graceful degradation', async () => {
    const res = await cangrejoHonoApp.request('http://localhost/api/transforms/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transformId: 'dns-txt-records',
        entityType: 'maltego.Domain',
        entityValue: 'cloudflare.com',
        customContext: { gate6Audit: 'txt-spf' },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      entities: Array<{ typeName: string; value: string }>;
      customContext?: { gate6Audit: string };
    };
    expect(body.ok).toBe(true);
    expect(body.entities.length).toBeGreaterThanOrEqual(1);
    expect(body.entities[0]?.typeName).toBe('maltego.Phrase');
    expect(body.customContext?.gate6Audit).toBe('txt-spf');
  });

  it('4. registers live analysts and broadcasts GraphMods deltas in /api/collab/rooms/:roomId', async () => {
    const roomId = 'expediente-gate6-collab';
    const joinRes = await cangrejoHonoApp.request(`http://localhost/api/collab/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analystId: 'analyst-oro-03',
        displayName: 'Subcomisaria V. Briceño',
        forensicRank: 'PLATINO',
        colorHex: '#10B981',
      }),
    });
    expect(joinRes.status).toBe(200);

    const deltaRes = await cangrejoHonoApp.request(
      `http://localhost/api/collab/rooms/${roomId}/deltas`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorId: 'analyst-oro-03',
          addedEntities: [
            {
              id: '0x0000000000000801',
              typeName: 'maltego.Domain',
              value: 'sync-node.cangrejo.org',
              weight: 100,
              bookmark: 0,
              position: { x: 40, y: 80, z: 0 },
              pinned: false,
            },
          ],
        }),
      }
    );
    expect(deltaRes.status).toBe(200);
    const deltaJson = (await deltaRes.json()) as { ok: boolean; deltaCount: number };
    expect(deltaJson.ok).toBe(true);
    expect(deltaJson.deltaCount).toBe(1);
  });

  it('5. generates a self-contained HTML5 Printable Forensic Dossier with PageRank rankings and SHA-256 Chain-of-Custody seal', async () => {
    const registry = new EntityRegistry();
    const store = new GraphStore(Guid.parse('0x0000000000000900'));
    const n1 = registry.createEntity('maltego.Domain', 'command-c2.cangrejo.org', {
      id: Guid.parse('0x0000000000000901'),
      weight: 100,
    });
    const n2 = registry.createEntity('maltego.IPv4Address', '104.21.88.10', {
      id: Guid.parse('0x0000000000000902'),
      weight: 90,
    });
    store.addEntity(n1, { x: 0, y: 0, z: 0 });
    store.addEntity(n2, { x: 180, y: 0, z: 0 });
    store.addLink(
      {
        id: Guid.parse('0x0000000000000903'),
        typeName: 'maltego.link.transform-link',
        weight: 1,
        bookmark: -1,
        notes: { value: '', show: false },
        displayInfo: [],
        properties: createPropertyBag(),
      },
      n1.id,
      n2.id
    );

    const directDossier = ForensicDossierGenerator.generateFromStore(store, {
      expedienteId: 'EXP-CGRJ-900',
      expedienteTitle: 'Informe Pericial Caso Cangrejo',
      caseTier: 'PLATINO',
      sourceId: n1.id,
      targetId: n2.id,
    });
    expect(directDossier.html).toContain('<!DOCTYPE html>');
    expect(directDossier.html).toContain('Informe Pericial Caso Cangrejo');
    expect(directDossier.html).toContain('command-c2.cangrejo.org');
    expect(directDossier.sha256CustodyDigest).toMatch(/^[0-9a-f]{64}$/);

    // Verify HTTP endpoint POST /api/export/dossier-html
    const httpRes = await cangrejoHonoApp.request('http://localhost/api/export/dossier-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'EXP-CGRJ-HTTP',
        title: 'Expediente Judicial CANGREJO',
        caseTier: 'ORO',
        entities: [
          { id: n1.id.toString(), typeName: 'maltego.Domain', value: 'command-c2.cangrejo.org' },
          { id: n2.id.toString(), typeName: 'maltego.IPv4Address', value: '104.21.88.10' },
        ],
        links: [
          { id: '0x0000000000000903', sourceId: n1.id.toString(), targetId: n2.id.toString(), label: 'resolves-to' },
        ],
      }),
    });
    expect(httpRes.status).toBe(200);
    const httpBody = (await httpRes.json()) as {
      ok: boolean;
      dossier: { expedienteId: string; sha256CustodyDigest: string; html: string };
    };
    expect(httpBody.ok).toBe(true);
    expect(httpBody.dossier.expedienteId).toBe('EXP-CGRJ-HTTP');
    expect(httpBody.dossier.html).toContain('Certificado de Cadena de Custodia Criptográfica');
  });
});
