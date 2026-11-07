import { describe, expect, it } from 'vitest';
import { cangrejoHonoApp } from '../apps/web/honoApp.js';

describe('Gate 8: HMAC-SHA256 Commercial Licensing, Billing Webhooks, Radar 24/7 Drift Detection, BYOK/Cloud Connectors & Smart IOC Ingestor', () => {
  it('1. issues HMAC-SHA256 signed license tokens, processes Stripe/LemonSqueezy billing webhooks, and rejects forged signatures', async () => {
    // Issue a cryptographically signed PLATINO_ENTERPRISE token
    const issueRes = await cangrejoHonoApp.request('/api/billing/issue-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: 'PLATINO_ENTERPRISE',
        organizationName: 'Banca Nacional de Custodia Forense S.A.',
        credits: 7500,
      }),
    });
    expect(issueRes.status).toBe(200);
    const issueJson = (await issueRes.json()) as {
      ok: boolean;
      licenseToken: string;
      tier: string;
    };
    expect(issueJson.ok).toBe(true);
    expect(issueJson.licenseToken.startsWith('CGRJ.PLATINO_ENTERPRISE.')).toBe(true);

    // Tamper with the HMAC signature at the end -> activation must be rejected with HTTP 400
    const tamperedToken = `${issueJson.licenseToken.slice(0, -6)}ffffff`;
    const tamperedRes = await cangrejoHonoApp.request('/api/edition/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: tamperedToken }),
    });
    expect(tamperedRes.status).toBe(400);
    const tamperedJson = (await tamperedRes.json()) as { ok: boolean; error: string };
    expect(tamperedJson.ok).toBe(false);
    expect(tamperedJson.error).toContain('HMAC-SHA256');

    // Simulate a Stripe/LemonSqueezy billing webhook -> must issue & activate license automatically
    const webhookRes = await cangrejoHonoApp.request('/api/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'stripe',
        type: 'checkout.session.completed',
        meta: {
          tier: 'ORO_PRO',
          organizationName: 'Unidad Antifraude Mercantil',
        },
      }),
    });
    expect(webhookRes.status).toBe(200);
    const webhookJson = (await webhookRes.json()) as {
      ok: boolean;
      webhookProcessed: boolean;
      issuedLicenseToken: string;
      editionState: {
        editionTier: string;
        creditsRemaining: number;
        whiteLabel: { organizationName: string };
      };
    };
    expect(webhookJson.ok).toBe(true);
    expect(webhookJson.webhookProcessed).toBe(true);
    expect(webhookJson.editionState.editionTier).toBe('ORO_PRO');
    expect(webhookJson.editionState.creditsRemaining).toBe(500);
    expect(webhookJson.editionState.whiteLabel.organizationName).toBe(
      'Unidad Antifraude Mercantil'
    );
  });

  it('2. monitors targets with Radar Cangrejo 24/7 and detects infrastructure drift (new IPs & rotated MX records)', async () => {
    const watchRes = await cangrejoHonoApp.request('/api/radar/watches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'watch-apt29-relay',
        targetValue: 'apt29-stealth-relay.org',
        entityType: 'maltego.Domain',
        baselineIndicators: ['A:185.220.101.42', 'MX:mail1.apt29-stealth-relay.org'],
      }),
    });
    expect(watchRes.status).toBe(200);
    const watchJson = (await watchRes.json()) as {
      ok: boolean;
      watch: { id: string; baselineDigestHex: string; driftCount: number };
    };
    expect(watchJson.ok).toBe(true);
    expect(watchJson.watch.driftCount).toBe(0);

    // 1st Scan: identical indicators -> no drift
    const stableScanRes = await cangrejoHonoApp.request('/api/radar/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        watchId: 'watch-apt29-relay',
        observedIndicators: ['MX:mail1.apt29-stealth-relay.org', 'A:185.220.101.42'],
      }),
    });
    const stableScanJson = (await stableScanRes.json()) as {
      ok: boolean;
      driftDetected: boolean;
      alert: unknown;
    };
    expect(stableScanJson.driftDetected).toBe(false);
    expect(stableScanJson.alert).toBeNull();

    // 2nd Scan: adversary rotates IPv4 and adds a new C2 IP -> CRITICAL drift alert!
    const driftScanRes = await cangrejoHonoApp.request('/api/radar/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        watchId: 'watch-apt29-relay',
        observedIndicators: [
          'A:91.219.236.174',
          'A:45.155.205.233',
          'MX:mail1.apt29-stealth-relay.org',
        ],
      }),
    });
    expect(driftScanRes.status).toBe(200);
    const driftScanJson = (await driftScanRes.json()) as {
      ok: boolean;
      driftDetected: boolean;
      watch: { driftCount: number };
      alert: {
        severity: string;
        addedIndicators: string[];
        removedIndicators: string[];
      };
    };
    expect(driftScanJson.ok).toBe(true);
    expect(driftScanJson.driftDetected).toBe(true);
    expect(driftScanJson.watch.driftCount).toBe(1);
    expect(driftScanJson.alert.severity).toBe('CRITICO');
    expect(driftScanJson.alert.addedIndicators).toContain('a:91.219.236.174');
    expect(driftScanJson.alert.removedIndicators).toContain('a:185.220.101.42');
  });

  it('3. stores masked BYOK API keys for Shodan/VirusTotal/AbuseIPDB and executes commercial OSINT transforms in BYOK mode', async () => {
    const saveKeyRes = await cangrejoHonoApp.request('/api/edition/provider-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'shodan',
        apiKey: 'shod_live_9876543210abcdef1234',
      }),
    });
    expect(saveKeyRes.status).toBe(200);
    const saveKeyJson = (await saveKeyRes.json()) as {
      ok: boolean;
      providerKey: { provider: string; maskedKey: string };
    };
    expect(saveKeyJson.ok).toBe(true);
    expect(saveKeyJson.providerKey.provider).toBe('shodan');
    expect(saveKeyJson.providerKey.maskedKey).toBe('shod••••1234');

    // Execute Shodan transform -> must authenticate in BYOK mode
    const shodanRunRes = await cangrejoHonoApp.request('/api/transforms/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transformId: 'shodan-host-intel',
        entityType: 'maltego.Domain',
        value: 'c2-node-byok.cangrejo.org',
        bypassCache: true,
      }),
    });
    expect(shodanRunRes.status).toBe(200);
    const shodanJson = (await shodanRunRes.json()) as {
      ok: boolean;
      entities: Array<{ fields: { authMode: string } }>;
    };
    expect(shodanJson.ok).toBe(true);
    expect(shodanJson.entities.length).toBeGreaterThanOrEqual(1);
    expect(shodanJson.entities[0]!.fields.authMode).toBe('BYOK');
  });

  it('4. extracts multi-type IOCs (CVE, SHA-256, IPv4, Domain, Email, ASN, BTC Wallet) from raw unstructured text into a radial graph', async () => {
    const rawReport = `
      BOLETÍN FORENSE CANGREJO:
      Se detectó exfiltración hacia el servidor C2 apt29-dropzone.org (185.220.101.42) alojado en AS42610.
      El vector inicial explotó la vulnerabilidad CVE-2024-3400 inyectando el binario con hash SHA-256:
      e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
      Correo del operador: ransom-ops@protonmail.com y dirección BTC: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa.
    `;

    const ingestRes = await cangrejoHonoApp.request('/api/ingest/raw-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: rawReport,
        incidentTitle: 'Caso Boletín C2',
      }),
    });
    expect(ingestRes.status).toBe(200);
    const ingestJson = (await ingestRes.json()) as {
      ok: boolean;
      extractedCount: number;
      incidentRoot: { id: string; value: string };
      entities: Array<{ typeName: string; value: string }>;
      links: Array<{ sourceId: string; targetId: string }>;
    };
    expect(ingestJson.ok).toBe(true);
    expect(ingestJson.extractedCount).toBeGreaterThanOrEqual(6);
    expect(ingestJson.links.length).toBe(ingestJson.extractedCount);

    const extractedTypes = new Set(ingestJson.entities.map((e) => e.typeName));
    expect(extractedTypes.has('maltego.CVE')).toBe(true);
    expect(extractedTypes.has('maltego.Hash')).toBe(true);
    expect(extractedTypes.has('maltego.IPv4Address')).toBe(true);
    expect(extractedTypes.has('maltego.Domain')).toBe(true);
    expect(extractedTypes.has('maltego.EmailAddress')).toBe(true);
    expect(extractedTypes.has('maltego.ASNumber')).toBe(true);
    expect(extractedTypes.has('maltego.BTCAddress')).toBe(true);
  });

  it('5. keeps OSINT transforms 100% free (0 credits) while supporting on-demand AI Top-Up Packs (Rollover) and Agent Auto-Recharge', async () => {
    // Reset to COMMUNITY (0 credits)
    await cangrejoHonoApp.request('/api/edition/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'COMMUNITY' }),
    });

    // Top-up +250 AI Credits on COMMUNITY without subscription
    const topupRes = await cangrejoHonoApp.request('/api/billing/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packId: 'pack-tactico-250',
        agentBudgetLimit: 200,
        autoRechargeEnabled: false,
      }),
    });
    expect(topupRes.status).toBe(200);
    const topupJson = (await topupRes.json()) as {
      ok: boolean;
      osintTransformsFree: boolean;
      creditsAdded: number;
      rolloverNeverExpires: boolean;
      editionState: { editionTier: string; creditsRemaining: number };
    };
    expect(topupJson.ok).toBe(true);
    expect(topupJson.osintTransformsFree).toBe(true);
    expect(topupJson.rolloverNeverExpires).toBe(true);
    expect(topupJson.creditsAdded).toBe(250);
    expect(topupJson.editionState.editionTier).toBe('COMMUNITY');
    expect(topupJson.editionState.creditsRemaining).toBe(250);

    // Run OSINT transform with freeOsintMode=true -> must deduct 0 credits (stays 250)
    const osintRes = await cangrejoHonoApp.request('/api/transforms/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transformId: 'dns-to-ip',
        entityType: 'maltego.Domain',
        value: `free-osint-${Date.now()}.cangrejo.org`,
        freeOsintMode: true,
      }),
    });
    expect(osintRes.status).toBe(200);
    const osintJson = (await osintRes.json()) as { creditsRemaining: number };
    expect(osintJson.creditsRemaining).toBe(250);

    // Run AI endpoint (/api/ai/unpack-iocs) -> must deduct 1 AI credit (250 -> 249)
    const aiRes = await cangrejoHonoApp.request('/api/ai/unpack-iocs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'C2 beacon observed at hxxps://apt-c2[.]org/gate',
      }),
    });
    expect(aiRes.status).toBe(200);
    const aiJson = (await aiRes.json()) as { creditsRemaining: number };
    expect(aiJson.creditsRemaining).toBe(249);
  });
});
