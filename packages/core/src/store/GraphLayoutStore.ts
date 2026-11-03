import { GuidMap, GuidSet, type EntityID, type LinkID } from '../identity/Guid.js';

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D extends Point2D {
  z: number;
}

export interface BoundingBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Spatial Store (`GraphLayoutStore`) managing 2D/3D Cartesian coordinates, polyline bend paths,
 * and positional pin locks.
 */
export class GraphLayoutStore {
  public readonly entityCoordinates = new GuidMap<Point3D>();
  public readonly linkPaths = new GuidMap<Point2D[]>();
  public readonly pinnedEntities = new GuidSet();

  public getPosition(entityId: EntityID): Point3D {
    const pos = this.entityCoordinates.get(entityId);
    if (!pos) {
      return { x: 0, y: 0, z: 0 };
    }
    return { x: pos.x, y: pos.y, z: pos.z };
  }

  public setPosition(entityId: EntityID, position: Point2D | Point3D): Point3D {
    const rawZ = 'z' in position && typeof position.z === 'number' ? position.z : 0;
    const normalized: Point3D = {
      x: position.x === 0 ? 0 : position.x,
      y: position.y === 0 ? 0 : position.y,
      z: rawZ === 0 ? 0 : rawZ,
    };
    this.entityCoordinates.set(entityId, normalized);
    return normalized;
  }

  public setPositions(positions: ReadonlyMap<EntityID, Point2D | Point3D>): void {
    for (const [id, pos] of positions.entries()) {
      this.setPosition(id, pos);
    }
  }

  public getLinkPath(linkId: LinkID): Point2D[] {
    const bends = this.linkPaths.get(linkId);
    if (!bends) return [];
    return bends.map((pt) => ({ x: pt.x, y: pt.y }));
  }

  public setLinkPath(linkId: LinkID, bends: Point2D[]): Point2D[] {
    const copy = bends.map((pt) => ({
      x: pt.x === 0 ? 0 : pt.x,
      y: pt.y === 0 ? 0 : pt.y,
    }));
    this.linkPaths.set(linkId, copy);
    return copy;
  }

  public isPinned(entityId: EntityID): boolean {
    return this.pinnedEntities.has(entityId);
  }

  public setPinned(entityId: EntityID, pinned: boolean): void {
    if (pinned) {
      this.pinnedEntities.add(entityId);
    } else {
      this.pinnedEntities.delete(entityId);
    }
  }

  public removeEntity(entityId: EntityID): void {
    this.entityCoordinates.delete(entityId);
    this.pinnedEntities.delete(entityId);
  }

  public removeLink(linkId: LinkID): void {
    this.linkPaths.delete(linkId);
  }

  public clear(): void {
    this.entityCoordinates.clear();
    this.linkPaths.clear();
    this.pinnedEntities.clear();
  }

  public computeBoundingBox(): BoundingBox2D | null {
    if (this.entityCoordinates.size === 0) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const pt of this.entityCoordinates.values()) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
    return { minX, minY, maxX, maxY };
  }
}
