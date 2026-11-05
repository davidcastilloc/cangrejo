import crypto from 'node:crypto';
import {
  CollectionNodeView,
  GraphStore,
} from '@cangrejo/core';
import {
  MtgjSchemaValidator,
  type MtgjDocumentJson,
} from '@cangrejo/schemas';
import { ZipContainerCodec } from './ZipContainerCodec.js';

function applyPkcs7Padding(buf: Buffer, blockSize = 16): Buffer {
  const padLen = blockSize - (buf.length % blockSize);
  const padBuf = Buffer.alloc(padLen, padLen);
  return Buffer.concat([buf, padBuf]);
}

function removePkcs7Padding(buf: Buffer, blockSize = 16): Buffer {
  if (buf.length === 0 || buf.length % blockSize !== 0) {
    throw new Error('Invalid PKCS7 padded buffer length.');
  }
  const padLen = buf[buf.length - 1]!;
  if (padLen < 1 || padLen > blockSize) {
    throw new Error('Invalid PKCS7 padding byte.');
  }
  for (let i = buf.length - padLen; i < buf.length; i++) {
    if (buf[i] !== padLen) {
      throw new Error('Corrupt PKCS7 padding bytes.');
    }
  }
  return buf.subarray(0, buf.length - padLen);
}

function encryptFieldValueAesGcm(plaintext: string, key: Buffer): string {
  const fieldIv = crypto.randomBytes(12);
  const padded = applyPkcs7Padding(Buffer.from(plaintext, 'utf-8'), 16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, fieldIv);
  const enc = Buffer.concat([cipher.update(padded), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([fieldIv, enc, tag]).toString('base64');
}

function decryptFieldValueAesGcm(ciphertextB64: string, key: Buffer, legacyIv?: Buffer): string {
  const raw = Buffer.from(ciphertextB64, 'base64');
  if (raw.length >= 44 && raw.length % 16 === 12) {
    const fieldIv = raw.subarray(0, 12);
    const enc = raw.subarray(12, raw.length - 16);
    const tag = raw.subarray(raw.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, fieldIv);
    decipher.setAuthTag(tag);
    const padded = Buffer.concat([decipher.update(enc), decipher.final()]);
    return removePkcs7Padding(padded, 16).toString('utf-8');
  }
  if (!legacyIv || raw.length < 16) {
    throw new Error('Invalid AES-256-GCM field ciphertext: missing per-field IV or 16-byte auth tag.');
  }
  const enc = raw.subarray(0, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, legacyIv);
  decipher.setAuthTag(tag);
  const padded = Buffer.concat([decipher.update(enc), decipher.final()]);
  return removePkcs7Padding(padded, 16).toString('utf-8');
}

function computeTopologyGmac(doc: MtgjDocumentJson, key: Buffer, iv: Buffer): string {
  const canonicalTopology = JSON.stringify({
    id: doc.id,
    entities: doc.entities.map((e) => ({
      id: e.id,
      type: e.type,
      weight: e.weight,
      position: e.position,
      pinned: e.pinned,
    })),
    links: doc.links.map((l) => ({
      id: l.id,
      type: l.type,
      source: l.source,
      target: l.target,
      weight: l.weight,
    })),
  });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(canonicalTopology, 'utf-8'));
  cipher.final();
  return cipher.getAuthTag().toString('base64');
}

/**
 * Streaming `.mtgj` v2.0.0 Archive & Selective Zero-Knowledge Cryptography Handler (`MtgjJsonHandler`).
 */
export class MtgjJsonHandler {
  private readonly validator = new MtgjSchemaValidator();

  /**
   * Selectively encrypts sensitive intelligence fields inside an `.mtgj` v2.0.0 document
   * using `PBKDF2-HMAC-SHA256` (100,000+ iterations) + `AES-256-GCM` with `PKCS7` padding + `AES-GMAC` topology signature.
   */
  public encryptMtgjDocument(
    doc: MtgjDocumentJson,
    passphrase: string,
    iterations = 100_000
  ): MtgjDocumentJson {
    const cloned = JSON.parse(JSON.stringify(doc)) as MtgjDocumentJson;
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(passphrase, salt, Math.max(100_000, iterations), 32, 'sha256');

    const encryptedFields: string[] = [];

    for (let ei = 0; ei < cloned.entities.length; ei++) {
      const ent = cloned.entities[ei]!;
      for (let pi = 0; pi < ent.props.length; pi++) {
        const prop = ent.props[pi]!;
        const serializedVal = JSON.stringify(prop.value);
        prop.value = encryptFieldValueAesGcm(serializedVal, key);
        encryptedFields.push(`/entities/${ei}/props/${pi}/value`);
      }
      if (ent.notes && ent.notes.value.length > 0) {
        ent.notes.value = encryptFieldValueAesGcm(ent.notes.value, key);
        encryptedFields.push(`/entities/${ei}/notes/value`);
      }
      if (ent.displayInfo) {
        for (let di = 0; di < ent.displayInfo.length; di++) {
          const item = ent.displayInfo[di]!;
          item.content = encryptFieldValueAesGcm(item.content, key);
          encryptedFields.push(`/entities/${ei}/displayInfo/${di}/content`);
        }
      }
    }

    for (let li = 0; li < cloned.links.length; li++) {
      const link = cloned.links[li]!;
      if (link.props) {
        for (let pi = 0; pi < link.props.length; pi++) {
          const prop = link.props[pi]!;
          const serializedVal = JSON.stringify(prop.value);
          prop.value = encryptFieldValueAesGcm(serializedVal, key);
          encryptedFields.push(`/links/${li}/props/${pi}/value`);
        }
      }
      if (link.notes && link.notes.value.length > 0) {
        link.notes.value = encryptFieldValueAesGcm(link.notes.value, key);
        encryptedFields.push(`/links/${li}/notes/value`);
      }
    }

    const gmacB64 = computeTopologyGmac(cloned, key, iv);
    const rootIv = crypto.randomBytes(12);
    const rootCipher = crypto.createCipheriv('aes-256-gcm', key, rootIv);
    rootCipher.update(Buffer.from(cloned.id, 'utf-8'));
    rootCipher.final();
    const tagB64 = rootCipher.getAuthTag().toString('base64');

    cloned.encryption = {
      algorithm: 'AES-GCM-256',
      keyWrap: 'RSA-OAEP-256',
      salt: salt.toString('base64'),
      iterations: Math.max(100_000, iterations),
      iv: iv.toString('base64'),
      tag: tagB64,
      gmac: gmacB64,
      encryptedFields,
    };

    const validRes = this.validator.validate(cloned);
    if (!validRes.valid) {
      throw new Error(`Encrypted .mtgj failed schema validation: ${validRes.errors.join('; ')}`);
    }

    return cloned;
  }

  /**
   * Verifies the `AES-GMAC` structural topology tag and decrypts all selectively encrypted fields.
   */
  public decryptMtgjDocument(doc: MtgjDocumentJson, passphrase: string): MtgjDocumentJson {
    if (!doc.encryption) {
      return JSON.parse(JSON.stringify(doc)) as MtgjDocumentJson;
    }

    const cloned = JSON.parse(JSON.stringify(doc)) as MtgjDocumentJson;
    const encMeta = cloned.encryption!;
    const salt = Buffer.from(encMeta.salt, 'base64');
    const iv = Buffer.from(encMeta.iv, 'base64');
    const key = crypto.pbkdf2Sync(passphrase, salt, encMeta.iterations, 32, 'sha256');

    // Verify AES-GMAC structural integrity tag before decrypting fields
    const expectedGmac = computeTopologyGmac(cloned, key, iv);
    if (expectedGmac !== encMeta.gmac) {
      throw new Error(
        'AES-GMAC structural integrity verification failed: graph topology was tampered with or passphrase is invalid.'
      );
    }

    const encryptedSet = new Set<string>(encMeta.encryptedFields);

    for (let ei = 0; ei < cloned.entities.length; ei++) {
      const ent = cloned.entities[ei]!;
      for (let pi = 0; pi < ent.props.length; pi++) {
        const ptr = `/entities/${ei}/props/${pi}/value`;
        if (encryptedSet.has(ptr)) {
          const prop = ent.props[pi]!;
          const rawJson = decryptFieldValueAesGcm(String(prop.value), key, iv);
          prop.value = JSON.parse(rawJson) as typeof prop.value;
        }
      }
      if (ent.notes && encryptedSet.has(`/entities/${ei}/notes/value`)) {
        ent.notes.value = decryptFieldValueAesGcm(ent.notes.value, key, iv);
      }
      if (ent.displayInfo) {
        for (let di = 0; di < ent.displayInfo.length; di++) {
          if (encryptedSet.has(`/entities/${ei}/displayInfo/${di}/content`)) {
            ent.displayInfo[di]!.content = decryptFieldValueAesGcm(
              ent.displayInfo[di]!.content,
              key,
              iv
            );
          }
        }
      }
    }

    for (let li = 0; li < cloned.links.length; li++) {
      const link = cloned.links[li]!;
      if (link.props) {
        for (let pi = 0; pi < link.props.length; pi++) {
          const ptr = `/links/${li}/props/${pi}/value`;
          if (encryptedSet.has(ptr)) {
            const prop = link.props[pi]!;
            const rawJson = decryptFieldValueAesGcm(String(prop.value), key, iv);
            prop.value = JSON.parse(rawJson) as typeof prop.value;
          }
        }
      }
      if (link.notes && encryptedSet.has(`/links/${li}/notes/value`)) {
        link.notes.value = decryptFieldValueAesGcm(link.notes.value, key, iv);
      }
    }

    cloned.encryption = null;
    return cloned;
  }

  public exportToMtgjArchiveBytes(
    store: GraphStore,
    options?: {
      graphName?: string;
      collectionView?: CollectionNodeView;
      passphrase?: string;
      attachmentPayloads?: ReadonlyMap<string, Uint8Array>;
    }
  ): Uint8Array {
    const graphName = options?.graphName ?? 'Graph1';
    let doc = this.validator.serializeGraphStore(store, {
      name: graphName,
      collectionView: options?.collectionView,
    });

    if (options?.passphrase) {
      doc = this.encryptMtgjDocument(doc, options.passphrase);
    }

    const entries = new Map<string, Uint8Array>();
    const manifest = {
      schemaVersion: '2.0.0',
      mtgjVersion: '1.0.0',
      graphCount: 1,
      defaultGraph: graphName,
      created: Date.now(),
      modified: Date.now(),
    };
    entries.set('properties.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
    entries.set(`Graphs/${graphName}.json`, new TextEncoder().encode(JSON.stringify(doc, null, 2)));

    if (options?.attachmentPayloads) {
      for (const [sha256, bytes] of options.attachmentPayloads.entries()) {
        const computedHash = crypto.createHash('sha256').update(bytes).digest('hex');
        if (computedHash.toLowerCase() !== sha256.toLowerCase()) {
          throw new Error(
            `Attachment SHA-256 integrity mismatch: expected ${sha256}, computed ${computedHash}`
          );
        }
        entries.set(`Files/Attachments/${sha256.toLowerCase()}`, bytes);
      }
    }

    return ZipContainerCodec.buildZipArchive(entries);
  }

  public importFromMtgjArchiveBytes(
    mtgjZipBytes: Uint8Array,
    options?: { passphrase?: string }
  ): {
    store: GraphStore;
    document: MtgjDocumentJson;
    attachmentPayloads: Map<string, Uint8Array>;
  } {
    const entries = ZipContainerCodec.extractZipArchive(mtgjZipBytes);
    let graphJsonText: string | null = null;
    const attachmentPayloads = new Map<string, Uint8Array>();

    for (const [filePath, bytes] of entries.entries()) {
      if (filePath.startsWith('Graphs/') && filePath.endsWith('.json')) {
        graphJsonText = new TextDecoder().decode(bytes);
      } else if (filePath.startsWith('Files/Attachments/')) {
        const sha256 = filePath.slice('Files/Attachments/'.length).toLowerCase();
        const computedHash = crypto.createHash('sha256').update(bytes).digest('hex');
        if (computedHash !== sha256) {
          throw new Error(`Corrupt attachment in .mtgj archive: SHA-256 mismatch for ${sha256}`);
        }
        attachmentPayloads.set(sha256, bytes);
      }
    }

    if (!graphJsonText) {
      throw new Error('Invalid .mtgj archive: missing Graphs/*.json entry.');
    }

    let doc = JSON.parse(graphJsonText) as MtgjDocumentJson;
    if (doc.encryption) {
      if (!options?.passphrase) {
        throw new Error('Encrypted .mtgj archive requires a passphrase to decrypt.');
      }
      doc = this.decryptMtgjDocument(doc, options.passphrase);
    }

    const store = this.validator.deserializeToGraphStore(doc);
    return {
      store,
      document: doc,
      attachmentPayloads,
    };
  }
}
