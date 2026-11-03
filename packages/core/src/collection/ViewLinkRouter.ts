import { Guid, GuidMap, GuidSet, type EntityID, type LinkID } from '../identity/Guid.js';
import type { Point2D } from '../store/GraphLayoutStore.js';
import type { GraphStore } from '../store/GraphStore.js';

export interface ViewLink {
  readonly id: LinkID;
  readonly sourceViewEntityId: EntityID;
  readonly targetViewEntityId: EntityID;
  readonly isProxy: boolean;
  readonly underlyingLinks: GuidSet;
  readonly path: Point2D[];
}

/**
 * Computes the projected set of `ViewLink` edges (both pass-through physical links and
 * aggregated proxy links connecting `ViewEntity` collection nodes).
 */
export function buildViewLinks(
  store: GraphStore,
  physicalToCollectionMap: ReadonlyMap<EntityID, EntityID>,
  existingProxyIdCache: Map<string, LinkID>
): GuidMap<ViewLink> {
  const viewLinks = new GuidMap<ViewLink>();
  const proxyGroups = new Map<
    string,
    {
      sourceViewId: EntityID;
      targetViewId: EntityID;
      underlyingLinks: GuidSet;
    }
  >();

  for (const [linkId, edge] of store.structureStore.links.entries()) {
    const viewSource = physicalToCollectionMap.get(edge.source) ?? edge.source;
    const viewTarget = physicalToCollectionMap.get(edge.target) ?? edge.target;

    const isSourceCollected = !viewSource.equals(edge.source);
    const isTargetCollected = !viewTarget.equals(edge.target);

    if (!isSourceCollected && !isTargetCollected) {
      // Uncollected pass-through link
      viewLinks.set(linkId, {
        id: linkId,
        sourceViewEntityId: viewSource,
        targetViewEntityId: viewTarget,
        isProxy: false,
        underlyingLinks: new GuidSet([linkId]),
        path: store.layoutStore.getLinkPath(linkId),
      });
    } else {
      // At least one endpoint belongs to a virtual collection node: route through a proxy ViewLink
      const groupKey = `${viewSource.toString()}->${viewTarget.toString()}`;
      let group = proxyGroups.get(groupKey);
      if (!group) {
        group = {
          sourceViewId: viewSource,
          targetViewId: viewTarget,
          underlyingLinks: new GuidSet(),
        };
        proxyGroups.set(groupKey, group);
      }
      group.underlyingLinks.add(linkId);
    }
  }

  for (const [groupKey, group] of proxyGroups.entries()) {
    let proxyId = existingProxyIdCache.get(groupKey);
    if (!proxyId) {
      proxyId = Guid.generate();
      existingProxyIdCache.set(groupKey, proxyId);
    }
    viewLinks.set(proxyId, {
      id: proxyId,
      sourceViewEntityId: group.sourceViewId,
      targetViewEntityId: group.targetViewId,
      isProxy: true,
      underlyingLinks: group.underlyingLinks,
      path: [],
    });
  }

  return viewLinks;
}
