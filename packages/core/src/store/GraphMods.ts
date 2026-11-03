import { GuidMap, GuidSet, type EntityID, type GraphID, type LinkID } from '../identity/Guid.js';
import {
  cloneEntityData,
  cloneLinkData,
  type MaltegoEntityData,
  type MaltegoLinkData,
} from './GraphDataStore.js';
import type { Point2D, Point3D } from './GraphLayoutStore.js';

export interface GraphMods {
  graphId: GraphID;
  timestamp: number;
  dataMods: {
    addedEntities: ReadonlyMap<EntityID, MaltegoEntityData>;
    updatedEntities: ReadonlyMap<EntityID, MaltegoEntityData>;
    deletedEntities: ReadonlySet<EntityID>;
    addedLinks: ReadonlyMap<LinkID, MaltegoLinkData>;
    updatedLinks: ReadonlyMap<LinkID, MaltegoLinkData>;
    deletedLinks: ReadonlySet<LinkID>;
  };
  structureMods: {
    connectedLinks: ReadonlyMap<LinkID, { source: EntityID; target: EntityID; isReversed: boolean }>;
    disconnectedLinks: ReadonlySet<LinkID>;
  };
  layoutMods: {
    movedEntities: ReadonlyMap<EntityID, Point3D>;
    reroutedLinks: ReadonlyMap<LinkID, Point2D[]>;
    pinChangedEntities: ReadonlyMap<EntityID, boolean>;
  };
}

/**
 * Delta-consolidating accumulator for `GraphMods` inside nested `BatchUpdatable` scopes.
 */
export class GraphModsAccumulator {
  private readonly addedEntities = new GuidMap<MaltegoEntityData>();
  private readonly updatedEntities = new GuidMap<MaltegoEntityData>();
  private readonly deletedEntities = new GuidSet();

  private readonly addedLinks = new GuidMap<MaltegoLinkData>();
  private readonly updatedLinks = new GuidMap<MaltegoLinkData>();
  private readonly deletedLinks = new GuidSet();

  private readonly connectedLinks = new GuidMap<{ source: EntityID; target: EntityID; isReversed: boolean }>();
  private readonly disconnectedLinks = new GuidSet();

  private readonly movedEntities = new GuidMap<Point3D>();
  private readonly reroutedLinks = new GuidMap<Point2D[]>();
  private readonly pinChangedEntities = new GuidMap<boolean>();

  public isEmpty(): boolean {
    return (
      this.addedEntities.size === 0 &&
      this.updatedEntities.size === 0 &&
      this.deletedEntities.size === 0 &&
      this.addedLinks.size === 0 &&
      this.updatedLinks.size === 0 &&
      this.deletedLinks.size === 0 &&
      this.connectedLinks.size === 0 &&
      this.disconnectedLinks.size === 0 &&
      this.movedEntities.size === 0 &&
      this.reroutedLinks.size === 0 &&
      this.pinChangedEntities.size === 0
    );
  }

  public recordEntityAdded(entity: MaltegoEntityData): void {
    this.deletedEntities.delete(entity.id);
    this.updatedEntities.delete(entity.id);
    this.addedEntities.set(entity.id, cloneEntityData(entity));
  }

  public recordEntityUpdated(entity: MaltegoEntityData): void {
    if (this.addedEntities.has(entity.id)) {
      this.addedEntities.set(entity.id, cloneEntityData(entity));
    } else if (!this.deletedEntities.has(entity.id)) {
      this.updatedEntities.set(entity.id, cloneEntityData(entity));
    }
  }

  public recordEntityDeleted(entityId: EntityID): void {
    this.updatedEntities.delete(entityId);
    this.movedEntities.delete(entityId);
    this.pinChangedEntities.delete(entityId);
    if (this.addedEntities.has(entityId)) {
      // Added and deleted within the same batch: net effect is no-op
      this.addedEntities.delete(entityId);
    } else {
      this.deletedEntities.add(entityId);
    }
  }

  public recordLinkAdded(link: MaltegoLinkData, source: EntityID, target: EntityID, isReversed = false): void {
    this.deletedLinks.delete(link.id);
    this.updatedLinks.delete(link.id);
    this.disconnectedLinks.delete(link.id);
    this.addedLinks.set(link.id, cloneLinkData(link));
    this.connectedLinks.set(link.id, { source, target, isReversed });
  }

  public recordLinkUpdated(link: MaltegoLinkData): void {
    if (this.addedLinks.has(link.id)) {
      this.addedLinks.set(link.id, cloneLinkData(link));
    } else if (!this.deletedLinks.has(link.id)) {
      this.updatedLinks.set(link.id, cloneLinkData(link));
    }
  }

  public recordLinkDeleted(linkId: LinkID): void {
    this.updatedLinks.delete(linkId);
    this.reroutedLinks.delete(linkId);
    if (this.addedLinks.has(linkId)) {
      this.addedLinks.delete(linkId);
      this.connectedLinks.delete(linkId);
    } else {
      this.deletedLinks.add(linkId);
      this.connectedLinks.delete(linkId);
      this.disconnectedLinks.add(linkId);
    }
  }

  public recordEntityMoved(entityId: EntityID, position: Point3D): void {
    if (!this.deletedEntities.has(entityId)) {
      this.movedEntities.set(entityId, { ...position });
    }
  }

  public recordLinkRerouted(linkId: LinkID, bends: Point2D[]): void {
    if (!this.deletedLinks.has(linkId)) {
      this.reroutedLinks.set(
        linkId,
        bends.map((p) => ({ ...p }))
      );
    }
  }

  public recordPinChanged(entityId: EntityID, pinned: boolean): void {
    if (!this.deletedEntities.has(entityId)) {
      this.pinChangedEntities.set(entityId, pinned);
    }
  }

  public consolidate(graphId: GraphID): GraphMods {
    return {
      graphId,
      timestamp: Date.now(),
      dataMods: {
        addedEntities: new GuidMap(this.addedEntities.entries()),
        updatedEntities: new GuidMap(this.updatedEntities.entries()),
        deletedEntities: this.deletedEntities.clone(),
        addedLinks: new GuidMap(this.addedLinks.entries()),
        updatedLinks: new GuidMap(this.updatedLinks.entries()),
        deletedLinks: this.deletedLinks.clone(),
      },
      structureMods: {
        connectedLinks: new GuidMap(this.connectedLinks.entries()),
        disconnectedLinks: this.disconnectedLinks.clone(),
      },
      layoutMods: {
        movedEntities: new GuidMap(this.movedEntities.entries()),
        reroutedLinks: new GuidMap(this.reroutedLinks.entries()),
        pinChangedEntities: new GuidMap(this.pinChangedEntities.entries()),
      },
    };
  }

  public clear(): void {
    this.addedEntities.clear();
    this.updatedEntities.clear();
    this.deletedEntities.clear();
    this.addedLinks.clear();
    this.updatedLinks.clear();
    this.deletedLinks.clear();
    this.connectedLinks.clear();
    this.disconnectedLinks.clear();
    this.movedEntities.clear();
    this.reroutedLinks.clear();
    this.pinChangedEntities.clear();
  }
}
