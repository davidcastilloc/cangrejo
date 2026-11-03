import { Guid } from '../identity/Guid.js';
import { createPropertyBag, getPartPrimaryValue, type MaltegoLinkData } from '../store/GraphDataStore.js';
import type { Point2D, Point3D } from '../store/GraphLayoutStore.js';
import type { GraphMods } from '../store/GraphMods.js';
import type { GraphStore } from '../store/GraphStore.js';
import type { EntityRegistry } from '../taxonomy/EntityRegistry.js';

export interface AnalystPresence {
  analystId: string;
  displayName: string;
  forensicRank: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
  colorHex: string;
  cursorWorld: Point2D;
  selectedEntityIds: string[];
  lastActiveAt: number;
}

export interface SerializedEntityDelta {
  id: string;
  typeName: string;
  value: string;
  weight: number;
  bookmark: number;
  notes: { value: string; show: boolean };
  properties: Record<string, string>;
  position: Point3D;
  pinned: boolean;
}

export interface SerializedLinkDelta {
  id: string;
  typeName: string;
  sourceId: string;
  targetId: string;
  label: string;
  color: string;
  weight: number;
  isReversed: boolean;
  path: Point2D[];
}

export interface SerializedGraphModsDelta {
  deltaId: string;
  roomId: string;
  authorId: string;
  lamportClock: number;
  timestamp: number;
  addedEntities: SerializedEntityDelta[];
  updatedEntities: SerializedEntityDelta[];
  deletedEntityIds: string[];
  addedLinks: SerializedLinkDelta[];
  deletedLinkIds: string[];
  movedEntities: Array<{ id: string; position: Point3D }>;
  pinChangedEntities: Array<{ id: string; pinned: boolean }>;
}

/**
 * Real-Time Multiplayer Collaboration Hub (`CollaborationRoomHub`).
 * Synchronizes `GraphMods` deltas and live analyst cursors across local, WebSocket, or Durable Object peers.
 */
export class CollaborationRoomHub {
  private lamportCounter = 0;
  private readonly roomAnalysts = new Map<string, Map<string, AnalystPresence>>();
  private readonly roomDeltaHistory = new Map<string, SerializedGraphModsDelta[]>();
  private readonly appliedDeltaIdsByStore = new WeakMap<GraphStore, Set<string>>();
  private readonly roomSubscribers = new Map<
    string,
    Set<(delta: SerializedGraphModsDelta) => void>
  >();

  public joinRoom(
    roomId: string,
    analyst: Omit<AnalystPresence, 'lastActiveAt'>
  ): AnalystPresence[] {
    let members = this.roomAnalysts.get(roomId);
    if (!members) {
      members = new Map();
      this.roomAnalysts.set(roomId, members);
    }
    members.set(analyst.analystId, {
      ...analyst,
      lastActiveAt: Date.now(),
    });
    return Array.from(members.values());
  }

  public updatePresence(
    roomId: string,
    analystId: string,
    patch: Partial<Pick<AnalystPresence, 'cursorWorld' | 'selectedEntityIds' | 'forensicRank'>>
  ): AnalystPresence | null {
    const members = this.roomAnalysts.get(roomId);
    const existing = members?.get(analystId);
    if (!existing) return null;
    const updated: AnalystPresence = {
      ...existing,
      ...patch,
      lastActiveAt: Date.now(),
    };
    members!.set(analystId, updated);
    return updated;
  }

  public listRoomAnalysts(roomId: string): AnalystPresence[] {
    const members = this.roomAnalysts.get(roomId);
    return members ? Array.from(members.values()) : [];
  }

  public getRoomDeltaHistory(roomId: string): SerializedGraphModsDelta[] {
    return [...(this.roomDeltaHistory.get(roomId) ?? [])];
  }

  public subscribeRoom(
    roomId: string,
    listener: (delta: SerializedGraphModsDelta) => void
  ): () => void {
    let subs = this.roomSubscribers.get(roomId);
    if (!subs) {
      subs = new Set();
      this.roomSubscribers.set(roomId, subs);
    }
    subs.add(listener);
    return () => {
      subs?.delete(listener);
    };
  }

  /**
   * Serializes a consolidated `GraphMods` batch from `sourceStore` into a wire-ready `SerializedGraphModsDelta`.
   */
  public serializeModsToDelta(
    roomId: string,
    authorId: string,
    sourceStore: GraphStore,
    mods: GraphMods
  ): SerializedGraphModsDelta {
    this.lamportCounter += 1;

    const serializeEnt = (id: Guid) => {
      const ent =
        mods.dataMods.addedEntities.get(id) ??
        mods.dataMods.updatedEntities.get(id) ??
        sourceStore.dataStore.getEntity(id);
      const propsObj: Record<string, string> = {};
      for (const [k, v] of ent.properties.values.entries()) {
        propsObj[k] = String(v ?? '');
      }
      return {
        id: ent.id.toString(),
        typeName: ent.typeName,
        value: getPartPrimaryValue(ent),
        weight: ent.weight,
        bookmark: ent.bookmark,
        notes: { value: ent.notes.value, show: ent.notes.show },
        properties: propsObj,
        position: sourceStore.layoutStore.getPosition(ent.id),
        pinned: sourceStore.layoutStore.isPinned(ent.id),
      };
    };

    const addedEntities: SerializedEntityDelta[] = [];
    for (const id of mods.dataMods.addedEntities.keys()) {
      addedEntities.push(serializeEnt(id));
    }

    const updatedEntities: SerializedEntityDelta[] = [];
    for (const id of mods.dataMods.updatedEntities.keys()) {
      if (sourceStore.dataStore.hasEntity(id)) {
        updatedEntities.push(serializeEnt(id));
      }
    }

    const deletedEntityIds = Array.from(mods.dataMods.deletedEntities.values()).map((id) =>
      id.toString()
    );

    const addedLinks: SerializedLinkDelta[] = [];
    for (const [lid, ldata] of mods.dataMods.addedLinks.entries()) {
      const conn = mods.structureMods.connectedLinks.get(lid);
      if (!conn) continue;
      const colorVal = ldata.properties.values.get('maltego.link.color');
      addedLinks.push({
        id: lid.toString(),
        typeName: ldata.typeName,
        sourceId: conn.source.toString(),
        targetId: conn.target.toString(),
        label: getPartPrimaryValue(ldata),
        color: typeof colorVal === 'string' ? colorVal : '#38bdf8',
        weight: ldata.weight,
        isReversed: conn.isReversed,
        path: sourceStore.layoutStore.getLinkPath(lid),
      });
    }

    const deletedLinkIds = Array.from(mods.dataMods.deletedLinks.values()).map((id) =>
      id.toString()
    );

    const movedEntities: Array<{ id: string; position: Point3D }> = [];
    for (const [id, pos] of mods.layoutMods.movedEntities.entries()) {
      movedEntities.push({ id: id.toString(), position: { ...pos } });
    }

    const pinChangedEntities: Array<{ id: string; pinned: boolean }> = [];
    for (const [id, pinned] of mods.layoutMods.pinChangedEntities.entries()) {
      pinChangedEntities.push({ id: id.toString(), pinned });
    }

    return {
      deltaId: `delta-${this.lamportCounter}-${Guid.generate().toString()}`,
      roomId,
      authorId,
      lamportClock: this.lamportCounter,
      timestamp: mods.timestamp,
      addedEntities,
      updatedEntities,
      deletedEntityIds,
      addedLinks,
      deletedLinkIds,
      movedEntities,
      pinChangedEntities,
    };
  }

  /**
   * Publishes a delta to a collaboration room and notifies all subscribed peers with graceful error isolation.
   */
  public publishDelta(delta: SerializedGraphModsDelta): void {
    this.lamportCounter = Math.max(this.lamportCounter, delta.lamportClock);
    let history = this.roomDeltaHistory.get(delta.roomId);
    if (!history) {
      history = [];
      this.roomDeltaHistory.set(delta.roomId, history);
    }
    history.push(delta);

    const subs = this.roomSubscribers.get(delta.roomId);
    if (!subs) return;
    for (const listener of subs) {
      try {
        listener(delta);
      } catch (err) {
        console.error('[CollaborationRoomHub] Subscriber error isolated:', err);
      }
    }
  }

  /**
   * Applies an incoming `SerializedGraphModsDelta` idempotently onto `targetStore`.
   * Returns `true` if applied, or `false` if this `deltaId` was already applied.
   */
  public applyDeltaToStore(
    targetStore: GraphStore,
    delta: SerializedGraphModsDelta,
    registry: EntityRegistry
  ): boolean {
    let appliedSet = this.appliedDeltaIdsByStore.get(targetStore);
    if (!appliedSet) {
      appliedSet = new Set();
      this.appliedDeltaIdsByStore.set(targetStore, appliedSet);
    }
    if (appliedSet.has(delta.deltaId)) {
      return false;
    }
    appliedSet.add(delta.deltaId);

    targetStore.runInBatch(() => {
      for (const ent of delta.addedEntities) {
        const id = Guid.parse(ent.id);
        const created = registry.createEntity(ent.typeName, ent.value, {
          id,
          weight: ent.weight,
          bookmark: ent.bookmark,
          extraProperties: ent.properties,
        });
        created.notes = { ...ent.notes };
        if (targetStore.dataStore.hasEntity(id)) {
          targetStore.updateEntity(created);
          targetStore.setEntityPosition(id, ent.position);
          targetStore.setEntityPinned(id, ent.pinned);
        } else {
          targetStore.addEntity(created, ent.position, ent.pinned);
        }
      }

      for (const ent of delta.updatedEntities) {
        const id = Guid.parse(ent.id);
        if (!targetStore.dataStore.hasEntity(id)) continue;
        const updated = registry.createEntity(ent.typeName, ent.value, {
          id,
          weight: ent.weight,
          bookmark: ent.bookmark,
          extraProperties: ent.properties,
        });
        updated.notes = { ...ent.notes };
        targetStore.updateEntity(updated);
      }

      for (const lnk of delta.addedLinks) {
        const lid = Guid.parse(lnk.id);
        const srcId = Guid.parse(lnk.sourceId);
        const dstId = Guid.parse(lnk.targetId);
        if (
          !targetStore.dataStore.hasEntity(srcId) ||
          !targetStore.dataStore.hasEntity(dstId) ||
          targetStore.structureStore.hasLink(lid)
        ) {
          continue;
        }
        const linkData: MaltegoLinkData = {
          id: lid,
          typeName: lnk.typeName,
          weight: lnk.weight,
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
              value: lnk.label,
            },
            {
              descriptor: {
                name: 'maltego.link.color',
                displayName: 'Color',
                type: 'color',
                nullable: true,
                hidden: false,
                readonly: false,
                specialRoles: [],
                matchingRule: 'LOOSE',
              },
              value: lnk.color,
            },
          ]),
        };
        targetStore.addLink(linkData, srcId, dstId, lnk.isReversed, lnk.path);
      }

      for (const moved of delta.movedEntities) {
        const id = Guid.parse(moved.id);
        if (targetStore.dataStore.hasEntity(id)) {
          targetStore.setEntityPosition(id, moved.position);
        }
      }

      for (const pinChange of delta.pinChangedEntities) {
        const id = Guid.parse(pinChange.id);
        if (targetStore.dataStore.hasEntity(id)) {
          targetStore.setEntityPinned(id, pinChange.pinned);
        }
      }

      for (const delLinkId of delta.deletedLinkIds) {
        const lid = Guid.parse(delLinkId);
        if (targetStore.structureStore.hasLink(lid)) {
          targetStore.removeLink(lid);
        }
      }

      for (const delEntId of delta.deletedEntityIds) {
        const eid = Guid.parse(delEntId);
        if (targetStore.dataStore.hasEntity(eid)) {
          targetStore.removeEntity(eid);
        }
      }
    });

    return true;
  }
}
