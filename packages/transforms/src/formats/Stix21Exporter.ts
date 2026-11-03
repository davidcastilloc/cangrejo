import type { GraphStore } from '@cangrejo/core';

export interface Stix21Object {
  type: string;
  spec_version: '2.1';
  id: string;
  created?: string;
  modified?: string;
  [key: string]: unknown;
}

export interface Stix21CustodyManifest {
  algorithm: 'SHA-256';
  canonicalDigestHex: string;
  entityCount: number;
  relationshipCount: number;
  objectCount: number;
  caseTier: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
  exportedAt: string;
}

export interface Stix21Bundle {
  type: 'bundle';
  id: string;
  spec_version: '2.1';
  objects: Stix21Object[];
  x_cangrejo_custody: Stix21CustodyManifest;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Pure synchronous FIPS 180-4 SHA-256 implementation (works identically in Browser, WebWorker, Bun, and Node).
 */
export function computeSha256Hex(input: string): string {
  const utf8 = new TextEncoder().encode(input);
  const bitLen = utf8.length * 8;
  const totalBytes = Math.ceil((utf8.length + 9) / 64) * 64;
  const padded = new Uint8Array(totalBytes);
  padded.set(utf8);
  padded[utf8.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalBytes - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalBytes - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalBytes; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

function deterministicStixUuid(seed: string): string {
  const hex = computeSha256Hex(seed).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function mapEntityTypeToStix(typeName: string): {
  stixType: string;
  primaryField: 'value' | 'name';
  identityClass?: string;
} {
  const lower = typeName.toLowerCase();
  if (lower.includes('ipv4')) {
    return { stixType: 'ipv4-addr', primaryField: 'value' };
  }
  if (lower.includes('ipv6')) {
    return { stixType: 'ipv6-addr', primaryField: 'value' };
  }
  if (
    lower.includes('domain') ||
    lower.includes('dnsname') ||
    lower.includes('mxrecord') ||
    lower.includes('nsrecord')
  ) {
    return { stixType: 'domain-name', primaryField: 'value' };
  }
  if (lower.includes('email')) {
    return { stixType: 'email-addr', primaryField: 'value' };
  }
  if (lower.includes('url') || lower.includes('website')) {
    return { stixType: 'url', primaryField: 'value' };
  }
  if (lower.includes('person') || lower.includes('alias')) {
    return { stixType: 'identity', primaryField: 'name', identityClass: 'individual' };
  }
  if (lower.includes('company') || lower.includes('organization')) {
    return { stixType: 'identity', primaryField: 'name', identityClass: 'organization' };
  }
  if (lower.includes('location') || lower.includes('gps')) {
    return { stixType: 'location', primaryField: 'name' };
  }
  if (lower.includes('hash') || lower.includes('file')) {
    return { stixType: 'file', primaryField: 'name' };
  }
  return { stixType: 'infrastructure', primaryField: 'name' };
}

/**
 * OASIS STIX 2.1 Cyber Threat Intelligence Bundle Exporter (`Stix21Exporter`).
 * Converts any CANGREJO `GraphStore` or JSON graph snapshot into an interoperable STIX 2.1 Bundle
 * signed with a deterministic SHA-256 chain-of-custody manifest (`x_cangrejo_custody`).
 */
export class Stix21Exporter {
  public static exportFromStore(
    store: GraphStore,
    options?: {
      expedienteTitle?: string;
      caseTier?: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
      timestampIso?: string;
    }
  ): Stix21Bundle {
    const timestampIso = options?.timestampIso ?? new Date().toISOString();
    const caseTier = options?.caseTier ?? 'ORO';
    const expedienteTitle = options?.expedienteTitle ?? 'Expediente Forense CANGREJO';

    const authoringIdentityId = `identity--${deterministicStixUuid('cangrejo-forensic-unit')}`;
    const objects: Stix21Object[] = [
      {
        type: 'identity',
        spec_version: '2.1',
        id: authoringIdentityId,
        created: timestampIso,
        modified: timestampIso,
        name: 'CANGREJO — Unidad de Criminalística Digital & OSINT',
        identity_class: 'organization',
      },
    ];

    const stixIdByEntityId = new Map<string, string>();
    const objectRefs: string[] = [];
    let entityCount = 0;

    for (const entity of store.dataStore.getEntities().values()) {
      entityCount++;
      const mapping = mapEntityTypeToStix(entity.typeName);
      const stixId = `${mapping.stixType}--${deterministicStixUuid(`entity:${entity.id}`)}`;
      stixIdByEntityId.set(entity.id.toString(), stixId);
      objectRefs.push(stixId);

      let displayValue = entity.id.toString();
      for (const [, val] of entity.properties.values) {
        if (typeof val === 'string' && val.trim().length > 0) {
          displayValue = val.trim();
          break;
        }
      }

      const customProps: Record<string, unknown> = {};
      for (const [k, v] of entity.properties.values) {
        customProps[k] = v;
      }

      const stixObj: Stix21Object = {
        type: mapping.stixType,
        spec_version: '2.1',
        id: stixId,
        created: timestampIso,
        modified: timestampIso,
        [mapping.primaryField]: displayValue,
        x_cangrejo_entity_id: entity.id.toString(),
        x_cangrejo_type: entity.typeName,
        x_cangrejo_weight: entity.weight,
        x_cangrejo_bookmark: entity.bookmark,
        x_cangrejo_properties: customProps,
      };

      if (mapping.identityClass) {
        stixObj.identity_class = mapping.identityClass;
      }

      objects.push(stixObj);
    }

    let relationshipCount = 0;
    for (const [linkId, edge] of store.structureStore.links) {
      const srcId = (edge.isReversed ? edge.target : edge.source).toString();
      const dstId = (edge.isReversed ? edge.source : edge.target).toString();
      const sourceRef = stixIdByEntityId.get(srcId);
      const targetRef = stixIdByEntityId.get(dstId);
      if (!sourceRef || !targetRef) continue;

      relationshipCount++;
      const linkData = store.dataStore.hasLink(linkId)
        ? store.dataStore.getLink(linkId)
        : null;
      let relLabel = 'related-to';
      if (linkData) {
        for (const [, v] of linkData.properties.values) {
          if (typeof v === 'string' && v.trim().length > 0) {
            relLabel = v
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '');
            break;
          }
        }
      }

      const relStixId = `relationship--${deterministicStixUuid(`link:${linkId}`)}`;
      objectRefs.push(relStixId);
      objects.push({
        type: 'relationship',
        spec_version: '2.1',
        id: relStixId,
        created: timestampIso,
        modified: timestampIso,
        relationship_type: relLabel || 'related-to',
        source_ref: sourceRef,
        target_ref: targetRef,
        created_by_ref: authoringIdentityId,
        x_cangrejo_link_id: linkId.toString(),
        x_cangrejo_weight: linkData?.weight ?? 1,
      });
    }

    const reportId = `report--${deterministicStixUuid(`report:${store.graphId}`)}`;
    objects.push({
      type: 'report',
      spec_version: '2.1',
      id: reportId,
      created: timestampIso,
      modified: timestampIso,
      name: expedienteTitle,
      published: timestampIso,
      created_by_ref: authoringIdentityId,
      report_types: ['threat-report', 'forensic-link-analysis'],
      object_refs: objectRefs,
      x_cangrejo_case_tier: caseTier,
    });

    // Compute canonical SHA-256 over the deterministic STIX objects array (independent of export wall-clock timestamp)
    const canonicalEntitiesAndRels = objects.map((obj) => ({
      id: obj.id,
      type: obj.type,
      value: obj.value ?? obj.name ?? null,
      source_ref: obj.source_ref ?? null,
      target_ref: obj.target_ref ?? null,
      relationship_type: obj.relationship_type ?? null,
    }));
    const canonicalDigestHex = computeSha256Hex(JSON.stringify(canonicalEntitiesAndRels));

    return {
      type: 'bundle',
      id: `bundle--${deterministicStixUuid(`bundle:${canonicalDigestHex}`)}`,
      spec_version: '2.1',
      objects,
      x_cangrejo_custody: {
        algorithm: 'SHA-256',
        canonicalDigestHex,
        entityCount,
        relationshipCount,
        objectCount: objects.length,
        caseTier,
        exportedAt: timestampIso,
      },
    };
  }
}
