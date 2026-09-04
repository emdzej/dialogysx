/**
 * `FileSource` over a directory the user picked — a mounted disc or an
 * unpacked tree, read straight off local disk with no upload and no server.
 *
 * Uses the File System Access API. `showDirectoryPicker` is Chromium-only
 * today; the feature is offered rather than assumed, and `isSupported` is what
 * the UI should branch on.
 */
import type { FileSource } from "@dialogysx/catalogue";
import { BlobReader, type Reader } from "@dialogysx/raf";

export function isSupported(): boolean {
  return typeof globalThis.showDirectoryPicker === "function";
}

export class LocalDirectorySource implements FileSource {
  /** @param root a handle for the `dialogys/data` directory */
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  /** Prompt for a directory. Throws if the user cancels or the API is absent. */
  static async pick(): Promise<LocalDirectorySource> {
    // Captured into a local so the check narrows the type. A predicate call
    // like `isSupported()` cannot narrow a property of `globalThis`.
    const picker = globalThis.showDirectoryPicker;
    if (typeof picker !== "function") {
      throw new Error(
        "This browser has no File System Access API. Use a static tree over HTTP instead.",
      );
    }
    return new LocalDirectorySource(await picker({ mode: "read" }));
  }

  private async resolve(relativePath: string): Promise<File | undefined> {
    const parts = relativePath.split("/").filter((p) => p.length > 0);
    const name = parts.pop();
    if (name === undefined) return undefined;
    let dir = this.root;
    try {
      for (const p of parts) dir = await dir.getDirectoryHandle(p);
      return await (await dir.getFileHandle(name)).getFile();
    } catch {
      return undefined;
    }
  }

  async open(relativePath: string): Promise<Reader | undefined> {
    const file = await this.resolve(relativePath);
    return file === undefined ? undefined : new BlobReader(file);
  }

  async readAll(relativePath: string): Promise<Uint8Array | undefined> {
    const file = await this.resolve(relativePath);
    return file === undefined ? undefined : new Uint8Array(await file.arrayBuffer());
  }

  /**
   * A picked directory has no URL, so mint a blob for the file.
   *
   * Blob URLs are revoked by `revokeImageUrl` once the `<img>` has swapped;
   * leaking one per drawing would pin every image ever viewed in memory.
   */
  async fileUrl(relativePath: string): Promise<string | undefined> {
    const file = await this.resolve(relativePath);
    return file === undefined ? undefined : URL.createObjectURL(file);
  }

  async listDirs(relativePath: string): Promise<string[]> {
    const parts = relativePath.split("/").filter((p) => p.length > 0);
    let dir = this.root;
    try {
      for (const p of parts) dir = await dir.getDirectoryHandle(p);
    } catch {
      return [];
    }
    const out: string[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") out.push(name);
    }
    return out;
  }
}

/** Release a blob URL made by `LocalDirectorySource.fileUrl`. */
export function revokeImageUrl(url: string | undefined): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}
