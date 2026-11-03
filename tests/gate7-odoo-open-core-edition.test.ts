import { describe, expect, it } from 'vitest';
import { cangrejoHonoApp } from '../apps/web/honoApp.js';

describe('Gate 7: Odoo-Style Open-Core Edition Engine (Community vs Oro Pro vs Platino Enterprise)', () => {
  it('1. defaults to COMMUNITY Edition with Open-Core Apache-2.0 attribution watermark on Forensic Dossiers', async () => {
    // Ensure clean COMMUNITY state
    await cangrejoHonoApp.request('/api/edition/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'COMMUNITY' }),
    });

    const statusRes = await cangrejoHonoApp.request('/api/edition/status');
    expect(statusRes.status).toBe(200);
    const statusJson = (await statusRes.json()) as {
      ok: boolean;
      editionTier: string;
      creditsRemaining: number;
      whiteLabel: { watermarkEnabled: boolean };
      entitlements: { whiteLabelDossier: boolean; oneClickCloudOsint: boolean };
    };
    expect(statusJson.ok).toBe(true);
    expect(statusJson.editionTier).toBe('COMMUNITY');
    expect(statusJson.creditsRemaining).toBe(0);
    expect(statusJson.whiteLabel.watermarkEnabled).toBe(true);
    expect(statusJson.entitlements.whiteLabelDossier).toBe(false);

    // Export a Forensic Dossier in COMMUNITY mode -> must contain Community watermark
    const dossierRes = await cangrejoHonoApp.request('/api/export/dossier-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Caso Community Audit',
        entities: [{ id: '101', typeName: 'maltego.Domain', value: 'cangrejo.org', weight: 100 }],
        links: [],
      }),
    });
    expect(dossierRes.status).toBe(200);
    const dossierJson = (await dossierRes.json()) as {
      ok: boolean;
      dossier: { watermarkEnabled: boolean; editionTier: string; html: string };
    };
    expect(dossierJson.ok).toBe(true);
    expect(dossierJson.dossier.editionTier).toBe('COMMUNITY');
    expect(dossierJson.dossier.watermarkEnabled).toBe(true);
    expect(dossierJson.dossier.html).toContain('CANGREJO Community Edition');
  });

  it('2. upgrades to PLATINO_ENTERPRISE with 5,000 OSINT Cloud Credits and generates White-Label Dossiers without watermark', async () => {
    const activateRes = await cangrejoHonoApp.request('/api/edition/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: 'CGRJ-PLATINO-2026-VENEZUELA',
        organizationName: 'Consultora Forense Carabobo & Asociados C.A.',
        badgeTitle: 'DICTAMEN PERICIAL CERTIFICADO — PLATINO',
      }),
    });
    expect(activateRes.status).toBe(200);
    const actJson = (await activateRes.json()) as {
      ok: boolean;
      editionTier: string;
      creditsRemaining: number;
      creditsTotal: number;
      licenseKeyMasked: string;
      whiteLabel: {
        organizationName: string;
        badgeTitle: string;
        watermarkEnabled: boolean;
      };
      entitlements: {
        oneClickCloudOsint: boolean;
        whiteLabelDossier: boolean;
        multiAnalystCollab: boolean;
        continuousRadar24x7: boolean;
        maxEntitiesPerExpediente: number;
      };
    };

    expect(actJson.ok).toBe(true);
    expect(actJson.editionTier).toBe('PLATINO_ENTERPRISE');
    expect(actJson.creditsRemaining).toBe(5000);
    expect(actJson.creditsTotal).toBe(5000);
    expect(actJson.licenseKeyMasked).toContain('CGRJ-PLATINO');
    expect(actJson.whiteLabel.organizationName).toBe('Consultora Forense Carabobo & Asociados C.A.');
    expect(actJson.whiteLabel.watermarkEnabled).toBe(false);
    expect(actJson.entitlements.whiteLabelDossier).toBe(true);
    expect(actJson.entitlements.multiAnalystCollab).toBe(true);
    expect(actJson.entitlements.maxEntitiesPerExpediente).toBe(100000);

    // Export Dossier in PLATINO_ENTERPRISE mode -> White-Label firm name present, Community watermark absent
    const dossierRes = await cangrejoHonoApp.request('/api/export/dossier-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Dictamen Forense Caso Bancario',
        entities: [
          { id: '201', typeName: 'maltego.Domain', value: 'banca-blindada.ve', weight: 100 },
          { id: '202', typeName: 'maltego.IPv4Address', value: '190.9.128.10', weight: 100 },
        ],
        links: [{ id: '901', sourceId: '201', targetId: '202', label: 'A record' }],
      }),
    });
    expect(dossierRes.status).toBe(200);
    const dossierJson = (await dossierRes.json()) as {
      ok: boolean;
      dossier: {
        editionTier: string;
        organizationName: string;
        watermarkEnabled: boolean;
        html: string;
      };
    };
    expect(dossierJson.dossier.editionTier).toBe('PLATINO_ENTERPRISE');
    expect(dossierJson.dossier.watermarkEnabled).toBe(false);
    expect(dossierJson.dossier.organizationName).toBe('Consultora Forense Carabobo & Asociados C.A.');
    expect(dossierJson.dossier.html).toContain('Consultora Forense Carabobo &amp; Asociados C.A.');
    expect(dossierJson.dossier.html).toContain('DICTAMEN PERICIAL CERTIFICADO — PLATINO');
    expect(dossierJson.dossier.html).not.toContain('Generado con <strong>CANGREJO Community Edition');
  });

  it('3. deducts 1 OSINT Cloud Credit on uncached Pesquisa execution in Enterprise mode and resets cleanly to COMMUNITY', async () => {
    const uniqueDomain = `credit-check-${Date.now()}.cangrejo.org`;
    const runRes = await cangrejoHonoApp.request('/api/transforms/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transformId: 'threat-intel',
        entityType: 'maltego.Domain',
        value: uniqueDomain,
      }),
    });
    expect(runRes.status).toBe(200);
    const runJson = (await runRes.json()) as {
      ok: boolean;
      editionTier?: string;
      creditsRemaining?: number;
    };
    expect(runJson.ok).toBe(true);
    expect(runJson.editionTier).toBe('PLATINO_ENTERPRISE');
    expect(runJson.creditsRemaining).toBe(4999);

    // Reset back to COMMUNITY
    const resetRes = await cangrejoHonoApp.request('/api/edition/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'COMMUNITY' }),
    });
    const resetJson = (await resetRes.json()) as { editionTier: string; creditsRemaining: number };
    expect(resetJson.editionTier).toBe('COMMUNITY');
    expect(resetJson.creditsRemaining).toBe(0);
  });
});
