/**
 * `IndexedRAF` — variable-length records addressed through a 2- or 3-level
 * index. Port of `dialogys.indexingfiles.IndexedRAF` and `IndexedRAFFactory`.
 * See `docs/data-format.md` §2.2.
 */
import type { Reader } from "./reader.js";
import { compareKeys, SortedCobolFile } from "./sorted-cobol-file.js";

/** A `(position, longueur)` pair. 12 bytes on disc, big-endian. */
export interface RecordPointer {
  position: number;
  longueur: number;
}

/** Bytes a 12-byte pointer occupies inside an index record. */
export const POINTER_BYTES = 12;

function decodePointer(rec: Uint8Array, offset: number): RecordPointer {
  const dv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
  // int64 big-endian. Data files are well under 2^53 bytes, so Number is exact.
  const position = Number(dv.getBigInt64(offset));
  const longueur = dv.getInt32(offset + 8);
  return { position, longueur };
}

/** How many index files sit between a key and its data. */
export type Depth = 2 | 3;

export interface OpenOptions {
  /** The variable-length data file. */
  data: Reader;
  /**
   * Level-1 index. For depth 3 this is the file whose name ends in `1`.
   * Preloaded by `SortedCobolFile`, so pass the whole file.
   */
  index1: Reader;
  /** Level-2 index — the pointer lists. Required for depth 3, ignored for 2. */
  index2?: Reader;
  keyLength: number;
  depth: Depth;
  /** Name used in error messages. */
  name?: string;
}

export class IndexedRAF {
  private constructor(
    readonly index1: SortedCobolFile,
    private readonly index2: Reader | undefined,
    private readonly data: Reader,
    readonly dataLength: number,
    readonly keyLength: number,
    readonly depth: Depth,
    readonly name: string,
  ) {}

  static async open(opts: OpenOptions): Promise<IndexedRAF> {
    const { data, index1, index2, keyLength, depth, name = "<dataset>" } = opts;
    if (depth === 3 && !index2) {
      throw new Error(`${name}: depth 3 needs an index2 reader`);
    }
    const idx = await SortedCobolFile.open(index1, {
      recordLength: keyLength + POINTER_BYTES,
      keyLength,
      preload: true,
      name: `${name} index1`,
    });
    return new IndexedRAF(
      idx,
      depth === 3 ? index2 : undefined,
      data,
      await data.size(),
      keyLength,
      depth,
      name,
    );
  }

  async keyAt(i: number): Promise<Uint8Array> {
    return this.index1.key(i);
  }

  /**
   * The data pointers for level-1 record `i`.
   *
   * At depth 2 the level-1 pointer addresses the data directly. At depth 3 it
   * addresses a pointer list in `index2`:
   *
   *     count:int32be || count x (position:int64be, longueur:int32be)
   *
   * There is **no padding** between the count and the first entry. The
   * original's `MultipleRAFRecordInfoFactory` implies 4 bytes of it, but that
   * class is unreachable from `IndexedRAFFactory` and the padded reading does
   * not validate against the discs. See `docs/data-format.md` §2.2.
   */
  async pointersAt(i: number): Promise<RecordPointer[]> {
    const rec = await this.index1.record(i);
    const first = decodePointer(rec, this.keyLength);
    if (this.depth === 2) return [first];

    const blob = await this.index2!.read(first.position, first.longueur);
    const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    const count = dv.getInt32(0);
    const out: RecordPointer[] = [];
    for (let k = 0; k < count; k++) out.push(decodePointer(blob, 4 + k * POINTER_BYTES));
    return out;
  }

  /** Read one record given its pointer. */
  async readPointer(p: RecordPointer): Promise<Uint8Array> {
    return this.data.read(p.position, p.longueur);
  }

  /** Every data record for level-1 index `i`, read in one batch. */
  async recordsAt(i: number): Promise<Uint8Array[]> {
    const ptrs = await this.pointersAt(i);
    return this.data.readMany(ptrs.map((p) => [p.position, p.longueur] as const));
  }

  /** Exact-match lookup. Returns `undefined` rather than throwing on a miss. */
  async get(key: Uint8Array): Promise<Uint8Array[] | undefined> {
    const i = await this.index1.search(key);
    return i < 0 ? undefined : this.recordsAt(i);
  }

  /** Prefix lookup — every record under every key starting with `prefix`. */
  async getPrefix(prefix: Uint8Array): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    for (const i of await this.index1.findPrefix(prefix)) out.push(...(await this.recordsAt(i)));
    return out;
  }

  /**
   * Release every reader this dataset holds.
   *
   * Node keeps a file descriptor per open reader, and a survey of a whole disc
   * opens dozens — without this, Node closes them on GC and warns as it does.
   */
  async close(): Promise<void> {
    await Promise.all([this.index1.close(), this.index2?.close?.(), this.data.close?.()]);
  }

  /**
   * Check that every pointer lands inside the data file.
   *
   * Reports rather than throws so a caller can survey a whole disc. This plus
   * the record-length check in `SortedCobolFile.open` and key ordering is the
   * validation described in `docs/data-format.md` §6.
   */
  async validate(): Promise<{ keys: number; unsorted: number; badPointers: number }> {
    let unsorted = 0;
    let badPointers = 0;
    let prev: Uint8Array | undefined;
    for (let i = 0; i < this.index1.count; i++) {
      const k = await this.index1.key(i);
      if (prev && compareKeys(prev, k) > 0) unsorted++;
      prev = k;
      for (const p of await this.pointersAt(i)) {
        if (p.position < 0 || p.position + p.longueur > this.dataLength) badPointers++;
      }
    }
    return { keys: this.index1.count, unsorted, badPointers };
  }
}
