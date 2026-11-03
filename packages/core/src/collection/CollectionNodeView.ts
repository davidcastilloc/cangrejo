import { Guid, GuidMap, GuidSet, type EntityID, type LinkID } from '../identity/Guid.js';
import type { Point3D } from '../store/GraphLayoutStore.js';
import type { GraphStore } from '../store/GraphStore.js';
import { evaluateChainingCollectionRule } from './ChainingRule.js';
import { evaluateNeighbourCollectionRule } from './NeighbourRule.js';
import { evaluateStandAloneCollectionRule, type CandidateCluster } from './StandAloneRule.js';
import { buildViewLinks, type ViewLink } from './ViewLinkRouter.js';

export interface ViewEntity {
  readonly id: EntityID;
  readonly typeName: string;
  readonly isCollectionNode: boolean;
  readonly ruleName?: 'StandAlone' | 'Neighbour' | 'Chaining';
  readonly underlyingEntities: GuidSet;
  position: Point3D;
  pinned: boolean;
}

export interface CollectionNodeSerializedState {
  version: number;
  enabled: boolean;
  ruleRatio: number;
  minRequiredEntitiesPerNode: number;
  collections: Array<{
    collectionEntityId: string;
    typeName: string;
    ruleName: 'StandAlone' | 'Neighbour' | 'Chaining';
    pinned: boolean;
    center: { x: number; y: number };
    underlyingEntityIds: string[];
  }>;
}

/**
 * Virtual Collection Nodes Projection (`CollectionNodeView`).
 * Aggregates high-degree leaf/bridge/orphan entities into synthetic `ViewEntity` nodes and `ViewLink` proxy edges
 * with ZERO mutation to the underlying `GraphDataStore` or `GraphStructureStore`.
 */
export class CollectionNodeView {
  public readonly underlyingStore: GraphStore;
  private enabled: boolean;
  private minRequiredEntitiesPerNode: number;
  private ruleRatio: number;

  private readonly viewEntities = new GuidMap<ViewEntity>();
  private viewLinks = new GuidMap<ViewLink>();
  private readonly physicalToViewMap = new GuidMap<EntityID>();
  private readonly manuallyUncollectedEntityIds = new GuidSet();
  private readonly groupKeyToCollectionId = new Map<string, EntityID>();
  private readonly proxyLinkIdCache = new Map<string, LinkID>();

  public constructor(
    underlyingStore: GraphStore,
    options?: {
      enabled?: boolean;
      minRequiredEntitiesPerNode?: number;
      ruleRatio?: number;
    }
  ) {
    this.underlyingStore = underlyingStore;
    this.enabled = options?.enabled ?? true;
    this.minRequiredEntitiesPerNode = Math.max(2, options?.minRequiredEntitiesPerNode ?? 3);
    this.ruleRatio = options?.ruleRatio ?? 1.0;

    this.recomputeCollections();
    this.underlyingStore.subscribe(() => {
      this.recomputeCollections();
    });
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public get minEntitiesThreshold(): number {
    return this.minRequiredEntitiesPerNode;
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.recomputeCollections();
  }

  public setMinRequiredEntitiesPerNode(minRequired: number): void {
    this.minRequiredEntitiesPerNode = Math.max(2, minRequired);
    this.recomputeCollections();
  }

  public getViewEntities(): ReadonlyMap<EntityID, ViewEntity> {
    return this.viewEntities;
  }

  public getViewLinks(): ReadonlyMap<LinkID, ViewLink> {
    return this.viewLinks;
  }

  public getCollectionNodes(): ViewEntity[] {
    const list: ViewEntity[] = [];
    for (const ve of this.viewEntities.values()) {
      if (ve.isCollectionNode) list.push(ve);
    }
    return list;
  }

  /**
   * Maps a physical `EntityID` to its projected `ViewEntity` ID (either itself or its containing Collection Node).
   */
  public getViewEntityIdForPhysical(physicalId: EntityID): EntityID {
    return this.physicalToViewMap.get(physicalId) ?? physicalId;
  }

  /**
   * Expands a collapsed collection node so its members are shown individually until reset.
   */
  public uncollectNode(collectionEntityId: EntityID): boolean {
    const viewEntity = this.viewEntities.get(collectionEntityId);
    if (!viewEntity || !viewEntity.isCollectionNode) {
      return false;
    }
    for (const memberId of viewEntity.underlyingEntities) {
      this.manuallyUncollectedEntityIds.add(memberId);
    }
    this.recomputeCollections();
    return true;
  }

  public resetManualUncollections(): void {
    this.manuallyUncollectedEntityIds.clear();
    this.recomputeCollections();
  }

  /**
   * Re-evaluates the 3 clustering rules (`StandAlone`, `Neighbour`, `Chaining`) in `O(V + E)` time
   * without mutating any data in `underlyingStore`.
   */
  public recomputeCollections(): void {
    this.viewEntities.clear();
    this.physicalToViewMap.clear();

    if (!this.enabled) {
      for (const [id, entity] of this.underlyingStore.dataStore.getEntities().entries()) {
        this.physicalToViewMap.set(id, id);
        this.viewEntities.set(id, {
          id,
          typeName: entity.typeName,
          isCollectionNode: false,
          underlyingEntities: new GuidSet([id]),
          position: this.underlyingStore.layoutStore.getPosition(id),
          pinned: this.underlyingStore.layoutStore.isPinned(id),
        });
      }
      this.viewLinks = buildViewLinks(this.underlyingStore, this.physicalToViewMap, this.proxyLinkIdCache);
      return;
    }

    const excluded = this.manuallyUncollectedEntityIds.clone();
    const clusters: CandidateCluster[] = [];

    // 1. StandAlone (Degree 0)
    const c1 = evaluateStandAloneCollectionRule(
      this.underlyingStore,
      excluded,
      this.minRequiredEntitiesPerNode
    );
    for (const c of c1) {
      clusters.push(c);
      for (const m of c.memberIds) excluded.add(m);
    }

    // 2. Neighbour (Degree 1)
    const c2 = evaluateNeighbourCollectionRule(
      this.underlyingStore,
      excluded,
      this.minRequiredEntitiesPerNode
    );
    for (const c of c2) {
      clusters.push(c);
      for (const m of c.memberIds) excluded.add(m);
    }

    // 3. Chaining (Degree 2)
    const c3 = evaluateChainingCollectionRule(
      this.underlyingStore,
      excluded,
      this.minRequiredEntitiesPerNode
    );
    for (const c of c3) {
      clusters.push(c);
      for (const m of c.memberIds) excluded.add(m);
    }

    // Materialize ViewEntities for clusters
    const collectedMemberIds = new GuidSet();
    for (const cluster of clusters) {
      let colId = this.groupKeyToCollectionId.get(cluster.groupKey);
      if (!colId || this.underlyingStore.dataStore.hasEntity(colId)) {
        colId = Guid.generate();
        this.groupKeyToCollectionId.set(cluster.groupKey, colId);
      }

      // Compute centroid of member coordinates
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      for (const memberId of cluster.memberIds) {
        collectedMemberIds.add(memberId);
        this.physicalToViewMap.set(memberId, colId);
        const pos = this.underlyingStore.layoutStore.getPosition(memberId);
        sumX += pos.x;
        sumY += pos.y;
        sumZ += pos.z;
      }
      const count = cluster.memberIds.size;
      const centroid: Point3D = {
        x: count > 0 ? sumX / count : 0,
        y: count > 0 ? sumY / count : 0,
        z: count > 0 ? sumZ / count : 0,
      };

      this.viewEntities.set(colId, {
        id: colId,
        typeName: cluster.entityTypeName,
        isCollectionNode: true,
        ruleName: cluster.ruleName,
        underlyingEntities: cluster.memberIds.clone(),
        position: centroid,
        pinned: false,
      });
    }

    // Add remaining uncollected physical entities
    for (const [id, entity] of this.underlyingStore.dataStore.getEntities().entries()) {
      if (collectedMemberIds.has(id)) continue;
      this.physicalToViewMap.set(id, id);
      this.viewEntities.set(id, {
        id,
        typeName: entity.typeName,
        isCollectionNode: false,
        underlyingEntities: new GuidSet([id]),
        position: this.underlyingStore.layoutStore.getPosition(id),
        pinned: this.underlyingStore.layoutStore.isPinned(id),
      });
    }

    this.viewLinks = buildViewLinks(this.underlyingStore, this.physicalToViewMap, this.proxyLinkIdCache);
  }

  /**
   * Serializes the collection node state to JSON.
   */
  public toJSONState(): CollectionNodeSerializedState {
    const collections = this.getCollectionNodes().map((ve) => ({
      collectionEntityId: ve.id.toString(),
      typeName: ve.typeName,
      ruleName: ve.ruleName ?? 'Neighbour',
      pinned: ve.pinned,
      center: { x: Math.round(ve.position.x), y: Math.round(ve.position.y) },
      underlyingEntityIds: ve.underlyingEntities.toArray().map((id) => id.toString()),
    }));

    return {
      version: 1,
      enabled: this.enabled,
      ruleRatio: this.ruleRatio,
      minRequiredEntitiesPerNode: this.minRequiredEntitiesPerNode,
      collections,
    };
  }

  /**
   * Serializes the collection node cache to Maltego's Big-Endian binary `collection-nodes.data` format.
   */
  public toBinaryCollectionNodesData(): Uint8Array {
    const state = this.toJSONState();
    const chunks: Buffer[] = [];

    const writeInt32 = (val: number) => {
      const b = Buffer.alloc(4);
      b.writeInt32BE(val, 0);
      chunks.push(b);
    };
    const writeInt64 = (val: bigint) => {
      const b = Buffer.alloc(8);
      b.writeBigInt64BE(val, 0);
      chunks.push(b);
    };
    const writeDouble = (val: number) => {
      const b = Buffer.alloc(8);
      b.writeDoubleBE(val, 0);
      chunks.push(b);
    };
    const writeByte = (val: number) => {
      chunks.push(Buffer.from([val & 0xff]));
    };
    const writeUTF = (str: string) => {
      const strBuf = Buffer.from(str, 'utf8');
      const lenBuf = Buffer.alloc(2);
      lenBuf.writeUInt16BE(strBuf.length, 0);
      chunks.push(lenBuf, strBuf);
    };

    writeInt32(state.version);
    writeByte(state.enabled ? 1 : 0);
    writeDouble(state.ruleRatio);
    writeInt32(state.minRequiredEntitiesPerNode);
    writeInt32(state.collections.length);

    for (const col of state.collections) {
      writeInt64(Guid.parse(col.collectionEntityId).toBigInt());
      writeUTF(col.typeName);
      writeByte(col.pinned ? 1 : 0);
      writeInt32(col.center.x);
      writeInt32(col.center.y);
      writeInt32(col.underlyingEntityIds.length);
      for (const memberStr of col.underlyingEntityIds) {
        writeInt64(Guid.parse(memberStr).toBigInt());
      }
    }

    return new Uint8Array(Buffer.concat(chunks));
  }
}
