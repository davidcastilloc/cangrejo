import type { EntityID, LinkID } from '../identity/Guid.js';

export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Thrown when attempting to connect a link whose source or target entity is not registered in `GraphStructureStore`.
 */
export class DanglingLinkException extends Error {
  public readonly linkId: LinkID;
  public readonly missingEntityId: EntityID;
  public readonly endpointRole: 'source' | 'target';

  public constructor(linkId: LinkID, missingEntityId: EntityID, endpointRole: 'source' | 'target') {
    super(
      `DanglingLinkException: Cannot add link ${linkId.toString()} because ${endpointRole} entity ${missingEntityId.toString()} does not exist in GraphStructureStore.`
    );
    this.name = 'DanglingLinkException';
    this.linkId = linkId;
    this.missingEntityId = missingEntityId;
    this.endpointRole = endpointRole;
  }
}

export class EntityNotFoundException extends Error {
  public readonly entityId: EntityID;

  public constructor(entityId: EntityID) {
    super(`EntityNotFoundException: Entity ${entityId.toString()} does not exist in store.`);
    this.name = 'EntityNotFoundException';
    this.entityId = entityId;
  }
}

export class LinkNotFoundException extends Error {
  public readonly linkId: LinkID;

  public constructor(linkId: LinkID) {
    super(`LinkNotFoundException: Link ${linkId.toString()} does not exist in store.`);
    this.name = 'LinkNotFoundException';
    this.linkId = linkId;
  }
}
