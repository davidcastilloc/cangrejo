import {
  EntityRegistry,
  Guid,
  createPropertyBag,
  type EntityID,
  type IncomingLinkRecord,
  type LinkID,
  type MaltegoEntityData,
  type MaltegoLinkData,
  type PropertyMatchingRuleType,
  type PropertyValueType,
  type SpecialPropertyRole,
} from '@cangrejo/core';

export type TransformV3RunState = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface TransformV3PropJson {
  name: string;
  type?: string;
  displayName?: string;
  value: unknown;
  special?: string[];
  matchingRule?: string;
}

export interface TransformV3EntityJson {
  id: string;
  type: string;
  weight?: number;
  bookmark?: number;
  notes?: { value: string; show?: boolean };
  props?: TransformV3PropJson[];
}

export interface TransformV3LinkJson {
  id: string;
  type?: string;
  sourceId: string;
  targetId: string;
  reversed?: boolean;
  weight?: number;
  props?: TransformV3PropJson[];
}

export interface TransformV3ChoicePrompt {
  id: string;
  message: string;
  timeout: number;
  defaultOptionId?: string;
  controlType: 'DROPDOWN' | 'RADIO' | 'TEXT';
  options: Array<{ id: string; displayName: string }>;
}

export interface TransformV3EventEnvelope {
  type: 'ADD' | 'UPDATE' | 'DELETE' | 'PROMPT';
  data: {
    '@class':
      | 'TransformRunEntityEvent'
      | 'TransformRunLinkEvent'
      | 'TransformRunChoicePromptEvent'
      | 'TransformRunTextPromptEvent';
    entity?: TransformV3EntityJson;
    entityId?: string;
    link?: TransformV3LinkJson;
    linkId?: string;
    id?: string;
    message?: string;
    timeout?: number;
    defaultOptionId?: string;
    control?: { type?: 'DROPDOWN' | 'RADIO' | 'TEXT' };
    options?: Array<{ id: string; displayName: string }>;
  };
}

export interface TransformV3RunResponseJson {
  result: {
    runId: string;
    state: TransformV3RunState;
    eventPointer: number;
    eventCount: number;
    events: TransformV3EventEnvelope[];
  };
  status?: {
    code: number;
    uiMessages?: Array<{ message: string; type: 'INFO' | 'WARN' | 'ERROR' }>;
  };
}

export interface ParsedTransformV3Events {
  runId: string;
  state: TransformV3RunState;
  eventPointer: number;
  entitiesToUpsert: MaltegoEntityData[];
  entityIdsToDelete: EntityID[];
  linksToUpsert: IncomingLinkRecord[];
  linkIdsToDelete: LinkID[];
  prompts: TransformV3ChoicePrompt[];
  uiMessages: Array<{ message: string; type: 'INFO' | 'WARN' | 'ERROR' }>;
}

function parseV3Id(rawId: string): Guid {
  try {
    return Guid.parse(rawId);
  } catch {
    let hash = 0xcbf29ce484222325n;
    const fnvPrime = 0x100000001b3n;
    for (let i = 0; i < rawId.length; i++) {
      hash ^= BigInt(rawId.charCodeAt(i));
      hash = BigInt.asUintN(64, hash * fnvPrime);
    }
    const signed = BigInt.asIntN(64, hash);
    return new Guid(signed === 0n ? 1n : signed);
  }
}

function convertV3Props(props: TransformV3PropJson[] | undefined) {
  if (!props || props.length === 0) {
    return createPropertyBag();
  }
  return createPropertyBag(
    props.map((p) => {
      const roles: SpecialPropertyRole[] = [];
      if (p.special) {
        for (const s of p.special) {
          if (s === 'VALUE' || s === 'DISPLAY_VALUE' || s === 'IMAGE_URL') {
            roles.push(s);
          }
        }
      }
      return {
        descriptor: {
          name: p.name,
          displayName: p.displayName ?? p.name,
          type: ((p.type ?? 'string') as PropertyValueType),
          nullable: true,
          hidden: false,
          readonly: false,
          specialRoles: roles,
          matchingRule: ((p.matchingRule ?? 'STRICT').toUpperCase() as PropertyMatchingRuleType),
        },
        value: p.value,
      };
    })
  );
}

/**
 * Builds a Protocol v3 `TransformRunRequest` payload from input entities and links.
 */
export function buildTransformV3RunRequest(options: {
  entities: MaltegoEntityData[];
  limit?: number;
  transformSettings?: Array<{ name: string; value: string }>;
  graphId?: string;
}): Record<string, unknown> {
  return {
    input: {
      graph: {
        entities: options.entities.map((e) => ({
          id: e.id.toString(),
          type: e.typeName,
          weight: e.weight,
          props: Array.from(e.properties.descriptors.entries()).map(([name, desc]) => ({
            name,
            type: desc.type,
            displayName: desc.displayName,
            value: e.properties.values.get(name) ?? null,
            special: [...desc.specialRoles],
          })),
        })),
        links: [],
      },
    },
    limit: options.limit ?? 255,
    transformSettings: options.transformSettings ?? [],
    runExecutionContext: {
      graphId: options.graphId ?? 'graph_default',
      runSource: 'USER_INTERACTION',
    },
  };
}

/**
 * Parses a Protocol v3 `TransformRunResponse` payload into structured delta mutations and interactive prompts.
 */
export function parseTransformV3RunResponse(
  response: TransformV3RunResponseJson,
  _registry = new EntityRegistry()
): ParsedTransformV3Events {
  const entitiesToUpsert: MaltegoEntityData[] = [];
  const entityIdsToDelete: EntityID[] = [];
  const linksToUpsert: IncomingLinkRecord[] = [];
  const linkIdsToDelete: LinkID[] = [];
  const prompts: TransformV3ChoicePrompt[] = [];

  for (const ev of response.result.events) {
    const cls = ev.data['@class'];
    if (cls === 'TransformRunEntityEvent') {
      if (ev.type === 'DELETE') {
        const rawId = ev.data.entityId ?? ev.data.entity?.id;
        if (rawId) entityIdsToDelete.push(parseV3Id(rawId));
      } else if (ev.data.entity) {
        const ej = ev.data.entity;
        const id = parseV3Id(ej.id);
        entitiesToUpsert.push({
          id,
          typeName: ej.type,
          weight: ej.weight ?? 100,
          bookmark: ej.bookmark ?? -1,
          notes: {
            value: ej.notes?.value ?? '',
            show: ej.notes?.show ?? false,
          },
          displayInfo: [],
          overlays: [],
          properties: convertV3Props(ej.props),
          attachments: [],
        });
      }
    } else if (cls === 'TransformRunLinkEvent') {
      if (ev.type === 'DELETE') {
        const rawId = ev.data.linkId ?? ev.data.link?.id;
        if (rawId) linkIdsToDelete.push(parseV3Id(rawId));
      } else if (ev.data.link) {
        const lj = ev.data.link;
        const linkData: MaltegoLinkData = {
          id: parseV3Id(lj.id),
          typeName: lj.type ?? 'maltego.link.transform-link',
          weight: lj.weight ?? 1,
          bookmark: -1,
          notes: { value: '', show: false },
          displayInfo: [],
          properties: convertV3Props(lj.props),
        };
        linksToUpsert.push({
          data: linkData,
          source: parseV3Id(lj.sourceId),
          target: parseV3Id(lj.targetId),
          isReversed: lj.reversed ?? false,
        });
      }
    } else if (
      ev.type === 'PROMPT' ||
      cls === 'TransformRunChoicePromptEvent' ||
      cls === 'TransformRunTextPromptEvent'
    ) {
      prompts.push({
        id: ev.data.id ?? 'prompt_default',
        message: ev.data.message ?? 'Input required:',
        timeout: ev.data.timeout ?? 60,
        defaultOptionId: ev.data.defaultOptionId,
        controlType: ev.data.control?.type ?? 'DROPDOWN',
        options: ev.data.options ?? [],
      });
    }
  }

  return {
    runId: response.result.runId,
    state: response.result.state,
    eventPointer: response.result.eventPointer,
    entitiesToUpsert,
    entityIdsToDelete,
    linksToUpsert,
    linkIdsToDelete,
    prompts,
    uiMessages: response.status?.uiMessages ?? [],
  };
}

export { parseV3Id };
