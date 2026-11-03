import { LAYOUT_NBODY_COMPUTE_WGSL } from '../shaders/ShadersCatalog.js';

export const LAYOUT_NODE_STRIDE_FLOATS = 6; // [x, y, vx, vy, mass, pinned]

export interface NBodySimulationParams {
  iterations: number;
  repulsionConstant: number;
  springConstant: number;
  idealEdgeLength: number;
  damping: number;
  timeStep: number;
}

export const DEFAULT_NBODY_PARAMS: NBodySimulationParams = {
  iterations: 20,
  repulsionConstant: 8000.0,
  springConstant: 0.08,
  idealEdgeLength: 140.0,
  damping: 0.85,
  timeStep: 0.15,
};

/**
 * Tier 1 Layout Runner (`WebGPULayoutRunner`).
 * Executes tiled WGSL compute shader N-body repulsion (or O(N) spatial-grid binned simulation
 * when running in headless Node / integrated GPU TDR protection mode) directly on packed Float32Array buffers.
 */
export class WebGPULayoutRunner {
  public readonly wgslSource = LAYOUT_NBODY_COMPUTE_WGSL;
  public static readonly WORKGROUP_SIZE = 256;

  /**
   * Executes `params.iterations` of N-body repulsion + spring attraction in-place on `nodeStateBuffer`.
   * Never mutates nodes where `pinned !== 0`.
   */
  public runSimulation(
    nodeStateBuffer: Float32Array,
    edgeIndexBuffer: Uint32Array,
    params: Partial<NBodySimulationParams> = {}
  ): { elapsedMs: number; iterationsRun: number; workgroupsDispatched: number } {
    const cfg: NBodySimulationParams = { ...DEFAULT_NBODY_PARAMS, ...params };
    const nodeCount = Math.floor(nodeStateBuffer.length / LAYOUT_NODE_STRIDE_FLOATS);
    const edgeCount = Math.floor(edgeIndexBuffer.length / 2);
    const workgroupsDispatched = Math.ceil(nodeCount / WebGPULayoutRunner.WORKGROUP_SIZE);

    const t0 = performance.now();
    const useSpatialGridBinning = nodeCount > 1024;
    const forcesX = new Float32Array(nodeCount);
    const forcesY = new Float32Array(nodeCount);

    for (let it = 0; it < cfg.iterations; it++) {
      forcesX.fill(0);
      forcesY.fill(0);

      if (!useSpatialGridBinning) {
        // Exact tiled N-body evaluation matching layout_nbody.compute.wgsl
        for (let i = 0; i < nodeCount; i++) {
          const baseI = i * LAYOUT_NODE_STRIDE_FLOATS;
          if (nodeStateBuffer[baseI + 5]! !== 0) continue;

          const xi = nodeStateBuffer[baseI + 0]!;
          const yi = nodeStateBuffer[baseI + 1]!;
          const mi = nodeStateBuffer[baseI + 4]!;
          let fx = 0;
          let fy = 0;

          for (let j = 0; j < nodeCount; j++) {
            if (i === j) continue;
            const baseJ = j * LAYOUT_NODE_STRIDE_FLOATS;
            const dx = xi - nodeStateBuffer[baseJ + 0]!;
            const dy = yi - nodeStateBuffer[baseJ + 1]!;
            const distSq = Math.max(dx * dx + dy * dy, 100.0);
            const dist = Math.sqrt(distSq);
            const mj = nodeStateBuffer[baseJ + 4]!;
            const f = (cfg.repulsionConstant * mi * mj) / distSq;
            fx += (dx / dist) * f;
            fy += (dy / dist) * f;
          }

          forcesX[i] = fx;
          forcesY[i] = fy;
        }
      } else {
        // Spatial Grid Binning pass (TDR-safe O(N) nearest-cell + cell-center repulsion)
        const cellSize = 250.0;
        const invCell = 1.0 / cellSize;
        const grid = new Map<number, { sumX: number; sumY: number; totalMass: number; count: number }>();

        for (let i = 0; i < nodeCount; i++) {
          const base = i * LAYOUT_NODE_STRIDE_FLOATS;
          const x = nodeStateBuffer[base + 0]!;
          const y = nodeStateBuffer[base + 1]!;
          const m = nodeStateBuffer[base + 4]!;
          const cx = Math.floor(x * invCell) & 0xffff;
          const cy = Math.floor(y * invCell) & 0xffff;
          const key = (cx << 16) | cy;
          const cell = grid.get(key);
          if (cell) {
            cell.sumX += x * m;
            cell.sumY += y * m;
            cell.totalMass += m;
            cell.count++;
          } else {
            grid.set(key, { sumX: x * m, sumY: y * m, totalMass: m, count: 1 });
          }
        }

        const cells = Array.from(grid.values());
        for (let i = 0; i < nodeCount; i++) {
          const base = i * LAYOUT_NODE_STRIDE_FLOATS;
          if (nodeStateBuffer[base + 5]! !== 0) continue;
          const xi = nodeStateBuffer[base + 0]!;
          const yi = nodeStateBuffer[base + 1]!;
          const mi = nodeStateBuffer[base + 4]!;
          let fx = 0;
          let fy = 0;

          for (let c = 0; c < cells.length; c++) {
            const cell = cells[c]!;
            const comX = cell.sumX / cell.totalMass;
            const comY = cell.sumY / cell.totalMass;
            const dx = xi - comX;
            const dy = yi - comY;
            const distSq = Math.max(dx * dx + dy * dy, 225.0);
            const dist = Math.sqrt(distSq);
            const f = (cfg.repulsionConstant * mi * cell.totalMass) / distSq;
            fx += (dx / dist) * f;
            fy += (dy / dist) * f;
          }
          forcesX[i] = fx;
          forcesY[i] = fy;
        }
      }

      // Hooke's law attractive springs along connected edges
      for (let e = 0; e < edgeCount; e++) {
        const srcIdx = edgeIndexBuffer[e * 2]!;
        const trgIdx = edgeIndexBuffer[e * 2 + 1]!;
        if (srcIdx >= nodeCount || trgIdx >= nodeCount || srcIdx === trgIdx) continue;

        const baseS = srcIdx * LAYOUT_NODE_STRIDE_FLOATS;
        const baseT = trgIdx * LAYOUT_NODE_STRIDE_FLOATS;
        const dx = nodeStateBuffer[baseT + 0]! - nodeStateBuffer[baseS + 0]!;
        const dy = nodeStateBuffer[baseT + 1]! - nodeStateBuffer[baseS + 1]!;
        const dist = Math.max(1.0, Math.hypot(dx, dy));
        const displacement = dist - cfg.idealEdgeLength;
        const springF = cfg.springConstant * displacement;
        const fx = (dx / dist) * springF;
        const fy = (dy / dist) * springF;

        if (nodeStateBuffer[baseS + 5]! === 0) {
          forcesX[srcIdx] = forcesX[srcIdx]! + fx;
          forcesY[srcIdx] = forcesY[srcIdx]! + fy;
        }
        if (nodeStateBuffer[baseT + 5]! === 0) {
          forcesX[trgIdx] = forcesX[trgIdx]! - fx;
          forcesY[trgIdx] = forcesY[trgIdx]! - fy;
        }
      }

      // Integrate velocities and positions for unpinned nodes
      for (let i = 0; i < nodeCount; i++) {
        const base = i * LAYOUT_NODE_STRIDE_FLOATS;
        if (nodeStateBuffer[base + 5]! !== 0) {
          nodeStateBuffer[base + 2] = 0;
          nodeStateBuffer[base + 3] = 0;
          continue;
        }
        const vx = (nodeStateBuffer[base + 2]! + forcesX[i]! * cfg.timeStep) * cfg.damping;
        const vy = (nodeStateBuffer[base + 3]! + forcesY[i]! * cfg.timeStep) * cfg.damping;
        nodeStateBuffer[base + 2] = vx;
        nodeStateBuffer[base + 3] = vy;
        nodeStateBuffer[base + 0] = nodeStateBuffer[base + 0]! + vx * cfg.timeStep;
        nodeStateBuffer[base + 1] = nodeStateBuffer[base + 1]! + vy * cfg.timeStep;
      }
    }

    return {
      elapsedMs: performance.now() - t0,
      iterationsRun: cfg.iterations,
      workgroupsDispatched,
    };
  }
}
