import { describe, expect, it } from "vitest";
import { ArchiveSource, type ArchiveMount } from "./archive-source.js";
import type { FileSource } from "./disc.js";
import type { ByteSource } from "@dialogysx/raf";
import { BytesReader, type Reader } from "@dialogysx/raf";

/**
 * A zip of stored entries, built here so the tests need no disc.
 *
 * Local headers carry zero sizes and a zero CRC, exactly as the Dialogys
 * archives do — a reader that trusts them writes empty files and reports
 * success, so it matters that this fixture reproduces the fault.
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
    for (let i = 0; i < 5; i++) u16(local, i === 0 ? 20 : 0);
    u32(local, 0);
    u32(local, 0);
    u32(local, 0);
    u16(local, name.length);
    u16(local, 0);
    local.push(...name, ...data);

    u32(central, 0x02014b50);
    u16(central, 20);
    u16(central, 20);
    for (let i = 0; i < 4; i++) u16(central, 0);
    u32(central, 0);
    u32(central, data.length);
    u32(central, data.length);
    u16(central, name.length);
    for (let i = 0; i < 4; i++) u16(central, 0);
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

/** A `FileSource` over a map, which can also hand out `ByteSource`s. */
function memorySource(files: Map<string, Uint8Array>): FileSource {
  return {
    async open(path): Promise<Reader | undefined> {
      const b = files.get(path);
      return b === undefined ? undefined : new BytesReader(b);
    },
    async readAll(path) {
      return files.get(path);
    },
    async listDirs() {
      return [];
    },
    async byteSource(path): Promise<ByteSource | undefined> {
      const b = files.get(path);
      return b === undefined ? undefined : (new Blob([b]) as unknown as ByteSource);
    },
  };
}

const MOUNTS: ArchiveMount[] = [
  { archive: "dessins/100.zip", serves: "dessins/100", entry: "basename" },
];

describe("ArchiveSource", () => {
  it("serves a file from inside an archive under its extracted path", async () => {
    // The trap this exists for: the archive stores `1132C000.png` flat, while
    // the app asks for `dessins/100/1132/1132C000.png` — the drawings ship in
    // both layouts, so the entry name cannot be derived by stripping a prefix.
    const files = new Map([
      ["dessins/100.zip", buildZip([{ name: "1132C000.png", data: "a drawing" }])],
    ]);
    const src = new ArchiveSource(memorySource(files), MOUNTS);
    const bytes = await src.readAll("dessins/100/1132/1132C000.png");
    expect(new TextDecoder().decode(bytes)).toBe("a drawing");
  });

  it("prefers an extracted file when the tree has one", async () => {
    // A tree that *was* extracted must keep working, and a half-extracted one
    // has to fall back per file rather than failing.
    const files = new Map([
      ["dessins/100.zip", buildZip([{ name: "x.png", data: "from the archive" }])],
      ["dessins/100/x/x.png", new TextEncoder().encode("already extracted")],
    ]);
    const src = new ArchiveSource(memorySource(files), MOUNTS);
    const bytes = await src.readAll("dessins/100/x/x.png");
    expect(new TextDecoder().decode(bytes)).toBe("already extracted");
  });

  it("tries every archive that serves a directory", async () => {
    // `images_1.zip` exists on three English discs with different contents, so
    // each is copied into its own subdirectory and several archives stand in
    // for one directory. A lookup that stopped at the first would miss two
    // thirds of the illustrations.
    const dir = "mrnt/en/d3k/images";
    const files = new Map([
      [`${dir}/1/images_1.zip`, buildZip([{ name: "one.png", data: "first disc" }])],
      [`${dir}/2/images_1.zip`, buildZip([{ name: "two.png", data: "second disc" }])],
      [`${dir}/3/images_1.zip`, buildZip([{ name: "three.png", data: "third disc" }])],
    ]);
    const mounts: ArchiveMount[] = [1, 2, 3].map((n) => ({
      archive: `${dir}/${n}/images_1.zip`,
      serves: dir,
      entry: "basename",
    }));
    const src = new ArchiveSource(memorySource(files), mounts);
    expect(new TextDecoder().decode(await src.readAll(`${dir}/one.png`))).toBe("first disc");
    expect(new TextDecoder().decode(await src.readAll(`${dir}/two.png`))).toBe("second disc");
    expect(new TextDecoder().decode(await src.readAll(`${dir}/three.png`))).toBe("third disc");
  });

  it("returns undefined for a path no archive covers", async () => {
    const files = new Map([["dessins/100.zip", buildZip([{ name: "a.png", data: "x" }])]]);
    const src = new ArchiveSource(memorySource(files), MOUNTS);
    expect(await src.readAll("pr/Planches.dat")).toBeUndefined();
    expect(await src.readAll("dessins/100/9999/absent.png")).toBeUndefined();
  });

  it("falls through when the source cannot hand out a byte source", async () => {
    // Node's plain reader can, but a backend that cannot must degrade to the
    // extracted tree rather than throw.
    const inner: FileSource = {
      async open() {
        return undefined;
      },
      async readAll() {
        return undefined;
      },
      async listDirs() {
        return [];
      },
    };
    const src = new ArchiveSource(inner, MOUNTS);
    expect(await src.readAll("dessins/100/1132/1132C000.png")).toBeUndefined();
  });

  it("parses each archive's central directory once", async () => {
    let opens = 0;
    const zip = buildZip([
      { name: "a.png", data: "one" },
      { name: "b.png", data: "two" },
    ]);
    const inner: FileSource = {
      async open() {
        return undefined;
      },
      async readAll() {
        return undefined;
      },
      async listDirs() {
        return [];
      },
      async byteSource() {
        opens += 1;
        return new Blob([zip]) as unknown as ByteSource;
      },
    };
    const src = new ArchiveSource(inner, MOUNTS);
    await src.readAll("dessins/100/a/a.png");
    await src.readAll("dessins/100/b/b.png");
    // The directory is 2.23 MB for the real drawings archive, so re-reading it
    // per file would cost more than the files themselves.
    expect(opens).toBe(1);
  });
});

describe("ArchiveSource.fileUrl", () => {
  it("prefers the archive, because an HTTP source's URL is not an existence test", async () => {
    // `HttpTreeSource.fileUrl` hands back a URL without checking anything, so
    // asking the inner source first produced a URL for every drawing, each of
    // which 404'd, and the archive was never reached. The `<img>` then simply
    // never loaded, with no error anywhere.
    const zip = buildZip([{ name: "a.png", data: "PNG-ish" }]);
    const urls: string[] = [];
    const inner: FileSource = {
      async open() {
        return undefined;
      },
      async readAll() {
        return undefined;
      },
      async listDirs() {
        return [];
      },
      async byteSource() {
        return new Blob([zip]) as unknown as ByteSource;
      },
      async fileUrl(path) {
        urls.push(path);
        return `/data/${path}`;
      },
    };
    const src = new ArchiveSource(inner, MOUNTS);

    // `URL.createObjectURL` does not exist in this environment; a stub is
    // enough to prove which branch was taken.
    const g = globalThis as unknown as { URL: { createObjectURL(b: unknown): string } };
    const original = g.URL.createObjectURL;
    g.URL.createObjectURL = () => "blob:stub";
    try {
      expect(await src.fileUrl("dessins/100/a/a.png")).toBe("blob:stub");
      expect(urls).toEqual([]);
      // And a path no archive covers still falls through to the inner URL.
      expect(await src.fileUrl("eclate/100/x.png")).toBe("/data/eclate/100/x.png");
    } finally {
      g.URL.createObjectURL = original;
    }
  });
});
