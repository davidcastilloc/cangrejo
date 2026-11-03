import {
  GuidMap,
  type CollectionNodeView,
  type LinkID,
} from '@cangrejo/core';

export const EDGE_INSTANCE_STRIDE_FLOATS = 12; // 12 * 4 bytes = 48 bytes per edge
export const EDGE_INSTANCE_STRIDE_BYTES = 48;

export interface UnpackedEdgeInstance {
  linkId: LinkID;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  colorRgba: [number, number, number, number];
  thickness: number;
  styleFlag: number;
  reversedFlag: number;
  selectionFlag: number;
}

/**
 * Hardware-instanced Edge & Directed Arrowhead Layer (`InstancedEdgeLayer`).
 * Packs up to 250,000+ edges into a contiguous 48-byte-per-edge `Float32Array` GPU instance buffer
 * rendered in a single GPU draw call (`drawCalls <= 1`).
 */
export class InstancedEdgeLayer {
  private buffer: Float32Array;
  private capacityEdges: number;
  private activeEdgeCount = 0;
  private readonly linkToSlot = new GuidMap<number>();
  private readonly slotToLink: LinkID[] = [];

  public constructor(initialCapacity = 8192) {
    this.capacityEdges = Math.max(16, initialCapacity);
    this.buffer = new Float32Array(this.capacityEdges * EDGE_INSTANCE_STRIDE_FLOATS);
  }

  public get edgeCount(): number {
    return this.activeEdgeCount;
  }

  public get drawCallCount(): number {
    return this.activeEdgeCount > 0 ? 1 : 0;
  }

  public get activeBufferBytes(): number {
    return this.activeEdgeCount * EDGE_INSTANCE_STRIDE_BYTES;
  }

  public get allocatedBufferBytes(): number {
    return this.buffer.byteLength;
  }

  public getInstanceBufferView(): Float32Array {
    return this.buffer.subarray(0, this.activeEdgeCount * EDGE_INSTANCE_STRIDE_FLOATS);
  }

  private ensureCapacity(requiredEdges: number): void {
    if (requiredEdges <= this.capacityEdges) return;
    let nextCap = this.capacityEdges;
    while (nextCap < requiredEdges) {
      nextCap = nextCap < 65_536 ? nextCap * 2 : nextCap + 32_768;
    }
    const nextBuffer = new Float32Array(nextCap * EDGE_INSTANCE_STRIDE_FLOATS);
    nextBuffer.set(this.buffer.subarray(0, this.activeEdgeCount * EDGE_INSTANCE_STRIDE_FLOATS));
    this.buffer = nextBuffer;
    this.capacityEdges = nextCap;
  }

  /**
   * Synchronizes the 48-byte instanced edge buffer from `CollectionNodeView` (including proxy ViewLinks).
   */
  public syncFromView(collectionView: CollectionNodeView): void {
    const viewLinks = collectionView.getViewLinks();
    const viewEntities = collectionView.getViewEntities();
    this.ensureCapacity(viewLinks.size);

    this.linkToSlot.clear();
    this.slotToLink.length = 0;

    const buf = this.buffer;
    let slot = 0;

    for (const vl of viewLinks.values()) {
      const srcEntity = viewEntities.get(vl.sourceViewEntityId);
      const trgEntity = viewEntities.get(vl.targetViewEntityId);
      if (!srcEntity || !trgEntity) continue;

      this.linkToSlot.set(vl.id, slot);
      this.slotToLink.push(vl.id);

      let weight = vl.underlyingLinks.size;
      let isReversed = false;
      if (!vl.isProxy) {
        const physData = collectionView.underlyingStore.dataStore.tryGetLink(vl.id);
        const physEdge = collectionView.underlyingStore.structureStore.links.get(vl.id);
        if (physData) weight = physData.weight;
        if (physEdge) isReversed = physEdge.isReversed;
      }

      const base = slot * EDGE_INSTANCE_STRIDE_FLOATS;
      const thickness = Math.min(8.0, 1.5 + Math.log2(Math.max(1, weight)) * 0.75);
      const styleFlag = vl.isProxy ? 2.0 : 0.0;
      const reversedFlag = isReversed ? 1.0 : 0.0;

      // Offset 0..1: sourcePos
      buf[base + 0] = srcEntity.position.x;
      buf[base + 1] = srcEntity.position.y;
      // Offset 2..3: targetPos
      buf[base + 2] = trgEntity.position.x;
      buf[base + 3] = trgEntity.position.y;
      // Offset 4..7: colorRgba
      if (vl.isProxy) {
        buf[base + 4] = 0.45;
        buf[base + 5] = 0.78;
        buf[base + 6] = 0.98;
        buf[base + 7] = 0.85;
      } else {
        buf[base + 4] = 0.58;
        buf[base + 5] = 0.64;
        buf[base + 6] = 0.72;
        buf[base + 7] = 0.75;
      }
      // Offset 8: thickness
      buf[base + 8] = thickness;
      // Offset 9: styleFlag
      buf[base + 9] = styleFlag;
      // Offset 10: reversedFlag
      buf[base + 10] = reversedFlag;
      // Offset 11: selectionFlag
      buf[base + 11] = 0.0;

      slot++;
    }

    this.activeEdgeCount = slot;
  }

  public unpackEdgeAtSlot(slot: number): UnpackedEdgeInstance {
    if (slot < 0 || slot >= this.activeEdgeCount) {
      throw new RangeError(`Edge slot ${slot} out of range [0, ${this.activeEdgeCount})`);
    }
    const base = slot * EDGE_INSTANCE_STRIDE_FLOATS;
    const b = this.buffer;
    return {
      linkId: this.slotToLink[slot]!,
      sourceX: b[base + 0]!,
      sourceY: b[base + 1]!,
      targetX: b[base + 2]!,
      targetY: b[base + 3]!,
      colorRgba: [b[base + 4]!, b[base + 5]!, b[base + 6]!, b[base + 7]!],
      thickness: b[base + 8]!,
      styleFlag: b[base + 9]!,
      reversedFlag: b[base + 10]!,
      selectionFlag: b[base + 11]!,
    };
  }
}
