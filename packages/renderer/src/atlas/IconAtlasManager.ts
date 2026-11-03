import { STANDARD_ENTITIES_CATALOG } from '@cangrejo/core';

export type RgbaTuple = readonly [number, number, number, number];

export interface IconAtlasSlot {
  readonly entityTypeName: string;
  readonly iconName: string;
  readonly category: string;
  readonly atlasIndex: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  readonly baseTintRgba: RgbaTuple;
}

const CATEGORY_TINTS: Record<string, RgbaTuple> = {
  infrastructure: [0.22, 0.58, 0.96, 1.0],
  devices: [0.95, 0.68, 0.18, 1.0],
  personal: [0.28, 0.82, 0.54, 1.0],
  groups: [0.64, 0.42, 0.94, 1.0],
  locations: [0.18, 0.78, 0.76, 1.0],
  events: [0.94, 0.44, 0.36, 1.0],
  financial: [0.88, 0.76, 0.24, 1.0],
  malware: [0.92, 0.22, 0.32, 1.0],
  'penetration-testing': [0.96, 0.48, 0.16, 1.0],
  'social-network': [0.34, 0.66, 0.98, 1.0],
  telecommunications: [0.46, 0.84, 0.38, 1.0],
  wireless: [0.26, 0.74, 0.88, 1.0],
};

const DEFAULT_TINT: RgbaTuple = [0.65, 0.72, 0.82, 1.0];

/**
 * 24-color analyst bookmark palette (indices 0..23) matching Maltego's bookmark system.
 */
export const BOOKMARK_PALETTE_RGBA: readonly RgbaTuple[] = [
  [0.95, 0.26, 0.21, 1.0], // 0: Red
  [0.91, 0.12, 0.39, 1.0], // 1: Pink
  [0.61, 0.15, 0.69, 1.0], // 2: Purple
  [0.40, 0.23, 0.72, 1.0], // 3: Deep Purple
  [0.25, 0.32, 0.71, 1.0], // 4: Indigo
  [0.13, 0.59, 0.95, 1.0], // 5: Blue
  [0.01, 0.66, 0.96, 1.0], // 6: Light Blue
  [0.00, 0.74, 0.83, 1.0], // 7: Cyan
  [0.00, 0.59, 0.53, 1.0], // 8: Teal
  [0.30, 0.69, 0.31, 1.0], // 9: Green
  [0.55, 0.76, 0.29, 1.0], // 10: Light Green
  [0.80, 0.86, 0.22, 1.0], // 11: Lime
  [1.00, 0.92, 0.23, 1.0], // 12: Yellow
  [1.00, 0.76, 0.03, 1.0], // 13: Amber
  [1.00, 0.60, 0.00, 1.0], // 14: Orange
  [1.00, 0.34, 0.13, 1.0], // 15: Deep Orange
  [0.47, 0.33, 0.28, 1.0], // 16: Brown
  [0.62, 0.62, 0.62, 1.0], // 17: Grey
  [0.38, 0.49, 0.55, 1.0], // 18: Blue Grey
  [0.85, 0.18, 0.18, 1.0], // 19: Crimson
  [0.18, 0.80, 0.44, 1.0], // 20: Emerald
  [0.20, 0.60, 0.86, 1.0], // 21: Dodger Blue
  [0.95, 0.61, 0.07, 1.0], // 22: Carrot
  [0.56, 0.27, 0.68, 1.0], // 23: Wisteria
];

export const SELECTION_HALO_RGBA: RgbaTuple = [0.0, 0.92, 1.0, 1.0];
export const TRANSPARENT_HALO_RGBA: RgbaTuple = [0.0, 0.0, 0.0, 0.0];

/**
 * Manages the `4096 x 4096` GPU Spritesheet Texture Atlas packing all 107 standard entity SVG icons
 * (plus dynamic custom entity icons) so all node types render in a single instanced GPU draw call.
 */
export class IconAtlasManager {
  public static readonly ATLAS_DIMENSION_PX = 4096;
  public static readonly GRID_DIMENSION = 11; // 11 x 11 = 121 icon slots
  public static readonly GUTTER_PX = 2;

  private readonly slotsByType = new Map<string, IconAtlasSlot>();
  private readonly fallbackSlot: IconAtlasSlot;

  public constructor() {
    for (let i = 0; i < STANDARD_ENTITIES_CATALOG.length; i++) {
      const spec = STANDARD_ENTITIES_CATALOG[i]!;
      this.registerEntityIcon(spec.id, spec.icon, spec.category, i);
    }

    this.fallbackSlot =
      this.slotsByType.get('maltego.Phrase') ??
      this.registerEntityIcon('maltego.Unknown', 'Unknown', 'personal', 0);
  }

  public get slotCount(): number {
    return this.slotsByType.size;
  }

  public registerEntityIcon(
    entityTypeName: string,
    iconName: string,
    category: string,
    explicitIndex?: number
  ): IconAtlasSlot {
    const existing = this.slotsByType.get(entityTypeName);
    if (existing) return existing;

    const index = explicitIndex ?? this.slotsByType.size;
    const grid = IconAtlasManager.GRID_DIMENSION;
    const col = index % grid;
    const row = Math.floor(index / grid);

    const cellPx = IconAtlasManager.ATLAS_DIMENSION_PX / grid;
    const padUv = IconAtlasManager.GUTTER_PX / IconAtlasManager.ATLAS_DIMENSION_PX;
    const u0 = (col * cellPx) / IconAtlasManager.ATLAS_DIMENSION_PX + padUv;
    const v0 = (row * cellPx) / IconAtlasManager.ATLAS_DIMENSION_PX + padUv;
    const u1 = ((col + 1) * cellPx) / IconAtlasManager.ATLAS_DIMENSION_PX - padUv;
    const v1 = ((row + 1) * cellPx) / IconAtlasManager.ATLAS_DIMENSION_PX - padUv;

    const baseTintRgba = CATEGORY_TINTS[category.toLowerCase()] ?? DEFAULT_TINT;

    const slot: IconAtlasSlot = {
      entityTypeName,
      iconName,
      category,
      atlasIndex: index,
      u0,
      v0,
      u1,
      v1,
      baseTintRgba,
    };

    this.slotsByType.set(entityTypeName, slot);
    return slot;
  }

  public getIconSlot(entityTypeName: string): IconAtlasSlot {
    return this.slotsByType.get(entityTypeName) ?? this.fallbackSlot;
  }

  public resolveHaloRgba(isSelected: boolean, bookmarkIndex: number): RgbaTuple {
    if (isSelected) {
      return SELECTION_HALO_RGBA;
    }
    if (bookmarkIndex >= 0 && bookmarkIndex < BOOKMARK_PALETTE_RGBA.length) {
      return BOOKMARK_PALETTE_RGBA[bookmarkIndex]!;
    }
    return TRANSPARENT_HALO_RGBA;
  }
}
