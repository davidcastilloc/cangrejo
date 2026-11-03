import { describe, expect, it } from 'vitest';
import { cangrejoHonoApp } from '../apps/web/honoApp.js';

describe('Gate 11: Native MCP JSON-RPC 2.0 Server, Bidirectional OASIS STIX 2.1 Importer & MITRE ATT&CK v15 Kill-Chain Mapper', () => {
  it('1. serves MCP JSON-RPC 2.0 protocol (initialize, tools/list, tools/call) at /api/mcp for external AI agents', async () => {
    const initRes = await cangrejoHonoApp.request('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    });
    expect(initRes.status).toBe(200);
    const initJson = (await initRes.json()) as {
      jsonrpc: string;
      id: number;
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(initJson.jsonrpc).toBe('2.0');
    expect(initJson.result.serverInfo.name).toBe('cangrejo-osint-mcp');

    const listRes = await cangrejoHonoApp.request('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(listJson.result.tools.length).toBe(6);
    expect(listJson.result.tools.map((t) => t.name)).toContain(
      'cangrejo_unpack_defanged_iocs'
    );
    expect(listJson.result.tools.map((t) => t.name)).toContain('cangrejo_map_mitre_attack');

    const callRes = await cangrejoHonoApp.request('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'cangrejo_unpack_defanged_iocs',
          arguments: {
            text: 'C2 detectado en hxxps[:]//mcp-relay[.]apt29[.]org/beacon y 185[.]220[.]101[.]42.',
          },
        },
      }),
    });
    expect(callRes.status).toBe(200);
    const callJson = (await callRes.json()) as {
      result: {
        isError: boolean;
        structuredContent: { unpackedCount: number };
      };
    };
    expect(callJson.result.isError).toBe(false);
    expect(callJson.result.structuredContent.unpackedCount).toBeGreaterThanOrEqual(2);
  });

  it('2. round-trips OASIS STIX 2.1 bundles (/api/export/stix21 -> /api/import/stix21) and detects SHA-256 custody tampering', async () => {
    const exportRes = await cangrejoHonoApp.request('/api/export/stix21', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Expediente STIX Roundtrip',
        caseTier: 'ORO',
        entities: [
          { id: '701', typeName: 'maltego.Domain', value: 'stix-c2.apt29.org', weight: 100 },
          { id: '702', typeName: 'maltego.IPv4Address', value: '185.220.101.99', weight: 90 },
        ],
        links: [{ id: '799', sourceId: '701', targetId: '702', label: 'resolves-to' }],
      }),
    });
    expect(exportRes.status).toBe(200);
    const exported = (await exportRes.json()) as {
      ok: boolean;
      bundle: {
        id: string;
        objects: Array<Record<string, unknown>>;
        x_cangrejo_custody: { canonicalDigestHex: string };
      };
    };
    expect(exported.ok).toBe(true);

    // Import intact bundle -> custodyVerified must be true
    const importRes = await cangrejoHonoApp.request('/api/import/stix21', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle: exported.bundle }),
    });
    expect(importRes.status).toBe(200);
    const imported = (await importRes.json()) as {
      ok: boolean;
      custodyVerified: boolean;
      entityCount: number;
      linkCount: number;
      entities: Array<{ value: string; typeName: string }>;
    };
    expect(imported.ok).toBe(true);
    expect(imported.custodyVerified).toBe(true);
    expect(imported.entityCount).toBe(2);
    expect(imported.linkCount).toBe(1);
    expect(imported.entities.map((e) => e.value)).toContain('stix-c2.apt29.org');

    // Tamper with a STIX object value -> custodyVerified must be false
    const tamperedBundle = structuredClone(exported.bundle);
    const domainObj = tamperedBundle.objects.find((o) => o.type === 'domain-name');
    expect(domainObj).toBeDefined();
    domainObj!.value = 'forged-attacker-domain.org';

    const tamperedRes = await cangrejoHonoApp.request('/api/import/stix21', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle: tamperedBundle }),
    });
    expect(tamperedRes.status).toBe(200);
    const tamperedJson = (await tamperedRes.json()) as {
      custodyVerified: boolean;
      custodyReason: string;
    };
    expect(tamperedJson.custodyVerified).toBe(false);
    expect(tamperedJson.custodyReason).toContain('TAMPER DETECTED');
  });

  it('3. maps graph topology to MITRE ATT&CK Enterprise v15.1 tactics, techniques, and ordered kill-chain timeline (/api/analytics/mitre-attack)', async () => {
    const res = await cangrejoHonoApp.request('/api/analytics/mitre-attack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entities: [
          { id: '1', typeName: 'maltego.Domain', value: 'c2-login.apt29.org' },
          { id: '2', typeName: 'maltego.IPv4Address', value: '185.220.101.42' },
          { id: '3', typeName: 'maltego.CVE', value: 'CVE-2024-3400' },
          { id: '4', typeName: 'maltego.URL', value: 'https://c2-login.apt29.org/gate' },
          {
            id: '5',
            typeName: 'maltego.BTCAddress',
            value: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          },
        ],
        links: [
          { id: '10', sourceId: '1', targetId: '2', label: 'A record' },
          { id: '11', sourceId: '2', targetId: '1', label: 'reverse cycle' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      frameworkVersion: string;
      tacticCount: number;
      techniqueCount: number;
      techniques: Array<{ techniqueId: string; tacticId: string }>;
      timelineEvents: Array<{ stepOrder: number; techniqueId: string }>;
    };
    expect(json.ok).toBe(true);
    expect(json.frameworkVersion).toContain('MITRE ATT&CK');
    expect(json.techniqueCount).toBeGreaterThanOrEqual(5);
    const techIds = json.techniques.map((t) => t.techniqueId);
    expect(techIds).toContain('T1583.001'); // Domains
    expect(techIds).toContain('T1190'); // Exploit Public-Facing Application (CVE)
    expect(techIds).toContain('T1071.001'); // Web Protocols (URL)
    expect(techIds).toContain('T1568.002'); // Fast Flux / Cyclic Routing
    expect(techIds).toContain('T1657'); // Financial Theft / Crypto
    expect(json.timelineEvents[0]!.stepOrder).toBe(1);
  });
});
