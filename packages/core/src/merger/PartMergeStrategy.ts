import {
  cloneEntityData,
  cloneLinkData,
  getPartPrimaryValue,
  setPartPrimaryValue,
  type AttachmentRef,
  type DisplayInformation,
  type EntityNotes,
  type EntityOverlay,
  type MaltegoEntityData,
  type MaltegoLinkData,
  type PropertyBag,
} from '../store/GraphDataStore.js';

export type PartMergeStrategyMode = 'Merge' | 'Update' | 'Replace' | 'KeepOriginal';

function isValueEmpty(val: unknown): boolean {
  if (val === undefined || val === null) return true;
  if (typeof val === 'string') return val.trim().length === 0;
  if (Array.isArray(val)) return val.length === 0;
  return false;
}

function chooseRicherValue(
  destVal: unknown,
  srcVal: unknown,
  mode: 'Merge' | 'Update'
): unknown {
  if (isValueEmpty(destVal)) return srcVal;
  if (isValueEmpty(srcVal)) return destVal;
  if (mode === 'Update') {
    return srcVal;
  }
  const destStr = String(destVal);
  const srcStr = String(srcVal);
  return srcStr.length > destStr.length ? srcVal : destVal;
}

function mergePropertyBags(
  destBag: PropertyBag,
  srcBag: PropertyBag,
  mode: 'Merge' | 'Update'
): void {
  for (const [propName, srcDesc] of srcBag.descriptors.entries()) {
    if (!destBag.descriptors.has(propName)) {
      destBag.descriptors.set(propName, {
        ...srcDesc,
        specialRoles: [...srcDesc.specialRoles],
      });
    }
  }

  for (const [propName, srcVal] of srcBag.values.entries()) {
    const desc = destBag.descriptors.get(propName) ?? srcBag.descriptors.get(propName);
    const isPrimary = desc?.specialRoles.includes('VALUE') ?? false;
    if (isPrimary) {
      const destPrimary = destBag.values.get(propName);
      if (isValueEmpty(destPrimary) && !isValueEmpty(srcVal)) {
        destBag.values.set(propName, srcVal);
      }
      continue;
    }

    if (!destBag.values.has(propName)) {
      destBag.values.set(propName, srcVal);
    } else {
      const currentVal = destBag.values.get(propName);
      destBag.values.set(propName, chooseRicherValue(currentVal, srcVal, mode));
    }
  }
}

function mergeNotes(destNotes: EntityNotes, srcNotes: EntityNotes): EntityNotes {
  const dText = destNotes.value.trim();
  const sText = srcNotes.value.trim();
  if (sText.length === 0) {
    return { ...destNotes };
  }
  if (dText.length === 0) {
    return { value: srcNotes.value, show: destNotes.show || srcNotes.show };
  }
  if (dText.includes(sText)) {
    return { value: destNotes.value, show: destNotes.show || srcNotes.show };
  }
  return {
    value: `${destNotes.value}\n---\n${srcNotes.value}`,
    show: destNotes.show || srcNotes.show,
  };
}

function mergeDisplayInfo(
  destList: DisplayInformation[],
  srcList: DisplayInformation[]
): DisplayInformation[] {
  const result = destList.map((d) => ({ ...d }));
  const seen = new Set<string>(result.map((d) => `${d.title}::${d.content}`));
  for (const item of srcList) {
    const key = `${item.title}::${item.content}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ ...item });
    }
  }
  return result;
}

function mergeOverlays(destOverlays: EntityOverlay[], srcOverlays: EntityOverlay[]): EntityOverlay[] {
  const result = destOverlays.map((o) => ({ ...o }));
  const occupied = new Set<string>(result.map((o) => o.position));
  for (const ov of srcOverlays) {
    if (!occupied.has(ov.position)) {
      occupied.add(ov.position);
      result.push({ ...ov });
    }
  }
  return result;
}

function mergeAttachments(destAtt: AttachmentRef[], srcAtt: AttachmentRef[]): AttachmentRef[] {
  const result = destAtt.map((a) => ({ ...a }));
  const seen = new Set<string>(result.map((a) => `${a.id}::${a.sha256}`));
  for (const att of srcAtt) {
    const key = `${att.id}::${att.sha256}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ ...att });
    }
  }
  return result;
}

/**
 * Merges an incoming entity (`src`) into an existing graph entity (`dest`) according to `mode`.
 * Always preserves `dest.id`.
 */
export function mergeEntityData(
  dest: MaltegoEntityData,
  src: MaltegoEntityData,
  mode: PartMergeStrategyMode = 'Merge'
): MaltegoEntityData {
  if (mode === 'KeepOriginal') {
    return cloneEntityData(dest);
  }

  if (mode === 'Replace') {
    const replaced = cloneEntityData(src);
    replaced.id = dest.id;
    return replaced;
  }

  const merged = cloneEntityData(dest);
  const destPrimary = getPartPrimaryValue(merged);
  const srcPrimary = getPartPrimaryValue(src);
  if (destPrimary.trim().length === 0 && srcPrimary.trim().length > 0) {
    setPartPrimaryValue(merged, srcPrimary);
  }

  mergePropertyBags(merged.properties, src.properties, mode);

  // Bounded entity weight: Math.max prevents runaway centrality inflation on repeated transforms
  merged.weight = Math.max(dest.weight, src.weight);
  merged.bookmark = dest.bookmark !== -1 ? dest.bookmark : src.bookmark;
  merged.notes = mergeNotes(dest.notes, src.notes);
  merged.displayInfo = mergeDisplayInfo(dest.displayInfo, src.displayInfo);
  merged.overlays = mergeOverlays(dest.overlays, src.overlays);
  merged.attachments = mergeAttachments(dest.attachments, src.attachments);

  return merged;
}

/**
 * Merges an incoming link (`src`) into an existing graph link (`dest`) according to `mode`.
 * Always preserves `dest.id`.
 */
export function mergeLinkData(
  dest: MaltegoLinkData,
  src: MaltegoLinkData,
  mode: PartMergeStrategyMode = 'Merge'
): MaltegoLinkData {
  if (mode === 'KeepOriginal') {
    return cloneLinkData(dest);
  }

  if (mode === 'Replace') {
    const replaced = cloneLinkData(src);
    replaced.id = dest.id;
    return replaced;
  }

  const merged = cloneLinkData(dest);
  const destPrimary = getPartPrimaryValue(merged);
  const srcPrimary = getPartPrimaryValue(src);
  if (destPrimary.trim().length === 0 && srcPrimary.trim().length > 0) {
    setPartPrimaryValue(merged, srcPrimary);
  }

  mergePropertyBags(merged.properties, src.properties, mode);

  // Accumulative link weight: reflects repeated transform evidence between two endpoints
  merged.weight = dest.weight + src.weight;
  merged.bookmark = dest.bookmark !== -1 ? dest.bookmark : src.bookmark;
  merged.notes = mergeNotes(dest.notes, src.notes);
  merged.displayInfo = mergeDisplayInfo(dest.displayInfo, src.displayInfo);

  return merged;
}
