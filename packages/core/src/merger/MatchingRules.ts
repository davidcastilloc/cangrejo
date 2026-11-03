import { getPartPrimaryValue, type MaltegoEntityData } from '../store/GraphDataStore.js';

const CASE_INSENSITIVE_TYPES = new Set<string>([
  'maltego.Domain',
  'maltego.DNSName',
  'maltego.MXRecord',
  'maltego.NSRecord',
  'maltego.EmailAddress',
  'maltego.URL',
  'maltego.Website',
  'maltego.Hash',
  'maltego.MACAddress',
  'maltego.IPv6Address',
]);

/**
 * Normalizes an entity's primary value according to its ontological type.
 */
export function normalizeEntityValue(typeName: string, rawValue: string): string {
  const trimmed = rawValue.trim();
  if (typeName === 'maltego.IPv4Address') {
    const parts = trimmed.split('.');
    if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
      return parts.map((p) => String(Number.parseInt(p, 10))).join('.');
    }
    return trimmed;
  }
  if (CASE_INSENSITIVE_TYPES.has(typeName)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

export interface EntityMatchingRule {
  /**
   * Computes a deterministic O(1) lookup key for the entity, or `null` if fail-closed
   * conditions prevent this entity from matching any existing node.
   */
  computeIdentityKey(entity: MaltegoEntityData): string | null;

  /**
   * Evaluates whether two entities represent the same semantic node.
   */
  matches(dest: MaltegoEntityData, src: MaltegoEntityData): boolean;
}

/**
 * Default `StatelessMatchingRule`: matches entities of identical `typeName` and normalized primary `VALUE`.
 */
export class StatelessMatchingRule implements EntityMatchingRule {
  public computeIdentityKey(entity: MaltegoEntityData): string | null {
    const primary = getPartPrimaryValue(entity);
    const normalized = normalizeEntityValue(entity.typeName, primary);
    if (normalized.length === 0) {
      return null;
    }
    return `${entity.typeName}::STATELESS::${normalized}`;
  }

  public matches(dest: MaltegoEntityData, src: MaltegoEntityData): boolean {
    if (dest.typeName !== src.typeName) return false;
    const keyDest = this.computeIdentityKey(dest);
    const keySrc = this.computeIdentityKey(src);
    return keyDest !== null && keyDest === keySrc;
  }
}

/**
 * `PropertyMatchingRule`: matches entities on a composite tuple of property names.
 * Enforces fail-closed semantics: if any configured property is null, undefined, or empty string,
 * the entity will NOT match another entity with missing properties.
 */
export class PropertyMatchingRule implements EntityMatchingRule {
  private readonly propertyNames: readonly string[];

  public constructor(propertyNames: readonly string[] = []) {
    this.propertyNames = propertyNames;
  }

  private resolveTargetProperties(entity: MaltegoEntityData): readonly string[] {
    if (this.propertyNames.length > 0) {
      return this.propertyNames;
    }
    const strictProps: string[] = [];
    for (const [name, desc] of entity.properties.descriptors.entries()) {
      if (desc.matchingRule === 'STRICT') {
        strictProps.push(name);
      }
    }
    return strictProps.sort();
  }

  public computeIdentityKey(entity: MaltegoEntityData): string | null {
    const props = this.resolveTargetProperties(entity);
    if (props.length === 0) {
      return null;
    }

    const parts: string[] = [];
    for (const propName of props) {
      const val = entity.properties.values.get(propName);
      if (val === undefined || val === null) {
        return null;
      }
      const strVal = String(val).trim();
      if (strVal.length === 0) {
        return null;
      }
      const desc = entity.properties.descriptors.get(propName);
      const isValueRole = desc?.specialRoles.includes('VALUE') ?? false;
      const normalized = isValueRole
        ? normalizeEntityValue(entity.typeName, strVal)
        : strVal;
      parts.push(`${propName}=${normalized}`);
    }

    return `${entity.typeName}::PROPS::${parts.join('|')}`;
  }

  public matches(dest: MaltegoEntityData, src: MaltegoEntityData): boolean {
    if (dest.typeName !== src.typeName) return false;
    const keyDest = this.computeIdentityKey(dest);
    const keySrc = this.computeIdentityKey(src);
    return keyDest !== null && keyDest === keySrc;
  }
}

/**
 * `TypeMapMatchingRule`: dispatches entity matching to a type-specific `EntityMatchingRule`
 * or falls back to `StatelessMatchingRule`.
 */
export class TypeMapMatchingRule implements EntityMatchingRule {
  private readonly rulesByType = new Map<string, EntityMatchingRule>();
  private readonly fallbackRule: EntityMatchingRule;

  public constructor(
    initialRules?: ReadonlyMap<string, EntityMatchingRule>,
    fallbackRule: EntityMatchingRule = new StatelessMatchingRule()
  ) {
    this.fallbackRule = fallbackRule;
    if (initialRules) {
      for (const [typeName, rule] of initialRules.entries()) {
        this.rulesByType.set(typeName, rule);
      }
    }
  }

  public registerRule(typeName: string, rule: EntityMatchingRule): void {
    this.rulesByType.set(typeName, rule);
  }

  public getRuleForType(typeName: string): EntityMatchingRule {
    return this.rulesByType.get(typeName) ?? this.fallbackRule;
  }

  public computeIdentityKey(entity: MaltegoEntityData): string | null {
    return this.getRuleForType(entity.typeName).computeIdentityKey(entity);
  }

  public matches(dest: MaltegoEntityData, src: MaltegoEntityData): boolean {
    if (dest.typeName !== src.typeName) return false;
    return this.getRuleForType(dest.typeName).matches(dest, src);
  }
}
