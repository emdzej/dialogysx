import { describe, expect, it } from "vitest";
import { BytesReader } from "./reader.js";
import { compareKeys, SortedCobolFile } from "./sorted-cobol-file.js";

/** Build a fixed-record file from key/payload pairs, keys padded with NUL. */
function build(keyLength: number, recordLength: number, rows: [string, string][]): Uint8Array {
  const out = new Uint8Array(rows.length * recordLength);
  rows.forEach(([key, payload], i) => {
    const base = i * recordLength;
    for (let j = 0; j < key.length; j++) out[base + j] = key.charCodeAt(j);
    for (let j = 0; j < payload.length; j++) out[base + keyLength + j] = payload.charCodeAt(j);
  });
  return out;
}

const KEY = 4;
const REC = 8;
const ROWS: [string, string][] = [
  ["AA01", "aaaa"],
  ["AA02", "bbbb"],
  ["AB01", "cccc"],
  ["AB02", "dddd"],
  ["BC01", "eeee"],
];

async function open(preload: boolean) {
  return SortedCobolFile.open(new BytesReader(build(KEY, REC, ROWS)), {
    recordLength: REC,
    keyLength: KEY,
    preload,
    name: "fixture",
  });
}

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe("compareKeys", () => {
  it("orders ASCII keys the obvious way", () => {
    expect(compareKeys(ascii("AA"), ascii("AB"))).toBeLessThan(0);
    expect(compareKeys(ascii("AB"), ascii("AA"))).toBeGreaterThan(0);
    expect(compareKeys(ascii("AA"), ascii("AA"))).toBe(0);
  });

  it("treats a shorter key as less than its own extension", () => {
    expect(compareKeys(ascii("AA"), ascii("AAA"))).toBeLessThan(0);
  });

  it("compares high bytes as SIGNED, so 0x80 sorts below 0x01", () => {
    // This is the property that distinguishes the original's comparison from an
    // unsigned one. No shipped catalogue key exercises it, so it gets a unit
    // test instead of relying on disc data to catch a regression.
    expect(compareKeys(new Uint8Array([0x80]), new Uint8Array([0x01]))).toBeLessThan(0);
    expect(compareKeys(new Uint8Array([0xff]), new Uint8Array([0x00]))).toBeLessThan(0);
  });
});

describe.each([true, false])("SortedCobolFile (preload=%s)", (preload) => {
  it("derives the record count from the file size", async () => {
    const f = await open(preload);
    expect(f.count).toBe(ROWS.length);
  });

  it("rejects a size that is not a whole number of records", async () => {
    // A wrong keyLength shows up here first, and it is the check that caught
    // every guess during reverse-engineering.
    await expect(
      SortedCobolFile.open(new BytesReader(new Uint8Array(41)), {
        recordLength: REC,
        keyLength: KEY,
        name: "ragged",
      }),
    ).rejects.toThrow(/not a multiple of record length 8 \(remainder 1\)/);
  });

  it("finds an exact key", async () => {
    const f = await open(preload);
    expect(await f.search(ascii("AB01"))).toBe(2);
  });

  it("returns the negated insertion point for a missing key", async () => {
    const f = await open(preload);
    // "AA015" sorts between index 0 and 1, so insertion point 1 -> -2.
    expect(await f.search(ascii("AA015"))).toBe(-2);
    expect(await f.search(ascii("ZZ99"))).toBe(-(ROWS.length + 1));
  });

  it("collects every record under a shared prefix", async () => {
    const f = await open(preload);
    expect(await f.findPrefix(ascii("AA"))).toEqual([0, 1]);
    expect(await f.findPrefix(ascii("A"))).toEqual([0, 1, 2, 3]);
    expect(await f.findPrefix(ascii("BC"))).toEqual([4]);
    expect(await f.findPrefix(ascii("ZZ"))).toEqual([]);
  });

  it("walks backwards to the first match when the probe lands mid-run", async () => {
    // Binary search on "AB" may land on index 3; the result must still start at 2.
    const f = await open(preload);
    expect(await f.findPrefix(ascii("AB"))).toEqual([2, 3]);
  });

  it("reads the payload after the key", async () => {
    const f = await open(preload);
    const rec = await f.record(1);
    expect(new TextDecoder().decode(rec.subarray(KEY))).toBe("bbbb");
  });
});
