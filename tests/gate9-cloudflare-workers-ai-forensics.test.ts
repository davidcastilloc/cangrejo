import { describe, expect, it } from 'vitest';
import { cangrejoHonoApp } from '../apps/web/honoApp.js';
import { CloudflareWorkersAiEngine } from '../packages/transforms/src/index.js';

describe('Gate 9: Cloudflare Workers AI & Forensic AI Engine (F1–F5, Vectorize RRF, Bóveda Cero Sanitization & Daubert Ed25519)', () => {
  it('1. F1 (/api/ai/unpack-iocs): unpacks defanged IOCs (hxxps://, [.], [@]) with exact UTF-8 byte offsets and zero hardware assumptions', async () => {
    const rawReport =
      'ALERTA FORENSE: Beaconing hacia hxxps[:]//c2-gateway[.]apt29-mirror[.]org/login y operador ops[@]dark-relay[.]ru desde IP 185[.]220[.]101[.]42 explotando CVE-2024-3400.';

    const res = await cangrejoHonoApp.request('/api/ai/unpack-iocs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: rawReport }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      unpackedCount: number;
      items: Array<{
        rawFragment: string;
        canonicalValue: string;
        typeName: string;
        wasDefanged: boolean;
        startByteOffset: number;
        endByteOffset: number;
      }>;
      aiMeta: {
        modelId: string;
        hardwareRequirement: string;
        bovedaCeroSanitized: boolean;
        estimatedCostUsd: number;
      };
    };

    expect(json.ok).toBe(true);
    expect(json.unpackedCount).toBeGreaterThanOrEqual(4);
    expect(json.aiMeta.hardwareRequirement).toBe('NONE_UNIVERSAL_CPU_OR_EDGE');
    expect(json.aiMeta.bovedaCeroSanitized).toBe(true);
    expect(json.aiMeta.estimatedCostUsd).toBeGreaterThan(0);

    const urlItem = json.items.find((i) => i.typeName === 'maltego.URL');
    expect(urlItem).toBeDefined();
    expect(urlItem!.canonicalValue).toBe('https://c2-gateway.apt29-mirror.org/login');
    expect(urlItem!.wasDefanged).toBe(true);

    // Verify exact UTF-8 byte slicing matches rawFragment
    const rawBytes = Buffer.from(rawReport, 'utf8');
    const slicedFragment = rawBytes
      .subarray(urlItem!.startByteOffset, urlItem!.endByteOffset)
      .toString('utf8');
    expect(slicedFragment).toBe(urlItem!.rawFragment);
  });

  it('2. F2 (/api/ai/latent-links): derives <=63-byte Vectorize namespace, sanitizes Bóveda Cero fields, and ranks latent links via RRF (k=60)', async () => {
    const res = await cangrejoHonoApp.request('/api/ai/latent-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-finanzas-caracas-2026-largo-identificador',
        entities: [
          {
            id: '101',
            typeName: 'maltego.Domain',
            value: 'auth-portal.apt29-mirror.org',
            secretPassphrase: 'ENC_GCM::super-secret-value',
          },
          {
            id: '102',
            typeName: 'maltego.Domain',
            value: 'vpn-gateway.apt29-mirror.org',
          },
          {
            id: '103',
            typeName: 'maltego.BTCAddress',
            value: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          },
        ],
        links: [],
        topK: 3,
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      vectorizeNamespace: string;
      rrfConstantK: number;
      suggestions: Array<{
        sourceEntityId: string;
        targetEntityId: string;
        rrfScore: number;
        vectorCosineSimilarity: number;
      }>;
    };

    expect(json.ok).toBe(true);
    expect(json.rrfConstantK).toBe(60);
    expect(Buffer.byteLength(json.vectorizeNamespace, 'utf8')).toBeLessThanOrEqual(63);
    expect(json.vectorizeNamespace.startsWith('cgrj_')).toBe(true);
    expect(json.suggestions.length).toBeGreaterThanOrEqual(2);
    // The two apt29-mirror.org domains should rank highest in RRF similarity
    expect(json.suggestions[0]!.sourceEntityId).toBe('101');
    expect(json.suggestions[0]!.targetEntityId).toBe('102');
    expect(json.suggestions[0]!.rrfScore).toBeGreaterThan(0.03);
  });

  it('3. F3 (/api/ai/anomalies): detects directed cyclic laundering rings and high-centrality C2 hubs', async () => {
    const res = await cangrejoHonoApp.request('/api/ai/anomalies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entities: [
          { id: '1', typeName: 'maltego.BTCAddress', value: 'wallet-alpha' },
          { id: '2', typeName: 'maltego.BTCAddress', value: 'wallet-beta' },
          { id: '3', typeName: 'maltego.BTCAddress', value: 'wallet-gamma' },
        ],
        links: [
          { id: '10', sourceId: '1', targetId: '2', label: 'peel hop 1' },
          { id: '11', sourceId: '2', targetId: '3', label: 'peel hop 2' },
          { id: '12', sourceId: '3', targetId: '1', label: 'cycle return' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      anomalies: Array<{ patternType: string; severity: string }>;
    };
    expect(json.ok).toBe(true);
    expect(
      json.anomalies.some((a) => a.patternType === 'CRYPTO_PEEL_CHAIN_LAUNDERING')
    ).toBe(true);
  });

  it('4. F4 (/api/ai/daubert-synthesis) & F5 (/api/ai/copilot): generates Ed25519-signed Daubert narrative and contextual Copilot tool calls', async () => {
    const graphPayload = {
      expedienteId: 'EXP-DAUBERT-009',
      title: 'Operación Cangrejo Dorado',
      entities: [
        { id: '501', typeName: 'maltego.Domain', value: 'c2-master.apt29.org', weight: 100 },
        { id: '502', typeName: 'maltego.IPv4Address', value: '185.220.101.42', weight: 95 },
      ],
      links: [{ id: '801', sourceId: '501', targetId: '502', label: 'resolves to' }],
    };

    const daubertRes = await cangrejoHonoApp.request('/api/ai/daubert-synthesis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graphPayload),
    });
    expect(daubertRes.status).toBe(200);
    const daubertJson = (await daubertRes.json()) as {
      ok: boolean;
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

    expect(daubertJson.ok).toBe(true);
    expect(daubertJson.standard).toBe('DAUBERT_FRE_702_VERIFIED');
    expect(daubertJson.executiveNarrative).toContain('c2-master.apt29.org');
    expect(daubertJson.citedEntityIds.length).toBe(2);
    expect(
      CloudflareWorkersAiEngine.verifyDaubertAttestation(daubertJson.attestation)
    ).toBe(true);

    // F5 Copilot turn
    const copilotRes = await cangrejoHonoApp.request('/api/ai/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '¿Cuál es el nodo pivote y qué herramientas debo correr?',
        ...graphPayload,
      }),
    });
    expect(copilotRes.status).toBe(200);
    const copilotJson = (await copilotRes.json()) as {
      ok: boolean;
      answer: string;
      suggestedToolCalls: Array<{ toolName: string; transformId: string }>;
    };
    expect(copilotJson.ok).toBe(true);
    expect(copilotJson.answer).toContain('Comisario IA');
    expect(copilotJson.suggestedToolCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('5. F6 (/api/ai/auto-investigate), 1024-d BGE-Large Vectorize query, Llama 3.3 70B Ed25519 re-signing & SSE streaming', async () => {
    // 1. Verify 1024-d BGE-Large embeddings + Vectorize upsert/query integration
    const upsertedLengths: number[] = [];
    let queryCalled = false;
    const rrfResult = await CloudflareWorkersAiEngine.discoverLatentLinksRrf(
      {
        expedienteId: 'exp-1024-bge',
        entities: [
          { id: '1', typeName: 'maltego.Domain', value: 'alpha.apt29.org' },
          { id: '2', typeName: 'maltego.Domain', value: 'beta.apt29.org' },
        ],
      },
      {
        aiBinding: {
          run: async () => ({
            data: [new Array(1024).fill(0.03125), new Array(1024).fill(0.03125)],
          }),
        },
        vectorizeBinding: {
          upsert: async (vecs) => {
            for (const v of vecs) upsertedLengths.push(v.values.length);
            return { count: vecs.length };
          },
          query: async () => {
            queryCalled = true;
            return {
              matches: [{ id: '2', score: 0.99, metadata: { entityId: '2' } }],
            };
          },
        },
      }
    );
    expect(upsertedLengths).toEqual([1024, 1024]);
    expect(queryCalled).toBe(true);
    expect(rrfResult.suggestions[0]?.vectorCosineSimilarity).toBeGreaterThanOrEqual(0.99);

    // 2. Verify F4 Daubert narrative incorporates real Llama 3.3 70B output and re-signs Ed25519
    const llmDaubertRes = await cangrejoHonoApp.request(
      '/api/ai/daubert-synthesis',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expedienteId: 'EXP-LLAMA70B',
          title: 'Caso Cangrejo Llama 70B',
          entities: [{ id: '701', typeName: 'maltego.Domain', value: 'c2.apt29.org' }],
          links: [],
        }),
      },
      {
        AI: {
          run: async () => ({
            response:
              'Dictamen pericial Llama 3.3 70B verificando el indicador primario [701] (c2.apt29.org) bajo estándar Daubert.',
          }),
        },
      }
    );
    expect(llmDaubertRes.status).toBe(200);
    const llmDaubertJson = (await llmDaubertRes.json()) as {
      executiveNarrative: string;
      attestation: {
        canonicalSha256Hex: string;
        signatureHex: string;
        publicKeyPem: string;
      };
    };
    expect(llmDaubertJson.executiveNarrative).toContain(
      'SÍNTESIS COGNITIVA LLAMA 3.3 70B (CLOUDFLARE WORKERS AI EDGE)'
    );
    expect(
      CloudflareWorkersAiEngine.verifyDaubertAttestation(llmDaubertJson.attestation)
    ).toBe(true);

    // 3. Verify F6 Autonomous Multi-Hop Investigator (/api/ai/auto-investigate)
    const autoRes = await cangrejoHonoApp.request('/api/ai/auto-investigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxHops: 2,
        maxTargetsPerHop: 2,
        entities: [
          { id: '901', typeName: 'maltego.Domain', value: 'pivot.apt29.org', weight: 100 },
        ],
        links: [],
      }),
    });
    expect(autoRes.status).toBe(200);
    const autoJson = (await autoRes.json()) as {
      ok: boolean;
      hopsExecuted: number;
      executedSteps: Array<{ hop: number; transformId: string; discoveredCount: number }>;
      discoveredEntities: Array<{ id: string; typeName: string; value: string }>;
      discoveredLinks: Array<{ id: string; sourceId: string; targetId: string }>;
    };
    expect(autoJson.ok).toBe(true);
    expect(autoJson.hopsExecuted).toBe(2);
    expect(autoJson.executedSteps.length).toBeGreaterThanOrEqual(2);
    expect(autoJson.discoveredEntities.length).toBeGreaterThanOrEqual(2);
    expect(autoJson.discoveredLinks.length).toBeGreaterThanOrEqual(2);

    // 4. Verify SSE streaming (text/event-stream) on /api/ai/copilot
    const sseRes = await cangrejoHonoApp.request('/api/ai/copilot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        prompt: 'Analiza el pivote en modo streaming SSE',
        stream: true,
        entities: [{ id: '901', typeName: 'maltego.Domain', value: 'pivot.apt29.org' }],
        links: [],
      }),
    });
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream');
    const sseBody = await sseRes.text();
    expect(sseBody).toContain('"type":"delta"');
    expect(sseBody).toContain('"type":"done"');
    expect(sseBody).toContain('data: [DONE]');
  });
});
