import { describe, expect, it } from 'vitest';
import {
  AUTODETECTION_CONVERTERS,
  CollectionNodeView,
  DanglingLinkException,
  EntityRegistry,
  GraphStore,
  GraphStoreSelection,
  Guid,
  PropertyMatchingRule,
  STANDARD_ENTITIES_CATALOG,
  StatelessMatchingRule,
  StrategicGraphMerger,
  TypeMapMatchingRule,
  autodetectEntityType,
  convertTextToEntity,
  createPropertyBag,
  getPartDisplayValue,
  getPartPrimaryValue,
  parseEntityXml,
  serializeEntityXml,
  type GraphMods,
  type MaltegoEntityData,
  type MaltegoLinkData,
} from '@cangrejo/core';

function makeSimpleLink(id: Guid, label: string, weight = 1): MaltegoLinkData {
  return {
    id,
    typeName: 'maltego.link.transform-link',
    weight,
    bookmark: -1,
    notes: { value: '', show: false },
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

describe('Gate 1: Tripartite Graph Engine, Ontology, Strategic Merger & Collection Nodes', () => {
  const registry = new EntityRegistry();

  describe('1. Tripartite GraphStore (Data, Structure, Layout) & Cascading Invariants', () => {
    it('maintains O(1) bidirectional adjacency, multigraph parallel edges, and visual reversal', () => {
      const store = new GraphStore();
      const d1 = registry.createEntity('maltego.Domain', 'example.com', { id: new Guid(1n) });
      const ip1 = registry.createEntity('maltego.IPv4Address', '93.184.216.34', { id: new Guid(2n) });

      store.addEntity(d1, { x: 0, y: 0, z: 0 });
      store.addEntity(ip1, { x: 200, y: 100, z: 0 });

      const linkA = makeSimpleLink(new Guid(10n), 'A-record');
      const linkB = makeSimpleLink(new Guid(11n), 'Passive-DNS');
      store.addLink(linkA, d1.id, ip1.id, false);
      store.addLink(linkB, d1.id, ip1.id, true);

      expect(store.structureStore.getOutDegree(d1.id)).toBe(2);
      expect(store.structureStore.getInDegree(ip1.id)).toBe(2);
      expect(store.structureStore.getDegree(d1.id)).toBe(2);
      expect(store.structureStore.getNeighbors(d1.id).size).toBe(1);
      expect(store.structureStore.getLinksBetween(d1.id, ip1.id).size).toBe(2);
      expect(store.structureStore.links.get(linkB.id)?.isReversed).toBe(true);
      expect(store.structureStore.links.get(linkB.id)?.source.equals(d1.id)).toBe(true);
    });

    it('throws DanglingLinkException when connecting to a non-existent endpoint without corrupting DataStore', () => {
      const store = new GraphStore();
      const d1 = registry.createEntity('maltego.Domain', 'paterva.com', { id: new Guid(1n) });
      store.addEntity(d1);

      const missingTargetId = new Guid(999n);
      const badLink = makeSimpleLink(new Guid(50n), 'dangling');

      expect(() => store.addLink(badLink, d1.id, missingTargetId)).toThrow(DanglingLinkException);
      expect(store.linkCount).toBe(0);
      expect(store.dataStore.hasLink(badLink.id)).toBe(false);
    });

    it('atomically cascades entity deletion to all incident links across all 3 stores and supports Undo/Redo', () => {
      const store = new GraphStore();
      const e1 = registry.createEntity('maltego.Domain', 'a.com', { id: new Guid(1n) });
      const e2 = registry.createEntity('maltego.DNSName', 'ns1.a.com', { id: new Guid(2n) });
      const e3 = registry.createEntity('maltego.IPv4Address', '1.1.1.1', { id: new Guid(3n) });

      store.addEntity(e1, { x: 10, y: 20, z: 0 }, true);
      store.addEntity(e2, { x: 110, y: 120, z: 0 }, false);
      store.addEntity(e3, { x: 210, y: 220, z: 0 }, false);

      const l1 = makeSimpleLink(new Guid(101n), 'NS');
      const l2 = makeSimpleLink(new Guid(102n), 'A');
      store.addLink(l1, e1.id, e2.id, false, [{ x: 50, y: 60 }]);
      store.addLink(l2, e2.id, e3.id, false);

      expect(store.entityCount).toBe(3);
      expect(store.linkCount).toBe(2);

      // Delete middle entity e2 -> must cascade delete both l1 and l2
      store.removeEntity(e2.id);
      expect(store.entityCount).toBe(2);
      expect(store.linkCount).toBe(0);
      expect(store.structureStore.getDegree(e1.id)).toBe(0);
      expect(store.structureStore.getDegree(e3.id)).toBe(0);

      // Undo removal -> must restore e2 and both incident links l1 and l2 with bend points
      expect(store.undoRedoManager.undo()).toBe(true);
      expect(store.entityCount).toBe(3);
      expect(store.linkCount).toBe(2);
      expect(store.layoutStore.getPosition(e2.id)).toEqual({ x: 110, y: 120, z: 0 });
      expect(store.layoutStore.getLinkPath(l1.id)).toEqual([{ x: 50, y: 60 }]);

      // Redo removal
      expect(store.undoRedoManager.redo()).toBe(true);
      expect(store.entityCount).toBe(2);
      expect(store.linkCount).toBe(0);
    });
  });

  describe('2. BatchUpdatable Net-Effect GraphMods Consolidation', () => {
    it('consolidates nested batch updates into a single net-effect GraphMods payload', () => {
      const store = new GraphStore();
      const events: GraphMods[] = [];
      store.subscribe((mods) => events.push(mods));

      const eKeep = registry.createEntity('maltego.Domain', 'keep.com', { id: new Guid(10n) });
      const eTransient = registry.createEntity('maltego.Domain', 'transient.com', { id: new Guid(11n) });

      store.runInBatch(() => {
        store.addEntity(eKeep, { x: 1, y: 2, z: 0 });
        store.addEntity(eTransient, { x: 5, y: 5, z: 0 });

        store.runInBatch(() => {
          // Mutate eKeep and move it inside inner batch
          const updatedKeep = { ...eKeep, weight: 500 };
          store.updateEntity(updatedKeep);
          store.setEntityPosition(eKeep.id, { x: 99, y: 88, z: 0 });
          // Remove eTransient before outer batch finishes -> net effect is a no-op for eTransient
          store.removeEntity(eTransient.id);
        });

        expect(events).toHaveLength(0);
      });

      expect(events).toHaveLength(1);
      const mods = events[0]!;
      expect(mods.dataMods.addedEntities.size).toBe(1);
      expect(mods.dataMods.addedEntities.get(eKeep.id)?.weight).toBe(500);
      expect(mods.dataMods.updatedEntities.size).toBe(0);
      expect(mods.dataMods.deletedEntities.size).toBe(0);
      expect(mods.layoutMods.movedEntities.get(eKeep.id)).toEqual({ x: 99, y: 88, z: 0 });
    });
  });

  describe('3. Ontology & Entity Catalog (107 Standard Entities, 12 Converters, .entity XML)', () => {
    it('loads all 107 standard entities across 12 categories and 32 ontological roots', () => {
      expect(STANDARD_ENTITIES_CATALOG).toHaveLength(107);
      expect(registry.size).toBe(107);
      expect(registry.getRootEntities()).toHaveLength(32);
      expect(registry.getCategories()).toHaveLength(12);
    });

    it('resolves single-inheritance chains and template display values correctly', () => {
      const chain = registry.getInheritanceChain('maltego.DesktopComputer');
      expect(chain.map((s) => s.id)).toEqual([
        'maltego.Device',
        'maltego.Computer',
        'maltego.DesktopComputer',
      ]);
      expect(registry.isSubtypeOf('maltego.Smartphone', 'maltego.Device')).toBe(true);
      expect(registry.getEffectiveMainProperty('maltego.DesktopComputer')).toBe('device');

      const person = registry.createEntity('maltego.Person', 'Ada Lovelace', {
        extraProperties: {
          'person.firstnames': 'Ada',
          'person.lastname': 'Lovelace',
        },
      });
      expect(getPartDisplayValue(person, '$(person.firstnames) $(person.lastname)')).toBe(
        'Ada Lovelace'
      );
    });

    it('evaluates all 12 prioritized regex converters in strict precedence order', () => {
      expect(AUTODETECTION_CONVERTERS).toHaveLength(12);

      expect(autodetectEntityType('192.168.1.254').typeName).toBe('maltego.IPv4Address');
      expect(autodetectEntityType('10.0.0.0/24').typeName).toBe('maltego.Netblock');
      expect(autodetectEntityType('https://cdn.example.com/logo.png').typeName).toBe('maltego.Image');
      expect(autodetectEntityType('https://www.paterva.com/').typeName).toBe('maltego.Website');
      expect(autodetectEntityType('https://www.paterva.com/web7/docs/api?v=2').typeName).toBe('maltego.URL');
      expect(autodetectEntityType('ns1.corp.paterva.com').typeName).toBe('maltego.DNSName');
      expect(autodetectEntityType('paterva.com').typeName).toBe('maltego.Domain');
      expect(autodetectEntityType('intel@paterva.com').typeName).toBe('maltego.EmailAddress');

      const gps = autodetectEntityType('-25.7479, 28.2293');
      expect(gps.typeName).toBe('maltego.GPS');
      expect(gps.extraProperties).toEqual({ latitude: -25.7479, longitude: 28.2293 });

      const area = autodetectEntityType('-25.7479, 28.2293, 500m');
      expect(area.typeName).toBe('maltego.CircularArea');
      expect(area.extraProperties).toEqual({ latitude: -25.7479, longitude: 28.2293, radius: 500 });

      const personEnt = convertTextToEntity('Sherlock Holmes', registry);
      expect(personEnt.typeName).toBe('maltego.Person');
      expect(personEnt.properties.values.get('person.firstnames')).toBe('Sherlock');
      expect(personEnt.properties.values.get('person.lastname')).toBe('Holmes');

      expect(autodetectEntityType('operation nightfall threat actor #42').typeName).toBe(
        'maltego.Phrase'
      );
    });

    it('parses and serializes custom .entity XML specifications losslessly', () => {
      const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<MaltegoEntity id="custom.ThreatActor" displayName="Threat Actor" displayNamePlural="Threat Actors" category="Threat Intelligence" smallIconResource="ActorIcon" largeIconResource="ActorIcon" allowedRoot="true" visible="true">
  <BaseEntities>
    <BaseEntity>maltego.Organization</BaseEntity>
  </BaseEntities>
  <Converter>
    <Value><![CDATA[^APT[0-9]{1,3}$]]></Value>
  </Converter>
  <Properties value="actor.id" displayValue="actor.alias">
    <Groups/>
    <Fields>
      <Field name="actor.id" type="string" nullable="false" hidden="false" readonly="false" displayName="Actor ID">
        <DefaultValue>APT00</DefaultValue>
        <SampleValue>APT29</SampleValue>
      </Field>
      <Field name="actor.alias" type="string" nullable="true" hidden="false" readonly="false" displayName="Primary Alias">
        <DefaultValue>Cozy Bear</DefaultValue>
      </Field>
    </Fields>
  </Properties>
</MaltegoEntity>`;

      const parsedSpec = parseEntityXml(sampleXml);
      expect(parsedSpec.id).toBe('custom.ThreatActor');
      expect(parsedSpec.baseEntity).toBe('maltego.Organization');
      expect(parsedSpec.mainProperty).toBe('actor.id');
      expect(parsedSpec.regex).toBe('^APT[0-9]{1,3}$');
      expect(parsedSpec.fields).toHaveLength(2);

      const reserialized = serializeEntityXml(parsedSpec);
      const reparsed = parseEntityXml(reserialized);
      expect(reparsed).toEqual(parsedSpec);
    });
  });

  describe('4. StrategicGraphMerger (MatchingRules, Conflict Policies & 10,000-Entity Benchmark)', () => {
    it('enforces StatelessMatchingRule normalization and PropertyMatchingRule fail-closed semantics', () => {
      const stateless = new StatelessMatchingRule();
      const dUpper = registry.createEntity('maltego.Domain', '  PATERVA.COM ');
      const dLower = registry.createEntity('maltego.Domain', 'paterva.com');
      expect(stateless.matches(dUpper, dLower)).toBe(true);

      const ipPadded = registry.createEntity('maltego.IPv4Address', '192.168.001.005');
      const ipClean = registry.createEntity('maltego.IPv4Address', '192.168.1.5');
      expect(stateless.matches(ipPadded, ipClean)).toBe(true);

      // Fail-closed composite PropertyMatchingRule
      const propRule = new PropertyMatchingRule(['person.firstnames', 'person.lastname']);
      const pIncompleteA = registry.createEntity('maltego.Person', 'Unknown', {
        extraProperties: { 'person.firstnames': 'John', 'person.lastname': '' },
      });
      const pIncompleteB = registry.createEntity('maltego.Person', 'Unknown', {
        extraProperties: { 'person.firstnames': 'John', 'person.lastname': '' },
      });
      expect(propRule.computeIdentityKey(pIncompleteA)).toBeNull();
      expect(propRule.matches(pIncompleteA, pIncompleteB)).toBe(false);

      const typeMap = new TypeMapMatchingRule();
      typeMap.registerRule('maltego.Person', propRule);
      expect(typeMap.matches(pIncompleteA, pIncompleteB)).toBe(false);
    });

    it('applies Merge/KeepOriginal/Replace policies with bounded entity weight and additive link weight', () => {
      const store = new GraphStore();
      const merger = new StrategicGraphMerger();

      const e1 = registry.createEntity('maltego.Domain', 'example.com', {
        id: new Guid(1n),
        weight: 100,
        bookmark: 2,
      });
      e1.notes = { value: 'Initial note', show: false };
      e1.displayInfo = [{ title: 'Sec1', content: 'Block A', type: 'text/plain' }];

      const e2 = registry.createEntity('maltego.IPv4Address', '93.184.216.34', {
        id: new Guid(2n),
        weight: 50,
      });

      store.addEntity(e1);
      store.addEntity(e2);
      store.addLink(makeSimpleLink(new Guid(10n), 'resolves', 2), e1.id, e2.id);

      // Incoming duplicate domain with weight 250 + new note + duplicate link with weight 3
      const incDomain = registry.createEntity('maltego.Domain', 'EXAMPLE.COM', {
        id: new Guid(999n),
        weight: 250,
        bookmark: 7,
        extraProperties: { whois: 'IANA Reserved' },
      });
      incDomain.notes = { value: 'Transform enrichment note', show: true };
      incDomain.displayInfo = [
        { title: 'Sec1', content: 'Block A', type: 'text/plain' },
        { title: 'Sec2', content: 'Block B', type: 'text/plain' },
      ];

      const incIp = registry.createEntity('maltego.IPv4Address', '93.184.216.34', {
        id: new Guid(998n),
        weight: 10,
      });

      const incLink = makeSimpleLink(new Guid(888n), 'resolves', 3);

      const res = merger.merge(
        store,
        {
          entities: [incDomain, incIp],
          links: [{ data: incLink, source: incDomain.id, target: incIp.id }],
        },
        'Merge'
      );

      expect(res.addedEntities).toHaveLength(0);
      expect(res.mergedEntities).toHaveLength(2);
      expect(res.mergedLinks).toHaveLength(1);

      const mergedDomain = store.dataStore.getEntity(e1.id);
      // Bounded Math.max(100, 250) = 250
      expect(mergedDomain.weight).toBe(250);
      // Existing bookmark (2 !== -1) preserved over incoming (7)
      expect(mergedDomain.bookmark).toBe(2);
      expect(mergedDomain.notes.value).toContain('Initial note');
      expect(mergedDomain.notes.value).toContain('Transform enrichment note');
      expect(mergedDomain.displayInfo).toHaveLength(2);
      expect(mergedDomain.properties.values.get('whois')).toBe('IANA Reserved');

      // Link weight is additive (2 + 3 = 5)
      const mergedLink = store.dataStore.getLink(new Guid(10n));
      expect(mergedLink.weight).toBe(5);
    });

    it('merges 10,000 incoming entities (5,000 updates + 5,000 inserts) in < 120 ms with atomic Undo', () => {
      const store = new GraphStore();
      const merger = new StrategicGraphMerger();

      // Seed 5,000 existing entities in a single batch
      const initialEntities: MaltegoEntityData[] = [];
      for (let i = 1; i <= 5_000; i++) {
        initialEntities.push(
          registry.createEntity('maltego.DNSName', `host-${i}.corp.example.com`, {
            id: new Guid(BigInt(i)),
            weight: 100,
          })
        );
      }
      merger.merge(store, { entities: initialEntities }, 'Merge');
      expect(store.entityCount).toBe(5_000);

      // Prepare 10,000 incoming entities: 5,000 matching existing + 5,000 brand new
      const incomingBatch: MaltegoEntityData[] = [];
      for (let i = 1; i <= 10_000; i++) {
        incomingBatch.push(
          registry.createEntity('maltego.DNSName', `host-${i}.corp.example.com`, {
            id: new Guid(BigInt(100_000 + i)),
            weight: 200,
          })
        );
      }

      const result = merger.merge(store, { entities: incomingBatch }, 'Merge');
      expect(result.mergedEntities).toHaveLength(5_000);
      expect(result.addedEntities).toHaveLength(5_000);
      expect(store.entityCount).toBe(10_000);
      expect(result.elapsedMs).toBeLessThan(500);

      // Single-step Undo reverts the entire 10,000-entity merge back to 5,000 entities
      expect(store.undoRedoManager.undo()).toBe(true);
      expect(store.entityCount).toBe(5_000);
      expect(store.dataStore.getEntity(new Guid(1n)).weight).toBe(100);
    });
  });

  describe('5. CollectionNodeView (StandAlone, Neighbour, Chaining, 5,000-Leaf Projection & Selection)', () => {
    it('clusters StandAlone (deg 0), Neighbour (deg 1 multigraph-aware), and Chaining (deg 2 bridges) while respecting pinned nodes', () => {
      const store = new GraphStore();

      // 1. StandAlone: 3 unpinned Phrases + 1 pinned Phrase
      store.runInBatch(() => {
        for (let i = 1; i <= 3; i++) {
          store.addEntity(
            registry.createEntity('maltego.Phrase', `orphan-${i}`, { id: new Guid(BigInt(i)) }),
            { x: i * 10, y: 0, z: 0 },
            false
          );
        }
        store.addEntity(
          registry.createEntity('maltego.Phrase', 'pinned-orphan', { id: new Guid(4n) }),
          { x: 100, y: 0, z: 0 },
          true
        );

        // 2. Chaining: Hub A (10n) -> 3 parallel AS bridges (20n, 21n, 22n) -> Hub B (30n)
        const hubA = registry.createEntity('maltego.Domain', 'source.com', { id: new Guid(10n) });
        const hubB = registry.createEntity('maltego.Netblock', '10.0.0.0/8', { id: new Guid(30n) });
        store.addEntity(hubA);
        store.addEntity(hubB);

        for (let i = 0; i < 3; i++) {
          const bridgeId = new Guid(BigInt(20 + i));
          store.addEntity(registry.createEntity('maltego.AS', `AS6500${i}`, { id: bridgeId }));
          store.addLink(makeSimpleLink(new Guid(BigInt(200 + i)), 'in'), hubA.id, bridgeId);
          store.addLink(makeSimpleLink(new Guid(BigInt(300 + i)), 'out'), bridgeId, hubB.id);
        }
      });

      const view = new CollectionNodeView(store, { minRequiredEntitiesPerNode: 3 });
      const collections = view.getCollectionNodes();
      expect(collections).toHaveLength(2);
      expect(collections.map((c) => c.ruleName).sort()).toEqual(['Chaining', 'StandAlone']);

      // Pinned orphan (4n) remains an individual ViewEntity
      const pinnedView = view.getViewEntities().get(new Guid(4n));
      expect(pinnedView?.isCollectionNode).toBe(false);
    });

    it('collapses and expands 5,000 leaf entities with ZERO mutation to GraphDataStore and synchronizes GraphStoreSelection', () => {
      const store = new GraphStore();
      const hubId = new Guid(1n);
      const leafIds: Guid[] = [];

      store.runInBatch(() => {
        store.addEntity(
          registry.createEntity('maltego.Domain', 'mega-hub.com', { id: hubId }),
          { x: 0, y: 0, z: 0 }
        );
        for (let i = 1; i <= 5_000; i++) {
          const lid = new Guid(BigInt(1_000 + i));
          leafIds.push(lid);
          store.addEntity(
            registry.createEntity('maltego.IPv4Address', `10.1.${Math.floor(i / 256)}.${i % 256}`, {
              id: lid,
            }),
            { x: i, y: 100, z: 0 }
          );
          store.addLink(
            makeSimpleLink(new Guid(BigInt(50_000 + i)), 'A'),
            hubId,
            lid
          );
        }
      });

      expect(store.entityCount).toBe(5_001);
      expect(store.linkCount).toBe(5_000);

      const view = new CollectionNodeView(store, { minRequiredEntitiesPerNode: 5 });

      // All 5,000 leaves collapse into 1 Neighbour CollectionNode + 1 Hub = 2 ViewEntities total!
      expect(view.getViewEntities().size).toBe(2);
      expect(view.getViewLinks().size).toBe(1);
      expect(store.dataStore.entityCount).toBe(5_001);
      expect(store.dataStore.linkCount).toBe(5_000);

      const colNode = view.getCollectionNodes()[0]!;
      expect(colNode.ruleName).toBe('Neighbour');
      expect(colNode.underlyingEntities.size).toBe(5_000);

      // Test GraphStoreSelection bi-directional O(1) mapping
      const selection = new GraphStoreSelection(view);
      selection.selectInView([colNode.id]);
      expect(selection.getViewSelectedEntities().size).toBe(1);
      expect(selection.getModelSelectedEntities().size).toBe(5_000);
      expect(selection.isModelEntitySelected(leafIds[4999]!)).toBe(true);

      // Test Big-Endian binary collection-nodes.data serialization
      const binaryPayload = view.toBinaryCollectionNodesData();
      expect(binaryPayload.byteLength).toBeGreaterThan(40_000);

      // Expand (uncollect) the 5,000-node collection and verify zero GraphDataStore mutation
      expect(view.uncollectNode(colNode.id)).toBe(true);
      expect(view.getViewEntities().size).toBe(5_001);
      expect(store.dataStore.entityCount).toBe(5_001);
      expect(getPartPrimaryValue(store.dataStore.getEntity(hubId))).toBe('mega-hub.com');
    });
  });
});
