/**
 * `FileSource` backed by csfs.
 *
 * dialogysx grew its own storage layer first — `HttpRangeReader`, a picked
 * directory, `ArchiveSource` — and csfs is that layer generalised into a
 * library. This adapter exists so the two can be compared against real data
 * before the local one is retired: the same 14-test browser suite runs through
 * either, so "csfs behaves identically" becomes something measured rather than
 * asserted.
 *
 * It is a thin translation, and the thinness is the interesting part. csfs
 * models a file on `Blob` — `size`, `slice`, `bytes` — while the catalogue
 * engine wants `read(pos, len)`; those are the same operation with different
 * spelling, which is why this file is short. Where dialogysx has a concept csfs
 * does not, that is called out below rather than papered over.
 */
import type { FileSource } from "@dialogysx/catalogue";
import type { ByteSource, Reader } from "@dialogysx/raf";
import type { CsFile, CsFileSystem } from "@emdzej/csfs-core";

/**
 * A `Reader` over a `CsFile`.
 *
 * `read(pos, len)` becomes `slice(pos, pos + len).bytes()`, and `size()` is a
 * property rather than a request — csfs resolves a file's size when the file is
 * opened, which is why `open()` here does not need its own `HEAD`.
 */
class CsFileReader implements Reader {
  constructor(private readonly file: CsFile) {}

  async size(): Promise<number> {
    return this.file.size;
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    if (len === 0) return new Uint8Array(0);
    return await this.file.slice(pos, pos + len).bytes();
  }

  async readMany(
    ranges: ReadonlyArray<readonly [pos: number, len: number]>,
  ): Promise<Uint8Array[]> {
    // Concurrent on purpose: over HTTP these become parallel range requests,
    // which is what makes a depth-3 index lookup one round trip's latency
    // rather than three.
    return await Promise.all(ranges.map(([pos, len]) => this.read(pos, len)));
  }
}

export class CsFileSource implements FileSource {
  constructor(private readonly fs: CsFileSystem) {}

  /** For diagnostics: `"http+zip"`, `"fsa+mounted-zip"`, and so on. */
  get kind(): string {
    return this.fs.kind;
  }

  async open(relativePath: string): Promise<Reader | undefined> {
    const file = await this.fs.file(`/${relativePath}`);
    return file ? new CsFileReader(file) : undefined;
  }

  async readAll(relativePath: string): Promise<Uint8Array | undefined> {
    return (await this.fs.read(`/${relativePath}`)) ?? undefined;
  }

  async listDirs(relativePath: string): Promise<string[]> {
    const dir = await this.fs.directory(`/${relativePath}`);
    if (!dir) return [];
    return (await dir.entries()).filter((e) => e.kind === "directory").map((e) => e.name);
  }

  /**
   * A URL for an `<img>` or an `<iframe>`.
   *
   * A real URL when the backend can give one, a blob otherwise — and the
   * difference matters for a manual rather than a drawing. A blob has to be
   * fully downloaded before it can be shown, so a 40 MB PDF cannot render page
   * one until all of it has arrived, and the browser cannot cache it between
   * visits. A real URL lets the built-in PDF viewer range-request.
   *
   * csfs answers null for anything inside an archive, where no URL addresses
   * the bytes, so the blob path still covers every illustration. Mixing the
   * two is safe because `revokeImageUrl` tests for `blob:` before revoking.
   */
  async fileUrl(relativePath: string): Promise<string | undefined> {
    const path = `/${relativePath}`;
    const direct = await this.fs.directUrl?.(path);
    if (direct) return direct;
    const file = await this.fs.file(path);
    if (!file) return undefined;
    const bytes = await file.bytes();
    return URL.createObjectURL(
      new Blob([bytes as unknown as ArrayBufferView<ArrayBuffer>], {
        type: file.type || "application/octet-stream",
      }),
    );
  }

  async byteSource(relativePath: string): Promise<ByteSource | undefined> {
    const file = await this.fs.file(`/${relativePath}`);
    if (!file) return undefined;
    // `CsFile` and `ByteSource` are the same shape by construction: both were
    // designed around `Blob`. The cast records that rather than hiding it.
    return file as unknown as ByteSource;
  }
}

/** Wrap a csfs file system as a dialogysx source. */
export function csfsSource(fs: CsFileSystem): CsFileSource {
  return new CsFileSource(fs);
}
