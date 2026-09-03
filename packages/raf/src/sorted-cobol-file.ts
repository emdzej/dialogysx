/**
 * `SortedCobolFile` — fixed-length records, sorted on the leading key, located
 * by binary search. Port of `dialogys.indexingfiles.SortedCobolFile` plus
 * `AbstractSortedCobolList`. See `docs/data-format.md` §2.1.
 *
 * The name is the original's. These files are mainframe sequential extracts and
 * the Java class said so.
 */
import type { Reader } from "./reader.js";

/**
 * `Clef.compareByteArrays` — **signed** byte comparison, because Java's `byte`
 * is signed and the original subtracts them directly.
 *
 * No catalogue dataset exercises this: 0 of 583,035 shipped keys contain a byte
 * above 0x7F, so signed and unsigned agree everywhere the validator can look.
 * It is here to match the original, and it matters for the MR/NT text indexes,
 * which are keyed by localised labels through `CollationClefFactory`.
 */
export function compareKeys(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    // Reinterpret each unsigned byte as a signed Java `byte` before subtracting.
    if (x !== y) return (x > 127 ? x - 256 : x) - (y > 127 ? y - 256 : y);
  }
  return a.length - b.length;
}

function startsWith(key: Uint8Array, prefix: Uint8Array): boolean {
  if (prefix.length > key.length) return false;
  for (let i = 0; i < prefix.length; i++) if (key[i] !== prefix[i]) return false;
  return true;
}

export class SortedCobolFile {
  /** Number of records. `fileSize / recordLength` — there is no header. */
  readonly count: number;

  private constructor(
    private readonly reader: Reader,
    readonly recordLength: number,
    readonly keyLength: number,
    readonly sizeBytes: number,
    private readonly cache: Uint8Array | undefined,
    readonly name: string,
  ) {
    this.count = sizeBytes / recordLength;
  }

  /**
   * Open a sorted fixed-record file.
   *
   * Rejects a size that is not a whole number of records. That check is the
   * cheapest and strongest evidence that `keyLength` is right: for every
   * shipped dataset exactly one plausible key length divides the index size.
   *
   * `preload: true` reads the whole file into memory, which is what index
   * files want — the largest is 7.2 MB and binary search over HTTP would
   * otherwise cost ~log2(n) round trips per lookup.
   */
  static async open(
    reader: Reader,
    opts: { recordLength: number; keyLength: number; preload?: boolean; name?: string },
  ): Promise<SortedCobolFile> {
    const { recordLength, keyLength, preload = false, name = "<reader>" } = opts;
    const sizeBytes = await reader.size();
    const remainder = sizeBytes % recordLength;
    if (remainder !== 0) {
      throw new Error(
        `${name}: ${sizeBytes} bytes is not a multiple of record length ${recordLength} ` +
          `(remainder ${remainder}) — keyLength ${keyLength} is probably wrong`,
      );
    }
    const cache = preload ? await reader.read(0, sizeBytes) : undefined;
    return new SortedCobolFile(reader, recordLength, keyLength, sizeBytes, cache, name);
  }

  async record(i: number): Promise<Uint8Array> {
    if (this.cache) {
      const off = i * this.recordLength;
      return this.cache.subarray(off, off + this.recordLength);
    }
    return this.reader.read(i * this.recordLength, this.recordLength);
  }

  async key(i: number): Promise<Uint8Array> {
    if (this.cache) {
      const off = i * this.recordLength;
      return this.cache.subarray(off, off + this.keyLength);
    }
    return this.reader.read(i * this.recordLength, this.keyLength);
  }

  /**
   * `RenaultDichotomie.dichotomie`: the record index on an exact match, or
   * `-(insertionPoint) - 1` when absent. The negative encoding is preserved
   * because prefix search needs the insertion point.
   */
  async search(probe: Uint8Array): Promise<number> {
    let lo = 0;
    let hi = this.count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const c = compareKeys(probe, await this.key(mid));
      if (c > 0) lo = mid + 1;
      else if (c < 0) hi = mid - 1;
      else return mid;
    }
    return -(lo + 1);
  }

  /**
   * Every record index whose key starts with `prefix`.
   *
   * A short probe against a longer key field is a legitimate query — the
   * original NUL-pads keys and searches by prefix on purpose (`typesetpr` keys
   * are a 4-char type in an 8-byte field).
   */
  async findPrefix(prefix: Uint8Array): Promise<number[]> {
    const found = await this.search(prefix);
    let start = found >= 0 ? found : -1 - found;
    while (start > 0 && startsWith(await this.key(start - 1), prefix)) start--;
    const out: number[] = [];
    for (let i = start; i < this.count && startsWith(await this.key(i), prefix); i++) out.push(i);
    return out;
  }

  /** Release the underlying reader, if it holds an OS handle. */
  async close(): Promise<void> {
    await this.reader.close?.();
  }

  async *keys(): AsyncIterableIterator<Uint8Array> {
    for (let i = 0; i < this.count; i++) yield await this.key(i);
  }
}
