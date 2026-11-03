import { GuidMap, type EntityID, type LinkID } from '../identity/Guid.js';
import {
  cloneEntityData,
  cloneLinkData,
  getPartPrimaryValue,
  type MaltegoEntityData,
  type MaltegoLinkData,
} from '../store/GraphDataStore.js';
import type { Point2D, Point3D } from '../store/GraphLayoutStore.js';
import type { GraphStore } from '../store/GraphStore.js';
import {
  StatelessMatchingRule,
  type EntityMatchingRule,
} from './MatchingRules.js';
import {
  mergeEntityData,
  mergeLinkData,
  type PartMergeStrategyMode,
} from './PartMergeStrategy.js';

export interface IncomingEntityRecord {
  data: MaltegoEntityData;
  position?: Point2D | Point3D;
  pinned?: boolean;
}

export interface IncomingLinkRecord {
  data: MaltegoLinkData;
  source: EntityID;
  target: EntityID;
  isReversed?: boolean;
  bends?: Point2D[];
}

export interface IncomingSubgraph {
  entities: Array<MaltegoEntityData | IncomingEntityRecord>;
  links?: IncomingLinkRecord[];
}

export interface MergeResult {
  addedEntities: EntityID[];
  mergedEntities: EntityID[];
  addedLinks: LinkID[];
  mergedLinks: LinkID[];
  /**
   * Maps every incoming `src` EntityID to its resolved `dest` EntityID in `targetStore`.
   */
  entityIdMap: GuidMap<EntityID>;
  elapsedMs: number;
}

function isIncomingEntityRecord(
  item: MaltegoEntityData | IncomingEntityRecord
): item is IncomingEntityRecord {
  return 'data' in item && typeof item.data === 'object' && item.data !== null && 'id' in item.data;
}

/**
 * High-throughput `StrategicGraphMerger` (`O(V + E)` hash-indexed identity resolution)
 * that coalesces incoming transform or file subgraphs into a `GraphStore` inside a single
 * atomic batch and undoable command.
 */
export class StrategicGraphMerger {
  private readonly matchingRule: EntityMatchingRule;

  public constructor(matchingRule: EntityMatchingRule = new StatelessMatchingRule()) {
    this.matchingRule = matchingRule;
  }

  private computeLinkIdentityKey(
    sourceId: EntityID,
    targetId: EntityID,
    linkData: MaltegoLinkData
  ): string {
    const label = getPartPrimaryValue(linkData).trim();
    return `${sourceId.toString()}->${targetId.toString()}::${linkData.typeName}::${label}`;
  }

  public merge(
    targetStore: GraphStore,
    incoming: IncomingSubgraph,
    strategy: PartMergeStrategyMode = 'Merge'
  ): MergeResult {
    const startTime = performance.now();

    const addedEntities: EntityID[] = [];
    const mergedEntities: EntityID[] = [];
    const addedLinks: LinkID[] = [];
    const mergedLinks: LinkID[] = [];
    const entityIdMap = new GuidMap<EntityID>();

    // Snapshots for atomic Undo/Redo of the entire merge operation
    const createdEntitySnapshots: Array<{
      data: MaltegoEntityData;
      pos: Point3D;
      pinned: boolean;
    }> = [];
    const updatedEntitySnapshots: Array<{
      before: MaltegoEntityData;
      after: MaltegoEntityData;
    }> = [];
    const createdLinkSnapshots: Array<{
      data: MaltegoLinkData;
      source: EntityID;
      target: EntityID;
      isReversed: boolean;
      bends: Point2D[];
    }> = [];
    const updatedLinkSnapshots: Array<{
      before: MaltegoLinkData;
      after: MaltegoLinkData;
    }> = [];

    // 1. Build O(1) identity index of existing entities in targetStore
    const entityIndex = new Map<string, EntityID>();
    for (const existing of targetStore.dataStore.getEntities().values()) {
      const key = this.matchingRule.computeIdentityKey(existing);
      if (key !== null && !entityIndex.has(key)) {
        entityIndex.set(key, existing.id);
      }
    }

    // 2. Build O(1) identity index of existing links in targetStore
    const linkIndex = new Map<string, LinkID>();
    for (const [linkId, edge] of targetStore.structureStore.links.entries()) {
      const linkData = targetStore.dataStore.tryGetLink(linkId);
      if (linkData) {
        const key = this.computeLinkIdentityKey(edge.source, edge.target, linkData);
        if (!linkIndex.has(key)) {
          linkIndex.set(key, linkId);
        }
      }
    }

    targetStore.runInBatch(() => {
      // Phase A: Resolve and merge/insert entities
      for (const item of incoming.entities) {
        const srcData = isIncomingEntityRecord(item) ? item.data : item;
        const rawPos = isIncomingEntityRecord(item) && item.position ? item.position : { x: 0, y: 0, z: 0 };
        const pos: Point3D = {
          x: rawPos.x,
          y: rawPos.y,
          z: 'z' in rawPos && typeof rawPos.z === 'number' ? rawPos.z : 0,
        };
        const pinned = isIncomingEntityRecord(item) && item.pinned ? item.pinned : false;

        // Check by ID first, then by semantic identity key
        let matchedDestId: EntityID | undefined = targetStore.dataStore.hasEntity(srcData.id)
          ? srcData.id
          : undefined;

        const identityKey = this.matchingRule.computeIdentityKey(srcData);
        if (!matchedDestId && identityKey !== null) {
          const candidateId = entityIndex.get(identityKey);
          if (candidateId) {
            const candidateEntity = targetStore.dataStore.getEntity(candidateId);
            if (this.matchingRule.matches(candidateEntity, srcData)) {
              matchedDestId = candidateId;
            }
          }
        }

        if (matchedDestId) {
          const destEntity = targetStore.dataStore.getEntity(matchedDestId);
          const beforeSnap = cloneEntityData(destEntity);
          const mergedData = mergeEntityData(destEntity, srcData, strategy);

          targetStore.dataStore.putEntity(mergedData);
          targetStore.pendingMods.recordEntityUpdated(mergedData);

          entityIdMap.set(srcData.id, matchedDestId);
          mergedEntities.push(matchedDestId);
          updatedEntitySnapshots.push({ before: beforeSnap, after: cloneEntityData(mergedData) });

          const updatedKey = this.matchingRule.computeIdentityKey(mergedData);
          if (updatedKey !== null) {
            entityIndex.set(updatedKey, matchedDestId);
          }
        } else {
          const newSnap = cloneEntityData(srcData);
          targetStore.dataStore.addEntity(newSnap);
          targetStore.structureStore.addEntity(newSnap.id);
          const normPos = targetStore.layoutStore.setPosition(newSnap.id, pos);
          targetStore.layoutStore.setPinned(newSnap.id, pinned);

          targetStore.pendingMods.recordEntityAdded(newSnap);
          targetStore.pendingMods.recordEntityMoved(newSnap.id, normPos);
          if (pinned) {
            targetStore.pendingMods.recordPinChanged(newSnap.id, true);
          }

          entityIdMap.set(srcData.id, newSnap.id);
          addedEntities.push(newSnap.id);
          createdEntitySnapshots.push({ data: newSnap, pos: normPos, pinned });

          if (identityKey !== null) {
            entityIndex.set(identityKey, newSnap.id);
          }
        }
      }

      // Phase B: Resolve endpoints and merge/insert links
      if (incoming.links) {
        for (const linkRec of incoming.links) {
          const resolvedSource = entityIdMap.get(linkRec.source) ?? linkRec.source;
          const resolvedTarget = entityIdMap.get(linkRec.target) ?? linkRec.target;
          const isReversed = linkRec.isReversed ?? false;
          const bends = linkRec.bends ? linkRec.bends.map((b) => ({ ...b })) : [];

          let matchedLinkId: LinkID | undefined = targetStore.dataStore.hasLink(linkRec.data.id)
            ? linkRec.data.id
            : undefined;

          const linkKey = this.computeLinkIdentityKey(resolvedSource, resolvedTarget, linkRec.data);
          if (!matchedLinkId) {
            matchedLinkId = linkIndex.get(linkKey);
          }

          if (matchedLinkId) {
            const destLink = targetStore.dataStore.getLink(matchedLinkId);
            const beforeSnap = cloneLinkData(destLink);
            const mergedLink = mergeLinkData(destLink, linkRec.data, strategy);

            targetStore.dataStore.putLink(mergedLink);
            targetStore.pendingMods.recordLinkUpdated(mergedLink);

            mergedLinks.push(matchedLinkId);
            updatedLinkSnapshots.push({ before: beforeSnap, after: cloneLinkData(mergedLink) });
          } else {
            const linkSnap = cloneLinkData(linkRec.data);
            targetStore.structureStore.addLink(
              linkSnap.id,
              resolvedSource,
              resolvedTarget,
              isReversed
            );
            targetStore.dataStore.addLink(linkSnap);
            if (bends.length > 0) {
              targetStore.layoutStore.setLinkPath(linkSnap.id, bends);
              targetStore.pendingMods.recordLinkRerouted(linkSnap.id, bends);
            }
            targetStore.pendingMods.recordLinkAdded(
              linkSnap,
              resolvedSource,
              resolvedTarget,
              isReversed
            );

            addedLinks.push(linkSnap.id);
            createdLinkSnapshots.push({
              data: linkSnap,
              source: resolvedSource,
              target: resolvedTarget,
              isReversed,
              bends,
            });
            linkIndex.set(linkKey, linkSnap.id);
          }
        }
      }
    });

    // Record composite Undo/Redo command if any changes occurred
    if (
      createdEntitySnapshots.length > 0 ||
      updatedEntitySnapshots.length > 0 ||
      createdLinkSnapshots.length > 0 ||
      updatedLinkSnapshots.length > 0
    ) {
      targetStore.undoRedoManager.record({
        description: `Merge subgraph (+${createdEntitySnapshots.length} entities, ~${updatedEntitySnapshots.length} merged)`,
        undo: () => {
          targetStore.runInBatch(() => {
            for (const linkItem of createdLinkSnapshots) {
              targetStore.structureStore.removeLink(linkItem.data.id);
              targetStore.dataStore.removeLink(linkItem.data.id);
              targetStore.layoutStore.removeLink(linkItem.data.id);
              targetStore.pendingMods.recordLinkDeleted(linkItem.data.id);
            }
            for (const updLink of updatedLinkSnapshots) {
              targetStore.dataStore.putLink(updLink.before);
              targetStore.pendingMods.recordLinkUpdated(updLink.before);
            }
            for (const entItem of createdEntitySnapshots) {
              targetStore.structureStore.removeEntity(entItem.data.id);
              targetStore.dataStore.removeEntity(entItem.data.id);
              targetStore.layoutStore.removeEntity(entItem.data.id);
              targetStore.pendingMods.recordEntityDeleted(entItem.data.id);
            }
            for (const updEnt of updatedEntitySnapshots) {
              targetStore.dataStore.putEntity(updEnt.before);
              targetStore.pendingMods.recordEntityUpdated(updEnt.before);
            }
          });
        },
        redo: () => {
          targetStore.runInBatch(() => {
            for (const entItem of createdEntitySnapshots) {
              targetStore.dataStore.addEntity(entItem.data);
              targetStore.structureStore.addEntity(entItem.data.id);
              targetStore.layoutStore.setPosition(entItem.data.id, entItem.pos);
              targetStore.layoutStore.setPinned(entItem.data.id, entItem.pinned);
              targetStore.pendingMods.recordEntityAdded(entItem.data);
              targetStore.pendingMods.recordEntityMoved(entItem.data.id, entItem.pos);
            }
            for (const updEnt of updatedEntitySnapshots) {
              targetStore.dataStore.putEntity(updEnt.after);
              targetStore.pendingMods.recordEntityUpdated(updEnt.after);
            }
            for (const linkItem of createdLinkSnapshots) {
              targetStore.structureStore.addLink(
                linkItem.data.id,
                linkItem.source,
                linkItem.target,
                linkItem.isReversed
              );
              targetStore.dataStore.addLink(linkItem.data);
              if (linkItem.bends.length > 0) {
                targetStore.layoutStore.setLinkPath(linkItem.data.id, linkItem.bends);
                targetStore.pendingMods.recordLinkRerouted(linkItem.data.id, linkItem.bends);
              }
              targetStore.pendingMods.recordLinkAdded(
                linkItem.data,
                linkItem.source,
                linkItem.target,
                linkItem.isReversed
              );
            }
            for (const updLink of updatedLinkSnapshots) {
              targetStore.dataStore.putLink(updLink.after);
              targetStore.pendingMods.recordLinkUpdated(updLink.after);
            }
          });
        },
      });
    }

    const elapsedMs = performance.now() - startTime;
    return {
      addedEntities,
      mergedEntities,
      addedLinks,
      mergedLinks,
      entityIdMap,
      elapsedMs,
    };
  }
}
