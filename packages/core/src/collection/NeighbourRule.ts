import { GuidSet, type EntityID } from '../identity/Guid.js';
import type { GraphStore } from '../store/GraphStore.js';
import type { CandidateCluster } from './StandAloneRule.js';

/**
 * Rule 2: `NeighbourCollectionRule` (Degree 1 Leaves & Multigraph Leaf Clusters).
 * Groups unpinned entities connected to exactly 1 distinct neighbor by
 * `(entity.typeName, neighborId, directionSignature, linkTypeSignature)`.
 */
export function evaluateNeighbourCollectionRule(
  store: GraphStore,
  excludedIds: ReadonlySet<EntityID>,
  minRequiredEntitiesPerNode: number
): CandidateCluster[] {
  const buckets = new Map<string, { typeName: string; members: GuidSet }>();

  for (const [id, entity] of store.dataStore.getEntities().entries()) {
    if (excludedIds.has(id) || store.layoutStore.isPinned(id)) {
      continue;
    }
    const neighbors = store.structureStore.getNeighbors(id);
    if (neighbors.size !== 1) {
      continue;
    }
    const neighborId = neighbors.values().next().value!;
    const inLinks = store.structureStore.getIncomingLinks(id);
    const outLinks = store.structureStore.getOutgoingLinks(id);

    const linkSigs: string[] = [];
    for (const lid of inLinks) {
      const lData = store.dataStore.tryGetLink(lid);
      if (lData) linkSigs.push(`IN:${lData.typeName}`);
    }
    for (const lid of outLinks) {
      const lData = store.dataStore.tryGetLink(lid);
      if (lData) linkSigs.push(`OUT:${lData.typeName}`);
    }
    linkSigs.sort();
    // Deduplicate multigraph parallel edges of the same direction + type so multigraph leaves still cluster
    const uniqSig = Array.from(new Set(linkSigs)).join('|');
    const key = `neighbour:${entity.typeName}:${neighborId.toString()}:${uniqSig}`;

    let entry = buckets.get(key);
    if (!entry) {
      entry = { typeName: entity.typeName, members: new GuidSet() };
      buckets.set(key, entry);
    }
    entry.members.add(id);
  }

  const results: CandidateCluster[] = [];
  for (const [key, entry] of buckets.entries()) {
    if (entry.members.size >= minRequiredEntitiesPerNode) {
      results.push({
        ruleName: 'Neighbour',
        groupKey: key,
        entityTypeName: entry.typeName,
        memberIds: entry.members,
      });
    }
  }
  return results;
}
