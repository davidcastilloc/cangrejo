import { Guid, type EntityID } from '../identity/Guid.js';
import {
  createPropertyBag,
  type MaltegoEntityData,
  type PropertyDescriptor,
  type PropertyValueType,
  type SpecialPropertyRole,
} from '../store/GraphDataStore.js';
import {
  STANDARD_ENTITIES_CATALOG,
  type EntityFieldSpec,
  type EntitySpec,
} from './StandardEntitiesCatalog.js';

function mapFieldTypeToPropertyType(rawType: string | undefined): PropertyValueType {
  switch ((rawType ?? 'string').toLowerCase()) {
    case 'int':
    case 'integer':
    case 'long':
    case 'byte':
      return 'int';
    case 'double':
    case 'float':
      return 'float';
    case 'boolean':
    case 'bool':
      return 'bool';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'color':
      return 'color';
    case 'url':
      return 'url';
    case 'image':
      return 'image';
    case 'ipaddress':
      return 'ipaddress';
    case 'phonenumber':
      return 'phonenumber';
    case 'string[]':
    case 'array':
      return 'string[]';
    default:
      return 'string';
  }
}

/**
 * Registry of built-in (107 standard entities across 12 categories and 32 roots) and user-defined `.entity` specifications.
 * Supports single-inheritance resolution (`baseEntity`) for fields and primary value properties.
 */
export class EntityRegistry {
  private readonly specs = new Map<string, EntitySpec>();

  public constructor(loadStandardCatalog = true) {
    if (loadStandardCatalog) {
      for (const spec of STANDARD_ENTITIES_CATALOG) {
        this.register(spec);
      }
    }
  }

  public get size(): number {
    return this.specs.size;
  }

  public register(spec: EntitySpec): void {
    this.specs.set(spec.id, {
      ...spec,
      fields: spec.fields.map((f) => ({ ...f })),
    });
  }

  public unregister(typeName: string): boolean {
    return this.specs.delete(typeName);
  }

  public has(typeName: string): boolean {
    return this.specs.has(typeName);
  }

  public get(typeName: string): EntitySpec | undefined {
    return this.specs.get(typeName);
  }

  public getAll(): EntitySpec[] {
    return Array.from(this.specs.values());
  }

  public getRootEntities(): EntitySpec[] {
    return Array.from(this.specs.values()).filter((s) => s.baseEntity === null);
  }

  public getCategories(): string[] {
    const cats = new Set<string>();
    for (const s of this.specs.values()) {
      cats.add(s.category);
    }
    return Array.from(cats).sort();
  }

  /**
   * Resolves the inheritance chain (`[rootSpec, ..., leafSpec]`) for `typeName`,
   * protecting against cyclic `baseEntity` references.
   */
  public getInheritanceChain(typeName: string): EntitySpec[] {
    const chain: EntitySpec[] = [];
    const visited = new Set<string>();
    let current = this.specs.get(typeName);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.unshift(current);
      current = current.baseEntity ? this.specs.get(current.baseEntity) : undefined;
    }
    return chain;
  }

  /**
   * Returns true if `typeName` equals `ancestorTypeName` or inherits from it.
   */
  public isSubtypeOf(typeName: string, ancestorTypeName: string): boolean {
    if (typeName === ancestorTypeName) return true;
    const chain = this.getInheritanceChain(typeName);
    return chain.some((s) => s.id === ancestorTypeName);
  }

  /**
   * Resolves the effective primary property name (`mainProperty`) across the inheritance hierarchy.
   */
  public getEffectiveMainProperty(typeName: string): string {
    const chain = this.getInheritanceChain(typeName);
    for (let i = chain.length - 1; i >= 0; i--) {
      const mainProp = chain[i]!.mainProperty;
      if (mainProp) return mainProp;
    }
    const fields = this.getEffectiveFields(typeName);
    return fields[0]?.name ?? 'value';
  }

  /**
   * Resolves all inherited + own fields for `typeName`, with child fields overriding parent fields of the same name.
   */
  public getEffectiveFields(typeName: string): EntityFieldSpec[] {
    const chain = this.getInheritanceChain(typeName);
    const fieldMap = new Map<string, EntityFieldSpec>();
    for (const spec of chain) {
      for (const f of spec.fields) {
        fieldMap.set(f.name, { ...f });
      }
    }
    return Array.from(fieldMap.values());
  }

  /**
   * Instantiates a canonical `MaltegoEntityData` object populated with all inherited descriptors and the primary `value`.
   */
  public createEntity(
    typeName: string,
    primaryValue: unknown,
    options?: {
      id?: EntityID;
      weight?: number;
      bookmark?: number;
      extraProperties?: Record<string, unknown>;
    }
  ): MaltegoEntityData {
    const id = options?.id ?? Guid.generate();
    const spec = this.specs.get(typeName);
    const mainPropName = this.getEffectiveMainProperty(typeName);
    const displayPropName = spec?.displayValueProperty ?? mainPropName;
    const effectiveFields = this.getEffectiveFields(typeName);

    const descriptorsAndValues: Array<{ descriptor: PropertyDescriptor; value?: unknown }> = [];

    if (effectiveFields.length === 0) {
      descriptorsAndValues.push({
        descriptor: {
          name: mainPropName,
          type: 'string',
          displayName: 'Value',
          nullable: false,
          hidden: false,
          readonly: false,
          specialRoles: ['VALUE', 'DISPLAY_VALUE'],
          matchingRule: 'STRICT',
        },
        value: primaryValue,
      });
    } else {
      for (const f of effectiveFields) {
        const roles: SpecialPropertyRole[] = [];
        if (f.name === mainPropName) roles.push('VALUE');
        if (f.name === displayPropName) roles.push('DISPLAY_VALUE');
        if (mapFieldTypeToPropertyType(f.type) === 'image') roles.push('IMAGE_URL');

        const isMain = f.name === mainPropName;
        descriptorsAndValues.push({
          descriptor: {
            name: f.name,
            type: mapFieldTypeToPropertyType(f.type),
            displayName: f.displayName || f.name,
            nullable: f.nullable ?? !isMain,
            hidden: f.hidden ?? false,
            readonly: f.readonly ?? false,
            specialRoles: roles,
            matchingRule: isMain ? 'STRICT' : 'LOOSE',
            defaultValue: f.defaultValue,
            sampleValue: f.sampleValue,
          },
          value: isMain ? primaryValue : options?.extraProperties?.[f.name] ?? f.defaultValue,
        });
      }
    }

    const bag = createPropertyBag(descriptorsAndValues);

    // Ensure mainPropName has primaryValue even if not explicitly listed in effectiveFields
    if (!bag.descriptors.has(mainPropName)) {
      bag.descriptors.set(mainPropName, {
        name: mainPropName,
        type: 'string',
        displayName: mainPropName,
        nullable: false,
        hidden: false,
        readonly: false,
        specialRoles: ['VALUE', 'DISPLAY_VALUE'],
        matchingRule: 'STRICT',
      });
    }
    bag.values.set(mainPropName, primaryValue);

    if (options?.extraProperties) {
      for (const [k, v] of Object.entries(options.extraProperties)) {
        if (!bag.descriptors.has(k)) {
          bag.descriptors.set(k, {
            name: k,
            type: 'string',
            displayName: k,
            nullable: true,
            hidden: false,
            readonly: false,
            specialRoles: [],
            matchingRule: 'LOOSE',
          });
        }
        bag.values.set(k, v);
      }
    }

    return {
      id,
      typeName,
      weight: options?.weight ?? 1,
      bookmark: options?.bookmark ?? -1,
      notes: { value: '', show: false },
      displayInfo: [],
      overlays: [],
      properties: bag,
      attachments: [],
      createdAt: Date.now(),
    };
  }
}
