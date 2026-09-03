/**
 * `FileSource` over a static HTTP tree — the deployed path.
 *
 * This is where the architecture in `docs/plan.md` §1 is either true or not:
 * the catalogue's own `(position, longueur)` addressing is served by `Range`
 * requests, so the 86 MB of data files are never downloaded, only sampled.
 *
 * Index files are the exception. Binary search over HTTP would cost ~log2(n)
 * round trips per lookup, so `SortedCobolFile` preloads them — 17 MB total
 * across every dataset, gzipped on the wire.
 */
import type { FileSource } from "@dialogysx/catalogue";
import { BytesReader, HttpRangeReader, type Reader } from "@dialogysx/raf";

export interface HttpSourceOptions {
  /** Base URL of the tree, i.e. the URL that stands in for `dialogys/data`. */
  baseUrl: string;
  /**
   * Language codes present under `langue/`. HTTP cannot list a directory, so
   * this has to be told to us — the CLI writes it into a manifest when it
   * builds a tree.
   */
  languages?: string[];
}

export class HttpTreeSource implements FileSource {
  private readonly base: string;
  private readonly langs: string[];

  constructor(opts: HttpSourceOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.langs = opts.languages ?? [];
  }

  private url(relativePath: string): string {
    return `${this.base}/${relativePath}`;
  }

  async open(relativePath: string): Promise<Reader | undefined> {
    const reader = new HttpRangeReader(this.url(relativePath));
    try {
      // A HEAD that 404s is how absence is detected; anything else propagates.
      await reader.size();
      return reader;
    } catch {
      return undefined;
    }
  }

  async readAll(relativePath: string): Promise<Uint8Array | undefined> {
    const res = await fetch(this.url(relativePath));
    if (!res.ok) return undefined;
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * HTTP has no directory listing, so this returns the configured languages
   * rather than probing. Returning `[]` for anything else is honest: we do not
   * know, rather than "nothing is there".
   */
  async listDirs(relativePath: string): Promise<string[]> {
    return relativePath === "langue" ? [...this.langs] : [];
  }
}

/** A source over already-downloaded bytes, for tests and small fixtures. */
export class MemorySource implements FileSource {
  constructor(private readonly files: Map<string, Uint8Array>) {}

  async open(relativePath: string): Promise<Reader | undefined> {
    const b = this.files.get(relativePath);
    return b === undefined ? undefined : new BytesReader(b);
  }

  async readAll(relativePath: string): Promise<Uint8Array | undefined> {
    return this.files.get(relativePath);
  }

  async listDirs(relativePath: string): Promise<string[]> {
    const prefix = relativePath === "" ? "" : `${relativePath}/`;
    const dirs = new Set<string>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash > 0) dirs.add(rest.slice(0, slash));
    }
    return [...dirs];
  }
}
