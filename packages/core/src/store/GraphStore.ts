import { Guid, type EntityID, type GraphID, type LinkID } from '../identity/Guid.js';
import { AbstractBatchUpdatable } from './BatchUpdatable.js';
import {
  GraphDataStore,
  cloneEntityData,
  cloneLinkData,
  type MaltegoEntityData,
  type MaltegoLinkData,
} from './GraphDataStore.js';
import { GraphLayoutStore, type Point2D, type Point3D } from './GraphLayoutStore.js';
import { GraphStructureStore } from './GraphStructureStore.js';

export interface UndoableCommand {
  readonly description: string;
  undo(): void;
  redo(): void;
}

/**
 * Bounded LIFO Undo/Redo stack (`GraphViewUndoRedoManager`) supporting up to `maxCapacity` (default: 100) operations.
 */
export class GraphViewUndoRedoManager {
  private readonly undoStack: UndoableCommand[] = [];
  private readonly redoStack: UndoableCommand[] = [];
  private readonly maxCapacity: number;
  private isExecutingUndoRedo = false;

  public constructor(maxCapacity = 100) {
    this.maxCapacity = maxCapacity;
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public get undoCount(): number {
    return this.undoStack.length;
  }

  public get redoCount(): number {
    return this.redoStack.length;
  }

  public record(command: UndoableCommand): void {
    if (this.isExecutingUndoRedo) return;
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxCapacity) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  public undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    this.isExecutingUndoRedo = true;
    try {
      cmd.undo();
      this.redoStack.push(cmd);
      return true;
    } finally {
      this.isExecutingUndoRedo = false;
    }
  }

  public redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    this.isExecutingUndoRedo = true;
    try {
      cmd.redo();
      this.undoStack.push(cmd);
      return true;
    } finally {
      this.isExecutingUndoRedo = false;
    }
  }

  public clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

/**
 * Unified Tripartite Graph Engine (`GraphStore`) coordinating `GraphDataStore`,
 * `GraphStructureStore`, and `GraphLayoutStore` with atomic batching and undo/redo support.
 */
export class GraphStore extends AbstractBatchUpdatable {
  public readonly graphId: GraphID;
  public readonly dataStore = new GraphDataStore();
  public readonly structureStore = new GraphStructureStore();
  public readonly layoutStore = new GraphLayoutStore();
  public readonly undoRedoManager: GraphViewUndoRedoManager;

  public constructor(graphId: GraphID = Guid.generate(), maxUndoCapacity = 100) {
    super();
    this.graphId = graphId;
    this.undoRedoManager = new GraphViewUndoRedoManager(maxUndoCapacity);
  }

  public get entityCount(): number {
    return this.dataStore.entityCount;
  }

  public get linkCount(): number {
    return this.dataStore.linkCount;
  }

  /**
   * Atomically registers an entity across Data, Structure, and Layout stores.
   */
  public addEntity(
    entity: MaltegoEntityData,
    position: Point2D | Point3D = { x: 0, y: 0, z: 0 },
    pinned = false
  ): void {
    const entitySnap = cloneEntityData(entity);
    const posSnap: Point3D = {
      x: position.x,
      y: position.y,
      z: 'z' in position && typeof position.z === 'number' ? position.z : 0,
    };

    const applyAdd = () => {
      this.runInBatch(() => {
        this.dataStore.addEntity(entitySnap);
        this.structureStore.addEntity(entitySnap.id);
        const normPos = this.layoutStore.setPosition(entitySnap.id, posSnap);
        this.layoutStore.setPinned(entitySnap.id, pinned);
        this.pendingMods.recordEntityAdded(entitySnap);
        this.pendingMods.recordEntityMoved(entitySnap.id, normPos);
        if (pinned) {
          this.pendingMods.recordPinChanged(entitySnap.id, true);
        }
      });
    };

    const applyRemove = () => {
      this.removeEntity(entitySnap.id);
    };

    applyAdd();
    this.undoRedoManager.record({
      description: `Add entity ${entitySnap.typeName} (${entitySnap.id.toString()})`,
      undo: applyRemove,
      redo: applyAdd,
    });
  }

  /**
   * Updates an existing entity's semantic data in `GraphDataStore`.
   */
  public updateEntity(entity: MaltegoEntityData): void {
    const previous = cloneEntityData(this.dataStore.getEntity(entity.id));
    const next = cloneEntityData(entity);

    const applyNext = () => {
      this.runInBatch(() => {
        this.dataStore.putEntity(next);
        this.pendingMods.recordEntityUpdated(next);
      });
    };

    const applyPrev = () => {
      this.runInBatch(() => {
        this.dataStore.putEntity(previous);
        this.pendingMods.recordEntityUpdated(previous);
      });
    };

    applyNext();
    this.undoRedoManager.record({
      description: `Update entity ${next.id.toString()}`,
      undo: applyPrev,
      redo: applyNext,
    });
  }

  /**
   * Atomically removes an entity and cascades deletion to all incident links across all 3 stores.
   */
  public removeEntity(entityId: EntityID): void {
    const existingEntity = this.dataStore.tryGetEntity(entityId);
    if (!existingEntity) return;

    const entitySnap = cloneEntityData(existingEntity);
    const posSnap = this.layoutStore.getPosition(entityId);
    const pinnedSnap = this.layoutStore.isPinned(entityId);

    const incidentIds = this.structureStore.getIncidentLinks(entityId);
    const removedLinksSnap: Array<{
      data: MaltegoLinkData;
      source: EntityID;
      target: EntityID;
      isReversed: boolean;
      path: Point2D[];
    }> = [];

    for (const linkId of incidentIds) {
      const linkData = this.dataStore.tryGetLink(linkId);
      const edge = this.structureStore.links.get(linkId);
      if (linkData && edge) {
        removedLinksSnap.push({
          data: cloneLinkData(linkData),
          source: edge.source,
          target: edge.target,
          isReversed: edge.isReversed,
          path: this.layoutStore.getLinkPath(linkId),
        });
      }
    }

    const applyRemove = () => {
      this.runInBatch(() => {
        const cascadedLinks = this.structureStore.removeEntity(entityId);
        for (const lid of cascadedLinks) {
          this.dataStore.removeLink(lid);
          this.layoutStore.removeLink(lid);
          this.pendingMods.recordLinkDeleted(lid);
        }
        this.dataStore.removeEntity(entityId);
        this.layoutStore.removeEntity(entityId);
        this.pendingMods.recordEntityDeleted(entityId);
      });
    };

    const applyRestore = () => {
      this.runInBatch(() => {
        this.dataStore.addEntity(entitySnap);
        this.structureStore.addEntity(entitySnap.id);
        const normPos = this.layoutStore.setPosition(entitySnap.id, posSnap);
        this.layoutStore.setPinned(entitySnap.id, pinnedSnap);
        this.pendingMods.recordEntityAdded(entitySnap);
        this.pendingMods.recordEntityMoved(entitySnap.id, normPos);
        if (pinnedSnap) {
          this.pendingMods.recordPinChanged(entitySnap.id, true);
        }

        for (const item of removedLinksSnap) {
          this.dataStore.addLink(item.data);
          this.structureStore.addLink(item.data.id, item.source, item.target, item.isReversed);
          this.layoutStore.setLinkPath(item.data.id, item.path);
          this.pendingMods.recordLinkAdded(item.data, item.source, item.target, item.isReversed);
          if (item.path.length > 0) {
            this.pendingMods.recordLinkRerouted(item.data.id, item.path);
          }
        }
      });
    };

    applyRemove();
    this.undoRedoManager.record({
      description: `Remove entity ${entityId.toString()}`,
      undo: applyRestore,
      redo: applyRemove,
    });
  }

  /**
   * Atomically adds a directed link connecting `source` and `target`.
   * Throws `DanglingLinkException` if either endpoint is missing in `GraphStructureStore`.
   */
  public addLink(
    link: MaltegoLinkData,
    source: EntityID,
    target: EntityID,
    isReversed = false,
    bends: Point2D[] = []
  ): void {
    const linkSnap = cloneLinkData(link);
    const bendsSnap = bends.map((b) => ({ ...b }));

    const applyAdd = () => {
      this.runInBatch(() => {
        // Validate structure first so DanglingLinkException is thrown before mutating dataStore
        this.structureStore.addLink(linkSnap.id, source, target, isReversed);
        this.dataStore.addLink(linkSnap);
        if (bendsSnap.length > 0) {
          this.layoutStore.setLinkPath(linkSnap.id, bendsSnap);
          this.pendingMods.recordLinkRerouted(linkSnap.id, bendsSnap);
        }
        this.pendingMods.recordLinkAdded(linkSnap, source, target, isReversed);
      });
    };

    const applyRemove = () => {
      this.removeLink(linkSnap.id);
    };

    applyAdd();
    this.undoRedoManager.record({
      description: `Add link ${linkSnap.id.toString()}`,
      undo: applyRemove,
      redo: applyAdd,
    });
  }

  public updateLink(link: MaltegoLinkData): void {
    const previous = cloneLinkData(this.dataStore.getLink(link.id));
    const next = cloneLinkData(link);

    const applyNext = () => {
      this.runInBatch(() => {
        this.dataStore.putLink(next);
        this.pendingMods.recordLinkUpdated(next);
      });
    };

    const applyPrev = () => {
      this.runInBatch(() => {
        this.dataStore.putLink(previous);
        this.pendingMods.recordLinkUpdated(previous);
      });
    };

    applyNext();
    this.undoRedoManager.record({
      description: `Update link ${next.id.toString()}`,
      undo: applyPrev,
      redo: applyNext,
    });
  }

  public removeLink(linkId: LinkID): void {
    const existingLink = this.dataStore.tryGetLink(linkId);
    const edge = this.structureStore.links.get(linkId);
    if (!existingLink || !edge) return;

    const linkSnap = cloneLinkData(existingLink);
    const sourceSnap = edge.source;
    const targetSnap = edge.target;
    const reversedSnap = edge.isReversed;
    const bendsSnap = this.layoutStore.getLinkPath(linkId);

    const applyRemove = () => {
      this.runInBatch(() => {
        this.structureStore.removeLink(linkId);
        this.dataStore.removeLink(linkId);
        this.layoutStore.removeLink(linkId);
        this.pendingMods.recordLinkDeleted(linkId);
      });
    };

    const applyRestore = () => {
      this.runInBatch(() => {
        this.structureStore.addLink(linkSnap.id, sourceSnap, targetSnap, reversedSnap);
        this.dataStore.addLink(linkSnap);
        if (bendsSnap.length > 0) {
          this.layoutStore.setLinkPath(linkSnap.id, bendsSnap);
          this.pendingMods.recordLinkRerouted(linkSnap.id, bendsSnap);
        }
        this.pendingMods.recordLinkAdded(linkSnap, sourceSnap, targetSnap, reversedSnap);
      });
    };

    applyRemove();
    this.undoRedoManager.record({
      description: `Remove link ${linkId.toString()}`,
      undo: applyRestore,
      redo: applyRemove,
    });
  }

  /**
   * Atomically swaps a link's `source` and `target` endpoints inside a single undoable command.
   */
  public reverseLink(linkId: LinkID): void {
    const existingLink = this.dataStore.tryGetLink(linkId);
    const edge = this.structureStore.links.get(linkId);
    if (!existingLink || !edge) return;

    const linkSnap = cloneLinkData(existingLink);
    const sourceSnap = edge.source;
    const targetSnap = edge.target;
    const reversedSnap = edge.isReversed;
    const bendsSnap = this.layoutStore.getLinkPath(linkId);

    const applyDirection = (src: EntityID, dst: EntityID) => {
      this.runInBatch(() => {
        this.structureStore.removeLink(linkId);
        this.structureStore.addLink(linkSnap.id, src, dst, reversedSnap);
        this.dataStore.putLink(linkSnap);
        if (bendsSnap.length > 0) {
          this.layoutStore.setLinkPath(linkSnap.id, bendsSnap);
        }
        this.pendingMods.recordLinkAdded(linkSnap, src, dst, reversedSnap);
      });
    };

    const applyForward = () => applyDirection(targetSnap, sourceSnap);
    const applyUndo = () => applyDirection(sourceSnap, targetSnap);

    applyForward();
    this.undoRedoManager.record({
      description: `Reverse link ${linkId.toString()}`,
      undo: applyUndo,
      redo: applyForward,
    });
  }

  public setEntityPosition(entityId: EntityID, position: Point2D | Point3D): void {
    const prevPos = this.layoutStore.getPosition(entityId);
    const nextPos: Point3D = {
      x: position.x,
      y: position.y,
      z: 'z' in position && typeof position.z === 'number' ? position.z : 0,
    };

    const applyNext = () => {
      this.runInBatch(() => {
        const norm = this.layoutStore.setPosition(entityId, nextPos);
        this.pendingMods.recordEntityMoved(entityId, norm);
      });
    };

    const applyPrev = () => {
      this.runInBatch(() => {
        const norm = this.layoutStore.setPosition(entityId, prevPos);
        this.pendingMods.recordEntityMoved(entityId, norm);
      });
    };

    applyNext();
    this.undoRedoManager.record({
      description: `Move entity ${entityId.toString()}`,
      undo: applyPrev,
      redo: applyNext,
    });
  }

  public setEntityPinned(entityId: EntityID, pinned: boolean): void {
    const prev = this.layoutStore.isPinned(entityId);
    if (prev === pinned) return;

    const applyNext = () => {
      this.runInBatch(() => {
        this.layoutStore.setPinned(entityId, pinned);
        this.pendingMods.recordPinChanged(entityId, pinned);
      });
    };

    const applyPrev = () => {
      this.runInBatch(() => {
        this.layoutStore.setPinned(entityId, prev);
        this.pendingMods.recordPinChanged(entityId, prev);
      });
    };

    applyNext();
    this.undoRedoManager.record({
      description: `Set pin=${pinned} on entity ${entityId.toString()}`,
      undo: applyPrev,
      redo: applyNext,
    });
  }

  public clear(): void {
    this.dataStore.clear();
    this.structureStore.clear();
    this.layoutStore.clear();
    this.pendingMods.clear();
    this.undoRedoManager.clear();
  }
}
