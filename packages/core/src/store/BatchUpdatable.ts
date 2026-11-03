import type { GraphID } from '../identity/Guid.js';
import { GraphModsAccumulator, type GraphMods } from './GraphMods.js';

/**
 * Nested batch transaction coordinator (`AbstractBatchUpdatable`).
 * Suppresses fine-grained event emission while `nestCount > 0` and dispatches a single
 * delta-consolidated `GraphMods` event when the outermost `endUpdate()` completes.
 */
export abstract class AbstractBatchUpdatable {
  private nestCount = 0;
  public readonly pendingMods = new GraphModsAccumulator();
  private readonly listeners = new Set<(mods: GraphMods) => void>();

  public abstract readonly graphId: GraphID;

  public get isUpdating(): boolean {
    return this.nestCount > 0;
  }

  public beginUpdate(): void {
    this.nestCount++;
  }

  public endUpdate(): void {
    if (this.nestCount <= 0) {
      throw new Error('endUpdate() called without matching beginUpdate()');
    }
    this.nestCount--;
    if (this.nestCount === 0) {
      this.flushModifications();
    }
  }

  public runInBatch<T>(operation: () => T): T {
    this.beginUpdate();
    try {
      return operation();
    } finally {
      this.endUpdate();
    }
  }

  public async runInBatchAsync<T>(operation: () => Promise<T>): Promise<T> {
    this.beginUpdate();
    try {
      return await operation();
    } finally {
      this.endUpdate();
    }
  }

  public subscribe(listener: (mods: GraphMods) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected notifyIfUnbatched(): void {
    if (this.nestCount === 0) {
      this.flushModifications();
    }
  }

  private flushModifications(): void {
    if (this.pendingMods.isEmpty()) return;
    const consolidated = this.pendingMods.consolidate(this.graphId);
    this.pendingMods.clear();
    for (const listener of this.listeners) {
      listener(consolidated);
    }
  }
}
