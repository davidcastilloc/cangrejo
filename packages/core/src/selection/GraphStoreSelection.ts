import { GuidSet, type EntityID } from '../identity/Guid.js';
import type { CollectionNodeView } from '../collection/CollectionNodeView.js';

/**
 * Bi-directional Model vs. View Selection Coordinator (`GraphStoreSelection`).
 * Selecting a collapsed `ViewEntity` collection node in the view automatically selects
 * all of its underlying physical `EntityID`s in the model layer in `O(1)` per member.
 */
export class GraphStoreSelection {
  private readonly collectionView: CollectionNodeView;
  private readonly viewSelected = new GuidSet();
  private readonly modelSelected = new GuidSet();
  private readonly listeners = new Set<() => void>();

  public constructor(collectionView: CollectionNodeView) {
    this.collectionView = collectionView;
  }

  public getViewSelectedEntities(): ReadonlySet<EntityID> {
    return this.viewSelected;
  }

  public getModelSelectedEntities(): ReadonlySet<EntityID> {
    return this.modelSelected;
  }

  public isViewEntitySelected(viewEntityId: EntityID): boolean {
    return this.viewSelected.has(viewEntityId);
  }

  public isModelEntitySelected(modelEntityId: EntityID): boolean {
    return this.modelSelected.has(modelEntityId);
  }

  /**
   * Selects one or more `ViewEntity` IDs in the viewport (e.g. a regular node or a CollectionNode)
   * and synchronizes `modelSelected` with all underlying physical entities.
   */
  public selectInView(viewEntityIds: Iterable<EntityID>, additive = false): void {
    if (!additive) {
      this.viewSelected.clear();
      this.modelSelected.clear();
    }
    const viewEntitiesMap = this.collectionView.getViewEntities();
    for (const viewId of viewEntityIds) {
      const ve = viewEntitiesMap.get(viewId);
      if (ve) {
        this.viewSelected.add(ve.id);
        for (const physId of ve.underlyingEntities) {
          this.modelSelected.add(physId);
        }
      } else if (this.collectionView.underlyingStore.dataStore.hasEntity(viewId)) {
        const mappedViewId = this.collectionView.getViewEntityIdForPhysical(viewId);
        this.viewSelected.add(mappedViewId);
        this.modelSelected.add(viewId);
      }
    }
    this.notifyListeners();
  }

  /**
   * Selects physical `EntityID`s directly in the model layer and synchronizes `viewSelected`
   * with their corresponding `ViewEntity` representations.
   */
  public selectInModel(modelEntityIds: Iterable<EntityID>, additive = false): void {
    if (!additive) {
      this.viewSelected.clear();
      this.modelSelected.clear();
    }
    for (const physId of modelEntityIds) {
      if (!this.collectionView.underlyingStore.dataStore.hasEntity(physId)) continue;
      this.modelSelected.add(physId);
      const viewId = this.collectionView.getViewEntityIdForPhysical(physId);
      this.viewSelected.add(viewId);
    }
    this.notifyListeners();
  }

  public clearSelection(): void {
    if (this.viewSelected.size === 0 && this.modelSelected.size === 0) return;
    this.viewSelected.clear();
    this.modelSelected.clear();
    this.notifyListeners();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const l of this.listeners) {
      l();
    }
  }
}
