import type { MaltegoEntityData } from '../store/GraphDataStore.js';
import type { EntityRegistry } from './EntityRegistry.js';

export interface AutodetectionConverter {
  readonly type: string;
  readonly order: number;
  readonly regex: RegExp;
  readonly extractProperties?: (rawText: string, match: RegExpExecArray) => Record<string, unknown>;
}

/**
 * The 12 prioritized autodetection regex converters ordered by strict precedence:
 * IPv4Address (10) -> Netblock (15) -> Image (18) -> Website (20) -> URL (22) ->
 * DNSName (38) -> Domain (40) -> EmailAddress (50) -> GPS (60) -> CircularArea (65) ->
 * Person (70) -> Phrase (999).
 */
export const AUTODETECTION_CONVERTERS: readonly AutodetectionConverter[] = [
  {
    type: 'maltego.IPv4Address',
    order: 10,
    regex: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
  },
  {
    type: 'maltego.Netblock',
    order: 15,
    regex: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/(?:3[0-2]|[12]?[0-9])$/,
  },
  {
    type: 'maltego.Image',
    order: 18,
    regex: /^(http[s]?:\/\/([-\w.:]*)[-\w.:/]*\/[^\s?]+\.(bmp|jpg|jpeg|png|gif|svg|webp)(?:\?[^\s]*)?)$/i,
    extractProperties: (rawText) => ({
      description: rawText.split('/').pop()?.split('?')[0] ?? rawText,
      url: rawText,
    }),
  },
  {
    type: 'maltego.Website',
    order: 20,
    regex: /^(http:\/\/|https:\/\/)[-\w.:]+\/?$/i,
    extractProperties: (rawText) => {
      const host = rawText.replace(/^https?:\/\//i, '').replace(/\/$/, '');
      return { fqdn: host, urls: rawText };
    },
  },
  {
    type: 'maltego.URL',
    order: 22,
    regex: /^(http[s]?:\/\/([-\w.:]*)[-\w.:/]*\/[^\s?]*(?:\?[^\s]*)?)$/i,
    extractProperties: (rawText) => ({
      'short-title': rawText,
      url: rawText,
    }),
  },
  {
    type: 'maltego.DNSName',
    order: 38,
    regex: /^([a-zA-Z0-9-]{1,63}\.)+([a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/,
  },
  {
    type: 'maltego.Domain',
    order: 40,
    regex: /^([a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/,
  },
  {
    type: 'maltego.EmailAddress',
    order: 50,
    regex: /^([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)$/,
  },
  {
    type: 'maltego.GPS',
    order: 60,
    regex: /^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*$/,
    extractProperties: (_raw, match) => ({
      latitude: Number(match[1]),
      longitude: Number(match[2]),
    }),
  },
  {
    type: 'maltego.CircularArea',
    order: 65,
    regex: /^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*,\s*(\d+)m?\s*$/,
    extractProperties: (_raw, match) => ({
      latitude: Number(match[1]),
      longitude: Number(match[2]),
      radius: Number(match[3]),
    }),
  },
  {
    type: 'maltego.Person',
    order: 70,
    regex: /^(\p{Lu}\p{Ll}{1,20})\s+(\p{Lu}\p{Ll}{1,20}(?:\s+\p{Lu}\p{Ll}{1,20}){0,3})$/u,
    extractProperties: (_raw, match) => ({
      'person.firstnames': match[1],
      'person.lastname': match[2],
    }),
  },
  {
    type: 'maltego.Phrase',
    order: 999,
    regex: /^.+$/,
  },
];

export const EXTENDED_OSINT_CONVERTERS: readonly AutodetectionConverter[] = [
  {
    type: 'maltego.AS',
    order: 80,
    regex: /^AS(\d{1,10})$/i,
    extractProperties: (_raw, match) => ({
      'as.number': Number(match[1]),
    }),
  },
  {
    type: 'maltego.CVE',
    order: 82,
    regex: /^CVE-\d{4}-\d{4,7}$/i,
  },
  {
    type: 'maltego.BitcoinAddress',
    order: 84,
    regex: /^(?:bc1[a-zA-HJ-NP-Z0-9]{25,89}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
  },
  {
    type: 'maltego.Hash',
    order: 86,
    regex: /^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/,
  },
  {
    type: 'maltego.PhoneNumber',
    order: 88,
    regex: /^\+[1-9]\d{0,3}[-\s.]?\(?\d{2,4}\)?[-\s.]?\d{3,4}[-\s.]?\d{3,4}$/,
  },
  {
    type: 'maltego.Alias',
    order: 90,
    regex: /^@[a-zA-Z0-9_.-]{2,36}$/,
  },
];

export interface AutodetectionMatch {
  typeName: string;
  value: string;
  extraProperties: Record<string, unknown>;
}

/**
 * Evaluates `rawText` against the 12 prioritized regex converters (plus extended OSINT patterns before the Phrase fallback)
 * and returns the matched entity type and extracted properties.
 */
export function autodetectEntityType(rawText: string): AutodetectionMatch {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { typeName: 'maltego.Phrase', value: '', extraProperties: {} };
  }

  const sorted = [...AUTODETECTION_CONVERTERS, ...EXTENDED_OSINT_CONVERTERS].sort(
    (a, b) => a.order - b.order
  );
  for (const conv of sorted) {
    const match = conv.regex.exec(trimmed);
    if (match) {
      const extraProperties = conv.extractProperties ? conv.extractProperties(trimmed, match) : {};
      return {
        typeName: conv.type,
        value: trimmed,
        extraProperties,
      };
    }
  }

  return { typeName: 'maltego.Phrase', value: trimmed, extraProperties: {} };
}

/**
 * Automatically creates a `MaltegoEntityData` instance from a line of free text using `autodetectEntityType`.
 */
export function convertTextToEntity(rawText: string, registry: EntityRegistry): MaltegoEntityData {
  const detected = autodetectEntityType(rawText);
  return registry.createEntity(detected.typeName, detected.value, {
    extraProperties: detected.extraProperties,
  });
}
