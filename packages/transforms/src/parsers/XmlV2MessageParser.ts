import {
  EntityRegistry,
  Guid,
  createPropertyBag,
  getPartPrimaryValue,
  type DisplayInformation,
  type EntityID,
  type EntityOverlay,
  type IncomingLinkRecord,
  type MaltegoEntityData,
  type MaltegoLinkData,
  type OverlayPosition,
  type OverlayType,
  type PropertyMatchingRuleType,
} from '@cangrejo/core';

export type TransformV2UIMessageType =
  | 'FatalError'
  | 'PartialError'
  | 'Inform'
  | 'Warning'
  | 'Debug';

export interface TransformV2UIMessage {
  type: TransformV2UIMessageType;
  text: string;
}

export interface TransformV2ActionButton {
  id: string;
  text: string;
  url: string;
}

export interface TransformV2ExceptionItem {
  code: string;
  message: string;
}

export interface ParsedTransformV2Response {
  isException: boolean;
  exceptions: TransformV2ExceptionItem[];
  entities: MaltegoEntityData[];
  links: IncomingLinkRecord[];
  uiMessages: TransformV2UIMessage[];
  buttons: TransformV2ActionButton[];
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

/**
 * Generates a canonical `<MaltegoTransformRequestMessage>` XML envelope conforming to `MaltegoDomain.xsd`.
 */
export function buildTransformV2RequestXml(options: {
  entities: MaltegoEntityData[];
  transformFields?: Record<string, string>;
  softLimit?: number;
  hardLimit?: number;
}): string {
  const softLimit = options.softLimit ?? 12;
  const hardLimit = options.hardLimit ?? 255;

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MaltegoMessage xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    '  <MaltegoTransformRequestMessage>',
    '    <Entities>',
  ];

  for (const entity of options.entities) {
    const primaryVal = getPartPrimaryValue(entity);
    lines.push(`      <Entity Type="${escapeXml(entity.typeName)}">`);
    lines.push(`        <Value>${escapeXml(primaryVal)}</Value>`);
    lines.push(`        <Weight>${Math.max(1, Math.round(entity.weight))}</Weight>`);
    lines.push('        <AdditionalFields>');
    for (const [propName, desc] of entity.properties.descriptors.entries()) {
      const val = entity.properties.values.get(propName);
      if (val === undefined || val === null) continue;
      lines.push(
        `          <Field Name="${escapeXml(propName)}" DisplayName="${escapeXml(desc.displayName)}" MatchingRule="${desc.matchingRule.toLowerCase()}">${escapeXml(String(val))}</Field>`
      );
    }
    lines.push('        </AdditionalFields>');
    lines.push('      </Entity>');
  }

  lines.push('    </Entities>');

  if (options.transformFields && Object.keys(options.transformFields).length > 0) {
    lines.push('    <TransformFields>');
    for (const [k, v] of Object.entries(options.transformFields)) {
      lines.push(`      <Field Name="${escapeXml(k)}">${escapeXml(v)}</Field>`);
    }
    lines.push('    </TransformFields>');
  }

  lines.push(`    <Limits SoftLimit="${softLimit}" HardLimit="${hardLimit}"/>`);
  lines.push('  </MaltegoTransformRequestMessage>');
  lines.push('</MaltegoMessage>');
  return lines.join('\n');
}

/**
 * Parses a Protocol v2 XML response (`<MaltegoTransformResponseMessage>` or `<MaltegoTransformExceptionMessage>`).
 * Automatically extracts link styling fields (`maltego.link.*`) to construct directed links from `sourceEntityId`.
 */
export function parseTransformV2ResponseXml(
  xmlPayload: string,
  options?: {
    sourceEntityId?: EntityID;
    registry?: EntityRegistry;
    hardLimit?: number;
  }
): ParsedTransformV2Response {
  const registry = options?.registry ?? new EntityRegistry();
  const hardLimit = options?.hardLimit ?? Number.POSITIVE_INFINITY;

  if (/<MaltegoTransformExceptionMessage\b/i.test(xmlPayload)) {
    const exceptions: TransformV2ExceptionItem[] = [];
    const exRe = /<Exception\b([^>]*)>([\s\S]*?)<\/Exception>/gi;
    let m: RegExpExecArray | null;
    while ((m = exRe.exec(xmlPayload)) !== null) {
      const code = extractAttr(m[1]!, 'code') ?? '500';
      const message = unescapeXml(m[2]!.trim());
      exceptions.push({ code, message });
    }
    return {
      isException: true,
      exceptions,
      entities: [],
      links: [],
      uiMessages: [],
      buttons: [],
    };
  }

  const entities: MaltegoEntityData[] = [];
  const links: IncomingLinkRecord[] = [];
  const uiMessages: TransformV2UIMessage[] = [];
  const buttons: TransformV2ActionButton[] = [];

  const entityBlockRe = /<Entity\b([^>]*)>([\s\S]*?)<\/Entity>/gi;
  let em: RegExpExecArray | null;

  while ((em = entityBlockRe.exec(xmlPayload)) !== null && entities.length < hardLimit) {
    const entityAttrs = em[1]!;
    const entityBody = em[2]!;
    const typeName = extractAttr(entityAttrs, 'Type') ?? 'maltego.Phrase';

    const valMatch = /<Value>([\s\S]*?)<\/Value>/i.exec(entityBody);
    const primaryValue = valMatch ? unescapeXml(valMatch[1]!.trim()) : '';

    const weightMatch = /<Weight>([\s\S]*?)<\/Weight>/i.exec(entityBody);
    const weight = weightMatch ? Math.max(1, Number.parseInt(weightMatch[1]!.trim(), 10) || 100) : 100;

    const extraProperties: Record<string, unknown> = {};
    const fieldRuleOverrides = new Map<string, { displayName?: string; matchingRule?: PropertyMatchingRuleType }>();
    const linkProps: Record<string, string> = {};

    const addFieldsMatch = /<AdditionalFields>([\s\S]*?)<\/AdditionalFields>/i.exec(entityBody);
    if (addFieldsMatch) {
      const fieldsInner = addFieldsMatch[1]!;
      const fieldRe = /<Field\b([^>]*)>([\s\S]*?)<\/Field>/gi;
      let fm: RegExpExecArray | null;
      while ((fm = fieldRe.exec(fieldsInner)) !== null) {
        const fAttrs = fm[1]!;
        const fVal = unescapeXml(fm[2]!.trim());
        const fName = extractAttr(fAttrs, 'Name');
        if (!fName) continue;

        if (fName.startsWith('maltego.link.')) {
          linkProps[fName] = fVal;
          continue;
        }

        const fDisp = extractAttr(fAttrs, 'DisplayName') ?? undefined;
        const fRuleRaw = extractAttr(fAttrs, 'MatchingRule');
        const matchingRule = fRuleRaw
          ? (fRuleRaw.toUpperCase() as PropertyMatchingRuleType)
          : undefined;

        extraProperties[fName] = fVal;
        fieldRuleOverrides.set(fName, { displayName: fDisp, matchingRule });
      }
    }

    const iconUrlMatch = /<IconURL>([\s\S]*?)<\/IconURL>/i.exec(entityBody);
    if (iconUrlMatch) {
      extraProperties['icon-url'] = unescapeXml(iconUrlMatch[1]!.trim());
    }

    const createdEntity = registry.createEntity(typeName, primaryValue, {
      weight,
      extraProperties,
    });

    for (const [fName, override] of fieldRuleOverrides.entries()) {
      const desc = createdEntity.properties.descriptors.get(fName);
      if (desc) {
        if (override.displayName) desc.displayName = override.displayName;
        if (override.matchingRule) desc.matchingRule = override.matchingRule;
      }
    }

    // DisplayInformation blocks
    const dispBlockMatch = /<DisplayInformation>([\s\S]*?)<\/DisplayInformation>/i.exec(entityBody);
    if (dispBlockMatch) {
      const dispInner = dispBlockMatch[1]!;
      const labelRe = /<Label\b([^>]*)>([\s\S]*?)<\/Label>/gi;
      let lm: RegExpExecArray | null;
      const displayInfoList: DisplayInformation[] = [];
      while ((lm = labelRe.exec(dispInner)) !== null) {
        const title = extractAttr(lm[1]!, 'Name') ?? 'Detail';
        const rawMime = extractAttr(lm[1]!, 'Type') ?? 'text/plain';
        const mimeType = rawMime === 'text/html' ? 'text/html' : 'text/plain';
        const content = unescapeXml(lm[2]!.trim());
        displayInfoList.push({ title, content, type: mimeType });
      }
      createdEntity.displayInfo = displayInfoList;
    }

    // Overlays
    const overlaysBlockMatch = /<Overlays>([\s\S]*?)<\/Overlays>/i.exec(entityBody);
    if (overlaysBlockMatch) {
      const ovInner = overlaysBlockMatch[1]!;
      const ovRe = /<Overlay\b([^>]*)\/?>/gi;
      let om: RegExpExecArray | null;
      const overlays: EntityOverlay[] = [];
      while ((om = ovRe.exec(ovInner)) !== null) {
        const propName = extractAttr(om[1]!, 'propertyName');
        const position = (extractAttr(om[1]!, 'position') ?? 'NW') as OverlayPosition;
        const rawType = extractAttr(om[1]!, 'type') ?? 'text';
        const ovType: OverlayType =
          rawType === 'image' ? 'image' : rawType === 'color' || rawType === 'colour' ? 'color' : 'text';
        if (propName) {
          overlays.push({ propertyName: propName, position, type: ovType });
        }
      }
      createdEntity.overlays = overlays;
    }

    // Optional Notes & Bookmark in V2 response
    const notesMatch = /<Notes>([\s\S]*?)<\/Notes>/i.exec(entityBody);
    if (notesMatch) {
      createdEntity.notes = { value: unescapeXml(notesMatch[1]!.trim()), show: false };
    }
    const bookmarkMatch = /<Bookmark>([\s\S]*?)<\/Bookmark>/i.exec(entityBody);
    if (bookmarkMatch) {
      createdEntity.bookmark = Number.parseInt(bookmarkMatch[1]!.trim(), 10);
    }

    entities.push(createdEntity);

    if (options?.sourceEntityId) {
      const linkLabel = linkProps['maltego.link.label'] ?? '';
      const isReversed =
        (linkProps['maltego.link.direction'] ?? '').toLowerCase() === 'output-to-input' ||
        (linkProps['maltego.link.reversed'] ?? '').toLowerCase() === 'true';

      const linkPropEntries = Object.entries(linkProps).map(([k, v]) => ({
        descriptor: {
          name: k,
          displayName: k.replace('maltego.link.', ''),
          type: 'string' as const,
          nullable: true,
          hidden: false,
          readonly: false,
          specialRoles: k === 'maltego.link.label' ? (['VALUE', 'DISPLAY_VALUE'] as const) : ([] as const),
          matchingRule: 'STRICT' as const,
        },
        value: v,
      }));

      if (!linkProps['maltego.link.label']) {
        linkPropEntries.unshift({
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
          value: linkLabel,
        });
      }

      const linkData: MaltegoLinkData = {
        id: Guid.generate(),
        typeName: 'maltego.link.transform-link',
        weight: 1,
        bookmark: -1,
        notes: { value: '', show: false },
        displayInfo: [],
        properties: createPropertyBag(
          linkPropEntries.map((item) => ({
            descriptor: { ...item.descriptor, specialRoles: [...item.descriptor.specialRoles] },
            value: item.value,
          }))
        ),
      };

      links.push({
        data: linkData,
        source: options.sourceEntityId,
        target: createdEntity.id,
        isReversed,
      });
    }
  }

  // Parse UIMessages
  const uiBlockMatch = /<UIMessages>([\s\S]*?)<\/UIMessages>/i.exec(xmlPayload);
  if (uiBlockMatch) {
    const uiRe = /<UIMessage\b([^>]*)>([\s\S]*?)<\/UIMessage>/gi;
    let um: RegExpExecArray | null;
    while ((um = uiRe.exec(uiBlockMatch[1]!)) !== null) {
      const msgType = (extractAttr(um[1]!, 'MessageType') ?? 'Inform') as TransformV2UIMessageType;
      const text = unescapeXml(um[2]!.trim());
      uiMessages.push({ type: msgType, text });
    }
  }

  // Parse AdditionalInfo Buttons
  const btnBlockMatch = /<Buttons>([\s\S]*?)<\/Buttons>/i.exec(xmlPayload);
  if (btnBlockMatch) {
    const btnRe = /<Button\b([^>]*)\/?>/gi;
    let bm: RegExpExecArray | null;
    while ((bm = btnRe.exec(btnBlockMatch[1]!)) !== null) {
      const id = extractAttr(bm[1]!, 'id') ?? 'btn';
      const text = extractAttr(bm[1]!, 'text') ?? 'Open';
      const url = extractAttr(bm[1]!, 'url') ?? '';
      buttons.push({ id, text, url });
    }
  }

  return {
    isException: false,
    exceptions: [],
    entities,
    links,
    uiMessages,
    buttons,
  };
}
