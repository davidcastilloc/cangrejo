import { LAYOUT_NODE_STRIDE_FLOATS } from './WebGPULayoutRunner.js';

interface QuadNode {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  comX: number;
  comY: number;
  totalMass: number;
  bodyIndex: number; // -1 if internal node or empty
  children: [QuadNode | null, QuadNode | null, QuadNode | null, QuadNode | null] | null;
}

function createQuadNode(minX: number, minY: number, maxX: number, maxY: number): QuadNode {
  return {
    minX,
    minY,
    maxX,
    maxY,
    comX: 0,
    comY: 0,
    totalMass: 0,
    bodyIndex: -1,
    children: null,
  };
}

function insertIntoQuadtree(
  root: QuadNode,
  bodyIdx: number,
  bx: number,
  by: number,
  bmass: number,
  depth = 0
): void {
  if (root.totalMass === 0 && root.children === null) {
    root.comX = bx;
    root.comY = by;
    root.totalMass = bmass;
    root.bodyIndex = bodyIdx;
    return;
  }

  // Update center of mass
  const nextMass = root.totalMass + bmass;
  root.comX = (root.comX * root.totalMass + bx * bmass) / nextMass;
  root.comY = (root.comY * root.totalMass + by * bmass) / nextMass;
  root.totalMass = nextMass;

  if (depth >= 14) {
    return;
  }

  const midX = (root.minX + root.maxX) * 0.5;
  const midY = (root.minY + root.maxY) * 0.5;

  if (root.children === null) {
    root.children = [
      createQuadNode(root.minX, root.minY, midX, midY),
      createQuadNode(midX, root.minY, root.maxX, midY),
      createQuadNode(root.minX, midY, midX, root.maxY),
      createQuadNode(midX, midY, root.maxX, root.maxY),
    ];
    if (root.bodyIndex !== -1) {
      const oldIdx = root.bodyIndex;
      root.bodyIndex = -1;
      const oldQuad = (root.comX >= midX ? 1 : 0) + (root.comY >= midY ? 2 : 0);
      insertIntoQuadtree(root.children[oldQuad]!, oldIdx, root.comX, root.comY, bmass, depth + 1);
    }
  }

  const quadIdx = (bx >= midX ? 1 : 0) + (by >= midY ? 2 : 0);
  insertIntoQuadtree(root.children[quadIdx]!, bodyIdx, bx, by, bmass, depth + 1);
}

function accumulateBarnesHutForce(
  node: QuadNode,
  targetIdx: number,
  tx: number,
  ty: number,
  tmass: number,
  theta: number,
  repulsionConstant: number,
  outForce: { fx: number; fy: number }
): void {
  if (node.totalMass === 0 || (node.bodyIndex === targetIdx && node.children === null)) {
    return;
  }

  const dx = tx - node.comX;
  const dy = ty - node.comY;
  const distSq = Math.max(100.0, dx * dx + dy * dy);
  const dist = Math.sqrt(distSq);
  const regionWidth = node.maxX - node.minX;

  if (node.children === null || regionWidth / dist < theta) {
    const f = (repulsionConstant * tmass * node.totalMass) / distSq;
    outForce.fx += (dx / dist) * f;
    outForce.fy += (dy / dist) * f;
    return;
  }

  for (let c = 0; c < 4; c++) {
    const child = node.children[c];
    if (child && child.totalMass > 0) {
      accumulateBarnesHutForce(
        child,
        targetIdx,
        tx,
        ty,
        tmass,
        theta,
        repulsionConstant,
        outForce
      );
    }
  }
}

export type LayoutMode = 'organic' | 'hierarchical' | 'circular' | 'block' | 'interactive';

/**
 * Tier 2 Layout Runner (`WasmWorkerLayoutRunner`).
 * Implements Barnes-Hut Quadtree O(V log V) ForceAtlas2, Sugiyama Hierarchical DAG,
 * Circular, and Block Grid layouts operating over zero-copy Transferable Float32Array buffers.
 */
export class WasmWorkerLayoutRunner {
  public runBarnesHutForceAtlas2(
    nodeStateBuffer: Float32Array,
    edgeIndexBuffer: Uint32Array,
    options?: {
      iterations?: number;
      theta?: number;
      repulsionConstant?: number;
      springConstant?: number;
      idealEdgeLength?: number;
      damping?: number;
      timeStep?: number;
    }
  ): { elapsedMs: number; iterationsRun: number } {
    const iterations = options?.iterations ?? 25;
    const theta = options?.theta ?? 0.8;
    const repulsion = options?.repulsionConstant ?? 6000.0;
    const springK = options?.springConstant ?? 0.08;
    const idealLen = options?.idealEdgeLength ?? 140.0;
    const damping = options?.damping ?? 0.85;
    const dt = options?.timeStep ?? 0.15;

    const nodeCount = Math.floor(nodeStateBuffer.length / LAYOUT_NODE_STRIDE_FLOATS);
    const edgeCount = Math.floor(edgeIndexBuffer.length / 2);
    const t0 = performance.now();

    const forcesX = new Float32Array(nodeCount);
    const forcesY = new Float32Array(nodeCount);
    const forceAcc = { fx: 0, fy: 0 };

    for (let it = 0; it < iterations; it++) {
      let minX = -1000;
      let minY = -1000;
      let maxX = 1000;
      let maxY = 1000;

      for (let i = 0; i < nodeCount; i++) {
        const base = i * LAYOUT_NODE_STRIDE_FLOATS;
        const x = nodeStateBuffer[base + 0]!;
        const y = nodeStateBuffer[base + 1]!;
        if (x < minX) minX = x - 10;
        if (y < minY) minY = y - 10;
        if (x > maxX) maxX = x + 10;
        if (y > maxY) maxY = y + 10;
      }

      const root = createQuadNode(minX, minY, maxX, maxY);
      for (let i = 0; i < nodeCount; i++) {
        const base = i * LAYOUT_NODE_STRIDE_FLOATS;
        insertIntoQuadtree(
          root,
          i,
          nodeStateBuffer[base + 0]!,
          nodeStateBuffer[base + 1]!,
          Math.max(1.0, nodeStateBuffer[base + 4]!)
        );
      }

      for (let i = 0; i < nodeCount; i++) {
        const base = i * LAYOUT_NODE_STRIDE_FLOATS;
        if (nodeStateBuffer[base + 5]! !== 0) {
          forcesX[i] = 0;
          forcesY[i] = 0;
          continue;
        }
        forceAcc.fx = 0;
        forceAcc.fy = 0;
        accumulateBarnesHutForce(
          root,
          i,
          nodeStateBuffer[base + 0]!,
          nodeStateBuffer[base + 1]!,
          Math.max(1.0, nodeStateBuffer[base + 4]!),
          theta,
          repulsion,
          forceAcc
        );
        forcesX[i] = forceAcc.fx;
        forcesY[i] = forceAcc.fy;
      }

      for (let e = 0; e < edgeCount; e++) {
        const s = edgeIndexBuffer[e * 2]!;
        const t = edgeIndexBuffer[e * 2 + 1]!;
        if (s >= nodeCount || t >= nodeCount || s === t) continue;
        const baseS = s * LAYOUT_NODE_STRIDE_FLOATS;
        const baseT = t * LAYOUT_NODE_STRIDE_FLOATS;
        const dx = nodeStateBuffer[baseT + 0]! - nodeStateBuffer[baseS + 0]!;
        const dy = nodeStateBuffer[baseT + 1]! - nodeStateBuffer[baseS + 1]!;
        const dist = Math.max(1.0, Math.hypot(dx, dy));
        const f = springK * (dist - idealLen);
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;

        if (nodeStateBuffer[baseS + 5]! === 0) {
          forcesX[s] = forcesX[s]! + fx;
          forcesY[s] = forcesY[s]! + fy;
        }
        if (nodeStateBuffer[baseT + 5]! === 0) {
          forcesX[t] = forcesX[t]! - fx;
          forcesY[t] = forcesY[t]! - fy;
        }
      }

      for (let i = 0; i < nodeCount; i++) {
        const base = i * LAYOUT_NODE_STRIDE_FLOATS;
        if (nodeStateBuffer[base + 5]! !== 0) continue;
        const vx = (nodeStateBuffer[base + 2]! + forcesX[i]! * dt) * damping;
        const vy = (nodeStateBuffer[base + 3]! + forcesY[i]! * dt) * damping;
        nodeStateBuffer[base + 2] = vx;
        nodeStateBuffer[base + 3] = vy;
        nodeStateBuffer[base + 0] = nodeStateBuffer[base + 0]! + vx * dt;
        nodeStateBuffer[base + 1] = nodeStateBuffer[base + 1]! + vy * dt;
      }
    }

    return { elapsedMs: performance.now() - t0, iterationsRun: iterations };
  }

  /**
   * Executes Sugiyama Hierarchical DAG layout (cycle-safe layering + barycenter ordering).
   */
  public runSugiyamaHierarchical(
    nodeStateBuffer: Float32Array,
    edgeIndexBuffer: Uint32Array,
    layerSpacing = 160,
    nodeSpacing = 120
  ): { elapsedMs: number; layerCount: number } {
    const t0 = performance.now();
    const nodeCount = Math.floor(nodeStateBuffer.length / LAYOUT_NODE_STRIDE_FLOATS);
    const edgeCount = Math.floor(edgeIndexBuffer.length / 2);

    const inDegree = new Int32Array(nodeCount);
    const outgoing: number[][] = Array.from({ length: nodeCount }, () => []);
    const incoming: number[][] = Array.from({ length: nodeCount }, () => []);

    for (let e = 0; e < edgeCount; e++) {
      const s = edgeIndexBuffer[e * 2]!;
      const t = edgeIndexBuffer[e * 2 + 1]!;
      if (s < nodeCount && t < nodeCount && s !== t) {
        outgoing[s]!.push(t);
        incoming[t]!.push(s);
        inDegree[t] = inDegree[t]! + 1;
      }
    }

    const layerOf = new Int32Array(nodeCount).fill(-1);
    const queue: number[] = [];
    for (let i = 0; i < nodeCount; i++) {
      if (inDegree[i] === 0) {
        layerOf[i] = 0;
        queue.push(i);
      }
    }

    if (queue.length === 0 && nodeCount > 0) {
      layerOf[0] = 0;
      queue.push(0);
    }

    let head = 0;
    while (head < queue.length) {
      const u = queue[head++]!;
      const nextLayer = layerOf[u]! + 1;
      for (const v of outgoing[u]!) {
        if (layerOf[v] === -1) {
          layerOf[v] = nextLayer;
          queue.push(v);
        }
      }
    }

    let maxLayer = 0;
    const layers = new Map<number, number[]>();
    for (let i = 0; i < nodeCount; i++) {
      const l = layerOf[i]! >= 0 ? layerOf[i]! : 0;
      if (l > maxLayer) maxLayer = l;
      let list = layers.get(l);
      if (!list) {
        list = [];
        layers.set(l, list);
      }
      list.push(i);
    }

    // Barycenter ordering within each layer and coordinate assignment
    for (let l = 0; l <= maxLayer; l++) {
      const nodesInLayer = layers.get(l);
      if (!nodesInLayer) continue;

      if (l > 0) {
        nodesInLayer.sort((a, b) => {
          const parentsA = incoming[a]!;
          const parentsB = incoming[b]!;
          const avgX = (parents: number[]) => {
            if (parents.length === 0) return 0;
            let sum = 0;
            for (const p of parents) sum += nodeStateBuffer[p * LAYOUT_NODE_STRIDE_FLOATS]!;
            return sum / parents.length;
          };
          return avgX(parentsA) - avgX(parentsB);
        });
      }

      const totalWidth = (nodesInLayer.length - 1) * nodeSpacing;
      const startX = -totalWidth * 0.5;
      const y = l * layerSpacing;

      for (let idx = 0; idx < nodesInLayer.length; idx++) {
        const nodeIdx = nodesInLayer[idx]!;
        const base = nodeIdx * LAYOUT_NODE_STRIDE_FLOATS;
        if (nodeStateBuffer[base + 5]! !== 0) continue;
        nodeStateBuffer[base + 0] = startX + idx * nodeSpacing;
        nodeStateBuffer[base + 1] = y;
      }
    }

    return { elapsedMs: performance.now() - t0, layerCount: maxLayer + 1 };
  }

  public runCircularLayout(nodeStateBuffer: Float32Array): { elapsedMs: number } {
    const t0 = performance.now();
    const nodeCount = Math.floor(nodeStateBuffer.length / LAYOUT_NODE_STRIDE_FLOATS);
    const radius = Math.max(150, (nodeCount * 48) / (2 * Math.PI));

    for (let i = 0; i < nodeCount; i++) {
      const base = i * LAYOUT_NODE_STRIDE_FLOATS;
      if (nodeStateBuffer[base + 5]! !== 0) continue;
      const angle = (2 * Math.PI * i) / Math.max(1, nodeCount);
      nodeStateBuffer[base + 0] = Math.cos(angle) * radius;
      nodeStateBuffer[base + 1] = Math.sin(angle) * radius;
    }

    return { elapsedMs: performance.now() - t0 };
  }

  public runBlockGridLayout(nodeStateBuffer: Float32Array, cellSpacing = 110): { elapsedMs: number } {
    const t0 = performance.now();
    const nodeCount = Math.floor(nodeStateBuffer.length / LAYOUT_NODE_STRIDE_FLOATS);
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodeCount)));

    for (let i = 0; i < nodeCount; i++) {
      const base = i * LAYOUT_NODE_STRIDE_FLOATS;
      if (nodeStateBuffer[base + 5]! !== 0) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodeStateBuffer[base + 0] = col * cellSpacing;
      nodeStateBuffer[base + 1] = row * cellSpacing;
    }

    return { elapsedMs: performance.now() - t0 };
  }
}
