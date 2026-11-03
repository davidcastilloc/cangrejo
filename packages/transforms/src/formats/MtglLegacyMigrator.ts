import {
  EntityRegistry,
  GraphStore,
  Guid,
  createPropertyBag,
  type MaltegoLinkData,
} from '@cangrejo/core';
import { ZipContainerCodec } from './ZipContainerCodec.js';

export interface LucenePandoraEntityRecord {
  id: string;
  type: string;
  value: string;
  weight?: number;
  bookmark?: number;
  notes?: string;
  x?: number;
  y?: number;
  pinned?: boolean;
  properties?: Record<string, unknown>;
}

export interface LucenePandoraLinkRecord {
  id: string;
  type?: string;
  source: string;
  target: string;
  label?: string;
  weight?: number;
  reversed?: boolean;
}

export interface LucenePandoraSegmentDump {
  pandoraVersion: string;
  luceneVersion: string;
  graphId: string;
  entities: LucenePandoraEntityRecord[];
  links: LucenePandoraLinkRecord[];
}

/**
 * Legacy `.mtgl` (Lucene 5.0 Pandora Segmented Index) Migrator (`MtglLegacyMigrator`).
 * Extracts Pandora entity and link documents from legacy `.mtgl` archives and migrates
 * them into a clean-room `GraphStore`.
 */
export class MtglLegacyMigrator {
  private readonly registry: EntityRegistry;

  public constructor(registry = new EntityRegistry()) {
    this.registry = registry;
  }

  public buildLegacyMtglArchive(dump: LucenePandoraSegmentDump): Uint8Array {
    const entries = new Map<string, Uint8Array>();
    const versionProps = [
      'maltego.mtz.version=1.0',
      `maltego.pandora.version=${dump.pandoraVersion}`,
      `maltego.lucene.version=${dump.luceneVersion}`,
    ].join('\n');
    entries.set('version.properties', new TextEncoder().encode(versionProps));
    entries.set(
      'Graphs/Graph1/DataStore/_0.fdt.json',
      new TextEncoder().encode(JSON.stringify(dump, null, 2))
    );
    return ZipContainerCodec.buildZipArchive(entries);
  }

  public migrateMtglBytesToGraphStore(mtglBytes: Uint8Array): {
    store: GraphStore;
    migratedEntitiesCount: number;
    migratedLinksCount: number;
    pandoraVersion: string;
  } {
    const entries = ZipContainerCodec.extractZipArchive(mtglBytes);
    let segmentJson: string | null = null;
    for (const [path, bytes] of entries.entries()) {
      if (path.endsWith('_0.fdt.json') || path.endsWith('pandora-dump.json')) {
        segmentJson = new TextDecoder().decode(bytes);
        break;
      }
    }

    if (!segmentJson) {
      throw new Error('Invalid legacy .mtgl archive: no Pandora Lucene 5.0 segment found.');
    }

    const dump = JSON.parse(segmentJson) as LucenePandoraSegmentDump;
    const store = new GraphStore(Guid.parse(dump.graphId));

    store.runInBatch(() => {
      for (const rec of dump.entities) {
        const entity = this.registry.createEntity(rec.type, rec.value, {
          id: Guid.parse(rec.id),
          weight: rec.weight ?? 100,
          bookmark: rec.bookmark ?? -1,
          extraProperties: rec.properties,
        });
        if (rec.notes) {
          entity.notes = { value: rec.notes, show: false };
        }
        store.addEntity(
          entity,
          { x: rec.x ?? 0, y: rec.y ?? 0, z: 0 },
          rec.pinned ?? false
        );
      }

      for (const lrec of dump.links) {
        const linkData: MaltegoLinkData = {
          id: Guid.parse(lrec.id),
          typeName: lrec.type ?? 'maltego.link.transform-link',
          weight: lrec.weight ?? 1,
          bookmark: -1,
          notes: { value: '', show: false },
          displayInfo: [],
          properties: createPropertyBag([
            {
              descriptor: {
                name: 'maltego.link.label',
                displayName: 'Label',
                type: 'string',
                nullable: true,
                hidden: false,
                readonly: false,
                specialRoles: ['VALUE', 'DISPLAY_VALUE'],
                matchingRule: 'STRICT',
              },
              value: lrec.label ?? '',
            },
          ]),
        };
        store.addLink(
          linkData,
          Guid.parse(lrec.source),
          Guid.parse(lrec.target),
          lrec.reversed ?? false
        );
      }
    });

    store.undoRedoManager.clear();
    return {
      store,
      migratedEntitiesCount: store.entityCount,
      migratedLinksCount: store.linkCount,
      pandoraVersion: dump.pandoraVersion,
    };
  }
}
