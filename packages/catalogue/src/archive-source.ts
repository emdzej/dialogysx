/**
 * Reading files that were never unpacked.
 *
 * 184,610 of the 228,515 files in a full English tree come out of nine
 * archives the vendor already ships: `dessins/100.zip` holds 38,488 drawings,
 * and eight `images_*.zip` hold 146,121 illustrations. Extracting them is what
 * makes an import slow to write, slow to copy and expensive to host — 146,121
 * objects in a bucket, or 146,121 file creates on a share that manages a
 * handful per second.
 *
 * None of that data needs unpacking to be read. A drawing is fetched whole,
 * one at a time, by an `<img>`; an illustration likewise. So this decorates a
 * `FileSource` and answers those paths out of the archives, with one `Range`
 * request per file — the same shape the catalogue's own `(position, length)`
 * addressing already uses.
 *
 * **The extracted layout is not the archive layout**, which is the trap here.
 * `dessins/100.zip` stores `1132C000.png` at its top level, while the app asks
 * for `dessins/100/1132/1132C000.png` — the drawings ship *twice* on the disc,
 * once as that flat archive and once as a directory tree bucketed by the first
 * four characters. So a mount cannot derive the entry name by stripping a
 * prefix; it has to be told how, which is what `entry` is for.
 *
 * The underlying source is always tried first, so a tree that *was* extracted
 * still works, and a half-extracted one falls back per file rather than
 * failing.
 */
import { openZipEntry, readZipEntries, type ByteSource, type ZipEntry } from "@dialogysx/raf";
import type { FileSource } from "./disc.js";

/** How to turn a requested path into an entry name inside an archive. */
export type EntryNaming =
  /** The last path segment. Both shipped archives are flat. */
  | "basename"
  /** The path with the mount's prefix removed, for an archive that nests. */
  | "relative";

/**
 * Which archive stands in for which directory.
 *
 * Paths are `/`-rooted — `/dessins/100.zip`, `/dessins/100` — deliberately,
 * because this is the same value `@emdzej/csfs-zip` takes for a mount. Rooting
 * them is the whole of the compatibility: the array in `manifest.json` can be
 * handed to `withTransparentArchives` unchanged, and there is nothing to
 * translate and so nothing to drift.
 *
 * Requested paths, by contrast, arrive relative — the catalogue's own
 * references have no leading slash — so `mountsFor` roots them before
 * comparing rather than requiring every caller to.
 */
export interface ArchiveMount {
  /** Path of the archive itself, from the tree root. */
  archive: string;
  /** The directory it stands in for, e.g. `/dessins/100`. */
  serves: string;
  entry: EntryNaming;
}

/** `/`-rooted, so a mount and a request can be compared. */
function rooted(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/** What `manifest.json` carries so a reader knows which archives to consult. */
export interface ArchiveManifest {
  archives?: ArchiveMount[];
}

/** Just enough of `Blob` to construct one where the DOM lib is absent. */
type BlobLike = new (parts: unknown[], opts?: { type?: string }) => unknown;

function basename(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? path : path.slice(at + 1);
}

/**
 * MIME type by extension, for the blob URLs this mints.
 *
 * An `<img>` will sniff a typeless blob and cope, but an `<iframe>` handed a
 * typeless PDF offers a download instead of rendering it — the same failure
 * the dev server had.
 */
function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  if (ext === "pdf") return "application/pdf";
  if (ext === "xml") return "application/xml";
  return "application/octet-stream";
}

export class ArchiveSource implements FileSource {
  /** Parsed central directories, by archive path. `null` = archive absent. */
  private readonly indexes = new Map<string, Promise<Map<string, ZipEntry> | null>>();
  /** Open archive handles, so each is sliced rather than re-opened per file. */
  private readonly handles = new Map<string, Promise<ByteSource | undefined>>();

  constructor(
    private readonly inner: FileSource,
    private readonly mounts: readonly ArchiveMount[],
  ) {}

  /**
   * Every mount that could serve this path.
   *
   * Plural, and that is the whole point: `images_1.zip` exists on three of the
   * English discs with *different* contents, and extraction is what used to
   * merge them. Keeping them archived means several archives stand in for one
   * directory, so a lookup tries each until the entry turns up. Their entry
   * names do not overlap — measured, 0 of 36,374 on the Russian set — so the
   * order does not matter.
   */
  private mountsFor(path: string): ArchiveMount[] {
    const p = rooted(path);
    return this.mounts.filter((m) => p.startsWith(`${rooted(m.serves)}/`));
  }

  private entryName(mount: ArchiveMount, path: string): string {
    if (mount.entry === "basename") return basename(path);
    return rooted(path).slice(rooted(mount.serves).length + 1);
  }

  /**
   * The archive's central directory, parsed once and kept.
   *
   * 2.23 MB for the drawings archive and 0.46 MB for an image set, read with
   * two `Range` requests — the end-of-central-directory record and then the
   * directory itself. That is a one-off comparable to the index preload the
   * catalogue already does, and it buys every file in the archive.
   *
   * Cached as the *promise*, so two concurrent lookups share one parse rather
   * than both downloading it.
   */
  private index(archive: string): Promise<Map<string, ZipEntry> | null> {
    const hit = this.indexes.get(archive);
    if (hit) return hit;
    const promise = (async () => {
      const bytes = await this.bytes(archive);
      if (!bytes) return null;
      const entries = await readZipEntries(bytes);
      const map = new Map<string, ZipEntry>();
      for (const e of entries) if (!e.isDirectory) map.set(e.name, e);
      return map;
    })().catch(() => null);
    this.indexes.set(archive, promise);
    return promise;
  }

  private bytes(archive: string): Promise<ByteSource | undefined> {
    const hit = this.handles.get(archive);
    if (hit) return hit;
    // The one place the rooted spelling has to come back off: mounts are
    // rooted to match csfs, while `FileSource` addresses the tree relatively.
    // Keyed on the rooted form above, so the cache agrees with the mounts.
    const relative = archive.replace(/^\/+/, "");
    // A source without `byteSource` cannot serve archives; `readAll` and
    // `fileUrl` then fall through to the extracted tree, which is the right
    // answer rather than an error.
    const promise = (this.inner.byteSource?.(relative) ?? Promise.resolve(undefined)).catch(
      () => undefined,
    );
    this.handles.set(archive, promise);
    return promise;
  }

  /** Read one file out of its archive, or `undefined` if it is not in one. */
  private async fromArchive(path: string): Promise<Uint8Array | undefined> {
    for (const mount of this.mountsFor(path)) {
      const found = await this.readFrom(mount, path);
      if (found) return found;
    }
    return undefined;
  }

  private async readFrom(mount: ArchiveMount, path: string): Promise<Uint8Array | undefined> {
    const index = await this.index(mount.archive);
    if (!index) return undefined;
    const entry = index.get(this.entryName(mount, path));
    if (!entry) return undefined;
    const source = await this.bytes(mount.archive);
    if (!source) return undefined;
    const stream = await openZipEntry(source, entry);
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }

  async open(relativePath: string): ReturnType<FileSource["open"]> {
    // Archived files are read whole; nothing byte-addresses them, so there is
    // no reason to present a `Reader` over one.
    return await this.inner.open(relativePath);
  }

  async readAll(relativePath: string): Promise<Uint8Array | undefined> {
    const direct = await this.inner.readAll(relativePath);
    if (direct) return direct;
    return await this.fromArchive(relativePath);
  }

  async listDirs(relativePath: string): Promise<string[]> {
    return await this.inner.listDirs(relativePath);
  }

  /**
   * A URL for the browser, from the archive when an archive has the file.
   *
   * **The archive is tried first here, unlike `readAll`**, and the asymmetry is
   * not an oversight. `HttpTreeSource.fileUrl` returns a URL without checking
   * that anything is there — deliberately, so that showing 15 drawings does not
   * cost 15 `HEAD` requests. That makes it useless as an existence test: asking
   * it first yielded a URL for every drawing, each of which 404'd, and the
   * archive was never consulted. The symptom was an `<img>` that simply never
   * loaded, with no error anywhere.
   *
   * The index lookup this costs is a `Map.get` after the first read of that
   * archive, so preferring it is nearly free.
   *
   * The blob has to be revoked by the caller — `revokeImageUrl` in the web app
   * already does that for the picked-directory backend, and this is the same
   * arrangement.
   */
  async fileUrl(relativePath: string): Promise<string | undefined> {
    const bytes = await this.fromArchive(relativePath);
    if (!bytes) return await this.inner.fileUrl?.(relativePath);
    // `Blob` and `URL.createObjectURL` exist only in a browser, and this
    // package builds against Node's libs, so the constructor is reached
    // through a narrow local type rather than by widening the whole package's
    // lib set — which would let genuinely browser-only APIs slip into the
    // domain code unnoticed.
    const blob = new (globalThis as unknown as { Blob: BlobLike }).Blob([bytes], {
      type: mimeFor(relativePath),
    });
    return (
      globalThis as unknown as { URL: { createObjectURL(b: unknown): string } }
    ).URL.createObjectURL(blob);
  }

  async byteSource(relativePath: string): Promise<ByteSource | undefined> {
    return await this.inner.byteSource?.(relativePath);
  }
}
