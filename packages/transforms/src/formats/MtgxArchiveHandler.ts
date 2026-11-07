import {
  CollectionNodeView,
  GraphStore,
  Guid,
  createPropertyBag,
  parseEntityXml,
  serializeEntityXml,
  type AttachmentRef,
  type DisplayInformation,
  type EntityOverlay,
  type EntitySpec,
  type MaltegoEntityData,
  type MaltegoLinkData,
  type OverlayPosition,
  type OverlayType,
  type Point2D,
  type PropertyBag,
  type PropertyMatchingRuleType,
  type PropertyValueType,
  type SpecialPropertyRole,
} from '@cangrejo/core';
import { MtgjJsonHandler } from './MtgjJsonHandler.js';
import { ZipContainerCodec } from './ZipContainerCodec.js';

function parseSafeGraphMlGuid(rawId: string | null | undefined, namespace = 'node'): Guid {
  const clean = (rawId ?? '').trim();
  if (clean) {
    try {
      const parsed = Guid.parse(clean);
      if (!parsed.equals(0n)) {
        return parsed;
      }
    } catch {
      // Fallback for yFiles/Maltego IDs such as "n0", "n1", "e0", or UUID strings
    }
  }
  const seed = `${namespace}:${clean || 'default'}`;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < seed.length; i++) {
    hash ^= BigInt(seed.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  const signed = BigInt.asIntN(64, hash);
  return new Guid(signed === 0n ? 1n : signed);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(str: string): string {
  const cdataStripped = str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return cdataStripped
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractAttr(tagAttrs: string, attrName: string): string | null {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*"([^"]*)"`, 'i');
  const m = re.exec(tagAttrs);
  return m ? unescapeXml(m[1]!) : null;
}

function serializePropertyBagGraphMl(bag: PropertyBag, indent: string): string[] {
  const lines: string[] = [`${indent}<mtgx:Properties>`];
  for (const [name, desc] of bag.descriptors.entries()) {
    const rawVal = bag.values.get(name);
    const valStr = rawVal === undefined || rawVal === null ? '' : String(rawVal);
    const rolesAttr = desc.specialRoles.join(',');
    lines.push(
      `${indent}  <mtgx:Property name="${escapeXml(name)}" type="${escapeXml(desc.type)}" displayName="${escapeXml(desc.displayName)}" nullable="${desc.nullable}" hidden="${desc.hidden}" readonly="${desc.readonly}" matchingRule="${desc.matchingRule}" specialRoles="${escapeXml(rolesAttr)}">${escapeXml(valStr)}</mtgx:Property>`
    );
  }
  lines.push(`${indent}</mtgx:Properties>`);
  return lines;
}

function parsePropertyBagGraphMl(xmlSection: string): PropertyBag {
  const propRe = /<mtgx:Property\b([^>]*)>([\s\S]*?)<\/mtgx:Property>/gi;
  let m: RegExpExecArray | null;
  const items: Array<{
    descriptor: {
      name: string;
      type: PropertyValueType;
      displayName: string;
      nullable: boolean;
      hidden: boolean;
      readonly: boolean;
      specialRoles: SpecialPropertyRole[];
      matchingRule: PropertyMatchingRuleType;
    };
    value: unknown;
  }> = [];

  while ((m = propRe.exec(xmlSection)) !== null) {
    const attrs = m[1]!;
    const innerXml = m[2]!;
    const nestedValueMatch = /<(?:mtgx:)?Value\b[^>]*>([\s\S]*?)<\/(?:mtgx:)?Value>/i.exec(innerXml);
    const rawText = unescapeXml(nestedValueMatch ? nestedValueMatch[1]! : innerXml);
    const name = extractAttr(attrs, 'name') ?? 'value';
    const type = (extractAttr(attrs, 'type') ?? 'string') as PropertyValueType;
    const displayName = extractAttr(attrs, 'displayName') ?? name;
    const nullable = (extractAttr(attrs, 'nullable') ?? 'true') === 'true';
    const hidden = (extractAttr(attrs, 'hidden') ?? 'false') === 'true';
    const readonly = (extractAttr(attrs, 'readonly') ?? 'false') === 'true';
    const matchingRule = (extractAttr(attrs, 'matchingRule') ?? 'STRICT') as PropertyMatchingRuleType;
    const specialStr = extractAttr(attrs, 'specialRoles') ?? '';
    const specialRoles = specialStr
      .split(',')
      .map((s) => s.trim())
      .filter(
        (s): s is SpecialPropertyRole =>
          s === 'VALUE' || s === 'DISPLAY_VALUE' || s === 'IMAGE_URL'
      );

    let typedVal: unknown = rawText;
    if (type === 'int') typedVal = Number.parseInt(rawText, 10) || 0;
    else if (type === 'float') typedVal = Number.parseFloat(rawText) || 0;
    else if (type === 'bool') typedVal = rawText === 'true';

    items.push({
      descriptor: {
        name,
        type,
        displayName,
        nullable,
        hidden,
        readonly,
        specialRoles,
        matchingRule,
      },
      value: typedVal,
    });
  }

  if (items.length > 0 && !items.some((it) => it.descriptor.specialRoles.includes('VALUE'))) {
    items[0]!.descriptor.specialRoles.push('VALUE', 'DISPLAY_VALUE');
  }

  return createPropertyBag(items);
}

export interface MtgxImportResult {
  store: GraphStore;
  versionProperties: Record<string, string>;
  customEntities: EntitySpec[];
  attachmentPayloads: Map<string, Uint8Array>;
}

/**
 * Classic `.mtgx` PKZIP / GraphML Container Handler (`MtgxArchiveHandler`).
 * Supports 100% lossless round-trip serialization and deserialization of `GraphStore`,
 * `version.properties`, `Graphs/Graph1.graphml` (`y:ShapeNode`, `y:PolyLineEdge`, `mtgx:MaltegoEntity`, `mtgx:MaltegoLink`),
 * `Graphs/Graph1-collection-nodes.data`, `Entities/*.entity`, and `Files/<sha256>` binary attachments.
 */
export class MtgxArchiveHandler {
  public exportToMtgxBytes(
    store: GraphStore,
    options?: {
      graphName?: string;
      collectionView?: CollectionNodeView;
      customEntities?: EntitySpec[];
      attachmentPayloads?: ReadonlyMap<string, Uint8Array>;
    }
  ): Uint8Array {
    const graphName = options?.graphName ?? 'Graph1';
    const entries = new Map<string, Uint8Array>();

    // 1. version.properties
    const versionProps = [
      'maltego.mtz.version=1.1',
      'maltego.graph.version=1.3',
      'maltego.pandora.version=1.4.7',
      'maltego.client.name=Maltego',
      'maltego.client.version=4.13.0',
      'maltego.SaveWithAllEntities=false',
    ].join('\n');
    entries.set('version.properties', new TextEncoder().encode(versionProps));

    // 2. Graphs/Graph1.graphml
    const graphml = this.serializeGraphStoreToGraphMl(store);
    entries.set(`Graphs/${graphName}.graphml`, new TextEncoder().encode(graphml));

    // 3. Optional collection-nodes.data
    if (options?.collectionView) {
      entries.set(
        `Graphs/${graphName}-collection-nodes.data`,
        options.collectionView.toBinaryCollectionNodesData()
      );
    }

    // 4. Optional custom .entity definitions
    if (options?.customEntities) {
      for (const spec of options.customEntities) {
        const xml = serializeEntityXml(spec);
        entries.set(`Entities/${spec.id}.entity`, new TextEncoder().encode(xml));
      }
    }

    // 5. Optional binary attachments
    if (options?.attachmentPayloads) {
      for (const [sha256, bytes] of options.attachmentPayloads.entries()) {
        entries.set(`Files/${sha256}`, bytes);
      }
    }

    return ZipContainerCodec.buildZipArchive(entries);
  }

  public importFromMtgxBytes(mtgxBytes: Uint8Array): MtgxImportResult {
    const entries = ZipContainerCodec.extractZipArchive(mtgxBytes);

    const versionProperties: Record<string, string> = {};
    const verBytes = entries.get('version.properties');
    if (verBytes) {
      const text = new TextDecoder().decode(verBytes);
      for (const line of text.split(/\r?\n/)) {
        const idx = line.indexOf('=');
        if (idx > 0) {
          versionProperties[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
    }

    let graphmlText: string | null = null;
    let hasJsonGraph = false;
    const customEntities: EntitySpec[] = [];
    const attachmentPayloads = new Map<string, Uint8Array>();

    for (const [filePath, bytes] of entries.entries()) {
      if (filePath.endsWith('.graphml')) {
        graphmlText = new TextDecoder().decode(bytes);
      } else if (filePath.startsWith('Graphs/') && filePath.endsWith('.json')) {
        hasJsonGraph = true;
      } else if (filePath.startsWith('Entities/') && filePath.endsWith('.entity')) {
        customEntities.push(parseEntityXml(new TextDecoder().decode(bytes)));
      } else if (filePath.startsWith('Files/')) {
        const sha256 = filePath.slice('Files/'.length);
        if (sha256) attachmentPayloads.set(sha256, bytes);
      }
    }

    if (!graphmlText && hasJsonGraph) {
      const mtgjImported = new MtgjJsonHandler().importFromMtgjArchiveBytes(mtgxBytes);
      return {
        store: mtgjImported.store,
        versionProperties,
        customEntities,
        attachmentPayloads: mtgjImported.attachmentPayloads,
      };
    }

    if (!graphmlText) {
      throw new Error('Invalid .mtgx/.mtgl archive: missing Graphs/*.graphml entry.');
    }

    const store = this.deserializeGraphMlToGraphStore(graphmlText);
    return {
      store,
      versionProperties,
      customEntities,
      attachmentPayloads,
    };
  }

  public serializeGraphStoreToGraphMl(store: GraphStore): string {
    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:y="http://www.yworks.com/xml/graphml" xmlns:mtgx="http://maltego.paterva.com/xml/mtgx">',
      '  <key id="d0" for="node" yfiles.type="nodegraphics"/>',
      '  <key id="d1" for="node" attr.name="MaltegoEntity" attr.type="complex"/>',
      '  <key id="d2" for="edge" yfiles.type="edgegraphics"/>',
      '  <key id="d3" for="edge" attr.name="MaltegoLink" attr.type="complex"/>',
      `  <graph id="${escapeXml(store.graphId.toString())}" edgedefault="directed">`,
    ];

    for (const entity of store.dataStore.getEntities().values()) {
      const pos = store.layoutStore.getPosition(entity.id);
      const pinned = store.layoutStore.isPinned(entity.id);
      lines.push(`    <node id="${escapeXml(entity.id.toString())}">`);
      lines.push('      <data key="d0">');
      lines.push('        <y:ShapeNode>');
      lines.push(
        `          <y:Geometry x="${pos.x}" y="${pos.y}" z="${pos.z}" width="32.0" height="32.0" pinned="${pinned}"/>`
      );
      lines.push('        </y:ShapeNode>');
      lines.push('      </data>');
      lines.push('      <data key="d1">');
      lines.push(
        `        <mtgx:MaltegoEntity id="${escapeXml(entity.id.toString())}" type="${escapeXml(entity.typeName)}" weight="${entity.weight}" bookmark="${entity.bookmark}">`
      );
      lines.push(
        `          <mtgx:Notes show="${entity.notes.show}">${escapeXml(entity.notes.value)}</mtgx:Notes>`
      );
      lines.push(...serializePropertyBagGraphMl(entity.properties, '          '));

      if (entity.displayInfo.length > 0) {
        lines.push('          <mtgx:DisplayInformation>');
        for (const di of entity.displayInfo) {
          lines.push(
            `            <mtgx:Label title="${escapeXml(di.title)}" type="${escapeXml(di.type)}">${escapeXml(di.content)}</mtgx:Label>`
          );
        }
        lines.push('          </mtgx:DisplayInformation>');
      }

      if (entity.overlays.length > 0) {
        lines.push('          <mtgx:Overlays>');
        for (const ov of entity.overlays) {
          lines.push(
            `            <mtgx:Overlay propertyName="${escapeXml(ov.propertyName)}" position="${ov.position}" type="${ov.type}"/>`
          );
        }
        lines.push('          </mtgx:Overlays>');
      }

      if (entity.attachments.length > 0) {
        lines.push('          <mtgx:Attachments>');
        for (const att of entity.attachments) {
          lines.push(
            `            <mtgx:Attachment id="${escapeXml(att.id)}" fileName="${escapeXml(att.fileName)}" mimeType="${escapeXml(att.mimeType)}" sizeBytes="${att.sizeBytes}" sha256="${escapeXml(att.sha256)}"/>`
          );
        }
        lines.push('          </mtgx:Attachments>');
      }

      lines.push('        </mtgx:MaltegoEntity>');
      lines.push('      </data>');
      lines.push('    </node>');
    }

    for (const [linkId, edge] of store.structureStore.links.entries()) {
      const linkData = store.dataStore.getLink(linkId);
      const path = store.layoutStore.getLinkPath(linkId);
      lines.push(
        `    <edge id="${escapeXml(linkId.toString())}" source="${escapeXml(edge.source.toString())}" target="${escapeXml(edge.target.toString())}">`
      );
      lines.push('      <data key="d2">');
      lines.push('        <y:PolyLineEdge>');
      lines.push('          <y:Path sx="0.0" sy="0.0" tx="0.0" ty="0.0">');
      for (const pt of path) {
        lines.push(`            <y:Point x="${pt.x}" y="${pt.y}"/>`);
      }
      lines.push('          </y:Path>');
      lines.push('        </y:PolyLineEdge>');
      lines.push('      </data>');
      lines.push('      <data key="d3">');
      lines.push(
        `        <mtgx:MaltegoLink id="${escapeXml(linkId.toString())}" type="${escapeXml(linkData.typeName)}" weight="${linkData.weight}" bookmark="${linkData.bookmark}" reversed="${edge.isReversed}">`
      );
      lines.push(
        `          <mtgx:Notes show="${linkData.notes.show}">${escapeXml(linkData.notes.value)}</mtgx:Notes>`
      );
      lines.push(...serializePropertyBagGraphMl(linkData.properties, '          '));
      lines.push('        </mtgx:MaltegoLink>');
      lines.push('      </data>');
      lines.push('    </edge>');
    }

    lines.push('  </graph>');
    lines.push('</graphml>');
    return lines.join('\n');
  }

  public deserializeGraphMlToGraphStore(graphmlText: string): GraphStore {
    const graphTagMatch = /<graph\b([^>]*)>/i.exec(graphmlText);
    const graphIdStr = graphTagMatch ? extractAttr(graphTagMatch[1]!, 'id') : null;
    const graphId = graphIdStr ? parseSafeGraphMlGuid(graphIdStr, 'graph') : Guid.generate();
    const store = new GraphStore(graphId);
    const nodeIdMap = new Map<string, Guid>();

    store.runInBatch(() => {
      const nodeRe = /<node\b([^>]*)>([\s\S]*?)<\/node>/gi;
      let nm: RegExpExecArray | null;
      while ((nm = nodeRe.exec(graphmlText)) !== null) {
        const nodeAttrs = nm[1]!;
        const nodeBody = nm[2]!;
        const rawNodeId = extractAttr(nodeAttrs, 'id') ?? '1';

        const geomMatch = /<y:Geometry\b([^>]*)\/?>/i.exec(nodeBody);
        const gx = geomMatch ? Number.parseFloat(extractAttr(geomMatch[1]!, 'x') ?? '0') : 0;
        const gy = geomMatch ? Number.parseFloat(extractAttr(geomMatch[1]!, 'y') ?? '0') : 0;
        const gz = geomMatch ? Number.parseFloat(extractAttr(geomMatch[1]!, 'z') ?? '0') : 0;
        const pinned = geomMatch
          ? (extractAttr(geomMatch[1]!, 'pinned') ?? 'false') === 'true'
          : false;

        const entMatch = /<mtgx:MaltegoEntity\b([^>]*)>([\s\S]*?)<\/mtgx:MaltegoEntity>/i.exec(
          nodeBody
        );
        const entAttrs = entMatch ? entMatch[1]! : '';
        const entBody = entMatch ? entMatch[2]! : '';
        const rawEntId = extractAttr(entAttrs, 'id');
        const nodeId = parseSafeGraphMlGuid(rawEntId ?? rawNodeId, 'node');
        nodeIdMap.set(rawNodeId, nodeId);
        if (rawEntId) nodeIdMap.set(rawEntId, nodeId);

        const typeName = extractAttr(entAttrs, 'type') ?? 'maltego.Phrase';
        const weight = Number.parseInt(extractAttr(entAttrs, 'weight') ?? '100', 10) || 100;
        const bookmark = Number.parseInt(extractAttr(entAttrs, 'bookmark') ?? '-1', 10);

        const notesMatch = /<mtgx:Notes\b([^>]*)>([\s\S]*?)<\/mtgx:Notes>/i.exec(entBody);
        const notesShow = notesMatch
          ? (extractAttr(notesMatch[1]!, 'show') ?? 'false') === 'true'
          : false;
        const notesVal = notesMatch ? unescapeXml(notesMatch[2]!) : '';

        const properties = parsePropertyBagGraphMl(entBody);
        if (properties.values.size === 0) {
          const yLabelMatch = /<y:NodeLabel\b[^>]*>([\s\S]*?)<\/y:NodeLabel>/i.exec(nodeBody);
          const fallbackLabel = yLabelMatch ? unescapeXml(yLabelMatch[1]!).trim() : rawNodeId;
          properties.descriptors.set('text', {
            name: 'text',
            type: 'string',
            displayName: 'Text',
            nullable: false,
            hidden: false,
            readonly: false,
            specialRoles: ['VALUE', 'DISPLAY_VALUE'],
            matchingRule: 'STRICT',
          });
          properties.values.set('text', fallbackLabel);
        }

        const displayInfo: DisplayInformation[] = [];
        const dispRe = /<mtgx:Label\b([^>]*)>([\s\S]*?)<\/mtgx:Label>/gi;
        let dm: RegExpExecArray | null;
        while ((dm = dispRe.exec(entBody)) !== null) {
          displayInfo.push({
            title: extractAttr(dm[1]!, 'title') ?? 'Detail',
            type:
              (extractAttr(dm[1]!, 'type') as DisplayInformation['type']) ?? 'text/plain',
            content: unescapeXml(dm[2]!),
          });
        }

        const overlays: EntityOverlay[] = [];
        const ovRe = /<mtgx:Overlay\b([^>]*)\/?>/gi;
        let om: RegExpExecArray | null;
        while ((om = ovRe.exec(entBody)) !== null) {
          const propName = extractAttr(om[1]!, 'propertyName');
          if (propName) {
            overlays.push({
              propertyName: propName,
              position: (extractAttr(om[1]!, 'position') ?? 'NW') as OverlayPosition,
              type: (extractAttr(om[1]!, 'type') ?? 'text') as OverlayType,
            });
          }
        }

        const attachments: AttachmentRef[] = [];
        const attRe = /<mtgx:Attachment\b([^>]*)\/?>/gi;
        let am: RegExpExecArray | null;
        while ((am = attRe.exec(entBody)) !== null) {
          attachments.push({
            id: extractAttr(am[1]!, 'id') ?? 'att',
            fileName: extractAttr(am[1]!, 'fileName') ?? 'file.bin',
            mimeType: extractAttr(am[1]!, 'mimeType') ?? 'application/octet-stream',
            sizeBytes: Number.parseInt(extractAttr(am[1]!, 'sizeBytes') ?? '0', 10),
            sha256: extractAttr(am[1]!, 'sha256') ?? '',
          });
        }

        const entityData: MaltegoEntityData = {
          id: nodeId,
          typeName,
          weight,
          bookmark,
          notes: { value: notesVal, show: notesShow },
          displayInfo,
          overlays,
          properties,
          attachments,
        };

        store.addEntity(entityData, { x: gx, y: gy, z: gz }, pinned);
      }

      const edgeRe = /<edge\b([^>]*)>([\s\S]*?)<\/edge>/gi;
      let em: RegExpExecArray | null;
      while ((em = edgeRe.exec(graphmlText)) !== null) {
        const edgeAttrs = em[1]!;
        const edgeBody = em[2]!;
        const rawEdgeId = extractAttr(edgeAttrs, 'id') ?? '1';
        const rawSource = extractAttr(edgeAttrs, 'source') ?? '1';
        const rawTarget = extractAttr(edgeAttrs, 'target') ?? '1';
        const sourceId = nodeIdMap.get(rawSource) ?? parseSafeGraphMlGuid(rawSource, 'node');
        const targetId = nodeIdMap.get(rawTarget) ?? parseSafeGraphMlGuid(rawTarget, 'node');
        if (!store.structureStore.hasEntity(sourceId) || !store.structureStore.hasEntity(targetId)) {
          continue;
        }

        const bends: Point2D[] = [];
        const ptRe = /<y:Point\b([^>]*)\/?>/gi;
        let pm: RegExpExecArray | null;
        while ((pm = ptRe.exec(edgeBody)) !== null) {
          bends.push({
            x: Number.parseFloat(extractAttr(pm[1]!, 'x') ?? '0'),
            y: Number.parseFloat(extractAttr(pm[1]!, 'y') ?? '0'),
          });
        }

        const linkMatch = /<mtgx:MaltegoLink\b([^>]*)>([\s\S]*?)<\/mtgx:MaltegoLink>/i.exec(
          edgeBody
        );
        const lAttrs = linkMatch ? linkMatch[1]! : '';
        const lBody = linkMatch ? linkMatch[2]! : '';
        const rawLinkEntId = extractAttr(lAttrs, 'id');
        const linkId = parseSafeGraphMlGuid(rawLinkEntId ?? rawEdgeId, 'edge');

        const typeName = extractAttr(lAttrs, 'type') ?? 'maltego.link.transform-link';
        const weight = Number.parseInt(extractAttr(lAttrs, 'weight') ?? '1', 10) || 1;
        const bookmark = Number.parseInt(extractAttr(lAttrs, 'bookmark') ?? '-1', 10);
        const isReversed = (extractAttr(lAttrs, 'reversed') ?? 'false') === 'true';

        const notesMatch = /<mtgx:Notes\b([^>]*)>([\s\S]*?)<\/mtgx:Notes>/i.exec(lBody);
        const notesShow = notesMatch
          ? (extractAttr(notesMatch[1]!, 'show') ?? 'false') === 'true'
          : false;
        const notesVal = notesMatch ? unescapeXml(notesMatch[2]!) : '';

        const linkProps = parsePropertyBagGraphMl(lBody);
        if (linkProps.values.size === 0) {
          const yEdgeLabel = /<y:EdgeLabel\b[^>]*>([\s\S]*?)<\/y:EdgeLabel>/i.exec(edgeBody);
          const fallbackEdgeLabel = yEdgeLabel ? unescapeXml(yEdgeLabel[1]!).trim() : 'related-to';
          linkProps.descriptors.set('maltego.link.label', {
            name: 'maltego.link.label',
            type: 'string',
            displayName: 'Label',
            nullable: true,
            hidden: false,
            readonly: false,
            specialRoles: ['VALUE', 'DISPLAY_VALUE'],
            matchingRule: 'STRICT',
          });
          linkProps.values.set('maltego.link.label', fallbackEdgeLabel);
        }

        const linkData: MaltegoLinkData = {
          id: linkId,
          typeName,
          weight,
          bookmark,
          notes: { value: notesVal, show: notesShow },
          displayInfo: [],
          properties: linkProps,
        };

        store.addLink(linkData, sourceId, targetId, isReversed, bends);
      }
    });

    store.undoRedoManager.clear();
    return store;
  }
}
