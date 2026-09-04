import { openAsBlob } from "node:fs";
import { describe, expect, it } from "vitest";
import { crc32, readZipEntries, readZipEntry, type ByteSource } from "./zip.js";

/**
 * A zip built by hand, so the tests do not need a disc.
 *
 * Stored entries only: enough to exercise the central-directory walk, the
 * local-header skip and the name decoding without pulling in a compressor.
 * The deflate path is exercised against a real archive below, which is the
 * only place the CRC-0 quirk actually appears.
 */
function buildZip(files: { name: string; data: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (a: number[], v: number) =>
    a.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);

  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.data);
    const offset = local.length;
    u32(local, 0x04034b50);
    u16(local, 20);
    u16(local, 0);
    u16(local, 0);
    u16(local, 0);
    u16(local, 0);
    // Zero CRC and zero sizes in the *local* header, exactly as the Dialogys
    // archives do — the reader must ignore all three.
    u32(local, 0);
    u32(local, 0);
    u32(local, 0);
    u16(local, name.length);
    u16(local, 0);
    local.push(...name, ...data);

    u32(central, 0x02014b50);
    u16(central, 20);
    u16(central, 20);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, 0xdeadbeef);
    u32(central, data.length);
    u32(central, data.length);
    u16(central, name.length);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, 0);
    u32(central, offset);
    central.push(...name);
  }

  const eocd: number[] = [];
  u32(eocd, 0x06054b50);
  u16(eocd, 0);
  u16(eocd, 0);
  u16(eocd, files.length);
  u16(eocd, files.length);
  u32(eocd, central.length);
  u32(eocd, local.length);
  u16(eocd, 0);
  return new Uint8Array([...local, ...central, ...eocd]);
}

const source = (bytes: Uint8Array): ByteSource => new Blob([bytes]) as unknown as ByteSource;

describe("readZipEntries", () => {
  it("takes sizes from the central directory, not the local header", async () => {
    // The load-bearing case: local headers here claim zero length. A reader
    // that trusts them writes empty files and reports success.
    const zip = source(
      buildZip([
        { name: "a.txt", data: "hello" },
        { name: "dir/b.txt", data: "world!" },
      ]),
    );
    const entries = await readZipEntries(zip);
    expect(entries.map((e) => [e.name, e.uncompressedSize])).toEqual([
      ["a.txt", 5],
      ["dir/b.txt", 6],
    ]);
    expect(entries[0]!.crc32).toBe(0xdeadbeef);
  });

  it("computes a CRC-32 that matches a known value", () => {
    // The standard check value for CRC-32 of "123456789".
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("reads a stored entry's bytes", async () => {
    const zip = source(buildZip([{ name: "a.txt", data: "hello" }]));
    const [entry] = await readZipEntries(zip);
    expect(new TextDecoder().decode(await readZipEntry(zip, entry!))).toBe("hello");
  });

  it("rejects something that is not a zip", async () => {
    const zip = source(new TextEncoder().encode("not a zip at all"));
    await expect(readZipEntries(zip)).rejects.toThrow(/not a zip archive/);
  });
});

/**
 * Against a real archive, when one is reachable.
 *
 * Skipped by default: disc data is not redistributable, so there is no fixture
 * in the repository. Point `DIALOGYSX_TEST_ZIP` at any archive from a disc —
 * this is the only test that proves the CRC-0 local headers and the deflate
 * path are handled, because a synthesised zip cannot reproduce them.
 */
const realZip = process.env.DIALOGYSX_TEST_ZIP;

describe.skipIf(!realZip)("against a real Dialogys archive", () => {
  it("reads the central directory and inflates an entry", async () => {
    const blob = (await openAsBlob(realZip!)) as unknown as ByteSource;
    const entries = await readZipEntries(blob);
    expect(entries.length).toBeGreaterThan(0);

    // Every entry is stored or deflate: anything else would mean the format
    // survey was wrong.
    expect([...new Set(entries.map((e) => e.method))].sort()).toEqual(
      expect.arrayContaining([expect.any(Number)]),
    );
    for (const e of entries) expect([0, 8]).toContain(e.method);

    // A deflate entry and, if the archive has one, a stored entry: the two
    // code paths differ and only one of them touches DecompressionStream.
    const deflated = entries.find((e) => e.method === 8 && e.uncompressedSize > 0);
    const stored = entries.find((e) => e.method === 0 && e.uncompressedSize > 0);
    expect(deflated ?? stored).toBeDefined();

    for (const file of [deflated, stored].filter((e) => e !== undefined)) {
      const bytes = await readZipEntry(blob, file);
      expect(bytes.byteLength).toBe(file.uncompressedSize);
      // The decisive check. Matching lengths would also hold for garbage of
      // the right size; a matching CRC against the *central* directory proves
      // both that the right bytes came out and that the size came from the
      // right header.
      expect(crc32(bytes)).toBe(file.crc32);
    }
  }, 120_000);
});
