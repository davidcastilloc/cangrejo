import { describe, expect, it } from 'vitest';
import {
  CollectionNodeView,
  DanglingLinkException,
  EntityNotFoundException,
  GraphStore,
  Guid,
  GuidMap,
  GuidSet,
  LinkNotFoundException,
  createPropertyBag,
  err,
  ok,
} from '@cangrejo/core';
import { D1SchemaRunner } from '@cangrejo/database-d1';
import {
  InMemoryPlatformBridge,
  formatLocalTransformFieldArg,
  parseLocalTransformFieldArg,
} from '@cangrejo/platform-bridge';
import { MtgjSchemaValidator } from '@cangrejo/schemas';

describe('Gate 0: Foundations, Data Model & Base Abstractions', () => {
  describe('1. 64-bit Non-Zero Guid Identity & Value Collections', () => {
    it('enforces the non-zero invariant on Guid construction while allowing Guid.ZERO', () => {
      expect(Guid.ZERO.isZero()).toBe(true);
      expect(Guid.ZERO.toBigInt()).toBe(0n);
      expect(() => new Guid(0n)).toThrow(/Guid cannot be zero/i);
    });

    it('generates 100,000 cryptographically random Guids with zero collisions and zero 0n values', () => {
      const seen = new Set<bigint>();
      const total = 100_000;
      for (let i = 0; i < total; i++) {
        const g = Guid.generate();
        expect(g.isZero()).toBe(false);
        expect(g.toBigInt()).not.toBe(0n);
        seen.add(g.toBigInt());
      }
      expect(seen.size).toBe(total);
    });

    it('parses decimal, hex, prefixed (e_/l_/g_), and deterministic string representations', () => {
      const g1 = Guid.parse('e_987654321012345');
      const g2 = Guid.parse('987654321012345');
      expect(g1.equals(g2)).toBe(true);

      const hexGuid = Guid.parse('-0x1a2b3c4d5e6f');
      expect(hexGuid.toBigInt()).toBe(-0x1a2b3c4d5e6fn);

      const zeroParsed = Guid.parse('0');
      expect(zeroParsed.isZero()).toBe(true);
    });

    it('supports O(1) value-based equality in GuidSet and GuidMap across distinct object instances', () => {
      const idA1 = new Guid(4242424242n);
      const idA2 = new Guid(4242424242n);
      expect(idA1).not.toBe(idA2);
      expect(idA1.equals(idA2)).toBe(true);

      const set = new GuidSet([idA1]);
      expect(set.has(idA2)).toBe(true);
      set.add(idA2);
      expect(set.size).toBe(1);

      const map = new GuidMap<string>();
      map.set(idA1, 'maltego.Domain');
      expect(map.get(idA2)).toBe('maltego.Domain');
      expect(map.delete(idA2)).toBe(true);
      expect(map.size).toBe(0);
    });
  });

  describe('2. Tagged Result & Domain Exceptions', () => {
    it('constructs discriminated ok/err results and domain exceptions with full metadata', () => {
      const success = ok(123);
      const failure = err(new EntityNotFoundException(new Guid(99n)));
      expect(success.ok).toBe(true);
      expect(failure.ok).toBe(false);

      const dangling = new DanglingLinkException(
        new Guid(1n),
        new Guid(3n),
        'target'
      );
      expect(dangling.endpointRole).toBe('target');
      expect(dangling.missingEntityId.equals(new Guid(3n))).toBe(true);
      expect(dangling.linkId.equals(new Guid(1n))).toBe(true);

      const linkNotFound = new LinkNotFoundException(new Guid(77n));
      expect(linkNotFound.linkId.equals(new Guid(77n))).toBe(true);
    });
  });

  describe('3. .mtgj v2.0.0 Schema Validation & GraphStore Round-Trip', () => {
    const validator = new MtgjSchemaValidator();

    it('validates a canonical .mtgj v2.0.0 document with entities, links, collections, and E2E encryption envelope', () => {
      const validDoc = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Operation Canary',
        schemaVersion: '2.0.0',
        metadata: {
          author: 'analyst@aerya.io',
          created: 1730000000000,
          modified: 1730000050000,
          bookmarkLabels: { '0': 'Critical C2', '23': 'Verified Sinkhole' },
          viewSettings: {
            activeLayout: 'hierarchical',
            zoom: 1.25,
            pan: { x: 100, y: -50 },
            collectionNodesEnabled: true,
          },
        },
        entities: [
          {
            id: 'e_1001',
            type: 'maltego.Domain',
            weight: 250,
            position: { x: 120.5, y: -80.25, z: 0 },
            pinned: true,
            bookmark: 0,
            notes: { value: 'Primary target domain', show: true },
            displayInfo: [
              { title: 'WHOIS Summary', content: '<p>Registrar: Example</p>', type: 'text/html' },
            ],
            overlays: [{ propertyName: 'fqdn', position: 'NW', type: 'text' }],
            props: [
              {
                name: 'fqdn',
                displayName: 'Domain Name',
                type: 'string',
                value: 'paterva.com',
                special: ['VALUE', 'DISPLAY_VALUE'],
                matchingRule: 'STRICT',
              },
            ],
            attachments: [
              {
                id: 'att_1',
                name: 'cert.pem',
                mimeType: 'application/x-pem-file',
                sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                sizeBytes: 2048,
              },
            ],
          },
        ],
        links: [],
        encryption: {
          algorithm: 'AES-GCM-256',
          keyWrap: 'RSA-OAEP-256',
          salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
          iterations: 600000,
          iv: 'AAAAAAAAAAAAAAAA',
          tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
          gmac: 'BBBBBBBBBBBBBBBBBBBBBB==',
          encryptedFields: ['/entities/0/props/0/value'],
        },
      };

      const res = validator.validate(validDoc);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('rejects malformed .mtgj documents (invalid schemaVersion or out-of-range bookmark)', () => {
      const invalidDoc = {
        id: 'graph_1',
        schemaVersion: '1.0.0',
        entities: [
          {
            id: 'e_1',
            type: 'maltego.Domain',
            weight: 100,
            bookmark: 99,
            props: [],
          },
        ],
        links: [],
      };
      const res = validator.validate(invalidDoc);
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    });

    it('round-trips a populated GraphStore + CollectionNodeView to .mtgj v2.0.0 and back losslessly', () => {
      const store = new GraphStore(new Guid(5000n));
      const e1Id = new Guid(101n);
      const e2Id = new Guid(102n);
      const l1Id = new Guid(201n);

      store.addEntity(
        {
          id: e1Id,
          typeName: 'maltego.Domain',
          weight: 200,
          bookmark: 3,
          notes: { value: 'Root domain', show: true },
          displayInfo: [{ title: 'DNS', content: 'A record resolved', type: 'text/plain' }],
          overlays: [{ propertyName: 'fqdn', position: 'N', type: 'text' }],
          properties: createPropertyBag([
            {
              descriptor: {
                name: 'fqdn',
                displayName: 'Domain Name',
                type: 'string',
                nullable: false,
                hidden: false,
                readonly: false,
                specialRoles: ['VALUE', 'DISPLAY_VALUE'],
                matchingRule: 'STRICT',
              },
              value: 'maltego.com',
            },
          ]),
          attachments: [],
        },
        { x: 10, y: 20, z: 0 },
        true
      );

      store.addEntity(
        {
          id: e2Id,
          typeName: 'maltego.IPv4Address',
          weight: 100,
          bookmark: -1,
          notes: { value: '', show: false },
          displayInfo: [],
          overlays: [],
          properties: createPropertyBag([
            {
              descriptor: {
                name: 'ipv4-address',
                displayName: 'IP Address',
                type: 'string',
                nullable: false,
                hidden: false,
                readonly: false,
                specialRoles: ['VALUE', 'DISPLAY_VALUE'],
                matchingRule: 'STRICT',
              },
              value: '104.21.12.34',
            },
          ]),
          attachments: [],
        },
        { x: 300, y: 400, z: 0 },
        false
      );

      store.addLink(
        {
          id: l1Id,
          typeName: 'maltego.link.transform-link',
          weight: 4,
          bookmark: 2,
          notes: { value: 'Passive DNS', show: false },
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
              value: 'resolves to',
            },
          ]),
        },
        e1Id,
        e2Id,
        false,
        [{ x: 150, y: 210 }]
      );

      const collectionView = new CollectionNodeView(store, { minRequiredEntitiesPerNode: 2 });
      const mtgjDoc = validator.serializeGraphStore(store, {
        name: 'RoundTripGraph',
        collectionView,
      });

      const restored = validator.deserializeToGraphStore(mtgjDoc);
      expect(restored.entityCount).toBe(2);
      expect(restored.linkCount).toBe(1);
      expect(restored.dataStore.getEntity(e1Id).notes.value).toBe('Root domain');
      expect(restored.layoutStore.isPinned(e1Id)).toBe(true);
      expect(restored.layoutStore.getPosition(e2Id)).toEqual({ x: 300, y: 400, z: 0 });
      expect(restored.layoutStore.getLinkPath(l1Id)).toEqual([{ x: 150, y: 210 }]);
    });
  });

  describe('4. IPlatformBridge & Local Transform CLI Escaping', () => {
    it('escapes and unescapes backslashes, equals signs, and hashes in CLI transform field bags', () => {
      const originalFields = {
        fqdn: 'sub.example.com',
        query: 'a=1#b=2\\path',
        notes: '100%#verified=true',
      };

      const encoded = formatLocalTransformFieldArg(originalFields);
      const decoded = parseLocalTransformFieldArg(encoded);
      expect(decoded).toEqual(originalFields);
    });

    it('supports InMemoryPlatformBridge virtual storage and local transform registration', async () => {
      const bridge = new InMemoryPlatformBridge('node-test', async (opts) => ({
        exitCode: 0,
        stdout: `<MaltegoMessage><Entity>${opts.args[0]}</Entity></MaltegoMessage>`,
        stderr: '',
        durationMs: 5,
      }));
      const payload = new TextEncoder().encode('hello-mtgx');
      const writeRes = await bridge.writeFileBytes('/graphs/test.mtgj', payload);
      expect(writeRes.ok).toBe(true);

      const readRes = await bridge.readFileBytes('/graphs/test.mtgj');
      expect(readRes.ok).toBe(true);
      if (readRes.ok) {
        expect(new TextDecoder().decode(readRes.value)).toBe('hello-mtgx');
      }

      const execRes = await bridge.executeLocalTransformSubprocess({
        command: '/usr/bin/dns_lookup',
        args: ['paterva.com', 'fqdn=paterva.com'],
        workingDirectory: '/tmp',
        timeoutMs: 5000,
      });
      expect(execRes.ok).toBe(true);
      if (execRes.ok) {
        expect(execRes.value.exitCode).toBe(0);
        expect(execRes.value.stdout).toContain('paterva.com');
      }
    });
  });

  describe('5. Cloudflare D1 Relational Schema & Same-Second Recursive Trigger Stress Test', () => {
    it('applies 0001_initial_schema.sql and survives 20 rapid same-second updates per table with recursive_triggers=ON', () => {
      const runner = new D1SchemaRunner(':memory:');
      try {
        runner.applyInitialMigration();

        const tables = runner.listTables();
        expect(tables).toEqual([
          'api_keys_vault',
          'audit_logs',
          'investigation_collaborators',
          'investigations',
          'memberships',
          'organizations',
          'rooms',
          'turnstile_verification_logs',
          'users',
          'workspaces',
        ]);

        const triggers = runner.listTriggers();
        expect(triggers).toHaveLength(6);

        // Insert records across all 6 trigger-managed tables
        runner.db
          .prepare(
            `INSERT INTO users (id, email, password_hash, full_name) VALUES ('usr_1', 'alice@example.com', 'argon2id$hash', 'Alice')`
          )
          .run();
        runner.db
          .prepare(
            `INSERT INTO organizations (id, name, slug) VALUES ('org_1', 'ACME Intel', 'acme-intel')`
          )
          .run();
        runner.db
          .prepare(
            `INSERT INTO memberships (user_id, org_id, role) VALUES ('usr_1', 'org_1', 'owner')`
          )
          .run();
        runner.db
          .prepare(
            `INSERT INTO workspaces (id, org_id, name, created_by) VALUES ('wsp_1', 'org_1', 'Case 42', 'usr_1')`
          )
          .run();
        runner.db
          .prepare(
            `INSERT INTO investigations (id, org_id, workspace_id, title, created_by)
             VALUES ('inv_1', 'org_1', 'wsp_1', 'Graph1', 'usr_1')`
          )
          .run();
        runner.db
          .prepare(
            `INSERT INTO api_keys_vault (id, org_id, provider_name, key_alias, encrypted_key, iv, auth_tag, created_by)
             VALUES ('sec_1', 'org_1', 'shodan', 'Corp Shodan', 'enc_b64', 'iv_b64', 'tag_b64', 'usr_1')`
          )
          .run();

        // Execute 20 rapid updates within the exact same epoch second as INSERT
        for (let i = 0; i < 20; i++) {
          runner.db
            .prepare(`UPDATE users SET full_name = ? WHERE id = 'usr_1'`)
            .run(`Alice_${i}`);
          runner.db
            .prepare(`UPDATE organizations SET name = ? WHERE id = 'org_1'`)
            .run(`ACME_${i}`);
          runner.db
            .prepare(`UPDATE memberships SET custom_permissions_mask = ? WHERE user_id = 'usr_1' AND org_id = 'org_1'`)
            .run(i + 1);
          runner.db
            .prepare(`UPDATE workspaces SET name = ? WHERE id = 'wsp_1'`)
            .run(`Case_${i}`);
          runner.db
            .prepare(`UPDATE investigations SET node_count = ? WHERE id = 'inv_1'`)
            .run(i + 1);
          runner.db
            .prepare(`UPDATE api_keys_vault SET key_version = ? WHERE id = 'sec_1'`)
            .run(i + 1);
        }

        const invRow = runner.db
          .prepare(`SELECT node_count FROM investigations WHERE id = 'inv_1'`)
          .get() as { node_count: number };
        expect(invRow.node_count).toBe(20);
      } finally {
        runner.close();
      }
    });
  });
});
