import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import cloudflareWorker, { type CangrejoCloudflareEnv } from '../apps/web/cloudflareWorker.js';
import { cangrejoHonoApp } from '../apps/web/honoApp.js';
import { CloudflareWorkersAiEngine } from '../packages/transforms/src/index.js';

describe('Gate 10: Cloudflare Workers Edge Entrypoint, Daubert/Ed25519 HTML5 Dossier & AI Materialization', () => {
  it('1. validates wrangler.jsonc best-practices bindings and routes /api/ai/* through env.AI binding in cloudflareWorker.ts', async () => {
    const wranglerPath = path.resolve(process.cwd(), 'wrangler.jsonc');
    expect(fs.existsSync(wranglerPath)).toBe(true);
    const wranglerRaw = fs.readFileSync(wranglerPath, 'utf8');
    expect(wranglerRaw).toContain('"nodejs_compat"');
    expect(wranglerRaw).toContain('"binding": "AI"');
    expect(wranglerRaw).toContain('"binding": "VECTORIZE_INDEX"');
    expect(wranglerRaw).toContain('"binding": "DB"');
    expect(wranglerRaw).toContain('"binding": "ASSETS"');

    const mockEnv: CangrejoCloudflareEnv = {
      AI: {
        run: async () => ({ response: 'ok' }),
      },
      ASSETS: {
        fetch: async () =>
          new Response('<!doctype html><html><body>CANGREJO SPA</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
      },
    };

    const apiReq = new Request('https://edge.cangrejo.io/api/ai/unpack-iocs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Tráfico detectado hacia hxxps[:]//edge-c2[.]apt29-mirror[.]org/beacon desde 185[.]220[.]101[.]42.',
      }),
    });

    const apiRes = await cloudflareWorker.fetch(apiReq, mockEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    });
    expect(apiRes.status).toBe(200);
    const apiJson = (await apiRes.json()) as {
      ok: boolean;
      unpackedCount: number;
      aiMeta: { executionBackend: string; hardwareRequirement: string };
    };
    expect(apiJson.ok).toBe(true);
    expect(apiJson.unpackedCount).toBeGreaterThanOrEqual(2);
    expect(apiJson.aiMeta.executionBackend).toBe('CLOUDFLARE_WORKERS_AI_BINDING');
    expect(apiJson.aiMeta.hardwareRequirement).toBe('NONE_UNIVERSAL_CPU_OR_EDGE');

    // Verify non-API requests delegate to env.ASSETS
    const assetReq = new Request('https://edge.cangrejo.io/index.html', { method: 'GET' });
    const assetRes = await cloudflareWorker.fetch(assetReq, mockEnv);
    expect(assetRes.status).toBe(200);
    expect(await assetRes.text()).toContain('CANGREJO SPA');
  });

  it('2. embeds Sección 4 (Daubert / FRE 702 + Ed25519 digital signature) directly inside exported HTML5 Forensic Dossiers (/api/export/dossier-html)', async () => {
    const res = await cangrejoHonoApp.request('/api/export/dossier-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'EXP-GATE10-DAUBERT',
        title: 'Expediente Judicial Operación Cangrejo Dorado',
        caseTier: 'PLATINO',
        leadAnalyst: 'Comisario L. Yerena (Unidad CANGREJO)',
        entities: [
          {
            id: '901',
            typeName: 'maltego.Domain',
            value: 'c2-core.apt29-mirror.org',
            weight: 100,
          },
          {
            id: '902',
            typeName: 'maltego.IPv4Address',
            value: '185.220.101.42',
            weight: 95,
          },
        ],
        links: [
          {
            id: '991',
            sourceId: '901',
            targetId: '902',
            label: 'A record resolution',
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      dossier: {
        expedienteId: string;
        html: string;
        daubertSynthesis: {
          standard: string;
          executiveNarrative: string;
          citedEntityIds: string[];
          attestation: {
            algorithm: string;
            canonicalSha256Hex: string;
            signatureHex: string;
            publicKeyPem: string;
          };
        };
      };
    };

    expect(json.ok).toBe(true);
    expect(json.dossier.daubertSynthesis.standard).toBe('DAUBERT_FRE_702_VERIFIED');
    expect(
      CloudflareWorkersAiEngine.verifyDaubertAttestation(
        json.dossier.daubertSynthesis.attestation
      )
    ).toBe(true);
    expect(json.dossier.html).toContain(
      '4. Dictamen Pericial Automatizado (Estándar Daubert / FRE 702) &amp; Firma Ed25519'
    );
    expect(json.dossier.html).toContain(json.dossier.daubertSynthesis.attestation.signatureHex);
    expect(json.dossier.html).toContain(
      json.dossier.daubertSynthesis.attestation.canonicalSha256Hex
    );

    // Verify UI materialization wiring in index.html & apps/web/main.ts
    const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    expect(indexHtml).toContain('id="btn-ai-materialize"');
    const mainTs = fs.readFileSync(path.resolve(process.cwd(), 'apps/web/main.ts'), 'utf8');
    expect(mainTs).toContain("document.getElementById('btn-ai-materialize')");
  });
});
