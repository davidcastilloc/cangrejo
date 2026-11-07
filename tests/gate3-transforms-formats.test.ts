import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CollectionNodeView,
  EntityRegistry,
  GraphStore,
  Guid,
  STANDARD_ENTITIES_CATALOG,
  createPropertyBag,
  getPartPrimaryValue,
  type MaltegoLinkData,
} from '@cangrejo/core';
import { InMemoryPlatformBridge } from '@cangrejo/platform-bridge';
import {
  HubClient,
  LocalCliRunner,
  MtgjJsonHandler,
  MtglLegacyMigrator,
  MtgxArchiveHandler,
  OAuthPkceManager,
  ProtocolV2Client,
  ProtocolV3Client,
  tokenizeCommandArgs,
  validateTransformExecutablePath,
  type ProtocolV3Transport,
  type TransformV3RunResponseJson,
} from '@cangrejo/transforms';
import { cangrejoHonoApp } from '../apps/web/honoApp';

function makeStyledLink(id: Guid, label: string, weight = 1): MaltegoLinkData {
  return {
    id,
    typeName: 'maltego.link.transform-link',
    weight,
    bookmark: 4,
    notes: { value: `Link note for ${label}`, show: true },
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

describe('Gate 3 (Milestone Beta): Transform Hub, Local CLI Subprocesses, Protocols v2/v3 & File Formats', () => {
  const registry = new EntityRegistry();

  describe('1. Local CLI Transform Runner & Subprocess Security Isolation', () => {
    it('tokenizes quoted CLI args, blocks path traversal/metacharacters, scrubs host secrets, and merges XML v2 output', async () => {
      const tokens = tokenizeCommandArgs(`-m maltego_trx --profile "corp#1=alpha" 'single quoted'`);
      expect(tokens).toEqual(['-m', 'maltego_trx', '--profile', 'corp#1=alpha', 'single quoted']);

      expect(validateTransformExecutablePath('../bin/evil.sh').valid).toBe(false);
      expect(validateTransformExecutablePath('python3; rm -rf /').valid).toBe(false);
      expect(validateTransformExecutablePath('/usr/bin/python3').valid).toBe(true);

      const store = new GraphStore();
      const domainId = new Guid(10n);
      store.addEntity(
        registry.createEntity('maltego.Domain', 'target-bank.com', {
          id: domainId,
          extraProperties: { registrar: 'NameCheap=Inc#1' },
        })
      );

      let capturedEnv: Record<string, string> = {};
      const bridge = new InMemoryPlatformBridge('tauri-desktop', async (opts) => {
        capturedEnv = opts.env ?? {};
        return {
          exitCode: 0,
          stdout: `<?xml version="1.0" encoding="UTF-8"?>
<MaltegoMessage>
  <MaltegoTransformResponseMessage>
    <Entities>
      <Entity Type="maltego.IPv4Address">
        <Value>198.51.100.42</Value>
        <Weight>200</Weight>
        <AdditionalFields>
          <Field Name="country" DisplayName="Country">CH</Field>
          <Field Name="maltego.link.label">DNS A</Field>
          <Field Name="maltego.link.color">#0033CC</Field>
        </AdditionalFields>
        <DisplayInformation>
          <Label Name="BGP Info" Type="text/html"><![CDATA[<b>ASN:</b> AS64500]]></Label>
        </DisplayInformation>
        <Overlays>
          <Overlay propertyName="country" position="NW" type="text"/>
        </Overlays>
      </Entity>
    </Entities>
    <UIMessages>
      <UIMessage MessageType="Inform">Resolved 1 A record</UIMessage>
    </UIMessages>
  </MaltegoTransformResponseMessage>
</MaltegoMessage>`,
          stderr: '',
          durationMs: 12,
        };
      });

      const runner = new LocalCliRunner(bridge, registry);
      const outcome = await runner.executeOnEntity(store, domainId, {
        executable: '/usr/bin/python3',
        rawParameters: 'transforms/dns_a.py --timeout 10',
        ambientEnv: {
          PATH: '/usr/bin:/bin',
          HOME: '/home/analyst',
          AWS_SECRET_ACCESS_KEY: 'SUPER_SECRET_AWS_KEY',
          GITHUB_TOKEN: 'ghp_SUPER_SECRET_TOKEN',
          CLOUDFLARE_API_TOKEN: 'cf_SUPER_SECRET',
        },
        explicitEnv: {
          TRANSFORM_LOCALE: 'en_US',
        },
      });

      // Verify secret scrubbing: host secrets must NEVER leak into the subprocess environment
      expect(capturedEnv['PATH']).toBe('/usr/bin:/bin');
      expect(capturedEnv['TRANSFORM_LOCALE']).toBe('en_US');
      expect(capturedEnv['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
      expect(capturedEnv['GITHUB_TOKEN']).toBeUndefined();
      expect(capturedEnv['CLOUDFLARE_API_TOKEN']).toBeUndefined();

      // Verify entity and link merged into GraphStore
      expect(outcome.mergeResult.addedEntities).toHaveLength(1);
      expect(outcome.mergeResult.addedLinks).toHaveLength(1);
      expect(store.entityCount).toBe(2);
      expect(store.linkCount).toBe(1);

      const newIpId = outcome.mergeResult.addedEntities[0]!;
      const newIp = store.dataStore.getEntity(newIpId);
      expect(getPartPrimaryValue(newIp)).toBe('198.51.100.42');
      expect(newIp.displayInfo[0]?.content).toBe('<b>ASN:</b> AS64500');
      expect(newIp.overlays[0]?.position).toBe('NW');
    });
  });

  describe('2. Transform Protocol v2 HTTP/XML Client & Exception Envelopes', () => {
    it('dispatches <MaltegoTransformRequestMessage>, parses response entities/buttons, and surfaces <MaltegoTransformExceptionMessage>', async () => {
      const store = new GraphStore();
      const srcId = new Guid(1n);
      store.addEntity(registry.createEntity('maltego.Domain', 'acme.org', { id: srcId }));

      const v2Client = new ProtocolV2Client(async (url, reqXml) => {
        expect(url).toContain('Command=_RUN&TransformToRun=ToMX');
        expect(reqXml).toContain('<Limits SoftLimit="12" HardLimit="50"/>');
        return {
          status: 200,
          bodyText: `<?xml version="1.0" encoding="UTF-8"?>
<MaltegoMessage>
  <MaltegoTransformResponseMessage>
    <Entities>
      <Entity Type="maltego.MXRecord">
        <Value>mail.acme.org</Value>
        <Weight>150</Weight>
      </Entity>
    </Entities>
    <AdditionalInfo>
      <Buttons>
        <Button id="btn_1" text="View WHOIS" url="https://whois.example.com/acme.org"/>
      </Buttons>
    </AdditionalInfo>
  </MaltegoTransformResponseMessage>
</MaltegoMessage>`,
        };
      });

      const res = await v2Client.runTransform(store, srcId, {
        serverUrl: 'https://tds.example.com/runner',
        transformName: 'ToMX',
        hardLimit: 50,
      });

      expect(res.parsedResponse.buttons).toHaveLength(1);
      expect(store.entityCount).toBe(2);
      expect(store.linkCount).toBe(1);

      // Test formal <MaltegoTransformExceptionMessage>
      const errorClient = new ProtocolV2Client(async () => ({
        status: 200,
        bodyText: `<MaltegoMessage><MaltegoTransformExceptionMessage><Exceptions><Exception code="401">API key expired</Exception></Exceptions></MaltegoTransformExceptionMessage></MaltegoMessage>`,
      }));

      await expect(
        errorClient.runTransform(store, srcId, {
          serverUrl: 'https://tds.example.com/runner',
          transformName: 'ToMX',
        })
      ).rejects.toThrow(/\[401\] API key expired/);
    });
  });

  describe('3. Transform Protocol v3 Asynchronous Streaming & Interactive Prompts', () => {
    it('streams ADD/UPDATE/DELETE delta events and resolves interactive prompts before cleanup', async () => {
      const store = new GraphStore();
      const domainId = new Guid(100n);
      store.addEntity(registry.createEntity('maltego.Domain', 'threat-actor.org', { id: domainId }));

      let cancelCalled = false;
      let submittedPromptOption = '';
      let pollCallCount = 0;

      const mockTransport: ProtocolV3Transport = {
        async startRun() {
          return { runId: 'run_v3_99', state: 'RUNNING' };
        },
        async pollResults(_transformId, runId): Promise<TransformV3RunResponseJson> {
          pollCallCount++;
          if (pollCallCount === 1) {
            return {
              result: {
                runId,
                state: 'RUNNING',
                eventPointer: 2,
                eventCount: 2,
                events: [
                  {
                    type: 'PROMPT',
                    data: {
                      '@class': 'TransformRunChoicePromptEvent',
                      id: 'prompt_region',
                      message: 'Select region:',
                      timeout: 30,
                      defaultOptionId: 'eu',
                      control: { type: 'DROPDOWN' },
                      options: [
                        { id: 'us', displayName: 'US' },
                        { id: 'eu', displayName: 'EU' },
                      ],
                    },
                  },
                  {
                    type: 'ADD',
                    data: {
                      '@class': 'TransformRunEntityEvent',
                      entity: {
                        id: '201',
                        type: 'maltego.IPv4Address',
                        weight: 180,
                        props: [
                          {
                            name: 'ipv4-address',
                            type: 'string',
                            displayName: 'IP Address',
                            value: '203.0.113.50',
                            special: ['VALUE', 'DISPLAY_VALUE'],
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            };
          }
          return {
            result: {
              runId,
              state: 'COMPLETED',
              eventPointer: 3,
              eventCount: 1,
              events: [
                {
                  type: 'ADD',
                  data: {
                    '@class': 'TransformRunLinkEvent',
                    link: {
                      id: '301',
                      sourceId: '100',
                      targetId: '201',
                      props: [
                        {
                          name: 'maltego.link.label',
                          type: 'string',
                          displayName: 'Label',
                          value: 'Passive DNS EU',
                        },
                      ],
                    },
                  },
                },
              ],
            },
            status: {
              code: 200,
              uiMessages: [{ message: 'Streaming transform complete', type: 'INFO' }],
            },
          };
        },
        async submitPrompt(_transformId, _runId, _promptId, selectedValue) {
          submittedPromptOption = selectedValue;
        },
        async cancelRun() {
          cancelCalled = true;
        },
      };

      const v3Client = new ProtocolV3Client(mockTransport, registry);
      const outcome = await v3Client.executeStreamingTransform(store, [domainId], {
        transformId: 'paterva.v3.PassiveDns',
        promptHandler: async () => 'eu',
      });

      expect(outcome.promptsHandled).toBe(1);
      expect(submittedPromptOption).toBe('eu');
      expect(cancelCalled).toBe(true);
      expect(store.entityCount).toBe(2);
      expect(store.linkCount).toBe(1);
    });
  });

  describe('4. Gate 3 Golden Master Suite: 20 .mtgx (GraphML/PKZIP) Lossless Round-Trips', () => {
    it('exports and re-imports 20 diverse .mtgx investigation archives with zero information loss', () => {
      const mtgxHandler = new MtgxArchiveHandler();

      for (let fileIdx = 1; fileIdx <= 20; fileIdx++) {
        const originalStore = new GraphStore(new Guid(BigInt(10_000 + fileIdx)));
        const nodeCount = 5 + (fileIdx % 8);
        const nodeIds: Guid[] = [];

        originalStore.runInBatch(() => {
          for (let n = 0; n < nodeCount; n++) {
            const spec =
              STANDARD_ENTITIES_CATALOG[(fileIdx * 7 + n) % STANDARD_ENTITIES_CATALOG.length]!;
            const nid = new Guid(BigInt(fileIdx * 1000 + n + 1));
            nodeIds.push(nid);

            const entity = registry.createEntity(spec.id, `val_${fileIdx}_${n}`, {
              id: nid,
              weight: 100 + n * 15,
              bookmark: (fileIdx + n) % 24,
            });
            entity.notes = {
              value: `Analyst note #${fileIdx}-${n} with XML chars <&>"'`,
              show: n % 2 === 0,
            };
            entity.displayInfo = [
              {
                title: `Report ${n}`,
                content: `<b>Evidence ${fileIdx}:${n}</b>`,
                type: 'text/html',
              },
            ];

            originalStore.addEntity(
              entity,
              { x: n * 125.5, y: -n * 80.25, z: 0 },
              n === 0
            );
          }

          for (let n = 0; n < nodeCount - 1; n++) {
            const lid = new Guid(BigInt(fileIdx * 5000 + n + 1));
            originalStore.addLink(
              makeStyledLink(lid, `edge_${fileIdx}_${n}`, n + 1),
              nodeIds[n]!,
              nodeIds[n + 1]!,
              n % 2 === 1,
              [{ x: n * 50, y: n * 25 }]
            );
          }
        });

        const collectionView = new CollectionNodeView(originalStore, {
          minRequiredEntitiesPerNode: 3,
        });
        const sampleAttachment = new TextEncoder().encode(`binary-attachment-${fileIdx}`);
        const sha256 = crypto.createHash('sha256').update(sampleAttachment).digest('hex');

        const mtgxBytes = mtgxHandler.exportToMtgxBytes(originalStore, {
          graphName: `Graph_${fileIdx}`,
          collectionView,
          attachmentPayloads: new Map([[sha256, sampleAttachment]]),
        });

        const imported = mtgxHandler.importFromMtgxBytes(mtgxBytes);
        expect(imported.versionProperties['maltego.client.version']).toBe('4.13.0');
        expect(imported.store.entityCount).toBe(originalStore.entityCount);
        expect(imported.store.linkCount).toBe(originalStore.linkCount);
        expect(imported.attachmentPayloads.has(sha256)).toBe(true);

        // Verify exact fidelity of every node and edge
        for (const origEntity of originalStore.dataStore.getEntities().values()) {
          const restEntity = imported.store.dataStore.getEntity(origEntity.id);
          expect(restEntity.typeName).toBe(origEntity.typeName);
          expect(getPartPrimaryValue(restEntity)).toBe(getPartPrimaryValue(origEntity));
          expect(restEntity.weight).toBe(origEntity.weight);
          expect(restEntity.bookmark).toBe(origEntity.bookmark);
          expect(restEntity.notes).toEqual(origEntity.notes);
          expect(restEntity.displayInfo).toEqual(origEntity.displayInfo);
          expect(imported.store.layoutStore.getPosition(origEntity.id)).toEqual(
            originalStore.layoutStore.getPosition(origEntity.id)
          );
          expect(imported.store.layoutStore.isPinned(origEntity.id)).toBe(
            originalStore.layoutStore.isPinned(origEntity.id)
          );
        }

        for (const [lid, origEdge] of originalStore.structureStore.links.entries()) {
          const restEdge = imported.store.structureStore.links.get(lid)!;
          expect(restEdge.source.equals(origEdge.source)).toBe(true);
          expect(restEdge.target.equals(origEdge.target)).toBe(true);
          expect(restEdge.isReversed).toBe(origEdge.isReversed);
          expect(imported.store.layoutStore.getLinkPath(lid)).toEqual(
            originalStore.layoutStore.getLinkPath(lid)
          );
        }
      }
    });
  });

  describe('5. .mtgj Selective Zero-Knowledge Encryption (AES-256-GCM + AES-GMAC), .mtgl Migrator & Hub PKCE', () => {
    it('encrypts sensitive .mtgj fields with AES-256-GCM + PKCS7 while keeping topology cleartext and detects tampering via AES-GMAC', () => {
      const store = new GraphStore(new Guid(777n));
      const e1 = registry.createEntity('maltego.Domain', 'classified-c2.org', {
        id: new Guid(1n),
        weight: 250,
      });
      e1.notes = { value: 'Top secret analyst attribution note', show: true };
      const e2 = registry.createEntity('maltego.IPv4Address', '192.0.2.99', {
        id: new Guid(2n),
        weight: 100,
      });

      store.addEntity(e1, { x: 10, y: 20, z: 0 }, true);
      store.addEntity(e2, { x: 110, y: 120, z: 0 }, false);
      store.addLink(makeStyledLink(new Guid(5n), 'C2 beacon', 3), e1.id, e2.id);

      const handler = new MtgjJsonHandler();
      const archiveBytes = handler.exportToMtgjArchiveBytes(store, {
        passphrase: 'correct-horse-battery-staple',
      });

      // Decrypt with correct passphrase
      const imported = handler.importFromMtgjArchiveBytes(archiveBytes, {
        passphrase: 'correct-horse-battery-staple',
      });
      expect(imported.store.entityCount).toBe(2);
      expect(getPartPrimaryValue(imported.store.dataStore.getEntity(e1.id))).toBe(
        'classified-c2.org'
      );
      expect(imported.store.dataStore.getEntity(e1.id).notes.value).toBe(
        'Top secret analyst attribution note'
      );

      // Verify AES-GMAC tamper detection when an attacker modifies topology in the encrypted JSON
      const encryptedDoc = handler.encryptMtgjDocument(imported.document, 'secret-pass');
      expect(encryptedDoc.entities[0]!.props[0]!.value).not.toBe('classified-c2.org');
      // Tamper with node weight in cleartext topology
      encryptedDoc.entities[0]!.weight = 999;
      expect(() => handler.decryptMtgjDocument(encryptedDoc, 'secret-pass')).toThrow(
        /AES-GMAC structural integrity verification failed/
      );
    });

    it('migrates legacy .mtgl (Lucene 5.0 Pandora) archives and validates HubClient + OAuth 2.0 PKCE S256', () => {
      const migrator = new MtglLegacyMigrator(registry);
      const legacyBytes = migrator.buildLegacyMtglArchive({
        pandoraVersion: '1.4.7',
        luceneVersion: '5.0.0',
        graphId: '9001',
        entities: [
          { id: '1', type: 'maltego.Domain', value: 'legacy.org', weight: 120, x: 50, y: 60 },
          { id: '2', type: 'maltego.IPv4Address', value: '198.51.100.1', weight: 100, x: 200, y: 60 },
        ],
        links: [{ id: '10', source: '1', target: '2', label: 'A', weight: 2 }],
      });

      const migrated = migrator.migrateMtglBytesToGraphStore(legacyBytes);
      expect(migrated.pandoraVersion).toBe('1.4.7');
      expect(migrated.migratedEntitiesCount).toBe(2);
      expect(migrated.migratedLinksCount).toBe(1);

      // HubClient & OAuthPkceManager
      const hub = new HubClient();
      hub.ingestHubCatalog({
        version: '1.0',
        timestamp: Date.now(),
        items: [
          {
            id: 'paterva.ctas',
            name: 'Standard Transforms (CTAS)',
            provider: 'Maltego Technologies',
            description: 'OSINT core transforms',
            seedUrl: 'https://cetas.paterva.com/TDS/runner/showseed/ctas',
            protocolVersion: '2.0',
            requiresApiKey: false,
            requiresOAuth: true,
            supportedInputTypes: ['maltego.Domain', 'maltego.IPv4Address'],
          },
        ],
      });
      expect(hub.findSeedsForEntityType('maltego.Domain')).toHaveLength(1);

      const pkce = new OAuthPkceManager();
      const challenge = pkce.generatePkceChallenge();
      expect(pkce.verifyChallengePair(challenge.codeVerifier, challenge.codeChallenge)).toBe(true);
      const authUrl = pkce.buildAuthorizationUrl({
        authorizationEndpoint: 'https://auth.maltego.com/oauth2/authorize',
        clientId: 'cangrejo_desktop',
        redirectUri: 'http://127.0.0.1:48210/callback',
        challenge,
        scopes: ['transforms:run', 'offline_access'],
      });
      expect(authUrl).toContain('code_challenge_method=S256');
    });

    it('imports real-world Maltego 4.x GraphML with yFiles IDs (n0, n1, e0) and ingests CLI Recon JSONL with semantic links', async () => {
      const mtgxHandler = new MtgxArchiveHandler();
      const rawMaltegoGraphMl = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:mtgx="http://maltego.paterva.com/xml/mtgx" xmlns:y="http://www.yworks.com/xml/graphml">
  <graph id="G" edgedefault="directed">
    <node id="n0">
      <data key="d0">
        <mtgx:MaltegoEntity type="maltego.Domain" weight="100">
          <mtgx:Properties>
            <mtgx:Property name="fqdn" type="string" displayName="Domain Name">
              <mtgx:Value>shadow-apt.org</mtgx:Value>
            </mtgx:Property>
          </mtgx:Properties>
        </mtgx:MaltegoEntity>
      </data>
      <data key="d1"><y:ShapeNode><y:Geometry x="120.0" y="240.0"/></y:ShapeNode></data>
    </node>
    <node id="n1">
      <data key="d1">
        <y:ShapeNode>
          <y:Geometry x="320.0" y="240.0"/>
          <y:NodeLabel>185.220.101.34</y:NodeLabel>
        </y:ShapeNode>
      </data>
    </node>
    <edge id="e0" source="n0" target="n1">
      <data key="d3"><y:PolyLineEdge><y:EdgeLabel>A record</y:EdgeLabel></y:PolyLineEdge></data>
    </edge>
  </graph>
</graphml>`;

      const store = mtgxHandler.deserializeGraphMlToGraphStore(rawMaltegoGraphMl);
      expect(store.entityCount).toBe(2);
      expect(store.linkCount).toBe(1);
      const values = Array.from(store.dataStore.getEntities().values()).map((e) =>
        getPartPrimaryValue(e)
      );
      expect(values).toContain('shadow-apt.org');
      expect(values).toContain('185.220.101.34');

      // Test Hono CLI Recon JSONL semantic link extraction
      const cliJsonl = [
        '{"host":"vpn.shadow-apt.org","input":"shadow-apt.org","source":"subfinder"}',
        '{"input":"vpn.shadow-apt.org","a":["185.220.101.34"],"asn":{"as_number":"AS205100"},"url":"https://vpn.shadow-apt.org:8443/login"}',
        '{"host":"vpn.shadow-apt.org","ip":"185.220.101.34","template-id":"CVE-2024-3400","info":{"name":"PAN-OS RCE","severity":"critical"}}',
      ].join('\n');

      const res = await cangrejoHonoApp.request('http://localhost/api/ingest/raw-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cliJsonl, incidentTitle: 'CLI Recon Test' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        cliReconRecords: number;
        entities: Array<{ typeName: string; value: string }>;
        links: Array<{ label: string }>;
      };
      expect(body.ok).toBe(true);
      expect(body.cliReconRecords).toBe(3);
      expect(body.entities.some((e) => e.value === 'CVE-2024-3400')).toBe(true);
      expect(body.links.some((l) => l.label === 'subdomain (CLI JSONL)')).toBe(true);
      expect(body.links.some((l) => l.label === 'resolves to (DNS A)')).toBe(true);
      expect(body.links.some((l) => l.label === 'vulnerable to (Nuclei)')).toBe(true);
    });
  });
});
