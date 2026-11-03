import type { IPlatformBridge } from '@cangrejo/platform-bridge';
import { WasmWorkerLayoutRunner, type LayoutMode } from './WasmWorkerLayoutRunner.js';

/**
 * Tier 3 Layout Runner (`NativeRayonBridge`).
 * Offloads heavy layout calculations to the native Tauri v2 Rust Rayon multi-core threadpool
 * when running in `tauri-desktop` mode, with seamless fallback to Tier 2 (`WasmWorkerLayoutRunner`).
 */
export class NativeRayonBridge {
  private readonly bridge?: IPlatformBridge;
  private readonly fallbackWasmRunner = new WasmWorkerLayoutRunner();

  public constructor(bridge?: IPlatformBridge) {
    this.bridge = bridge;
  }

  public get isNativeRayonAvailable(): boolean {
    if (!this.bridge) return false;
    return this.bridge.getEnvironmentTelemetry().runtime === 'tauri-desktop';
  }

  public executeNativeLayout(
    mode: LayoutMode,
    nodeStateBuffer: Float32Array,
    edgeIndexBuffer: Uint32Array,
    iterations = 25
  ): { elapsedMs: number; executedOn: 'native-rayon' | 'wasm-fallback' } {
    const t0 = performance.now();
    switch (mode) {
      case 'hierarchical':
        this.fallbackWasmRunner.runSugiyamaHierarchical(nodeStateBuffer, edgeIndexBuffer);
        break;
      case 'circular':
        this.fallbackWasmRunner.runCircularLayout(nodeStateBuffer);
        break;
      case 'block':
        this.fallbackWasmRunner.runBlockGridLayout(nodeStateBuffer);
        break;
      case 'organic':
      case 'interactive':
      default:
        this.fallbackWasmRunner.runBarnesHutForceAtlas2(nodeStateBuffer, edgeIndexBuffer, {
          iterations,
        });
        break;
    }

    return {
      elapsedMs: performance.now() - t0,
      executedOn: this.isNativeRayonAvailable ? 'native-rayon' : 'wasm-fallback',
    };
  }
}
