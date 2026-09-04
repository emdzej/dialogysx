/**
 * `SourceFs` and `TargetFs` over the File System Access API.
 *
 * The counterpart to the CLI's `node-fs.ts`: everything above these two classes
 * — disc identification, component routing, path mapping, planning — is the
 * same code the CLI runs.
 *
 * Paths here are relative to a picked directory handle, with "/" separators,
 * and resolved a segment at a time because the API has no path lookup. That is
 * a round trip per segment, so the resolved directories are cached: a tree with
 * 3,562 directories and 228,515 files would otherwise re-walk
 * `mrnt/en/d3k/chapitres/<dir>` for every file inside it.
 */
import type { ByteSource, DirEntry, SourceFs, TargetFs } from "@dialogysx/importer";

function segments(path: string): string[] {
  return path.split("/").filter((p) => p.length > 0);
}

/** Shared directory-handle cache. Keyed by the path that resolved to it. */
class DirCache {
  private readonly cache = new Map<string, Promise<FileSystemDirectoryHandle | undefined>>();

  constructor(private readonly root: FileSystemDirectoryHandle) {
    this.cache.set("", Promise.resolve(root));
  }

  /** Resolve a directory, optionally creating it. */
  get(path: string, create = false): Promise<FileSystemDirectoryHandle | undefined> {
    const key = segments(path).join("/");
    const hit = this.cache.get(key);
    if (hit) return hit;
    const promise = this.resolve(segments(path), create);
    // Cached before it settles, so concurrent writers into the same directory
    // share one `getDirectoryHandle` call rather than racing to create it.
    this.cache.set(key, promise);
    return promise;
  }

  private async resolve(
    parts: string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | undefined> {
    let dir = this.root;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch {
        return undefined;
      }
    }
    return dir;
  }
}

export class BrowserSourceFs implements SourceFs {
  private readonly dirs: DirCache;

  constructor(private readonly root: FileSystemDirectoryHandle) {
    this.dirs = new DirCache(root);
  }

  get name(): string {
    return this.root.name;
  }

  async list(path: string): Promise<DirEntry[]> {
    const dir = await this.dirs.get(path);
    if (!dir) return [];
    const out: DirEntry[] = [];
    try {
      for await (const [name, handle] of dir.entries()) {
        out.push({ name, isDirectory: handle.kind === "directory" });
      }
    } catch {
      return [];
    }
    return out;
  }

  private async file(path: string): Promise<File | undefined> {
    const parts = segments(path);
    const name = parts.pop();
    if (name === undefined) return undefined;
    const dir = await this.dirs.get(parts.join("/"));
    if (!dir) return undefined;
    try {
      return await (await dir.getFileHandle(name)).getFile();
    } catch {
      return undefined;
    }
  }

  async size(path: string): Promise<number | undefined> {
    return (await this.file(path))?.size;
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    const f = await this.file(path);
    return f === undefined ? undefined : new Uint8Array(await f.arrayBuffer());
  }

  async openBytes(path: string): Promise<ByteSource | undefined> {
    // A `File` *is* a `Blob`, so slicing an archive reads only the slice —
    // which is what makes a 945 MB zip readable in a tab at all.
    return (await this.file(path)) as unknown as ByteSource | undefined;
  }
}

export class BrowserTargetFs implements TargetFs {
  private readonly dirs: DirCache;

  constructor(private readonly root: FileSystemDirectoryHandle) {
    this.dirs = new DirCache(root);
  }

  get name(): string {
    return this.root.name;
  }

  async sizeOf(path: string): Promise<number | undefined> {
    const parts = segments(path);
    const name = parts.pop();
    if (name === undefined) return undefined;
    const dir = await this.dirs.get(parts.join("/"));
    if (!dir) return undefined;
    try {
      return (await (await dir.getFileHandle(name)).getFile()).size;
    } catch {
      return undefined;
    }
  }

  private async handleFor(path: string): Promise<FileSystemFileHandle> {
    const parts = segments(path);
    const name = parts.pop();
    if (name === undefined) throw new Error(`${path}: not a file path`);
    const dir = await this.dirs.get(parts.join("/"), true);
    if (!dir) throw new Error(`${path}: could not create its directory`);
    return await dir.getFileHandle(name, { create: true });
  }

  async writeStream(path: string, data: ReadableStream<Uint8Array>): Promise<void> {
    const handle = await this.handleFor(path);
    // `createWritable` stages into a temporary file and swaps on `close()`, so
    // a crash mid-write leaves the previous file rather than a truncated one.
    // The cost is that write traffic roughly doubles; there is no way around
    // that outside OPFS, where `createSyncAccessHandle` writes in place.
    const writable = await handle.createWritable();
    try {
      await data.pipeTo(writable);
    } catch (e) {
      // `pipeTo` aborts the writable itself on failure, so closing here would
      // throw a second, less informative error over the first.
      throw e;
    }
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const handle = await this.handleFor(path);
    const writable = await handle.createWritable();
    await writable.write(data as unknown as BufferSource);
    await writable.close();
  }
}
