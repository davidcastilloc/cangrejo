import {
  GuidMap,
  type EntityID,
  type GraphStore,
  type Point3D,
} from '@cangrejo/core';
import type { IPlatformBridge } from '@cangrejo/platform-bridge';
import { NativeRayonBridge } from './NativeRayonBridge.js';
import { WasmWorkerLayoutRunner, type LayoutMode } from './WasmWorkerLayoutRunner.js';
import {
  LAYOUT_NODE_STRIDE_FLOATS,
  WebGPULayoutRunner,
} from './WebGPULayoutRunner.js';

export type LayoutTier = 'tier1-webgpu' | 'tier2-wasm' | 'tier3-native-rayon';

export interface LayoutExecutionResult {
  tierUsed: LayoutTier;
  mode: LayoutMode;
  nodeCount: number;
  edgeCount: number;
  elapsedMs: number;
}

/**
 * Adaptive 3-Tier Layout Offloading Pipeline (`LayoutPipeline`).
 * Routes layout requests across Tier 1 (WebGPU WGSL), Tier 2 (Wasm Barnes-Hut / Sugiyama),
 * and Tier 3 (Native Rust Rayon), preserves `pinned` entities, and commits updated coordinates
 * in a single atomic `GraphStore.runInBatch` transaction with Undo/Redo support.
 */
export class LayoutPipeline {
  public readonly webgpuRunner = new WebGPULayoutRunner();
  public readonly wasmRunner = new WasmWorkerLayoutRunner();
  public readonly rayonBridge: NativeRayonBridge;
  private readonly bridge?: IPlatformBridge;

  public constructor(bridge?: IPlatformBridge) {
    this.bridge = bridge;
    this.rayonBridge = new NativeRayonBridge(bridge);
  }

  public selectOptimalTier(
    mode: LayoutMode,
    nodeCount: number,
    preferTier?: LayoutTier
  ): LayoutTier {
    if (preferTier) return preferTier;
    const telemetry = this.bridge?.getEnvironmentTelemetry();

    if (mode === 'organic' || mode === 'interactive') {
      if (telemetry?.supportsWebGPU ?? true) {
        return 'tier1-webgpu';
      }
    }
    if (telemetry?.runtime === 'tauri-desktop' && nodeCount >= 2_000) {
      return 'tier3-native-rayon';
    }
    return 'tier2-wasm';
  }

  public executeLayout(
    store: GraphStore,
    mode: LayoutMode = 'organic',
    options?: {
      iterations?: number;
      preferTier?: LayoutTier;
    }
  ): LayoutExecutionResult {
    const entities = Array.from(store.dataStore.getEntities().values());
    const nodeCount = entities.length;
    const links = Array.from(store.structureStore.links.values());
    const edgeCount = links.length;

    const tierUsed = this.selectOptimalTier(mode, nodeCount, options?.preferTier);
    const iterations = options?.iterations ?? 20;

    const entityToIndex = new GuidMap<number>();
    const nodeStateBuffer = new Float32Array(nodeCount * LAYOUT_NODE_STRIDE_FLOATS);
    const previousPositions = new GuidMap<Point3D>();

    for (let i = 0; i < nodeCount; i++) {
      const ent = entities[i]!;
      entityToIndex.set(ent.id, i);
      const pos = store.layoutStore.getPosition(ent.id);
      const pinned = store.layoutStore.isPinned(ent.id);
      previousPositions.set(ent.id, { ...pos });

      const base = i * LAYOUT_NODE_STRIDE_FLOATS;
      nodeStateBuffer[base + 0] = pos.x;
      nodeStateBuffer[base + 1] = pos.y;
      nodeStateBuffer[base + 2] = 0;
      nodeStateBuffer[base + 3] = 0;
      nodeStateBuffer[base + 4] = Math.max(1.0, Math.log10(Math.max(10, ent.weight)));
      nodeStateBuffer[base + 5] = pinned ? 1.0 : 0.0;
    }

    const edgeIndexBuffer = new Uint32Array(edgeCount * 2);
    let validEdges = 0;
    for (const edge of links) {
      const sIdx = entityToIndex.get(edge.source);
      const tIdx = entityToIndex.get(edge.target);
      if (sIdx !== undefined && tIdx !== undefined) {
        edgeIndexBuffer[validEdges * 2] = sIdx;
        edgeIndexBuffer[validEdges * 2 + 1] = tIdx;
        validEdges++;
      }
    }

    const t0 = performance.now();

    if (tierUsed === 'tier1-webgpu' && (mode === 'organic' || mode === 'interactive')) {
      this.webgpuRunner.runSimulation(nodeStateBuffer, edgeIndexBuffer, { iterations });
    } else if (tierUsed === 'tier3-native-rayon') {
      this.rayonBridge.executeNativeLayout(mode, nodeStateBuffer, edgeIndexBuffer, iterations);
    } else {
      switch (mode) {
        case 'hierarchical':
          this.wasmRunner.runSugiyamaHierarchical(nodeStateBuffer, edgeIndexBuffer);
          break;
        case 'circular':
          this.wasmRunner.runCircularLayout(nodeStateBuffer);
          break;
        case 'block':
          this.wasmRunner.runBlockGridLayout(nodeStateBuffer);
          break;
        case 'organic':
        case 'interactive':
        default:
          this.wasmRunner.runBarnesHutForceAtlas2(nodeStateBuffer, edgeIndexBuffer, {
            iterations,
          });
          break;
      }
    }

    const nextPositions = new GuidMap<Point3D>();
    for (let i = 0; i < nodeCount; i++) {
      const ent = entities[i]!;
      const base = i * LAYOUT_NODE_STRIDE_FLOATS;
      const prev = previousPositions.get(ent.id)!;
      if (store.layoutStore.isPinned(ent.id)) {
        nextPositions.set(ent.id, prev);
      } else {
        nextPositions.set(ent.id, {
          x: nodeStateBuffer[base + 0]!,
          y: nodeStateBuffer[base + 1]!,
          z: prev.z,
        });
      }
    }

    const applyPositions = (posMap: GuidMap<Point3D>) => {
      store.runInBatch(() => {
        for (const [id, pt] of posMap.entries()) {
          if (store.layoutStore.isPinned(id)) continue;
          const norm = store.layoutStore.setPosition(id, pt);
          store.pendingMods.recordEntityMoved(id, norm);
        }
      });
    };

    applyPositions(nextPositions);

    store.undoRedoManager.record({
      description: `Layout (${mode} via ${tierUsed})`,
      undo: () => applyPositions(previousPositions),
      redo: () => applyPositions(nextPositions),
    });

    return {
      tierUsed,
      mode,
      nodeCount,
      edgeCount: validEdges,
      elapsedMs: performance.now() - t0,
    };
  }
}
