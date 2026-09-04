/**
 * `SourceFs` and `TargetFs` over `node:fs`.
 *
 * The whole point of the abstraction is that this file is the only thing in the
 * importer that knows about `node:fs` — the classification, the path mapping
 * and the disc identification are shared with the browser.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { openAsBlob } from "node:fs";
import type { ByteSource, DirEntry, SourceFs, TargetFs } from "@dialogysx/importer";

export class NodeSourceFs implements SourceFs {
  async list(path: string): Promise<DirEntry[]> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    } catch {
      return [];
    }
  }

  async size(path: string): Promise<number | undefined> {
    try {
      const st = await stat(path);
      return st.isFile() ? st.size : undefined;
    } catch {
      return undefined;
    }
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(path));
    } catch {
      return undefined;
    }
  }

  async openBytes(path: string): Promise<ByteSource | undefined> {
    try {
      // `openAsBlob` gives a Blob backed by the file, so slicing a 945 MB
      // archive reads only the slice — the same shape the browser has.
      return (await openAsBlob(path)) as unknown as ByteSource;
    } catch {
      return undefined;
    }
  }
}

export class NodeTargetFs implements TargetFs {
  constructor(private readonly root: string) {}

  private abs(path: string): string {
    return join(this.root, path);
  }

  async sizeOf(path: string): Promise<number | undefined> {
    try {
      const st = await stat(this.abs(path));
      return st.isFile() ? st.size : undefined;
    } catch {
      return undefined;
    }
  }

  async writeStream(path: string, data: ReadableStream<Uint8Array>): Promise<void> {
    const out = this.abs(path);
    await mkdir(dirname(out), { recursive: true });
    await pipeline(Readable.fromWeb(data as never), createWriteStream(out));
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const out = this.abs(path);
    await mkdir(dirname(out), { recursive: true });
    await pipeline(Readable.from([data]), createWriteStream(out));
  }
}

/** A `ReadableStream` of a file on disk, for copying without buffering it. */
export function fileStream(path: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
}

/** Silences an unused-import warning while keeping the type available. */
export type { Writable };
