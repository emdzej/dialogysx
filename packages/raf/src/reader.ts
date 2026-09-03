/**
 * The read boundary.
 *
 * Dialogys addresses every catalogue record as `(position, longueur)` — see
 * `docs/data-format.md` §2.2. That is the same shape as an HTTP `Range`
 * request and as `Blob.slice()`, which is why the whole engine needs exactly
 * one primitive and gets three backends for free.
 */

export interface Reader {
  /** Total length of the underlying resource, in bytes. */
  size(): Promise<number>;
  /** Read `len` bytes at `pos`. Must return exactly `len` bytes unless at EOF. */
  read(pos: number, len: number): Promise<Uint8Array>;
  /**
   * Read many ranges. The default implementation is sequential; backends that
   * can do better should override it.
   *
   * The original batched too — `ObjetGenericRandomAccessFile.getTabOfRecords`
   * takes parallel position and length arrays — so a plate view was never
   * meant to be N round trips.
   */
  readMany(ranges: ReadonlyArray<readonly [pos: number, len: number]>): Promise<Uint8Array[]>;
  close?(): Promise<void>;
}

/** Shared `readMany` for backends with no better idea. */
export abstract class BaseReader implements Reader {
  abstract size(): Promise<number>;
  abstract read(pos: number, len: number): Promise<Uint8Array>;

  async readMany(
    ranges: ReadonlyArray<readonly [pos: number, len: number]>,
  ): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    for (const [pos, len] of ranges) out.push(await this.read(pos, len));
    return out;
  }
}

/** A reader over an in-memory buffer. Used for small preloaded index files. */
export class BytesReader extends BaseReader {
  constructor(private readonly bytes: Uint8Array) {
    super();
  }

  async size(): Promise<number> {
    return this.bytes.length;
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    return this.bytes.subarray(pos, pos + len);
  }
}

/**
 * A reader over a browser `Blob` or `File` — the local-disc path, via the File
 * System Access API or a plain file input.
 */
export class BlobReader extends BaseReader {
  constructor(private readonly blob: Blob) {
    super();
  }

  async size(): Promise<number> {
    return this.blob.size;
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    const buf = await this.blob.slice(pos, pos + len).arrayBuffer();
    return new Uint8Array(buf);
  }
}

/**
 * A reader over HTTP `Range` requests — the static-hosting path.
 *
 * Requires the host to honour `Range`; a server that ignores it and returns
 * 200 with the whole body would quietly read the wrong bytes, so that case is
 * rejected rather than trusted.
 */
export class HttpRangeReader extends BaseReader {
  private cachedSize?: number;

  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  async size(): Promise<number> {
    if (this.cachedSize !== undefined) return this.cachedSize;
    const res = await this.fetchImpl(this.url, { method: "HEAD" });
    if (!res.ok) throw new Error(`HEAD ${this.url}: ${res.status}`);
    const len = res.headers.get("content-length");
    if (len === null) throw new Error(`HEAD ${this.url}: no content-length`);
    this.cachedSize = Number(len);
    return this.cachedSize;
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    if (len === 0) return new Uint8Array(0);
    const res = await this.fetchImpl(this.url, {
      headers: { Range: `bytes=${pos}-${pos + len - 1}` },
    });
    if (res.status !== 206) {
      throw new Error(
        `GET ${this.url} Range bytes=${pos}-${pos + len - 1}: expected 206, got ${res.status}` +
          ` — the host is ignoring Range requests`,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Range requests parallelise; the browser will cap the connection count. */
  override async readMany(
    ranges: ReadonlyArray<readonly [pos: number, len: number]>,
  ): Promise<Uint8Array[]> {
    return Promise.all(ranges.map(([pos, len]) => this.read(pos, len)));
  }
}
