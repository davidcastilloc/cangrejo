import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cangrejoHonoApp } from '../apps/web/honoApp.js';
import { dispatchMcpJsonRpcLine } from '../apps/web/mcpStdioServer.js';
import { CloudflareWorkersAiEngine } from '../packages/transforms/src/index.js';

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
    expect(listJson.result.tools.length).toBe(12);
    expect(listJson.result.tools.map((t) => t.name)).toContain(
      'cangrejo_unpack_defanged_iocs'
    );
    expect(listJson.result.tools.map((t) => t.name)).toContain('cangrejo_map_mitre_attack');
    expect(listJson.result.tools.map((t) => t.name)).toContain(
      'cangrejo_ai_auto_investigate'
    );
    expect(listJson.result.tools.map((t) => t.name)).toContain('cangrejo_session_state');
    expect(listJson.result.tools.map((t) => t.name)).toContain('cangrejo_session_mutate_graph');
    expect(listJson.result.tools.map((t) => t.name)).toContain('cangrejo_session_run_pesquisa');
    expect(listJson.result.tools.map((t) => t.name)).toContain('cangrejo_session_view_control');
    expect(listJson.result.tools.map((t) => t.name)).toContain('cangrejo_session_vault');

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

    // Verify live env.AI.run invocation in invokeWorkersAiModel & UI buttons
    const invokedModels: string[] = [];
    await CloudflareWorkersAiEngine.unpackCognitiveIocs('hxxps[:]//test[.]apt29[.]org', {
      aiBinding: {
        run: async (model) => {
          invokedModels.push(model);
          return { response: 'ok' };
        },
      },
    });
    expect(invokedModels).toContain('@cf/meta/llama-3.1-8b-instruct-fp8');

    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
    const indexHtml = fs.readFileSync(path.resolve(repoRoot, 'index.html'), 'utf8');
    expect(indexHtml).toContain('id="btn-import-stix21"');
    expect(indexHtml).toContain('id="btn-ai-run-tools"');

    // Verify Vectorize binding upsert in F2 & OpenAPI 3.1.0 v1.1.0 completeness
    let upsertedCount = 0;
    await CloudflareWorkersAiEngine.discoverLatentLinksRrf(
      {
        expedienteId: 'exp-vec-test',
        entities: [
          { id: '1', typeName: 'maltego.Domain', value: 'a.apt29.org' },
          { id: '2', typeName: 'maltego.Domain', value: 'b.apt29.org' },
        ],
      },
      {
        vectorizeBinding: {
          upsert: async (vectors) => {
            upsertedCount = vectors.length;
            return { count: vectors.length };
          },
        },
      }
    );
    expect(upsertedCount).toBe(2);

    const openApiRes = await cangrejoHonoApp.request('/api/openapi.json');
    expect(openApiRes.status).toBe(200);
    const openApiJson = (await openApiRes.json()) as {
      info: { version: string };
      paths: Record<string, unknown>;
    };
    expect(openApiJson.info.version).toBe('1.1.0');
    expect(openApiJson.paths['/api/mcp']).toBeDefined();
    expect(openApiJson.paths['/api/ai/unpack-iocs']).toBeDefined();
    expect(openApiJson.paths['/api/import/stix21']).toBeDefined();
    expect(openApiJson.paths['/api/analytics/mitre-attack']).toBeDefined();
  });

  it('4. controls the live Cangrejo session (mutate, undo/redo, live pesquisa, view/layout control, vault save/load & stdio bridge)', async () => {
    const roomId = 'expediente-mcp-session-test';

    // 1. Upsert 2 nodes + 1 link via stdio bridge
    const upsertRaw = await dispatchMcpJsonRpcLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 101,
        method: 'tools/call',
        params: {
          name: 'cangrejo_session_mutate_graph',
          arguments: {
            roomId,
            action: 'upsert',
            entities: [
              { id: '9001', typeName: 'maltego.Domain', value: 'cloudflare.com', weight: 100 },
              { id: '9002', typeName: 'maltego.IPv4Address', value: '1.1.1.1', weight: 90 },
            ],
            links: [{ id: '9099', sourceId: '9001', targetId: '9002', label: 'resolves-A' }],
          },
        },
      })
    );
    expect(upsertRaw).not.toBeNull();
    const upsertRpc = JSON.parse(upsertRaw!) as {
      result: { structuredContent: { entityCount: number; linkCount: number; canUndo: boolean } };
    };
    expect(upsertRpc.result.structuredContent.entityCount).toBe(2);
    expect(upsertRpc.result.structuredContent.linkCount).toBe(1);
    expect(upsertRpc.result.structuredContent.canUndo).toBe(true);

    // 2. Undo & Redo on the live session
    const undoRaw = await dispatchMcpJsonRpcLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 102,
        method: 'tools/call',
        params: {
          name: 'cangrejo_session_mutate_graph',
          arguments: { roomId, action: 'undo' },
        },
      })
    );
    const undoRpc = JSON.parse(undoRaw!) as {
      result: { structuredContent: { linkCount: number; canRedo: boolean } };
    };
    expect(undoRpc.result.structuredContent.linkCount).toBe(0);
    expect(undoRpc.result.structuredContent.canRedo).toBe(true);

    await dispatchMcpJsonRpcLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 103,
        method: 'tools/call',
        params: {
          name: 'cangrejo_session_mutate_graph',
          arguments: { roomId, action: 'redo' },
        },
      })
    );

    // 3. View control (select + layout + camera)
    const viewRaw = await dispatchMcpJsonRpcLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 104,
        method: 'tools/call',
        params: {
          name: 'cangrejo_session_view_control',
          arguments: {
            roomId,
            selectEntityIds: ['9001'],
            layoutMode: 'circular',
            camera: { action: 'fit', zoom: 1.25 },
          },
        },
      })
    );
    const viewRpc = JSON.parse(viewRaw!) as {
      result: {
        structuredContent: {
          selectedEntityIds: string[];
          layoutMode: string;
          camera: { zoom: number };
        };
      };
    };
    expect(viewRpc.result.structuredContent.selectedEntityIds).toEqual(['9001']);
    expect(viewRpc.result.structuredContent.layoutMode).toBe('circular');
    expect(viewRpc.result.structuredContent.camera.zoom).toBe(1.25);

    // 4. Execute live OSINT Pesquisa on selected node in session
    const pesqRaw = await dispatchMcpJsonRpcLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 105,
        method: 'tools/call',
        params: {
          name: 'cangrejo_session_run_pesquisa',
          arguments: {
            roomId,
            transformId: 'ct-subdomains',
          },
        },
      })
    );
    const pesqRpc = JSON.parse(pesqRaw!) as {
      result: { structuredContent: { entityCount: number; totalAddedEntities: number } };
    };
    expect(pesqRpc.result.structuredContent.totalAddedEntities).toBeGreaterThanOrEqual(1);
    expect(pesqRpc.result.structuredContent.entityCount).toBeGreaterThan(2);

    // 5. Save session to SQLite Vault and inspect via cangrejo_session_state
    const saveRaw = await dispatchMcpJsonRpcLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 106,
        method: 'tools/call',
        params: {
          name: 'cangrejo_session_vault',
          arguments: {
            roomId,
            action: 'save_expediente',
            expedienteId: 'exp-mcp-saved-01',
            title: 'Caso Controlado por MCP',
            caseTier: 'PLATINO',
          },
        },
      })
    );
    const saveRpc = JSON.parse(saveRaw!) as {
      result: { structuredContent: { ok: boolean; expediente: { id: string; caseTier: string } } };
    };
    expect(saveRpc.result.structuredContent.ok).toBe(true);
    expect(saveRpc.result.structuredContent.expediente.id).toBe('exp-mcp-saved-01');
    expect(saveRpc.result.structuredContent.expediente.caseTier).toBe('PLATINO');

    // Verify room collab endpoint reflects published GraphMods deltas & UI events
    const roomRes = await cangrejoHonoApp.request(`/api/collab/rooms/${roomId}`);
    expect(roomRes.status).toBe(200);
    const roomJson = (await roomRes.json()) as {
      deltas: unknown[];
      session: { entityCount: number; uiEvents: unknown[] };
    };
    expect(roomJson.deltas.length).toBeGreaterThanOrEqual(3);
    expect(roomJson.session.entityCount).toBe(pesqRpc.result.structuredContent.entityCount);
    expect(roomJson.session.uiEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('5. executes Cloudflare Code Mode SDK (.d.ts) and multi-step TypeScript pipelines via /api/ai/codemode and MCP cangrejo_codemode_run', async () => {
    const dtsRes = await cangrejoHonoApp.request('/api/mcp/codemode.d.ts');
    expect(dtsRes.status).toBe(200);
    const dtsText = await dtsRes.text();
    expect(dtsText).toContain('declare namespace CangrejoCodeMode');
    expect(dtsText).toContain('declare const codemode: CangrejoCodeMode.SDK');

    const codeModeListRes = await cangrejoHonoApp.request('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 201,
        method: 'tools/list',
        params: { mode: 'codemode' },
      }),
    });
    expect(codeModeListRes.status).toBe(200);
    const codeModeListJson = (await codeModeListRes.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(codeModeListJson.result.tools.length).toBe(1);
    expect(codeModeListJson.result.tools[0]!.name).toBe('cangrejo_codemode_run');

    const execRes = await cangrejoHonoApp.request('/api/ai/codemode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: 'expediente-codemode-test',
        code: `async () => {
          const [iocs, pesq, mitre] = await Promise.all([
            codemode.unpackDefangedIocs({ text: "C2 hxxps[:]//apt29-relay[.]org" }),
            codemode.runPesquisa({ transformId: "ct-subdomains", entityValue: "cloudflare.com", sliderLimit: 4 }),
            codemode.mapMitreAttack({}),
          ]);
          await codemode.viewControl({ layoutMode: "organic" });
          return { iocs, pesq, mitre };
        }`,
      }),
    });
    expect(execRes.status).toBe(200);
    const execJson = (await execRes.json()) as {
      ok: boolean;
      mode: string;
      stepsExecuted: Array<{ method: string; parallel: boolean }>;
      tokenSavings: { reductionPercent: number };
      session: { entityCount: number };
    };
    expect(execJson.ok).toBe(true);
    expect(execJson.mode).toBe('cloudflare-codemode-v1');
    expect(execJson.stepsExecuted.length).toBe(4);
    expect(execJson.stepsExecuted[0]!.parallel).toBe(true);
    expect(execJson.stepsExecuted[3]!.parallel).toBe(false);
    expect(execJson.tokenSavings.reductionPercent).toBeGreaterThan(90);
    expect(execJson.session.entityCount).toBeGreaterThanOrEqual(2);
  });

  it('6. serves full MCP Resources (resources/list, resources/read), Prompts (prompts/list, prompts/get), ping, notifications, and JSON-RPC 2.0 batching', async () => {
    const batchRes = await cangrejoHonoApp.request('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 301, method: 'ping' },
        { jsonrpc: '2.0', id: 302, method: 'resources/list' },
        {
          jsonrpc: '2.0',
          id: 303,
          method: 'resources/read',
          params: { uri: 'cangrejo://session/expediente-mcp-session-test/graph' },
        },
        { jsonrpc: '2.0', id: 304, method: 'prompts/list' },
        {
          jsonrpc: '2.0',
          id: 305,
          method: 'prompts/get',
          params: {
            name: 'osint-surface-expansion',
            arguments: { target: 'cloudflare.com', roomId: 'expediente-mcp-session-test' },
          },
        },
      ]),
    });
    expect(batchRes.status).toBe(200);
    const batchJson = (await batchRes.json()) as Array<{
      id: number;
      result: Record<string, unknown>;
    }>;
    // Notification without id is omitted from JSON-RPC batch response array -> 5 responses
    expect(batchJson.length).toBe(5);
    expect(batchJson[0]!.id).toBe(301);
    expect(batchJson[1]!.id).toBe(302);
    const resources = (batchJson[1]!.result.resources as Array<{ uri: string }>).map((r) => r.uri);
    expect(resources).toContain('cangrejo://session/active/graph');
    expect(resources).toContain('cangrejo://taxonomy/entities');

    const readContents = batchJson[2]!.result.contents as Array<{ uri: string; text: string }>;
    expect(readContents[0]!.uri).toBe('cangrejo://session/expediente-mcp-session-test/graph');
    const parsedGraph = JSON.parse(readContents[0]!.text) as { entityCount: number };
    expect(parsedGraph.entityCount).toBeGreaterThanOrEqual(2);

    const prompts = (batchJson[3]!.result.prompts as Array<{ name: string }>).map((p) => p.name);
    expect(prompts).toContain('osint-surface-expansion');
    expect(prompts).toContain('forensic-graph-audit');

    const promptMessages = batchJson[4]!.result.messages as Array<{
      role: string;
      content: { text: string };
    }>;
    expect(promptMessages[0]!.content.text).toContain('cloudflare.com');
  });
});
