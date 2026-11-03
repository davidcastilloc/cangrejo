import { GuidSet, type EntityID } from '../identity/Guid.js';
import type { GraphStore } from '../store/GraphStore.js';

export interface CandidateCluster {
  readonly ruleName: 'StandAlone' | 'Neighbour' | 'Chaining';
  readonly groupKey: string;
  readonly entityTypeName: string;
  readonly memberIds: GuidSet;
}

/**
 * Rule 1: `StandAloneCollectionRule` (Degree 0 Orphans).
 * Groups unpinned entities that have 0 incoming and 0 outgoing links by `entity.typeName`.
 */
export function evaluateStandAloneCollectionRule(
  store: GraphStore,
  excludedIds: ReadonlySet<EntityID>,
  minRequiredEntitiesPerNode: number
): CandidateCluster[] {
  const buckets = new Map<string, GuidSet>();

  for (const [id, entity] of store.dataStore.getEntities().entries()) {
    if (excludedIds.has(id) || store.layoutStore.isPinned(id)) {
      continue;
    }
    if (store.structureStore.getDegree(id) !== 0) {
      continue;
    }
    let set = buckets.get(entity.typeName);
    if (!set) {
      set = new GuidSet();
      buckets.set(entity.typeName, set);
    }
    set.add(id);
  }

  const results: CandidateCluster[] = [];
  for (const [typeName, members] of buckets.entries()) {
    if (members.size >= minRequiredEntitiesPerNode) {
      results.push({
        ruleName: 'StandAlone',
        groupKey: `standalone:${typeName}`,
        entityTypeName: typeName,
        memberIds: members,
      });
    }
  }
  return results;
}
