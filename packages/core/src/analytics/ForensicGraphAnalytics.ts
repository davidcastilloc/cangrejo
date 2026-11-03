import { GuidMap, GuidSet, type EntityID, type LinkID } from '../identity/Guid.js';
import type { GraphStore } from '../store/GraphStore.js';

export type ForensicCentralityTier = 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';

export interface ShortestForensicPathResult {
  found: boolean;
  sourceId: EntityID;
  targetId: EntityID;
  entityPath: EntityID[];
  linkPath: LinkID[];
  hopCount: number;
  totalCost: number;
}

export interface ForensicNodeCentrality {
  entityId: EntityID;
  score: number;
  percentile: number;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
  suggestedTier: ForensicCentralityTier;
}

export interface ForensicPageRankResult {
  rankings: ForensicNodeCentrality[];
  iterations: number;
  converged: boolean;
  totalScoreSum: number;
}

export interface DirectedCycleRing {
  cycleId: string;
  entityIds: EntityID[];
  linkIds: LinkID[];
  length: number;
}

export interface ForensicAnalyticsReport {
  nodeCount: number;
  edgeCount: number;
  pageRank: ForensicPageRankResult;
  cycles: DirectedCycleRing[];
  shortestPath: ShortestForensicPathResult | null;
}

interface InternalEdge {
  id: LinkID;
  source: EntityID;
  target: EntityID;
  cost: number;
}

function extractTopology(store: GraphStore): {
  entityIds: EntityID[];
  edges: InternalEdge[];
  outgoingByNode: GuidMap<InternalEdge[]>;
  undirectedByNode: GuidMap<Array<{ neighbor: EntityID; linkId: LinkID; cost: number }>>;
  inDegreeByNode: GuidMap<number>;
  outDegreeByNode: GuidMap<number>;
} {
  const entityIds: EntityID[] = [];
  const outgoingByNode = new GuidMap<InternalEdge[]>();
  const undirectedByNode = new GuidMap<
    Array<{ neighbor: EntityID; linkId: LinkID; cost: number }>
  >();
  const inDegreeByNode = new GuidMap<number>();
  const outDegreeByNode = new GuidMap<number>();

  for (const [id] of store.structureStore.entities) {
    entityIds.push(id);
    outgoingByNode.set(id, []);
    undirectedByNode.set(id, []);
    inDegreeByNode.set(id, 0);
    outDegreeByNode.set(id, 0);
  }

  const edges: InternalEdge[] = [];
  for (const [linkId, edge] of store.structureStore.links) {
    const src = edge.isReversed ? edge.target : edge.source;
    const dst = edge.isReversed ? edge.source : edge.target;
    if (!outgoingByNode.has(src) || !outgoingByNode.has(dst)) {
      continue;
    }
    let linkWeight = 1;
    if (store.dataStore.hasLink(linkId)) {
      const linkData = store.dataStore.getLink(linkId);
      linkWeight = Math.max(0.1, linkData.weight || 1);
    }
    const cost = 1 / linkWeight;
    const internalEdge: InternalEdge = { id: linkId, source: src, target: dst, cost };
    edges.push(internalEdge);
    outgoingByNode.get(src)!.push(internalEdge);
    outDegreeByNode.set(src, (outDegreeByNode.get(src) ?? 0) + 1);
    inDegreeByNode.set(dst, (inDegreeByNode.get(dst) ?? 0) + 1);

    undirectedByNode.get(src)!.push({ neighbor: dst, linkId, cost });
    if (!src.equals(dst)) {
      undirectedByNode.get(dst)!.push({ neighbor: src, linkId, cost });
    }
  }

  return {
    entityIds,
    edges,
    outgoingByNode,
    undirectedByNode,
    inDegreeByNode,
    outDegreeByNode,
  };
}

/**
 * Computes the shortest forensic path between `sourceId` and `targetId` (`Eslabón Dorado`)
 * using Dijkstra's algorithm over inverse link weights (or uniform hop distance when weights are equal).
 */
export function findShortestForensicPath(
  store: GraphStore,
  sourceId: EntityID,
  targetId: EntityID,
  options?: { directedOnly?: boolean }
): ShortestForensicPathResult {
  const directedOnly = options?.directedOnly ?? false;
  if (
    !store.structureStore.hasEntity(sourceId) ||
    !store.structureStore.hasEntity(targetId)
  ) {
    return {
      found: false,
      sourceId,
      targetId,
      entityPath: [],
      linkPath: [],
      hopCount: 0,
      totalCost: 0,
    };
  }

  if (sourceId.equals(targetId)) {
    return {
      found: true,
      sourceId,
      targetId,
      entityPath: [sourceId],
      linkPath: [],
      hopCount: 0,
      totalCost: 0,
    };
  }

  const { outgoingByNode, undirectedByNode } = extractTopology(store);
  const dist = new GuidMap<number>();
  const prevNode = new GuidMap<EntityID>();
  const prevLink = new GuidMap<LinkID>();
  const visited = new GuidSet();

  dist.set(sourceId, 0);
  const frontier: Array<{ id: EntityID; cost: number }> = [{ id: sourceId, cost: 0 }];

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost);
    const current = frontier.shift()!;
    if (visited.has(current.id)) {
      continue;
    }
    visited.add(current.id);

    if (current.id.equals(targetId)) {
      break;
    }

    if (directedOnly) {
      for (const edge of outgoingByNode.get(current.id) ?? []) {
        if (visited.has(edge.target)) continue;
        const candidateCost = current.cost + edge.cost;
        const knownCost = dist.get(edge.target) ?? Number.POSITIVE_INFINITY;
        if (candidateCost < knownCost) {
          dist.set(edge.target, candidateCost);
          prevNode.set(edge.target, current.id);
          prevLink.set(edge.target, edge.id);
          frontier.push({ id: edge.target, cost: candidateCost });
        }
      }
    } else {
      for (const adj of undirectedByNode.get(current.id) ?? []) {
        if (visited.has(adj.neighbor)) continue;
        const candidateCost = current.cost + adj.cost;
        const knownCost = dist.get(adj.neighbor) ?? Number.POSITIVE_INFINITY;
        if (candidateCost < knownCost) {
          dist.set(adj.neighbor, candidateCost);
          prevNode.set(adj.neighbor, current.id);
          prevLink.set(adj.neighbor, adj.linkId);
          frontier.push({ id: adj.neighbor, cost: candidateCost });
        }
      }
    }
  }

  if (!prevNode.has(targetId)) {
    return {
      found: false,
      sourceId,
      targetId,
      entityPath: [],
      linkPath: [],
      hopCount: 0,
      totalCost: 0,
    };
  }

  const entityPath: EntityID[] = [];
  const linkPath: LinkID[] = [];
  let cursor: EntityID | undefined = targetId;
  while (cursor !== undefined) {
    entityPath.push(cursor);
    const viaLink = prevLink.get(cursor);
    if (viaLink !== undefined) {
      linkPath.push(viaLink);
    }
    cursor = prevNode.get(cursor);
  }

  entityPath.reverse();
  linkPath.reverse();

  return {
    found: true,
    sourceId,
    targetId,
    entityPath,
    linkPath,
    hopCount: linkPath.length,
    totalCost: Number((dist.get(targetId) ?? linkPath.length).toFixed(4)),
  };
}

function classifyForensicTier(percentile: number, rankIndex: number, totalCount: number): ForensicCentralityTier {
  if (totalCount <= 1 || rankIndex === 0 || percentile >= 90) {
    return 'PLATINO';
  }
  if (percentile >= 70) {
    return 'ORO';
  }
  if (percentile >= 40) {
    return 'PLATA';
  }
  return 'BRONCE';
}

/**
 * Computes iterative PageRank + degree centrality over the graph, returning ranked entities
 * along with suggested Venezuelan Forensic Tiers (`PLATINO`, `ORO`, `PLATA`, `BRONCE`).
 */
export function computeForensicPageRank(
  store: GraphStore,
  options?: {
    damping?: number;
    maxIterations?: number;
    tolerance?: number;
  }
): ForensicPageRankResult {
  const { entityIds, outgoingByNode, inDegreeByNode, outDegreeByNode } = extractTopology(store);
  const n = entityIds.length;
  if (n === 0) {
    return {
      rankings: [],
      iterations: 0,
      converged: true,
      totalScoreSum: 0,
    };
  }

  const damping = options?.damping ?? 0.85;
  const maxIterations = options?.maxIterations ?? 30;
  const tolerance = options?.tolerance ?? 1e-6;

  // Build undirected/bidirectional transition links as well so star centers with either incoming or outgoing links rank highest
  const neighborsByIdx: number[][] = Array.from({ length: n }, () => []);
  const idxByEntity = new GuidMap<number>();
  entityIds.forEach((id, i) => idxByEntity.set(id, i));

  for (let i = 0; i < n; i++) {
    const uId = entityIds[i]!;
    for (const edge of outgoingByNode.get(uId) ?? []) {
      const vIdx = idxByEntity.get(edge.target);
      if (vIdx !== undefined && vIdx !== i) {
        neighborsByIdx[i]!.push(vIdx);
        neighborsByIdx[vIdx]!.push(i);
      }
    }
  }

  let ranks = new Float64Array(n).fill(1 / n);
  let nextRanks = new Float64Array(n);
  let iterationsRun = 0;
  let converged = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterationsRun = iter + 1;
    let danglingMass = 0;
    for (let i = 0; i < n; i++) {
      if (neighborsByIdx[i]!.length === 0) {
        danglingMass += ranks[i]!;
      }
    }

    const baseMass = (1 - damping) / n + (damping * danglingMass) / n;
    nextRanks.fill(baseMass);

    for (let i = 0; i < n; i++) {
      const adj = neighborsByIdx[i]!;
      if (adj.length === 0) continue;
      const share = (damping * ranks[i]!) / adj.length;
      for (const targetIdx of adj) {
        nextRanks[targetIdx] = nextRanks[targetIdx]! + share;
      }
    }

    let delta = 0;
    for (let i = 0; i < n; i++) {
      delta += Math.abs(nextRanks[i]! - ranks[i]!);
    }
    ranks.set(nextRanks);
    if (delta < tolerance) {
      converged = true;
      break;
    }
  }

  const rawEntries = entityIds.map((entityId, idx) => {
    const inDeg = inDegreeByNode.get(entityId) ?? 0;
    const outDeg = outDegreeByNode.get(entityId) ?? 0;
    return {
      entityId,
      score: Number(ranks[idx]!.toFixed(6)),
      inDegree: inDeg,
      outDegree: outDeg,
      totalDegree: inDeg + outDeg,
    };
  });

  rawEntries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.totalDegree - a.totalDegree;
  });

  const rankings: ForensicNodeCentrality[] = rawEntries.map((item, rankIdx) => {
    const percentile =
      n <= 1 ? 100 : Math.round(((n - 1 - rankIdx) / (n - 1)) * 100);
    return {
      ...item,
      percentile,
      suggestedTier: classifyForensicTier(percentile, rankIdx, n),
    };
  });

  const totalScoreSum = Number(
    rankings.reduce((acc, r) => acc + r.score, 0).toFixed(4)
  );

  return {
    rankings,
    iterations: iterationsRun,
    converged,
    totalScoreSum,
  };
}

function canonicalCycleKey(nodes: EntityID[]): string {
  if (nodes.length === 0) return '';
  const strs = nodes.map((id) => id.toString());
  let best = strs;
  for (let i = 1; i < strs.length; i++) {
    const rotated = [...strs.slice(i), ...strs.slice(0, i)];
    if (rotated.join('->') < best.join('->')) {
      best = rotated;
    }
  }
  return best.join('->');
}

/**
 * Detects elementary directed cycles (e.g., circular financial/command-and-control loops A -> B -> C -> A).
 */
export function detectDirectedCycles(
  store: GraphStore,
  maxCycles = 32
): DirectedCycleRing[] {
  const { entityIds, outgoingByNode } = extractTopology(store);
  const cycles: DirectedCycleRing[] = [];
  const seenKeys = new Set<string>();

  for (const startId of entityIds) {
    if (cycles.length >= maxCycles) break;

    const pathNodes: EntityID[] = [startId];
    const pathLinks: LinkID[] = [];
    const onStack = new GuidSet([startId]);

    const dfs = (currentId: EntityID, depth: number): void => {
      if (cycles.length >= maxCycles || depth > 8) return;
      for (const edge of outgoingByNode.get(currentId) ?? []) {
        if (edge.target.equals(startId) && pathNodes.length >= 2) {
          const key = canonicalCycleKey(pathNodes);
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            cycles.push({
              cycleId: `cycle-${cycles.length + 1}`,
              entityIds: [...pathNodes, startId],
              linkIds: [...pathLinks, edge.id],
              length: pathNodes.length,
            });
          }
        } else if (!onStack.has(edge.target)) {
          onStack.add(edge.target);
          pathNodes.push(edge.target);
          pathLinks.push(edge.id);
          dfs(edge.target, depth + 1);
          pathLinks.pop();
          pathNodes.pop();
          onStack.delete(edge.target);
        }
      }
    };

    dfs(startId, 1);
  }

  return cycles;
}

/**
 * Produces a unified forensic intelligence report (`ForensicAnalyticsReport`) combining
 * PageRank centrality, directed cycle rings, and optional Shortest Forensic Path (`Eslabón Dorado`).
 */
export function analyzeExpedienteForensics(
  store: GraphStore,
  options?: {
    sourceId?: EntityID;
    targetId?: EntityID;
    directedOnly?: boolean;
  }
): ForensicAnalyticsReport {
  const pageRank = computeForensicPageRank(store);
  const cycles = detectDirectedCycles(store);
  const shortestPath =
    options?.sourceId && options?.targetId
      ? findShortestForensicPath(store, options.sourceId, options.targetId, {
          directedOnly: options.directedOnly,
        })
      : null;

  return {
    nodeCount: store.entityCount,
    edgeCount: store.linkCount,
    pageRank,
    cycles,
    shortestPath,
  };
}
