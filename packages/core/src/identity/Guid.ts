/**
 * 64-bit signed non-zero identity primitive modeled after Maltego's `com.paterva.maltego.core.Guid`.
 * Zero (`0n`) is strictly reserved for `Guid.ZERO` (unassigned identity).
 */
export class Guid {
  private readonly value: bigint;

  /** Sentinel unassigned identity (`0n`). */
  public static readonly ZERO: Guid = new Guid(0n, true);

  public constructor(value: bigint);
  /** @internal */
  public constructor(value: bigint, allowZero: boolean);
  public constructor(value: bigint, allowZero = false) {
    const normalized = BigInt.asIntN(64, value);
    if (normalized === 0n && !allowZero) {
      throw new Error('Guid cannot be zero. Zero represents unassigned identity.');
    }
    this.value = normalized;
  }

  /**
   * Generates a cryptographically strong, non-zero 64-bit signed `Guid`.
   */
  public static generate(): Guid {
    const buffer = new BigUint64Array(1);
    globalThis.crypto.getRandomValues(buffer);
    let val = BigInt.asIntN(64, buffer[0]!);
    if (val === 0n) {
      val = 1n;
    }
    return new Guid(val);
  }

  /**
   * Alias for `Guid.generate()` matching Maltego's `Guid.create()`.
   */
  public static create(): Guid {
    return Guid.generate();
  }

  /**
   * Parses a string or bigint representation (`"12345"`, `"e_12345"`, `"l_12345"`, `"g_12345"`, or `"0x1a2b..."`) into a `Guid`.
   */
  public static parse(text: string | bigint | Guid): Guid {
    if (text instanceof Guid) {
      return text;
    }
    if (typeof text === 'bigint') {
      return text === 0n ? Guid.ZERO : new Guid(text);
    }
    let clean = text.trim();
    if (clean.startsWith('e_') || clean.startsWith('l_') || clean.startsWith('g_')) {
      clean = clean.substring(2);
    }
    if (clean === '0' || clean === '0x0' || clean === '-0x0') {
      return Guid.ZERO;
    }
    if (clean.startsWith('-0x') || clean.startsWith('-0X')) {
      return new Guid(-BigInt('0x' + clean.slice(3)));
    }
    if (/^[+-]?\d+$/.test(clean) || /^0[xX][0-9a-fA-F]+$/.test(clean)) {
      return new Guid(BigInt(clean));
    }
    // Fallback for base-36 / hex strings without 0x prefix (like MTGJ IDs "1a2b3c4d5e6f")
    if (/^[0-9a-fA-F]{8,16}$/.test(clean)) {
      return new Guid(BigInt('0x' + clean));
    }
    throw new Error(`Invalid Guid string representation: "${text}"`);
  }

  public isZero(): boolean {
    return this.value === 0n;
  }

  public toBigInt(): bigint {
    return this.value;
  }

  public toHex(): string {
    const unsigned = BigInt.asUintN(64, this.value);
    return '0x' + unsigned.toString(16).padStart(16, '0');
  }

  public toString(): string {
    return this.value.toString(10);
  }

  public toJSON(): string {
    return this.toString();
  }

  public equals(other: Guid | bigint | null | undefined): boolean {
    if (other == null) return false;
    if (typeof other === 'bigint') {
      return this.value === BigInt.asIntN(64, other);
    }
    return this.value === other.value;
  }
}

export type GraphID = Guid;
export type EntityID = Guid;
export type LinkID = Guid;

/**
 * Value-equal `O(1)` Set of `Guid` instances backed by a `Map<bigint, Guid>`.
 * Guarantees that two distinct `Guid` object instances with identical 64-bit `bigint` values
 * resolve to the same entry in `O(1)` time.
 */
export class GuidSet implements ReadonlySet<Guid> {
  private readonly inner = new Map<bigint, Guid>();

  public constructor(iterable?: Iterable<Guid>) {
    if (iterable) {
      for (const item of iterable) {
        this.add(item);
      }
    }
  }

  public get size(): number {
    return this.inner.size;
  }

  public add(value: Guid): this {
    this.inner.set(value.toBigInt(), value);
    return this;
  }

  public has(value: Guid): boolean {
    return this.inner.has(value.toBigInt());
  }

  public delete(value: Guid): boolean {
    return this.inner.delete(value.toBigInt());
  }

  public clear(): void {
    this.inner.clear();
  }

  public forEach(callbackfn: (value: Guid, value2: Guid, set: ReadonlySet<Guid>) => void, thisArg?: unknown): void {
    for (const guid of this.inner.values()) {
      callbackfn.call(thisArg, guid, guid, this);
    }
  }

  public entries(): IterableIterator<[Guid, Guid]> {
    const vals = this.inner.values();
    return (function* () {
      for (const v of vals) {
        yield [v, v] as [Guid, Guid];
      }
    })();
  }

  public keys(): IterableIterator<Guid> {
    return this.inner.values();
  }

  public values(): IterableIterator<Guid> {
    return this.inner.values();
  }

  public [Symbol.iterator](): IterableIterator<Guid> {
    return this.inner.values();
  }

  public clone(): GuidSet {
    return new GuidSet(this.inner.values());
  }

  public toArray(): Guid[] {
    return Array.from(this.inner.values());
  }
}

/**
 * Value-equal `O(1)` Map keyed by `Guid` (backed by `bigint` keys internally).
 */
export class GuidMap<V> implements ReadonlyMap<Guid, V> {
  private readonly keyMap = new Map<bigint, Guid>();
  private readonly valMap = new Map<bigint, V>();

  public constructor(entries?: Iterable<readonly [Guid, V]>) {
    if (entries) {
      for (const [k, v] of entries) {
        this.set(k, v);
      }
    }
  }

  public get size(): number {
    return this.valMap.size;
  }

  public set(key: Guid, value: V): this {
    const raw = key.toBigInt();
    this.keyMap.set(raw, key);
    this.valMap.set(raw, value);
    return this;
  }

  public get(key: Guid): V | undefined {
    return this.valMap.get(key.toBigInt());
  }

  public has(key: Guid): boolean {
    return this.valMap.has(key.toBigInt());
  }

  public delete(key: Guid): boolean {
    const raw = key.toBigInt();
    this.keyMap.delete(raw);
    return this.valMap.delete(raw);
  }

  public clear(): void {
    this.keyMap.clear();
    this.valMap.clear();
  }

  public forEach(callbackfn: (value: V, key: Guid, map: ReadonlyMap<Guid, V>) => void, thisArg?: unknown): void {
    for (const [raw, val] of this.valMap.entries()) {
      const guid = this.keyMap.get(raw)!;
      callbackfn.call(thisArg, val, guid, this);
    }
  }

  public entries(): IterableIterator<[Guid, V]> {
    const keyMap = this.keyMap;
    const valEntries = this.valMap.entries();
    return (function* () {
      for (const [raw, val] of valEntries) {
        yield [keyMap.get(raw)!, val] as [Guid, V];
      }
    })();
  }

  public keys(): IterableIterator<Guid> {
    return this.keyMap.values();
  }

  public values(): IterableIterator<V> {
    return this.valMap.values();
  }

  public [Symbol.iterator](): IterableIterator<[Guid, V]> {
    return this.entries();
  }
}
