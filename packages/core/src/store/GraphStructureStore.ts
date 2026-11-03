import { GuidMap, GuidSet, type EntityID, type LinkID } from '../identity/Guid.js';
import { DanglingLinkException, EntityNotFoundException, LinkNotFoundException } from '../result/Result.js';

export interface StructureEntityNode {
  readonly id: EntityID;
  readonly incoming: GuidSet;
  readonly outgoing: GuidSet;
}

export interface StructureLinkEdge {
  readonly id: LinkID;
  readonly source: EntityID;
  readonly target: EntityID;
  isReversed: boolean;
}

/**
 * Topological Store (`GraphStructureStore`) maintaining O(1) directed multigraph adjacency sets
 * and enforcing strict referential integrity (zero dangling links).
 */
export class GraphStructureStore {
  public readonly entities = new GuidMap<StructureEntityNode>();
  public readonly links = new GuidMap<StructureLinkEdge>();

  public get entityCount(): number {
    return this.entities.size;
  }

  public get linkCount(): number {
    return this.links.size;
  }

  public hasEntity(entityId: EntityID): boolean {
    return this.entities.has(entityId);
  }

  public hasLink(linkId: LinkID): boolean {
    return this.links.has(linkId);
  }

  public getLinkEndpoints(linkId: LinkID): StructureLinkEdge {
    const edge = this.links.get(linkId);
    if (!edge) {
      throw new LinkNotFoundException(linkId);
    }
    return edge;
  }

  public getIncomingLinks(entityId: EntityID): ReadonlySet<LinkID> {
    const node = this.entities.get(entityId);
    if (!node) {
      throw new EntityNotFoundException(entityId);
    }
    return node.incoming;
  }

  public getOutgoingLinks(entityId: EntityID): ReadonlySet<LinkID> {
    const node = this.entities.get(entityId);
    if (!node) {
      throw new EntityNotFoundException(entityId);
    }
    return node.outgoing;
  }

  public getIncidentLinks(entityId: EntityID): ReadonlySet<LinkID> {
    const node = this.entities.get(entityId);
    if (!node) {
      throw new EntityNotFoundException(entityId);
    }
    const incident = new GuidSet(node.incoming);
    for (const outId of node.outgoing) {
      incident.add(outId);
    }
    return incident;
  }

  public getInDegree(entityId: EntityID): number {
    return this.getIncomingLinks(entityId).size;
  }

  public getOutDegree(entityId: EntityID): number {
    return this.getOutgoingLinks(entityId).size;
  }

  public getDegree(entityId: EntityID): number {
    const node = this.entities.get(entityId);
    if (!node) {
      throw new EntityNotFoundException(entityId);
    }
    return node.incoming.size + node.outgoing.size;
  }

  /**
   * Returns the set of distinct neighboring entities connected to `entityId`
   * (excluding self-loops from counting as an external neighbor).
   */
  public getNeighbors(entityId: EntityID): ReadonlySet<EntityID> {
    const node = this.entities.get(entityId);
    if (!node) {
      throw new EntityNotFoundException(entityId);
    }
    const neighbors = new GuidSet();
    for (const inLinkId of node.incoming) {
      const edge = this.links.get(inLinkId);
      if (edge && !edge.source.equals(entityId)) {
        neighbors.add(edge.source);
      }
    }
    for (const outLinkId of node.outgoing) {
      const edge = this.links.get(outLinkId);
      if (edge && !edge.target.equals(entityId)) {
        neighbors.add(edge.target);
      }
    }
    return neighbors;
  }

  public hasLinks(entityId: EntityID): boolean {
    const node = this.entities.get(entityId);
    if (!node) {
      throw new EntityNotFoundException(entityId);
    }
    return node.incoming.size > 0 || node.outgoing.size > 0;
  }

  public addEntity(entityId: EntityID): void {
    if (!this.entities.has(entityId)) {
      this.entities.set(entityId, {
        id: entityId,
        incoming: new GuidSet(),
        outgoing: new GuidSet(),
      });
    }
  }

  /**
   * Atomically removes `entityId` and cascades deletion to all incident links.
   * Returns the set of `LinkID`s that were removed during cascading cleanup.
   */
  public removeEntity(entityId: EntityID): GuidSet {
    const node = this.entities.get(entityId);
    const removedLinks = new GuidSet();
    if (!node) {
      return removedLinks;
    }

    for (const inLinkId of node.incoming.toArray()) {
      removedLinks.add(inLinkId);
      this.removeLink(inLinkId);
    }
    for (const outLinkId of node.outgoing.toArray()) {
      removedLinks.add(outLinkId);
      this.removeLink(outLinkId);
    }

    this.entities.delete(entityId);
    return removedLinks;
  }

  public addLink(linkId: LinkID, source: EntityID, target: EntityID, isReversed = false): void {
    const srcNode = this.entities.get(source);
    if (!srcNode) {
      throw new DanglingLinkException(linkId, source, 'source');
    }
    const trgNode = this.entities.get(target);
    if (!trgNode) {
      throw new DanglingLinkException(linkId, target, 'target');
    }

    if (this.links.has(linkId)) {
      this.removeLink(linkId);
    }

    this.links.set(linkId, {
      id: linkId,
      source,
      target,
      isReversed,
    });
    srcNode.outgoing.add(linkId);
    trgNode.incoming.add(linkId);
  }

  public removeLink(linkId: LinkID): StructureLinkEdge | undefined {
    const edge = this.links.get(linkId);
    if (!edge) {
      return undefined;
    }
    const srcNode = this.entities.get(edge.source);
    if (srcNode) {
      srcNode.outgoing.delete(linkId);
    }
    const trgNode = this.entities.get(edge.target);
    if (trgNode) {
      trgNode.incoming.delete(linkId);
    }
    this.links.delete(linkId);
    return edge;
  }

  public isReversed(linkId: LinkID): boolean {
    const edge = this.links.get(linkId);
    if (!edge) {
      throw new LinkNotFoundException(linkId);
    }
    return edge.isReversed;
  }

  public setReversed(linkId: LinkID, reversed: boolean): void {
    const edge = this.links.get(linkId);
    if (!edge) {
      throw new LinkNotFoundException(linkId);
    }
    edge.isReversed = reversed;
  }

  /**
   * Returns all links connecting `entityA` and `entityB` in either direction.
   */
  public getLinksBetween(entityA: EntityID, entityB: EntityID): GuidSet {
    const nodeA = this.entities.get(entityA);
    const result = new GuidSet();
    if (!nodeA) return result;
    for (const outId of nodeA.outgoing) {
      const edge = this.links.get(outId);
      if (edge && edge.target.equals(entityB)) {
        result.add(outId);
      }
    }
    for (const inId of nodeA.incoming) {
      const edge = this.links.get(inId);
      if (edge && edge.source.equals(entityB)) {
        result.add(inId);
      }
    }
    return result;
  }

  public clear(): void {
    this.entities.clear();
    this.links.clear();
  }
}
