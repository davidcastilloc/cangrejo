import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2019, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import {
  CollectionNodeView,
  Guid,
  GraphStore,
  createPropertyBag,
  type AttachmentRef,
  type DisplayInformation,
  type EntityOverlay,
  type MaltegoEntityData,
  type MaltegoLinkData,
  type Point2D,
  type Point3D,
  type PropertyBag,
  type PropertyMatchingRuleType,
  type PropertyValueType,
  type SpecialPropertyRole,
} from '@cangrejo/core';

export interface MtgjPropertyJson {
  name: string;
  displayName: string;
  type:
    | 'string'
    | 'int'
    | 'float'
    | 'double'
    | 'bool'
    | 'boolean'
    | 'datetime'
    | 'date'
    | 'bytes'
    | 'url'
    | 'color'
    | 'string[]';
  value: string | number | boolean | string[] | null;
  special?: Array<
    | 'VALUE'
    | 'DISPLAY_VALUE'
    | 'IMAGE_URL'
    | 'LABEL'
    | 'STYLE'
    | 'COLOR'
    | 'THICKNESS'
    | 'SHOW_LABEL'
  >;
  matchingRule?: 'STRICT' | 'LOOSE' | 'NONE' | 'strict' | 'loose' | 'none';
  hidden?: boolean;
  readonly?: boolean;
  nullable?: boolean;
}

export interface MtgjEntityJson {
  id: string;
  type: string;
  weight: number;
  position?: Point3D;
  pinned?: boolean;
  bookmark?: number;
  notes?: {
    value: string;
    show?: boolean;
  };
  displayInfo?: Array<{
    title: string;
    content: string;
    type?: 'text/plain' | 'text/html';
  }>;
  overlays?: Array<{
    propertyName: string;
    position: 'NW' | 'N' | 'NE' | 'W' | 'C' | 'E' | 'SW' | 'S' | 'SE';
    type: 'text' | 'image' | 'color' | 'colour';
  }>;
  props: MtgjPropertyJson[];
  attachments?: Array<{
    id: string;
    name: string;
    mimeType: string;
    sha256: string;
    sizeBytes: number;
  }>;
}

export interface MtgjLinkJson {
  id: string;
  type: string;
  source: string;
  target: string;
  reversed?: boolean;
  weight?: number;
  path?: Point2D[];
  props?: MtgjPropertyJson[];
  displayInfo?: Array<{
    title: string;
    content: string;
    type?: 'text/plain' | 'text/html';
  }>;
  bookmark?: number;
  notes?: {
    value: string;
    show?: boolean;
  };
}

export interface MtgjCollectionNodeJson {
  id: string;
  type: string;
  rule: 'STANDALONE' | 'NEIGHBOUR' | 'CHAINING' | 'MANUAL';
  pinned?: boolean;
  position?: Point2D;
  underlyingEntityIds: string[];
  viewLinks?: Array<{
    id: string;
    source: string;
    target: string;
    underlyingLinkIds: string[];
    path?: Point2D[];
  }>;
}

export interface MtgjEncryptionMetadataJson {
  algorithm: 'AES-GCM-256';
  keyWrap: 'RSA-OAEP-256' | 'ECDH-ES+A256KW';
  salt: string;
  iterations: number;
  iv: string;
  tag: string;
  gmac: string;
  encryptedFields: string[];
}

export interface MtgjDocumentJson {
  id: string;
  name?: string;
  schemaVersion: '2.0.0';
  metadata?: {
    author?: string;
    created?: number;
    modified?: number;
    description?: string;
    bookmarkLabels?: Record<string, string>;
    tags?: string[];
    viewSettings?: {
      activeLayout?:
        | 'hierarchical'
        | 'circular'
        | 'organic'
        | 'block'
        | 'interactive'
        | 'ball'
        | 'none';
      zoom?: number;
      pan?: { x: number; y: number };
      collectionNodesEnabled?: boolean;
    };
    [key: string]: unknown;
  };
  entities: MtgjEntityJson[];
  links: MtgjLinkJson[];
  collections?: MtgjCollectionNodeJson[];
  encryption?: MtgjEncryptionMetadataJson | null;
}

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
  rawErrors?: ErrorObject[] | null;
}

function resolveDefaultSchemaPath(): string {
  try {
    if (
      typeof import.meta !== 'undefined' &&
      typeof import.meta.url === 'string' &&
      import.meta.url.startsWith('file:')
    ) {
      const currentDir = dirname(fileURLToPath(import.meta.url));
      return resolve(currentDir, '../../../schemas/mtgj_schema_v2.0.0.json');
    }
  } catch {
    // Fallback for bundled edge runtimes (Cloudflare Workers workerd)
  }
  return '/schemas/mtgj_schema_v2.0.0.json';
}

function createEdgeFallbackValidator(): ValidateFunction {
  const fn = ((doc: unknown): boolean => {
    const errs: ErrorObject[] = [];
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
      errs.push({
        instancePath: '',
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      });
      (fn as { errors?: ErrorObject[] | null }).errors = errs;
      return false;
    }
    const rec = doc as Record<string, unknown>;
    if (typeof rec.id !== 'string' || rec.id.length === 0) {
      errs.push({
        instancePath: '/id',
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'id' },
        message: 'must have required property id',
      });
    }
    if (rec.schemaVersion !== '2.0.0') {
      errs.push({
        instancePath: '/schemaVersion',
        schemaPath: '#/properties/schemaVersion/enum',
        keyword: 'enum',
        params: { allowedValues: ['2.0.0'] },
        message: 'must be equal to one of the allowed values (2.0.0)',
      });
    }
    if (!Array.isArray(rec.entities)) {
      errs.push({
        instancePath: '/entities',
        schemaPath: '#/properties/entities/type',
        keyword: 'type',
        params: { type: 'array' },
        message: 'must be array',
      });
    } else {
      rec.entities.forEach((ent, idx) => {
        if (typeof ent === 'object' && ent !== null) {
          const b = (ent as Record<string, unknown>).bookmark;
          if (typeof b === 'number' && (b < -1 || b > 23)) {
            errs.push({
              instancePath: `/entities/${idx}/bookmark`,
              schemaPath: '#/properties/bookmark',
              keyword: 'maximum',
              params: { comparison: '<=', limit: 23 },
              message: 'must be >= -1 and <= 23',
            });
          }
        }
      });
    }
    if (!Array.isArray(rec.links)) {
      errs.push({
        instancePath: '/links',
        schemaPath: '#/properties/links/type',
        keyword: 'type',
        params: { type: 'array' },
        message: 'must be array',
      });
    }
    (fn as { errors?: ErrorObject[] | null }).errors = errs.length > 0 ? errs : null;
    return errs.length === 0;
  }) as unknown as ValidateFunction;
  return fn;
}

function toMtgjPropType(t: PropertyValueType): MtgjPropertyJson['type'] {
  switch (t) {
    case 'string':
    case 'int':
    case 'float':
    case 'bool':
    case 'datetime':
    case 'date':
    case 'bytes':
    case 'url':
    case 'color':
    case 'string[]':
      return t;
    case 'image':
      return 'url';
    default:
      return 'string';
  }
}

function fromMtgjPropType(t: MtgjPropertyJson['type']): PropertyValueType {
  switch (t) {
    case 'double':
      return 'float';
    case 'boolean':
      return 'bool';
    default:
      return t;
  }
}

function serializePropertyBag(bag: PropertyBag): MtgjPropertyJson[] {
  const out: MtgjPropertyJson[] = [];
  for (const [name, desc] of bag.descriptors.entries()) {
    const rawVal = bag.values.get(name);
    let serializedVal: MtgjPropertyJson['value'] = null;
    if (
      typeof rawVal === 'string' ||
      typeof rawVal === 'number' ||
      typeof rawVal === 'boolean'
    ) {
      serializedVal = rawVal;
    } else if (Array.isArray(rawVal)) {
      serializedVal = rawVal.map((item) => String(item));
    } else if (rawVal !== undefined && rawVal !== null) {
      serializedVal = JSON.stringify(rawVal);
    }

    out.push({
      name: desc.name,
      displayName: desc.displayName,
      type: toMtgjPropType(desc.type),
      value: serializedVal,
      special: [...desc.specialRoles],
      matchingRule: desc.matchingRule,
      hidden: desc.hidden,
      readonly: desc.readonly,
      nullable: desc.nullable,
    });
  }
  return out;
}

function deserializePropertyBag(props: MtgjPropertyJson[] | undefined): PropertyBag {
  if (!props || props.length === 0) {
    return createPropertyBag();
  }
  const initial = props.map((p) => {
    const specialRoles: SpecialPropertyRole[] = [];
    if (p.special) {
      for (const s of p.special) {
        if (s === 'VALUE' || s === 'DISPLAY_VALUE' || s === 'IMAGE_URL') {
          specialRoles.push(s);
        }
      }
    }
    const matchingRule = (p.matchingRule?.toUpperCase() ?? 'STRICT') as PropertyMatchingRuleType;
    return {
      descriptor: {
        name: p.name,
        displayName: p.displayName,
        type: fromMtgjPropType(p.type),
        nullable: p.nullable ?? true,
        hidden: p.hidden ?? false,
        readonly: p.readonly ?? false,
        specialRoles,
        matchingRule,
      },
      value: p.value,
    };
  });
  return createPropertyBag(initial);
}

/**
 * Runtime JSON Schema validator and lossless `.mtgj` v2.0.0 serializer/deserializer.
 */
export class MtgjSchemaValidator {
  private readonly validateFn: ValidateFunction;
  public readonly rawSchema: Record<string, unknown>;

  public constructor(schemaPath = resolveDefaultSchemaPath()) {
    try {
      const rawText = readFileSync(schemaPath, 'utf-8');
      this.rawSchema = JSON.parse(rawText) as Record<string, unknown>;

      const AjvCtor = Ajv2019 as unknown as new (opts?: Record<string, unknown>) => {
        compile(schema: Record<string, unknown>): ValidateFunction;
      };
      const ajv = new AjvCtor({ allErrors: true, strict: false });
      const applyFormats = addFormats as unknown as (instance: unknown) => void;
      applyFormats(ajv);
      this.validateFn = ajv.compile(this.rawSchema);
    } catch {
      this.rawSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'Maltego Graph JSON (.mtgj) Schema v2.0.0',
        type: 'object',
        required: ['id', 'schemaVersion', 'entities', 'links'],
      };
      this.validateFn = createEdgeFallbackValidator();
    }
  }

  public validate(document: unknown): ValidationOutcome {
    const valid = Boolean(this.validateFn(document));
    if (valid) {
      return { valid: true, errors: [] };
    }
    const rawErrors = this.validateFn.errors ?? [];
    const errors = rawErrors.map(
      (err) => `${err.instancePath || '/'} ${err.message ?? 'validation error'}`
    );
    return { valid: false, errors, rawErrors };
  }

  /**
   * Serializes a `GraphStore` (and optional `CollectionNodeView`) into a validated `.mtgj` v2.0.0 JSON document.
   */
  public serializeGraphStore(
    store: GraphStore,
    options?: {
      name?: string;
      metadata?: MtgjDocumentJson['metadata'];
      collectionView?: CollectionNodeView;
      encryption?: MtgjEncryptionMetadataJson | null;
    }
  ): MtgjDocumentJson {
    const entities: MtgjEntityJson[] = [];
    for (const entity of store.dataStore.getEntities().values()) {
      const pos = store.layoutStore.getPosition(entity.id);
      const pinned = store.layoutStore.isPinned(entity.id);
      entities.push({
        id: entity.id.toString(),
        type: entity.typeName,
        weight: Math.max(1, Math.round(entity.weight)),
        position: { x: pos.x, y: pos.y, z: pos.z },
        pinned,
        bookmark: entity.bookmark,
        notes: {
          value: entity.notes.value,
          show: entity.notes.show,
        },
        displayInfo: entity.displayInfo.map((d) => ({
          title: d.title,
          content: d.content,
          type: d.type === 'text/html' ? 'text/html' : 'text/plain',
        })),
        overlays: entity.overlays.map((o) => ({
          propertyName: o.propertyName,
          position: o.position,
          type: o.type,
        })),
        props: serializePropertyBag(entity.properties),
        attachments: entity.attachments.map((a) => ({
          id: a.id,
          name: a.fileName,
          mimeType: a.mimeType,
          sha256: a.sha256,
          sizeBytes: a.sizeBytes,
        })),
      });
    }

    const links: MtgjLinkJson[] = [];
    for (const [linkId, edge] of store.structureStore.links.entries()) {
      const linkData = store.dataStore.getLink(linkId);
      const path = store.layoutStore.getLinkPath(linkId);
      links.push({
        id: linkId.toString(),
        type: linkData.typeName,
        source: edge.source.toString(),
        target: edge.target.toString(),
        reversed: edge.isReversed,
        weight: Math.max(1, Math.round(linkData.weight)),
        path,
        props: serializePropertyBag(linkData.properties),
        displayInfo: linkData.displayInfo.map((d) => ({
          title: d.title,
          content: d.content,
          type: d.type === 'text/html' ? 'text/html' : 'text/plain',
        })),
        bookmark: linkData.bookmark,
        notes: {
          value: linkData.notes.value,
          show: linkData.notes.show,
        },
      });
    }

    let collections: MtgjCollectionNodeJson[] | undefined;
    if (options?.collectionView) {
      collections = [];
      for (const ve of options.collectionView.getViewEntities().values()) {
        if (ve.isCollectionNode) {
          const ruleUpper = (
            ve.ruleName ? ve.ruleName.toUpperCase() : 'MANUAL'
          ) as MtgjCollectionNodeJson['rule'];
          collections.push({
            id: ve.id.toString(),
            type: ve.typeName,
            rule: ruleUpper,
            pinned: ve.pinned,
            position: { x: ve.position.x, y: ve.position.y },
            underlyingEntityIds: [...ve.underlyingEntities].map((id) => id.toString()),
          });
        }
      }
    }

    const doc: MtgjDocumentJson = {
      id: store.graphId.toString(),
      name: options?.name ?? 'Graph1',
      schemaVersion: '2.0.0',
      metadata: options?.metadata ?? {
        created: Date.now(),
        modified: Date.now(),
      },
      entities,
      links,
      ...(collections ? { collections } : {}),
      encryption: options?.encryption ?? null,
    };

    const validation = this.validate(doc);
    if (!validation.valid) {
      throw new Error(`Serialized .mtgj failed schema validation: ${validation.errors.join('; ')}`);
    }

    return doc;
  }

  /**
   * Validates and deserializes a `.mtgj` v2.0.0 JSON document into a `GraphStore`.
   */
  public deserializeToGraphStore(document: unknown): GraphStore {
    const validation = this.validate(document);
    if (!validation.valid) {
      throw new Error(`Invalid .mtgj v2.0.0 document: ${validation.errors.join('; ')}`);
    }

    const doc = document as MtgjDocumentJson;
    const graphId = Guid.parse(doc.id);

    const store = new GraphStore(graphId);
    store.runInBatch(() => {
      for (const eJson of doc.entities) {
        const entityId = Guid.parse(eJson.id);
        const displayInfo: DisplayInformation[] = (eJson.displayInfo ?? []).map((d) => ({
          title: d.title,
          content: d.content,
          type: d.type ?? 'text/plain',
        }));
        const overlays: EntityOverlay[] = (eJson.overlays ?? []).map((o) => ({
          propertyName: o.propertyName,
          position: o.position,
          type: o.type === 'colour' ? 'color' : o.type,
        }));
        const attachments: AttachmentRef[] = (eJson.attachments ?? []).map((a) => ({
          id: a.id,
          fileName: a.name,
          mimeType: a.mimeType,
          sha256: a.sha256,
          sizeBytes: a.sizeBytes,
        }));

        const entityData: MaltegoEntityData = {
          id: entityId,
          typeName: eJson.type,
          weight: eJson.weight,
          bookmark: eJson.bookmark ?? -1,
          notes: {
            value: eJson.notes?.value ?? '',
            show: eJson.notes?.show ?? false,
          },
          displayInfo,
          overlays,
          properties: deserializePropertyBag(eJson.props),
          attachments,
        };

        store.addEntity(
          entityData,
          eJson.position ?? { x: 0, y: 0, z: 0 },
          eJson.pinned ?? false
        );
      }

      for (const lJson of doc.links) {
        const linkId = Guid.parse(lJson.id);
        const sourceId = Guid.parse(lJson.source);
        const targetId = Guid.parse(lJson.target);

        const linkData: MaltegoLinkData = {
          id: linkId,
          typeName: lJson.type,
          weight: lJson.weight ?? 1,
          bookmark: lJson.bookmark ?? -1,
          notes: {
            value: lJson.notes?.value ?? '',
            show: lJson.notes?.show ?? false,
          },
          displayInfo: (lJson.displayInfo ?? []).map((d) => ({
            title: d.title,
            content: d.content,
            type: d.type ?? 'text/plain',
          })),
          properties: deserializePropertyBag(lJson.props),
        };

        store.addLink(
          linkData,
          sourceId,
          targetId,
          lJson.reversed ?? false,
          lJson.path ?? []
        );
      }
    });

    store.undoRedoManager.clear();
    return store;
  }
}
