/**
 * `FileSource` over a local directory — a mounted disc or an unpacked tree.
 */
import { openAsBlob } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileSource } from "@dialogysx/catalogue";
import type { ByteSource, Reader } from "@dialogysx/raf";
import { NodeFileReader } from "@dialogysx/raf/node";

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export class NodeDirectorySource implements FileSource {
  /** @param root the `dialogys/data` directory */
  constructor(private readonly root: string) {}

  async open(relativePath: string): Promise<Reader | undefined> {
    const path = join(this.root, relativePath);
    return (await exists(path)) ? new NodeFileReader(path) : undefined;
  }

  /**
   * A sliceable handle, so the CLI can read archives in place too — the same
   * capability the browser has, which is what keeps `ArchiveSource` testable
   * outside a tab.
   */
  async byteSource(relativePath: string): Promise<ByteSource | undefined> {
    try {
      return (await openAsBlob(join(this.root, relativePath))) as unknown as ByteSource;
    } catch {
      return undefined;
    }
  }

  async readAll(relativePath: string): Promise<Uint8Array | undefined> {
    const path = join(this.root, relativePath);
    if (!(await exists(path))) return undefined;
    return new Uint8Array(await readFile(path));
  }

  async listDirs(relativePath: string): Promise<string[]> {
    try {
      const entries = await readdir(join(this.root, relativePath), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }
}
