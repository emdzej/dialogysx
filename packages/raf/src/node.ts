/**
 * Node filesystem backend. Kept in its own module so the browser bundle never
 * pulls `node:fs` in through the package entry point.
 */
import { open, stat, type FileHandle } from "node:fs/promises";
import { BaseReader } from "./reader.js";

export class NodeFileReader extends BaseReader {
  private handle?: FileHandle;
  private cachedSize?: number;

  constructor(private readonly path: string) {
    super();
  }

  private async fh(): Promise<FileHandle> {
    this.handle ??= await open(this.path, "r");
    return this.handle;
  }

  async size(): Promise<number> {
    this.cachedSize ??= (await stat(this.path)).size;
    return this.cachedSize;
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    if (len === 0) return new Uint8Array(0);
    const buf = new Uint8Array(len);
    const { bytesRead } = await (await this.fh()).read(buf, 0, len, pos);
    return bytesRead === len ? buf : buf.subarray(0, bytesRead);
  }

  async close(): Promise<void> {
    await this.handle?.close();
    this.handle = undefined;
  }
}
