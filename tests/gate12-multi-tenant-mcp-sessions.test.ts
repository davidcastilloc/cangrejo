import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cangrejoHonoApp, sessionRooms } from '../apps/web/honoApp.js';
import { dispatchMcpJsonRpcLine } from '../apps/web/mcpStdioServer.js';
import {
  BunSqliteVault,
  MAX_D1_INLINE_SNAPSHOT_BYTES,
  compressGraphSnapshot,
  decompressGraphSnapshot,
  type CloudflareR2BucketLike,
  type McpGraphMutationRow,
} from '../packages/database-d1/src/index.js';

describe('Gate 12: Multi-Tenant MCP Session Isolation, Atomic WAL OCC Batching, Compaction Boundary Invariant & Two-Tier D1/R2 Snapshots', () => {
  it('1. enforces Bearer auth on /api/mcp/:sessionId (401/403), JIT provisions CGRJ.* tenants, and isolates same-slug sessions across tenants', async () => {
    const vault = new BunSqliteVault(':memory:');
    const d1 = vault.asD1Database();

    // 1a. Missing token on parameterized session route -> HTTP 401 (-32000)
    const unauthRes = await cangrejoHonoApp.request(
      '/api/mcp/expediente-apt29',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      },
      { DB: d1 }
    );
    expect(unauthRes.status).toBe(401);
    const unauthJson = (await unauthRes.json()) as { error: { code: number; message: string } };
    expect(unauthJson.error.code).toBe(-32000);

    // 1b. Invalid/forged CGRJ token -> HTTP 403 (-32001)
    const forgedRes = await cangrejoHonoApp.request(
      '/api/mcp/expediente-apt29',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer CGRJ.ORO_PRO.eyJmb3JnZWQiOnRydWV9.deadbeef',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize' }),
      },
      { DB: d1 }
    );
    expect(forgedRes.status).toBe(403);
    const forgedJson = (await forgedRes.json()) as { error: { code: number } };
    expect(forgedJson.error.code).toBe(-32001);

    // 1c. Issue valid commercial CGRJ tokens for Tenant Alpha and Tenant Beta
    const tokenAlpha = BunSqliteVault.issueSignedLicenseToken({
      tier: 'ORO_PRO',
      organizationName: 'Alpha Forensics Corp',
      credits: 500,
    });
    const tokenBeta = BunSqliteVault.issueSignedLicenseToken({
      tier: 'PLATINO_ENTERPRISE',
      organizationName: 'Beta Cyber Defense SOC',
      credits: 5000,
    });

    // Both Tenant Alpha and Tenant Beta connect to the exact same slug: /api/mcp/expediente-apt29
    // Tenant Alpha adds entity "alpha-secret.corp"
    const alphaMutateRes = await cangrejoHonoApp.request(
      '/api/mcp/expediente-apt29',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenAlpha}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: {
            name: 'cangrejo_session_mutate_graph',
            arguments: {
              action: 'upsert',
              entities: [
                { id: '1001', typeName: 'maltego.Domain', value: 'alpha-secret.corp', weight: 100 },
              ],
            },
          },
        }),
      },
      { DB: d1 }
    );
    expect(alphaMutateRes.status).toBe(200);
    const alphaMutateJson = (await alphaMutateRes.json()) as {
      result: { structuredContent: { entityCount: number } };
    };
    expect(alphaMutateJson.result.structuredContent.entityCount).toBe(1);

    // Tenant Beta queries /api/mcp/expediente-apt29 -> must see 0 entities (zero cross-tenant leakage)
    const betaStateRes = await cangrejoHonoApp.request(
      '/api/mcp/expediente-apt29',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenBeta}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: {
            name: 'cangrejo_session_state',
            arguments: {},
          },
        }),
      },
      { DB: d1 }
    );
    expect(betaStateRes.status).toBe(200);
    const betaStateJson = (await betaStateRes.json()) as {
      result: { structuredContent: { entityCount: number; entities: Array<{ value: string }> } };
    };
    expect(betaStateJson.result.structuredContent.entityCount).toBe(0);
    expect(betaStateJson.result.structuredContent.entities).toEqual([]);

    // Verify composite primary keys in cangrejo_mcp_sessions (${tenantId}:expediente-apt29)
    const sessionRows = await d1
      .prepare('SELECT session_id, tenant_id, raw_session_id, last_seq FROM cangrejo_mcp_sessions ORDER BY session_id ASC')
      .all<{ session_id: string; tenant_id: string; raw_session_id: string; last_seq: number }>();
    const results = sessionRows.results ?? [];
    expect(results.length).toBe(2);
    for (const row of results) {
      expect(row.raw_session_id).toBe('expediente-apt29');
      expect(row.session_id).toBe(`${row.tenant_id}:expediente-apt29`);
    }

    // 1d. Dedicated D1 Session Token (Type B: ses_sec_<hex>) & anti-spoofing slug check
    const rawDedicatedToken = 'ses_sec_99887766554433221100aabbccddeeff';
    const tokenHash = crypto.createHash('sha256').update(rawDedicatedToken).digest('hex');
    const alphaTenantId = results[0]!.tenant_id;
    await d1
      .prepare(
        `INSERT INTO cangrejo_mcp_sessions (
          session_id, tenant_id, raw_session_id, session_token_hash, title, case_tier, status, last_seq, expires_at
        ) VALUES (?, ?, 'caso-dedicado-01', ?, 'Caso Dedicado', 'ORO', 'active', 0, ?)`
      )
      .bind(
        `${alphaTenantId}:caso-dedicado-01`,
        alphaTenantId,
        tokenHash,
        Math.floor(Date.now() / 1000) + 3600
      )
      .run();

    // Valid slug succeeds
    const dedicatedOk = await cangrejoHonoApp.request(
      '/api/mcp/caso-dedicado-01',
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${rawDedicatedToken}` },
      },
      { DB: d1 }
    );
    expect(dedicatedOk.status).toBe(200);

    // Cross-slug spoofing fails with 403
    const dedicatedSpoof = await cangrejoHonoApp.request(
      '/api/mcp/expediente-apt29',
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${rawDedicatedToken}` },
      },
      { DB: d1 }
    );
    expect(dedicatedSpoof.status).toBe(403);

    vault.close();
  });

  it('2. executes atomic WAL OCC batch mutations and rolls back + reconciles on UNIQUE(session_id, seq) conflicts', async () => {
    const vault = new BunSqliteVault(':memory:');
    const d1 = vault.asD1Database();
    const tenantId = 'org_occ_test_01';
    const rawSessionId = 'caso-occ';
    const dbSessionId = `${tenantId}:${rawSessionId}`;
    const scopedRoomKey = `tenant:${tenantId}:session:${rawSessionId}`;

    await BunSqliteVault.provisionMcpSessionJit(d1, {
      tenantId,
      tier: 'ORO_PRO',
      organizationName: 'OCC Test Lab',
      licenseSignatureHash: 'sig_occ',
      creditsRemaining: 500,
      dbSessionId,
      rawSessionId,
      expiresEpoch: Math.floor(Date.now() / 1000) + 86400,
    });

    // Isolate 1 commits seq = 1
    const firstCommit = await BunSqliteVault.appendGraphMutationWithOcc(d1, {
      dbSessionId,
      expectedNextSeq: 1,
      deltaId: 'delta-iso-1',
      authorId: 'isolate-1',
      action: 'upsert',
      deltaPayload: {
        deltaId: 'delta-iso-1',
        roomId: scopedRoomKey,
        authorId: 'isolate-1',
        lamportClock: 1,
        timestamp: Date.now(),
        addedEntities: [{ id: '1', typeName: 'maltego.Domain', value: 'iso1.org' }],
        updatedEntities: [],
        deletedEntityIds: [],
        addedLinks: [],
        deletedLinkIds: [],
        movedEntities: [],
        pinChangedEntities: [],
      },
    });
    expect(firstCommit.committedSeq).toBe(1);
    expect(firstCommit.retries).toBe(0);

    // Isolate 2 has stale expectedNextSeq = 1 -> triggers UNIQUE(session_id, seq) rollback, reconciles missed delta, and commits at seq = 2
    const reconciledDeltas: McpGraphMutationRow[] = [];
    const secondCommit = await BunSqliteVault.appendGraphMutationWithOcc(d1, {
      dbSessionId,
      expectedNextSeq: 1,
      deltaId: 'delta-iso-2',
      authorId: 'isolate-2',
      action: 'upsert',
      deltaPayload: {
        deltaId: 'delta-iso-2',
        roomId: scopedRoomKey,
        authorId: 'isolate-2',
        lamportClock: 2,
        timestamp: Date.now(),
        addedEntities: [{ id: '2', typeName: 'maltego.Domain', value: 'iso2.org' }],
        updatedEntities: [],
        deletedEntityIds: [],
        addedLinks: [],
        deletedLinkIds: [],
        movedEntities: [],
        pinChangedEntities: [],
      },
      onReconcileMissedDeltas: (missed: McpGraphMutationRow[]) => {
        reconciledDeltas.push(...missed);
      },
    });

    expect(secondCommit.retries).toBe(1);
    expect(secondCommit.committedSeq).toBe(2);
    expect(reconciledDeltas.length).toBe(1);
    expect(reconciledDeltas[0]!.delta_id).toBe('delta-iso-1');

    const meta = await BunSqliteVault.getMcpSessionMeta(d1, dbSessionId);
    expect(meta?.last_seq).toBe(2);

    vault.close();
  });

  it('3. enforces Compaction Boundary Invariant (Scached < Scheckpoint eviction) and Two-Tier Gzip D1 BLOB / R2 Snapshot parity with SHA-256 tamper detection', async () => {
    const vault = new BunSqliteVault(':memory:');
    const d1 = vault.asD1Database();
    const orgName = 'Compaction & R2 Forensic Lab';
    const token = BunSqliteVault.issueSignedLicenseToken({
      tier: 'PLATINO_ENTERPRISE',
      organizationName: orgName,
    });
    const orgDigest = crypto.createHash('sha256').update(orgName).digest('hex').slice(0, 12);
    const tenantId = `org_${orgDigest}`;
    const rawSessionId = 'expediente-compaction';
    const dbSessionId = `${tenantId}:${rawSessionId}`;
    const scopedRoomKey = `tenant:${tenantId}:session:${rawSessionId}`;

    // Populate stale isolate cache at lastSeq = 1 with outdated entity "stale-node.local"
    await cangrejoHonoApp.request(
      '/api/mcp/expediente-compaction',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'cangrejo_session_mutate_graph',
            arguments: {
              action: 'upsert',
              entities: [{ id: '501', typeName: 'maltego.Domain', value: 'stale-node.local' }],
            },
          },
        }),
      },
      { DB: d1 }
    );
    expect(sessionRooms.get(scopedRoomKey)?.lastSeq).toBe(1);

    // Simulate another isolate advancing to checkpoint_seq = 5, compacting snapshot, and pruning WAL < 5
    const compactedSnapshot = {
      entities: [
        {
          id: '502',
          typeName: 'maltego.Domain',
          value: 'compacted-checkpoint.org',
          weight: 100,
          bookmark: 4,
          notes: { value: '', show: false },
          properties: { custom_analyst_tag: 'preserved_zero_pruning' },
          position: { x: 10, y: 20, z: 0 },
          pinned: true,
        },
      ],
      links: [],
    };
    const inlineSnap = await BunSqliteVault.persistGraphSnapshotToD1OrR2(d1, undefined, {
      tenantId,
      dbSessionId,
      checkpointSeq: 5,
      nodeCount: 1,
      edgeCount: 0,
      serializedGraph: compactedSnapshot,
      pruneBeforeCheckpoint: true,
    });
    expect(inlineSnap.storageTier).toBe('d1_inline');
    expect(inlineSnap.byteSize).toBeLessThanOrEqual(MAX_D1_INLINE_SNAPSHOT_BYTES);

    // Also append trailing mutation at seq = 6 after checkpoint 5
    await BunSqliteVault.appendGraphMutationWithOcc(d1, {
      dbSessionId,
      expectedNextSeq: 6,
      deltaId: 'delta-seq-6',
      authorId: 'other-isolate',
      action: 'upsert',
      deltaPayload: {
        deltaId: 'delta-seq-6',
        roomId: scopedRoomKey,
        authorId: 'other-isolate',
        lamportClock: 6,
        timestamp: Date.now(),
        addedEntities: [
          {
            id: '503',
            typeName: 'maltego.IPv4Address',
            value: '185.220.101.77',
            weight: 90,
            bookmark: 1,
            notes: { value: '', show: false },
            properties: {},
            position: { x: 50, y: 60, z: 0 },
            pinned: false,
          },
        ],
        updatedEntities: [],
        deletedEntityIds: [],
        addedLinks: [],
        deletedLinkIds: [],
        movedEntities: [],
        pinChangedEntities: [],
      },
    });

    // Now query /api/mcp/expediente-compaction on the first isolate (whose cached lastSeq = 1 < checkpointSeq = 5)
    // It MUST evict stale-node.local and re-hydrate compacted-checkpoint.org (seq 5) + 185.220.101.77 (seq 6)
    const stateRes = await cangrejoHonoApp.request(
      '/api/mcp/expediente-compaction',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'cangrejo_session_state', arguments: {} },
        }),
      },
      { DB: d1 }
    );
    expect(stateRes.status).toBe(200);
    const stateJson = (await stateRes.json()) as {
      result: {
        structuredContent: {
          entityCount: number;
          entities: Array<{ value: string; properties: Record<string, string> }>;
        };
      };
    };
    const values = stateJson.result.structuredContent.entities.map((e) => e.value);
    expect(values).not.toContain('stale-node.local');
    expect(values).toContain('compacted-checkpoint.org');
    expect(values).toContain('185.220.101.77');
    const compactedEnt = stateJson.result.structuredContent.entities.find(
      (e) => e.value === 'compacted-checkpoint.org'
    );
    expect(compactedEnt?.properties.custom_analyst_tag).toBe('preserved_zero_pruning');

    // Tier 2 R2 Offload test (> 1.5 MB compressed payload)
    const r2Store = new Map<string, Uint8Array>();
    const mockR2: CloudflareR2BucketLike = {
      async put(key, value) {
        const bytes =
          value instanceof Uint8Array
            ? new Uint8Array(value)
            : typeof value === 'string'
              ? new TextEncoder().encode(value)
              : new Uint8Array(value);
        r2Store.set(key, bytes);
      },
      async get(key) {
        const bytes = r2Store.get(key);
        if (!bytes) return null;
        return {
          async arrayBuffer(): Promise<ArrayBuffer> {
            const copy = new Uint8Array(bytes.byteLength);
            copy.set(bytes);
            return copy.buffer;
          },
        };
      },
    };

    // Generate 2.2 MB of cryptographic random entropy in base64 so Gzip output (> 2.2 MB) exceeds the 1.5 MB D1 inline threshold
    const highEntropyBase64 = crypto.randomBytes(2_200_000).toString('base64');
    const largeSnapshotJson = JSON.stringify({
      entities: [
        {
          id: '999',
          typeName: 'maltego.Domain',
          value: 'r2-offloaded-giant-graph.org',
          properties: { highEntropyBlob: highEntropyBase64 },
        },
      ],
      links: [],
    });

    const r2Snap = await BunSqliteVault.persistGraphSnapshotToD1OrR2(d1, mockR2, {
      tenantId,
      dbSessionId,
      checkpointSeq: 10,
      nodeCount: 1,
      edgeCount: 0,
      serializedGraph: largeSnapshotJson,
    });
    expect(r2Snap.storageTier).toBe('r2_offload');
    expect(r2Snap.byteSize).toBeGreaterThan(MAX_D1_INLINE_SNAPSHOT_BYTES);
    expect(r2Snap.snapshotR2Key).toContain(`snapshots/${tenantId}/`);
    expect(r2Store.has(r2Snap.snapshotR2Key!)).toBe(true);

    // Hydrate from R2 and verify integrity
    const hydratedR2 = await BunSqliteVault.hydrateSessionSnapshotAndDeltas(
      d1,
      mockR2,
      dbSessionId
    );
    expect(hydratedR2.checkpointSeq).toBe(10);
    expect(
      (hydratedR2.snapshotDoc?.entities as Array<{ value: string }>)[0]?.value
    ).toBe('r2-offloaded-giant-graph.org');

    // Corrupt a byte in R2 and verify Daubert SHA-256 tamper rejection
    const corruptedBytes = new Uint8Array(r2Store.get(r2Snap.snapshotR2Key!)!);
    corruptedBytes[corruptedBytes.length - 5] ^= 0xff;
    r2Store.set(r2Snap.snapshotR2Key!, corruptedBytes);

    await expect(
      BunSqliteVault.hydrateSessionSnapshotAndDeltas(d1, mockR2, dbSessionId)
    ).rejects.toThrow(/Daubert integrity violation: snapshot SHA-256 mismatch/);

    // Direct Gzip codec roundtrip sanity check
    const compressed = await compressGraphSnapshot('{"hello":"cangrejo"}');
    expect(await decompressGraphSnapshot(compressed)).toBe('{"hello":"cangrejo"}');

    vault.close();
  });

  it('4. verifies MCP Client Onboarding UI (WCAG 2.1 AAA tokens, viewport containment, token masking) and mcpStdioServer session/token bridge', async () => {
    const repoRoot = path.resolve(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
      '..'
    );
    const indexHtml = fs.readFileSync(path.resolve(repoRoot, 'index.html'), 'utf8');
    const stylesCss = fs.readFileSync(path.resolve(repoRoot, 'apps/web/styles.css'), 'utf8');
    const mainTs = fs.readFileSync(path.resolve(repoRoot, 'apps/web/main.ts'), 'utf8');

    // Verify DOM elements in index.html
    expect(indexHtml).toContain('id="mcp-onboarding-section"');
    expect(indexHtml).toContain('id="inp-mcp-session-id"');
    expect(indexHtml).toContain('id="inp-mcp-auth-token"');
    expect(indexHtml).toContain('type="password"');
    expect(indexHtml).toContain('id="btn-mcp-toggle-token"');
    expect(indexHtml).toContain('id="tab-client-claude-desktop"');
    expect(indexHtml).toContain('id="tab-client-cursor"');
    expect(indexHtml).toContain('id="tab-client-claude-code"');
    expect(indexHtml).toContain('id="mcp-snippet-output"');

    // Verify WCAG 2.1 AAA contrast colors & modal viewport containment in styles.css
    expect(stylesCss).toContain('max-height: calc(100vh - 40px)');
    expect(stylesCss).toContain('.status-pill-cloud');
    expect(stylesCss).toContain('#7dd3fc'); // Dark mode Sky300 (9.20:1)
    expect(stylesCss).toContain("[data-theme='light'] .status-pill-cloud");
    expect(stylesCss).toContain('#0c4a6e'); // Light mode Sky900 (8.36:1 / 9.46:1)
    expect(stylesCss).toContain('.mcp-health-badge');
    expect(stylesCss).toContain('var(--text-subtle)'); // 9.45:1 light / 13.58:1 dark

    // Verify controller & sessionStorage token caching in main.ts
    expect(mainTs).toContain('initMcpModalController');
    expect(mainTs).toContain('updateMcpOnboardingView');
    expect(mainTs).toContain('cangrejo_mcp_auth_token');
    expect(mainTs).toContain('CANGREJO_MCP_TOKEN');

    // Verify Mobile OSINT Super-App (Launchpad Bento 2x3, Radar 1-2H Dossier & Scanner HUD + QA R1/R2)
    expect(indexHtml).toContain('id="mobile-superapp-shell"');
    expect(indexHtml).toContain('id="mobile-toast-banner"');
    expect(indexHtml).toContain('id="mobile-custody-ledger"');
    expect(indexHtml).toContain('id="sel-mobile-dossier-entity"');
    expect(indexHtml).toContain('id="btn-mobile-pivot-dork"');
    expect(indexHtml).toContain('id="btn-mobile-copy-brief"');
    expect(indexHtml).toContain('id="mobile-view-launchpad"');
    expect(indexHtml).toContain('id="mobile-view-radar"');
    expect(indexHtml).toContain('id="mobile-view-scanner"');
    expect(indexHtml).toContain('id="mobile-thumb-dock"');
    expect(stylesCss).toContain('100dvh');
    expect(stylesCss).toContain('safe-area-inset-bottom');
    expect(stylesCss).toContain('.mobile-bento-grid');
    expect(mainTs).toContain('initMobileSuperAppController');
    expect(mainTs).toContain('switchMobileSuperAppView');
    expect(mainTs).toContain('cangrejo_mobile_offline_queue');
    expect(mainTs).toContain('extractEmbeddedIocsAndAliases');

    // Verify zero TDZ ordering for mcpState and verify palette drag-and-drop + entity linking
    expect(mainTs.indexOf('const mcpState: McpUiState')).toBeLessThan(
      mainTs.indexOf('store.subscribe((mods) =>')
    );
    expect(mainTs.indexOf('const mcpState: McpUiState')).toBeLessThan(
      mainTs.indexOf('function connectLiveMcpSessionStream')
    );
    expect(mainTs).toContain('row.draggable = true');
    expect(mainTs).toContain("canvasEl.addEventListener('dragover'");
    expect(mainTs).toContain("canvasEl.addEventListener('drop'");
    expect(indexHtml).toContain('id="ctx-start-link"');

    // Verify mcpStdioServer forwards CANGREJO_SESSION_ID and CANGREJO_MCP_TOKEN
    const token = BunSqliteVault.issueSignedLicenseToken({
      tier: 'ORO_PRO',
      organizationName: 'Stdio Bridge Org',
    });
    const prevSession = process.env.CANGREJO_SESSION_ID;
    const prevToken = process.env.CANGREJO_MCP_TOKEN;
    try {
      process.env.CANGREJO_SESSION_ID = 'expediente-stdio-cloud';
      process.env.CANGREJO_MCP_TOKEN = token;

      const rawResp = await dispatchMcpJsonRpcLine(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 77,
          method: 'initialize',
          params: {},
        })
      );
      expect(rawResp).not.toBeNull();
      const parsed = JSON.parse(rawResp!) as {
        result: { serverInfo: { tier: string; sessionId: string } };
      };
      expect(parsed.result.serverInfo.tier).toBe('ORO_PRO');
      expect(parsed.result.serverInfo.sessionId).toBe('expediente-stdio-cloud');
    } finally {
      if (prevSession === undefined) delete process.env.CANGREJO_SESSION_ID;
      else process.env.CANGREJO_SESSION_ID = prevSession;
      if (prevToken === undefined) delete process.env.CANGREJO_MCP_TOKEN;
      else process.env.CANGREJO_MCP_TOKEN = prevToken;
    }
  });
});
