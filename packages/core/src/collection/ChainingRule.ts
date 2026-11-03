import { GuidSet, type EntityID } from '../identity/Guid.js';
import type { GraphStore } from '../store/GraphStore.js';
import type { CandidateCluster } from './StandAloneRule.js';

/**
 * Rule 3: `ChainingCollectionRule` (Degree 2 Parallel Bridges).
 * Groups unpinned bridge entities with `inDegree == 1` and `outDegree == 1` connecting the exact same
 * `(srcNeighbor, trgNeighbor)` pair with the same link types.
 */
export function evaluateChainingCollectionRule(
  store: GraphStore,
  excludedIds: ReadonlySet<EntityID>,
  minRequiredEntitiesPerNode: number
): CandidateCluster[] {
  const buckets = new Map<string, { typeName: string; members: GuidSet }>();

  for (const [id, entity] of store.dataStore.getEntities().entries()) {
    if (excludedIds.has(id) || store.layoutStore.isPinned(id)) {
      continue;
    }
    const inLinks = store.structureStore.getIncomingLinks(id);
    const outLinks = store.structureStore.getOutgoingLinks(id);
    if (inLinks.size !== 1 || outLinks.size !== 1) {
      continue;
    }
    const inLinkId = inLinks.values().next().value!;
    const outLinkId = outLinks.values().next().value!;
    const inEdge = store.structureStore.getLinkEndpoints(inLinkId);
    const outEdge = store.structureStore.getLinkEndpoints(outLinkId);

    const srcNeighbor = inEdge.source;
    const trgNeighbor = outEdge.target;
    if (srcNeighbor.equals(id) || trgNeighbor.equals(id) || srcNeighbor.equals(trgNeighbor)) {
      continue;
    }

    const inLinkData = store.dataStore.tryGetLink(inLinkId);
    const outLinkData = store.dataStore.tryGetLink(outLinkId);
    const inType = inLinkData?.typeName ?? 'unknown';
    const outType = outLinkData?.typeName ?? 'unknown';

    const key = `chaining:${entity.typeName}:${srcNeighbor.toString()}->${trgNeighbor.toString()}:${inType}:${outType}`;
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
        ruleName: 'Chaining',
        groupKey: key,
        entityTypeName: entry.typeName,
        memberIds: entry.members,
      });
    }
  }
  return results;
}
