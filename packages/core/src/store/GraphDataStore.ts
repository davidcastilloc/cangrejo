import { Guid, GuidMap, type EntityID, type LinkID } from '../identity/Guid.js';
import { EntityNotFoundException, LinkNotFoundException } from '../result/Result.js';

export type PropertyValueType =
  | 'string'
  | 'int'
  | 'float'
  | 'bool'
  | 'datetime'
  | 'date'
  | 'color'
  | 'url'
  | 'image'
  | 'ipaddress'
  | 'phonenumber'
  | 'bytes'
  | 'string[]'
  | 'object';

export type SpecialPropertyRole = 'VALUE' | 'DISPLAY_VALUE' | 'IMAGE_URL';
export type PropertyMatchingRuleType = 'STRICT' | 'LOOSE' | 'NONE';

export interface PropertyDescriptor {
  name: string;
  type: PropertyValueType;
  displayName: string;
  nullable: boolean;
  hidden: boolean;
  readonly: boolean;
  specialRoles: SpecialPropertyRole[];
  matchingRule: PropertyMatchingRuleType;
  defaultValue?: unknown;
  sampleValue?: unknown;
  description?: string;
}

export interface PropertyBag {
  descriptors: Map<string, PropertyDescriptor>;
  values: Map<string, unknown>;
}

export interface EntityNotes {
  value: string;
  show: boolean;
}

export interface DisplayInformation {
  title: string;
  content: string;
  type: 'text/plain' | 'text/html' | 'text/markdown';
}

export type OverlayPosition = 'NW' | 'N' | 'NE' | 'W' | 'C' | 'E' | 'SW' | 'S' | 'SE';
export type OverlayType = 'text' | 'image' | 'color';

export interface EntityOverlay {
  propertyName: string;
  position: OverlayPosition;
  type: OverlayType;
}

export interface AttachmentRef {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface MaltegoEntityData {
  id: EntityID;
  typeName: string;
  weight: number;
  bookmark: number;
  notes: EntityNotes;
  displayInfo: DisplayInformation[];
  overlays: EntityOverlay[];
  properties: PropertyBag;
  attachments: AttachmentRef[];
  createdAt?: number;
}

export interface MaltegoLinkData {
  id: LinkID;
  typeName: string;
  weight: number;
  bookmark: number;
  notes: EntityNotes;
  displayInfo: DisplayInformation[];
  properties: PropertyBag;
}

export function createPropertyBag(
  initial?: Array<{ descriptor: PropertyDescriptor; value?: unknown }>
): PropertyBag {
  const descriptors = new Map<string, PropertyDescriptor>();
  const values = new Map<string, unknown>();
  if (initial) {
    for (const item of initial) {
      descriptors.set(item.descriptor.name, {
        ...item.descriptor,
        specialRoles: [...item.descriptor.specialRoles],
      });
      if (item.value !== undefined) {
        values.set(item.descriptor.name, item.value);
      } else if (item.descriptor.defaultValue !== undefined) {
        values.set(item.descriptor.name, item.descriptor.defaultValue);
      }
    }
  }
  return { descriptors, values };
}

export function clonePropertyBag(bag: PropertyBag): PropertyBag {
  const descriptors = new Map<string, PropertyDescriptor>();
  for (const [k, d] of bag.descriptors.entries()) {
    descriptors.set(k, { ...d, specialRoles: [...d.specialRoles] });
  }
  const values = new Map<string, unknown>(bag.values);
  return { descriptors, values };
}

export function cloneEntityData(entity: MaltegoEntityData): MaltegoEntityData {
  return {
    id: entity.id,
    typeName: entity.typeName,
    weight: entity.weight,
    bookmark: entity.bookmark,
    notes: { ...entity.notes },
    displayInfo: entity.displayInfo.map((d) => ({ ...d })),
    overlays: entity.overlays.map((o) => ({ ...o })),
    properties: clonePropertyBag(entity.properties),
    attachments: entity.attachments.map((a) => ({ ...a })),
    createdAt: entity.createdAt,
  };
}

export function cloneLinkData(link: MaltegoLinkData): MaltegoLinkData {
  return {
    id: link.id,
    typeName: link.typeName,
    weight: link.weight,
    bookmark: link.bookmark,
    notes: { ...link.notes },
    displayInfo: link.displayInfo.map((d) => ({ ...d })),
    properties: clonePropertyBag(link.properties),
  };
}

/**
 * Extracts the primary `VALUE` of an entity or link from its `PropertyBag`.
 */
export function getPartPrimaryValue(part: MaltegoEntityData | MaltegoLinkData): string {
  for (const [propName, desc] of part.properties.descriptors.entries()) {
    if (desc.specialRoles.includes('VALUE')) {
      const val = part.properties.values.get(propName);
      if (val !== undefined && val !== null) {
        return String(val);
      }
    }
  }
  // Fallback to first available value or 'value' property
  if (part.properties.values.has('value')) {
    return String(part.properties.values.get('value') ?? '');
  }
  const firstVal = part.properties.values.values().next();
  return firstVal.done ? '' : String(firstVal.value ?? '');
}

/**
 * Sets the primary `VALUE` of an entity or link in its `PropertyBag`.
 */
export function setPartPrimaryValue(part: MaltegoEntityData | MaltegoLinkData, newValue: unknown): void {
  for (const [propName, desc] of part.properties.descriptors.entries()) {
    if (desc.specialRoles.includes('VALUE')) {
      part.properties.values.set(propName, newValue);
      return;
    }
  }
  const defaultKey = 'value';
  if (!part.properties.descriptors.has(defaultKey)) {
    part.properties.descriptors.set(defaultKey, {
      name: defaultKey,
      type: 'string',
      displayName: 'Value',
      nullable: false,
      hidden: false,
      readonly: false,
      specialRoles: ['VALUE', 'DISPLAY_VALUE'],
      matchingRule: 'STRICT',
    });
  }
  part.properties.values.set(defaultKey, newValue);
}

/**
 * Evaluates the display value of an entity or link, supporting `$(propName)` template substitution.
 */
export function getPartDisplayValue(part: MaltegoEntityData | MaltegoLinkData, templateExpr?: string): string {
  if (templateExpr && templateExpr.includes('$(')) {
    return templateExpr.replace(/\$\(([^)]+)\)/g, (_m, propName: string) => {
      const v = part.properties.values.get(propName.trim());
      return v !== undefined && v !== null ? String(v) : '';
    }).trim();
  }
  for (const [propName, desc] of part.properties.descriptors.entries()) {
    if (desc.specialRoles.includes('DISPLAY_VALUE')) {
      const val = part.properties.values.get(propName);
      if (val !== undefined && val !== null && String(val).length > 0) {
        return String(val);
      }
    }
  }
  return getPartPrimaryValue(part);
}

/**
 * Semantic Store (`GraphDataStore`) managing typed entity/link attributes, provenance (`DisplayInformation`),
 * sticky notes, bookmarks, overlays, and binary attachment references.
 */
export class GraphDataStore {
  private readonly entities = new GuidMap<MaltegoEntityData>();
  private readonly links = new GuidMap<MaltegoLinkData>();

  public get entityCount(): number {
    return this.entities.size;
  }

  public get linkCount(): number {
    return this.links.size;
  }

  public hasEntity(entityId: EntityID): boolean {
    return this.entities.has(entityId);
  }

  public getEntity(entityId: EntityID): MaltegoEntityData {
    const found = this.entities.get(entityId);
    if (!found) {
      throw new EntityNotFoundException(entityId);
    }
    return found;
  }

  public tryGetEntity(entityId: EntityID): MaltegoEntityData | undefined {
    return this.entities.get(entityId);
  }

  public getEntities(): ReadonlyMap<Guid, MaltegoEntityData> {
    return this.entities;
  }

  public addEntity(entity: MaltegoEntityData): void {
    this.entities.set(entity.id, cloneEntityData(entity));
  }

  public putEntity(entity: MaltegoEntityData): void {
    this.entities.set(entity.id, cloneEntityData(entity));
  }

  public removeEntity(entityId: EntityID): MaltegoEntityData | undefined {
    const existing = this.entities.get(entityId);
    if (existing) {
      this.entities.delete(entityId);
    }
    return existing;
  }

  public hasLink(linkId: LinkID): boolean {
    return this.links.has(linkId);
  }

  public getLink(linkId: LinkID): MaltegoLinkData {
    const found = this.links.get(linkId);
    if (!found) {
      throw new LinkNotFoundException(linkId);
    }
    return found;
  }

  public tryGetLink(linkId: LinkID): MaltegoLinkData | undefined {
    return this.links.get(linkId);
  }

  public getLinks(): ReadonlyMap<Guid, MaltegoLinkData> {
    return this.links;
  }

  public addLink(link: MaltegoLinkData): void {
    this.links.set(link.id, cloneLinkData(link));
  }

  public putLink(link: MaltegoLinkData): void {
    this.links.set(link.id, cloneLinkData(link));
  }

  public removeLink(linkId: LinkID): MaltegoLinkData | undefined {
    const existing = this.links.get(linkId);
    if (existing) {
      this.links.delete(linkId);
    }
    return existing;
  }

  public clear(): void {
    this.entities.clear();
    this.links.clear();
  }
}
