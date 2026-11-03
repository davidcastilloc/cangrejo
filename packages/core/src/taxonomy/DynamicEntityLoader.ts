import type { EntityFieldSpec, EntitySpec } from './StandardEntitiesCatalog.js';

function extractAttribute(tagAttrs: string, attrName: string): string | null {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*"([^"]*)"`, 'i');
  const m = re.exec(tagAttrs);
  return m ? m[1]! : null;
}

/**
 * Parses a Maltego declarative `.entity` XML specification into an `EntitySpec` object.
 */
export function parseEntityXml(xmlContent: string, defaultCategory = 'Custom'): EntitySpec {
  const rootMatch = /<MaltegoEntity\b([^>]*)>/i.exec(xmlContent);
  if (!rootMatch) {
    throw new Error('Invalid .entity XML: Missing <MaltegoEntity> root element.');
  }
  const rootAttrs = rootMatch[1]!;
  const id = extractAttribute(rootAttrs, 'id');
  if (!id) {
    throw new Error('Invalid .entity XML: <MaltegoEntity> is missing required "id" attribute.');
  }

  const displayName = extractAttribute(rootAttrs, 'displayName') ?? id;
  const plural = extractAttribute(rootAttrs, 'displayNamePlural') ?? `${displayName}s`;
  const category = extractAttribute(rootAttrs, 'category') ?? defaultCategory;
  const icon =
    extractAttribute(rootAttrs, 'largeIconResource') ??
    extractAttribute(rootAttrs, 'smallIconResource') ??
    'Unknown';
  const allowedRootStr = extractAttribute(rootAttrs, 'allowedRoot');
  const allowedRoot = allowedRootStr ? allowedRootStr.toLowerCase() === 'true' : true;
  const conversionOrderStr = extractAttribute(rootAttrs, 'conversionOrder');
  const conversionOrder = conversionOrderStr ? Number(conversionOrderStr) : undefined;

  const baseMatch =
    extractAttribute(rootAttrs, 'baseEntity') ??
    (/<BaseEntities>\s*<BaseEntity>([^<]+)<\/BaseEntity>/i.exec(xmlContent)?.[1]?.trim() ?? null);

  const propsTagMatch = /<Properties\b([^>]*)>/i.exec(xmlContent);
  const propsAttrs = propsTagMatch ? propsTagMatch[1]! : '';
  const mainProperty = extractAttribute(propsAttrs, 'value');
  const displayValueProperty = extractAttribute(propsAttrs, 'displayValue');

  const regexMatch = /<Converter>\s*<Value>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/Value>\s*<\/Converter>/i.exec(
    xmlContent
  );
  const regex = regexMatch ? regexMatch[1]!.trim() : null;

  const fields: EntityFieldSpec[] = [];
  const fieldRe = /<Field\s+([^>]+?)(?:\/>|>([\s\S]*?)<\/Field>)/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fieldRe.exec(xmlContent)) !== null) {
    const attrs = fm[1]!;
    const inner = fm[2] ?? '';
    const name = extractAttribute(attrs, 'name');
    if (!name) continue;
    const type = extractAttribute(attrs, 'type') ?? 'string';
    const fDisplayName = extractAttribute(attrs, 'displayName') ?? name;
    const nullableStr = extractAttribute(attrs, 'nullable');
    const hiddenStr = extractAttribute(attrs, 'hidden');
    const readonlyStr = extractAttribute(attrs, 'readonly');
    const defValMatch = /<DefaultValue>([\s\S]*?)<\/DefaultValue>/i.exec(inner);
    const sampleValMatch = /<SampleValue>([\s\S]*?)<\/SampleValue>/i.exec(inner);

    fields.push({
      name,
      type,
      displayName: fDisplayName,
      nullable: nullableStr ? nullableStr.toLowerCase() === 'true' : true,
      hidden: hiddenStr ? hiddenStr.toLowerCase() === 'true' : false,
      readonly: readonlyStr ? readonlyStr.toLowerCase() === 'true' : false,
      defaultValue: defValMatch ? defValMatch[1]!.trim() : undefined,
      sampleValue: sampleValMatch ? sampleValMatch[1]!.trim() : undefined,
    });
  }

  return {
    id,
    category,
    displayName,
    plural,
    baseEntity: baseMatch,
    icon,
    allowedRoot,
    mainProperty,
    displayValueProperty,
    regex,
    conversionOrder,
    fields,
  };
}

/**
 * Serializes an `EntitySpec` object back into Maltego-compatible `.entity` XML format.
 */
export function serializeEntityXml(spec: EntitySpec): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<MaltegoEntity id="${spec.id}" displayName="${spec.displayName}" displayNamePlural="${spec.plural}" category="${spec.category}" smallIconResource="${spec.icon}" largeIconResource="${spec.icon}" allowedRoot="${spec.allowedRoot}" visible="true">`
  );
  if (spec.baseEntity) {
    lines.push('  <BaseEntities>');
    lines.push(`    <BaseEntity>${spec.baseEntity}</BaseEntity>`);
    lines.push('  </BaseEntities>');
  }
  if (spec.regex) {
    lines.push('  <Converter>');
    lines.push(`    <Value><![CDATA[${spec.regex}]]></Value>`);
    lines.push('  </Converter>');
  }
  const mainProp = spec.mainProperty ?? spec.fields[0]?.name ?? 'value';
  const dispProp = spec.displayValueProperty ?? mainProp;
  lines.push(`  <Properties value="${mainProp}" displayValue="${dispProp}">`);
  lines.push('    <Groups/>');
  lines.push('    <Fields>');
  for (const f of spec.fields) {
    lines.push(
      `      <Field name="${f.name}" type="${f.type}" nullable="${f.nullable ?? true}" hidden="${f.hidden ?? false}" readonly="${f.readonly ?? false}" displayName="${f.displayName}">`
    );
    if (f.defaultValue !== undefined) {
      lines.push(`        <DefaultValue>${f.defaultValue}</DefaultValue>`);
    }
    if (f.sampleValue !== undefined) {
      lines.push(`        <SampleValue>${f.sampleValue}</SampleValue>`);
    }
    lines.push('      </Field>');
  }
  lines.push('    </Fields>');
  lines.push('  </Properties>');
  lines.push('</MaltegoEntity>');
  return lines.join('\n');
}
