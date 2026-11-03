import {
  GuidMap,
  type CollectionNodeView,
  type EntityID,
  type GraphStoreSelection,
  type Point2D,
} from '@cangrejo/core';
import { IconAtlasManager } from '../atlas/IconAtlasManager.js';

export const NODE_INSTANCE_STRIDE_FLOATS = 16; // 16 * 4 bytes = 64 bytes per node
export const NODE_INSTANCE_STRIDE_BYTES = 64;

export interface UnpackedNodeInstance {
  entityId: EntityID;
  x: number;
  y: number;
  width: number;
  height: number;
  colorRgba: [number, number, number, number];
  selectionRgba: [number, number, number, number];
  iconAtlasId: number;
  collectionFlag: number;
  pinnedFlag: number;
}

/**
 * Hardware-instanced Node Geometry Layer (`InstancedNodeLayer`).
 * Packs up to 100,000+ nodes into a contiguous 64-byte-per-node `Float32Array` GPU instance buffer
 * rendered in a single GPU draw call (`drawCalls <= 1`).
 */
export class InstancedNodeLayer {
  private buffer: Float32Array;
  private capacityNodes: number;
  private activeNodeCount = 0;
  private readonly entityToSlot = new GuidMap<number>();
  private readonly slotToEntity: EntityID[] = [];
  private readonly atlasManager: IconAtlasManager;
  private dirtyRange: { startSlot: number; endSlot: number } | null = null;

  public constructor(atlasManager = new IconAtlasManager(), initialCapacity = 4096) {
    this.atlasManager = atlasManager;
    this.capacityNodes = Math.max(16, initialCapacity);
    this.buffer = new Float32Array(this.capacityNodes * NODE_INSTANCE_STRIDE_FLOATS);
  }

  public get nodeCount(): number {
    return this.activeNodeCount;
  }

  public get drawCallCount(): number {
    return this.activeNodeCount > 0 ? 1 : 0;
  }

  public get activeBufferBytes(): number {
    return this.activeNodeCount * NODE_INSTANCE_STRIDE_BYTES;
  }

  public get allocatedBufferBytes(): number {
    return this.buffer.byteLength;
  }

  public getInstanceBufferView(): Float32Array {
    return this.buffer.subarray(0, this.activeNodeCount * NODE_INSTANCE_STRIDE_FLOATS);
  }

  public getDirtyRange(): { startSlot: number; endSlot: number } | null {
    return this.dirtyRange;
  }

  public clearDirtyRange(): void {
    this.dirtyRange = null;
  }

  private ensureCapacity(requiredNodes: number): void {
    if (requiredNodes <= this.capacityNodes) return;
    let nextCap = this.capacityNodes;
    while (nextCap < requiredNodes) {
      nextCap = nextCap < 65_536 ? nextCap * 2 : nextCap + 32_768;
    }
    const nextBuffer = new Float32Array(nextCap * NODE_INSTANCE_STRIDE_FLOATS);
    nextBuffer.set(this.buffer.subarray(0, this.activeNodeCount * NODE_INSTANCE_STRIDE_FLOATS));
    this.buffer = nextBuffer;
    this.capacityNodes = nextCap;
  }

  /**
   * Synchronizes the 64-byte instanced node buffer from `CollectionNodeView` and `GraphStoreSelection`.
   */
  public syncFromView(
    collectionView: CollectionNodeView,
    selection?: GraphStoreSelection
  ): void {
    const viewEntities = collectionView.getViewEntities();
    const required = viewEntities.size;
    this.ensureCapacity(required);

    this.entityToSlot.clear();
    this.slotToEntity.length = 0;

    const dataStore = collectionView.underlyingStore.dataStore;
    let slot = 0;
    const buf = this.buffer;

    for (const ve of viewEntities.values()) {
      this.entityToSlot.set(ve.id, slot);
      this.slotToEntity.push(ve.id);

      const baseOffset = slot * NODE_INSTANCE_STRIDE_FLOATS;
      const iconSlot = this.atlasManager.getIconSlot(ve.typeName);

      let weight = 100;
      let bookmark = -1;
      if (!ve.isCollectionNode) {
        const phys = dataStore.tryGetEntity(ve.id);
        if (phys) {
          weight = phys.weight;
          bookmark = phys.bookmark;
        }
      }

      const scaleBoost = ve.isCollectionNode
        ? Math.min(24, Math.log2(ve.underlyingEntities.size + 1) * 4)
        : Math.min(16, Math.log10(Math.max(1, weight)) * 4);
      const dimension = 32 + scaleBoost;

      const isSelected = selection ? selection.isViewEntitySelected(ve.id) : false;
      const haloRgba = this.atlasManager.resolveHaloRgba(isSelected, bookmark);
      const tintRgba = iconSlot.baseTintRgba;

      // Offset 0..1: position (x, y)
      buf[baseOffset + 0] = ve.position.x;
      buf[baseOffset + 1] = ve.position.y;
      // Offset 2..3: dimensions (width, height)
      buf[baseOffset + 2] = dimension;
      buf[baseOffset + 3] = dimension;
      // Offset 4..7: colorRgba
      buf[baseOffset + 4] = tintRgba[0];
      buf[baseOffset + 5] = tintRgba[1];
      buf[baseOffset + 6] = tintRgba[2];
      buf[baseOffset + 7] = tintRgba[3];
      // Offset 8..11: selectionRgba
      buf[baseOffset + 8] = haloRgba[0];
      buf[baseOffset + 9] = haloRgba[1];
      buf[baseOffset + 10] = haloRgba[2];
      buf[baseOffset + 11] = haloRgba[3];
      // Offset 12: iconAtlasId
      buf[baseOffset + 12] = iconSlot.atlasIndex;
      // Offset 13: collectionFlag (0.0 = standard, >0.0 = member count)
      buf[baseOffset + 13] = ve.isCollectionNode ? ve.underlyingEntities.size : 0.0;
      // Offset 14..15: padding (stores pinned flag in [14])
      buf[baseOffset + 14] = ve.pinned ? 1.0 : 0.0;
      buf[baseOffset + 15] = 0.0;

      slot++;
    }

    this.activeNodeCount = slot;
    this.dirtyRange = slot > 0 ? { startSlot: 0, endSlot: slot - 1 } : null;
  }

  /**
   * Updates only the `selectionRgba` bytes in-place (simulating `glBufferSubData` / `queue.writeBuffer`)
   * without rebuilding or reallocating geometry buffers.
   */
  public updateSelectionInPlace(
    collectionView: CollectionNodeView,
    selection: GraphStoreSelection
  ): number {
    const dataStore = collectionView.underlyingStore.dataStore;
    const viewEntities = collectionView.getViewEntities();
    const buf = this.buffer;
    let updatedCount = 0;
    let minSlot = Number.MAX_SAFE_INTEGER;
    let maxSlot = -1;

    for (let slot = 0; slot < this.activeNodeCount; slot++) {
      const entityId = this.slotToEntity[slot]!;
      const ve = viewEntities.get(entityId);
      const bookmark =
        ve && !ve.isCollectionNode ? (dataStore.tryGetEntity(entityId)?.bookmark ?? -1) : -1;
      const isSelected = selection.isViewEntitySelected(entityId);
      const halo = this.atlasManager.resolveHaloRgba(isSelected, bookmark);

      const r32 = Math.fround(halo[0]);
      const g32 = Math.fround(halo[1]);
      const b32 = Math.fround(halo[2]);
      const a32 = Math.fround(halo[3]);

      const baseOffset = slot * NODE_INSTANCE_STRIDE_FLOATS;
      if (
        buf[baseOffset + 8] !== r32 ||
        buf[baseOffset + 9] !== g32 ||
        buf[baseOffset + 10] !== b32 ||
        buf[baseOffset + 11] !== a32
      ) {
        buf[baseOffset + 8] = r32;
        buf[baseOffset + 9] = g32;
        buf[baseOffset + 10] = b32;
        buf[baseOffset + 11] = a32;
        updatedCount++;
        if (slot < minSlot) minSlot = slot;
        if (slot > maxSlot) maxSlot = slot;
      }
    }

    if (updatedCount > 0) {
      this.dirtyRange = { startSlot: minSlot, endSlot: maxSlot };
    }
    return updatedCount;
  }

  /**
   * Updates a single node's `(x, y)` coordinates in-place in `O(1)` time.
   */
  public updateNodePositionInPlace(entityId: EntityID, pos: Point2D): boolean {
    const slot = this.entityToSlot.get(entityId);
    if (slot === undefined) return false;
    const baseOffset = slot * NODE_INSTANCE_STRIDE_FLOATS;
    this.buffer[baseOffset + 0] = pos.x;
    this.buffer[baseOffset + 1] = pos.y;
    this.dirtyRange = this.dirtyRange
      ? {
          startSlot: Math.min(this.dirtyRange.startSlot, slot),
          endSlot: Math.max(this.dirtyRange.endSlot, slot),
        }
      : { startSlot: slot, endSlot: slot };
    return true;
  }

  public getSlotIndex(entityId: EntityID): number | undefined {
    return this.entityToSlot.get(entityId);
  }

  public unpackNodeAtSlot(slot: number): UnpackedNodeInstance {
    if (slot < 0 || slot >= this.activeNodeCount) {
      throw new RangeError(`Slot ${slot} out of range [0, ${this.activeNodeCount})`);
    }
    const base = slot * NODE_INSTANCE_STRIDE_FLOATS;
    const b = this.buffer;
    return {
      entityId: this.slotToEntity[slot]!,
      x: b[base + 0]!,
      y: b[base + 1]!,
      width: b[base + 2]!,
      height: b[base + 3]!,
      colorRgba: [b[base + 4]!, b[base + 5]!, b[base + 6]!, b[base + 7]!],
      selectionRgba: [b[base + 8]!, b[base + 9]!, b[base + 10]!, b[base + 11]!],
      iconAtlasId: b[base + 12]!,
      collectionFlag: b[base + 13]!,
      pinnedFlag: b[base + 14]!,
    };
  }
}
