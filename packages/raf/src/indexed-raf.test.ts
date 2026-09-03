import { describe, expect, it } from "vitest";
import { IndexedRAF, POINTER_BYTES } from "./indexed-raf.js";
import { BytesReader } from "./reader.js";

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

function be64(v: number): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, BigInt(v));
  return [...b];
}

function be32(v: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v);
  return [...b];
}

/** `key || position:int64be || longueur:int32be` records. */
function index1(keyLength: number, rows: [string, number, number][]): Uint8Array {
  const out: number[] = [];
  for (const [key, pos, len] of rows) {
    const k = new Uint8Array(keyLength);
    for (let i = 0; i < key.length; i++) k[i] = key.charCodeAt(i);
    out.push(...k, ...be64(pos), ...be32(len));
  }
  return new Uint8Array(out);
}

describe("IndexedRAF depth 2", () => {
  it("resolves a key straight to its data record", async () => {
    const data = ascii("HELLOWORLD");
    const raf = await IndexedRAF.open({
      data: new BytesReader(data),
      index1: new BytesReader(
        index1(2, [
          ["AA", 0, 5],
          ["BB", 5, 5],
        ]),
      ),
      keyLength: 2,
      depth: 2,
    });

    expect(raf.index1.recordLength).toBe(2 + POINTER_BYTES);
    const recs = await raf.get(ascii("BB"));
    expect(recs?.map((r) => new TextDecoder().decode(r))).toEqual(["WORLD"]);
  });

  it("returns undefined for a key that is not present", async () => {
    const raf = await IndexedRAF.open({
      data: new BytesReader(ascii("HELLO")),
      index1: new BytesReader(index1(2, [["AA", 0, 5]])),
      keyLength: 2,
      depth: 2,
    });
    expect(await raf.get(ascii("ZZ"))).toBeUndefined();
  });
});

describe("IndexedRAF depth 3", () => {
  // index2 record: count:int32be then count x (position:int64be, longueur:int32be).
  // Crucially there is NO padding between the count and the first entry.
  const data = ascii("ONETWOSIX");
  const i2 = new Uint8Array([
    ...be32(2),
    ...be64(0),
    ...be32(3), // "ONE"
    ...be64(3),
    ...be32(3), // "TWO"
    ...be32(1),
    ...be64(6),
    ...be32(3), // "SIX"
  ]);
  // First index2 record occupies bytes 0..27 (4 + 2*12), second starts at 28.
  const idx1 = index1(2, [
    ["AA", 0, 28],
    ["BB", 28, 16],
  ]);

  async function open() {
    return IndexedRAF.open({
      data: new BytesReader(data),
      index1: new BytesReader(idx1),
      index2: new BytesReader(i2),
      keyLength: 2,
      depth: 3,
    });
  }

  it("fans one key out to many data records", async () => {
    const raf = await open();
    const recs = await raf.get(ascii("AA"));
    expect(recs?.map((r) => new TextDecoder().decode(r))).toEqual(["ONE", "TWO"]);
  });

  it("handles a single-entry pointer list", async () => {
    const raf = await open();
    const recs = await raf.get(ascii("BB"));
    expect(recs?.map((r) => new TextDecoder().decode(r))).toEqual(["SIX"]);
  });

  it("reads the pointer list with no padding after the count", async () => {
    // The original's unreachable MultipleRAFRecordInfoFactory skips to offset +8,
    // implying 4 bytes of padding. If this reader did that, the first pointer
    // would be read from the wrong offset and decode as garbage. Asserting the
    // exact pointers pins the layout.
    const raf = await open();
    expect(await raf.pointersAt(0)).toEqual([
      { position: 0, longueur: 3 },
      { position: 3, longueur: 3 },
    ]);
  });

  it("requires an index2 reader", async () => {
    await expect(
      IndexedRAF.open({
        data: new BytesReader(data),
        index1: new BytesReader(idx1),
        keyLength: 2,
        depth: 3,
        name: "no-index2",
      }),
    ).rejects.toThrow(/depth 3 needs an index2 reader/);
  });
});

describe("IndexedRAF.validate", () => {
  it("passes a well-formed dataset", async () => {
    const raf = await IndexedRAF.open({
      data: new BytesReader(ascii("HELLOWORLD")),
      index1: new BytesReader(
        index1(2, [
          ["AA", 0, 5],
          ["BB", 5, 5],
        ]),
      ),
      keyLength: 2,
      depth: 2,
    });
    expect(await raf.validate()).toEqual({ keys: 2, unsorted: 0, badPointers: 0 });
  });

  it("counts keys that are out of order", async () => {
    const raf = await IndexedRAF.open({
      data: new BytesReader(ascii("HELLOWORLD")),
      index1: new BytesReader(
        index1(2, [
          ["BB", 0, 5],
          ["AA", 5, 5],
        ]),
      ),
      keyLength: 2,
      depth: 2,
    });
    expect((await raf.validate()).unsorted).toBe(1);
  });

  it("counts pointers that run past the end of the data file", async () => {
    const raf = await IndexedRAF.open({
      data: new BytesReader(ascii("SHORT")),
      index1: new BytesReader(index1(2, [["AA", 3, 99]])),
      keyLength: 2,
      depth: 2,
    });
    expect((await raf.validate()).badPointers).toBe(1);
  });
});
