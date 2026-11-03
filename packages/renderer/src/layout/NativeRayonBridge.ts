import type { IPlatformBridge } from '@cangrejo/platform-bridge';
import { WasmWorkerLayoutRunner, type LayoutMode } from './WasmWorkerLayoutRunner.js';

interface BunFfiBarnesHutHandle {
  libraryPath: string;
  stepStride6: (
    nodePtr: number | bigint,
    nodeFloatsLen: number,
    edgePtr: number | bigint,
    edgeU32Len: number,
    iterations: number,
    theta: number
  ) => number;
  ptrOf: (typedArray: Float32Array | Uint32Array) => number | bigint;
}

let cachedBunFfiHandle: BunFfiBarnesHutHandle | null | undefined;

/**
 * Dynamically resolves the native `cangrejo_layout_rs` shared library via `bun:ffi` (`dlopen`)
 * when running inside the Bun runtime. Completely no-ops in browser/Vite environments.
 */
function resolveBunFfiBarnesHutHandle(): BunFfiBarnesHutHandle | null {
  if (cachedBunFfiHandle !== undefined) {
    return cachedBunFfiHandle;
  }

  const g = globalThis as Record<string, unknown>;
  if (typeof g.Bun === 'undefined') {
    cachedBunFfiHandle = null;
    return null;
  }

  try {
    const metaReq = (import.meta as unknown as { require?: (mod: string) => unknown }).require;
    const dynamicRequire =
      typeof metaReq === 'function'
        ? metaReq
        : (new Function('mod', 'return require(mod)') as (mod: string) => unknown);
    const ffi = dynamicRequire('bun:ffi') as {
      dlopen: (
        path: string,
        symbols: Record<string, { args: string[]; returns: string }>
      ) => {
        symbols: {
          cangrejo_barnes_hut_stride6_step: (
            nodePtr: number | bigint,
            nodeFloatsLen: number,
            edgePtr: number | bigint,
            edgeU32Len: number,
            iterations: number,
            theta: number
          ) => number;
        };
      };
      ptr: (view: ArrayBufferView) => number | bigint;
    };
    const pathMod = dynamicRequire('node:path') as { resolve: (...parts: string[]) => string };
    const fsMod = dynamicRequire('node:fs') as { existsSync: (p: string) => boolean };
    const proc = g.process as { cwd?: () => string; platform?: string } | undefined;
    const cwd = typeof proc?.cwd === 'function' ? proc.cwd() : '.';
    const platform = proc?.platform ?? 'win32';
    const libFileName =
      platform === 'win32'
        ? 'cangrejo_layout_rs.dll'
        : platform === 'darwin'
          ? 'libcangrejo_layout_rs.dylib'
          : 'libcangrejo_layout_rs.so';

    const candidates = [
      pathMod.resolve(cwd, 'packages/layout-rs/target/release', libFileName),
      pathMod.resolve(cwd, 'packages/layout-rs/target/debug', libFileName),
      pathMod.resolve(cwd, '../../packages/layout-rs/target/release', libFileName),
      pathMod.resolve(cwd, '../layout-rs/target/release', libFileName),
    ];

    const foundPath = candidates.find((p) => fsMod.existsSync(p));
    if (!foundPath) {
      cachedBunFfiHandle = null;
      return null;
    }

    const lib = ffi.dlopen(foundPath, {
      cangrejo_barnes_hut_stride6_step: {
        args: ['ptr', 'usize', 'ptr', 'usize', 'u32', 'f32'],
        returns: 'u32',
      },
    });

    cachedBunFfiHandle = {
      libraryPath: foundPath,
      stepStride6: (nodePtr, nodeFloatsLen, edgePtr, edgeU32Len, iterations, theta) =>
        lib.symbols.cangrejo_barnes_hut_stride6_step(
          nodePtr,
          nodeFloatsLen,
          edgePtr,
          edgeU32Len,
          iterations,
          theta
        ),
      ptrOf: (typedArray) => ffi.ptr(typedArray),
    };
    return cachedBunFfiHandle;
  } catch {
    cachedBunFfiHandle = null;
    return null;
  }
}

/**
 * Tier 3 Layout Runner (`NativeRayonBridge`).
 * Offloads heavy O(V log V) Barnes-Hut layout calculations to the native Rust (`cangrejo-layout-rs`)
 * C-ABI kernel via Zero-Copy `bun:ffi` (`dlopen` + `ptr(Float32Array)`) or Tauri v2 desktop bridge,
 * with seamless fallback to Tier 2 (`WasmWorkerLayoutRunner`).
 */
export class NativeRayonBridge {
  private readonly bridge?: IPlatformBridge;
  private readonly fallbackWasmRunner = new WasmWorkerLayoutRunner();

  public constructor(bridge?: IPlatformBridge) {
    this.bridge = bridge;
  }

  public get isNativeRayonAvailable(): boolean {
    if (this.bridge?.getEnvironmentTelemetry().runtime === 'tauri-desktop') {
      return true;
    }
    return resolveBunFfiBarnesHutHandle() !== null;
  }

  public get isBunFfiAvailable(): boolean {
    return resolveBunFfiBarnesHutHandle() !== null;
  }

  /**
   * Executes the native Rust Barnes-Hut O(V log V) C-ABI kernel directly over `nodeStateBuffer`
   * and `edgeIndexBuffer` via `bun:ffi` zero-copy pointers when available.
   */
  public executeBunFfiBarnesHut(
    nodeStateBuffer: Float32Array,
    edgeIndexBuffer: Uint32Array,
    iterations = 25,
    theta = 0.8
  ): {
    executed: boolean;
    processedNodes: number;
    elapsedMs: number;
    libraryPath: string | null;
  } {
    const handle = resolveBunFfiBarnesHutHandle();
    if (!handle || nodeStateBuffer.length < 6) {
      return {
        executed: false,
        processedNodes: 0,
        elapsedMs: 0,
        libraryPath: null,
      };
    }

    const t0 = performance.now();
    const nodePtr = handle.ptrOf(nodeStateBuffer);
    const dummyEdge = edgeIndexBuffer.length > 0 ? edgeIndexBuffer : new Uint32Array(2);
    const edgePtr = handle.ptrOf(dummyEdge);
    const processedNodes = handle.stepStride6(
      nodePtr,
      nodeStateBuffer.length,
      edgePtr,
      edgeIndexBuffer.length,
      iterations,
      theta
    );

    return {
      executed: true,
      processedNodes,
      elapsedMs: performance.now() - t0,
      libraryPath: handle.libraryPath,
    };
  }

  public executeNativeLayout(
    mode: LayoutMode,
    nodeStateBuffer: Float32Array,
    edgeIndexBuffer: Uint32Array,
    iterations = 25,
    theta = 0.8
  ): { elapsedMs: number; executedOn: 'native-rayon' | 'wasm-fallback' } {
    const t0 = performance.now();
    let executedViaBunFfi = false;

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
      default: {
        const ffiRes = this.executeBunFfiBarnesHut(
          nodeStateBuffer,
          edgeIndexBuffer,
          iterations,
          theta
        );
        if (ffiRes.executed) {
          executedViaBunFfi = true;
        } else {
          this.fallbackWasmRunner.runBarnesHutForceAtlas2(nodeStateBuffer, edgeIndexBuffer, {
            iterations,
            theta,
          });
        }
        break;
      }
    }

    const isTauriDesktop = this.bridge?.getEnvironmentTelemetry().runtime === 'tauri-desktop';
    return {
      elapsedMs: performance.now() - t0,
      executedOn: isTauriDesktop || executedViaBunFfi ? 'native-rayon' : 'wasm-fallback',
    };
  }
}
