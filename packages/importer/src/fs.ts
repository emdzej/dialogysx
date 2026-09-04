/**
 * The filesystem the importer works against, narrowed to what it needs.
 *
 * The point is that `discover` and `plan` stop knowing where they run. The CLI
 * reads a mounted disc with `node:fs` and writes with `copyFile`; the browser
 * reads a directory handle and writes with `createWritable()`. Behind these two
 * interfaces the classification and planning are the same code, which is the
 * only way the two implementations stay honest about each other — a second
 * implementation of "which component does this file belong to" would diverge
 * on the first disc nobody tested.
 *
 * Deliberately not a general filesystem. No rename, no delete, no seek: an
 * import reads a tree once and writes files once, and a wider interface would
 * invite a browser adapter to pretend it has capabilities it does not.
 */
import type { ByteSource } from "@dialogysx/raf";

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  /** Absent for directories, and for backends that would have to stat twice. */
  size?: number;
}

/** Reading a disc, or anything shaped like one. */
export interface SourceFs {
  /** Immediate children. Returns `[]` for a path that is not a directory. */
  list(path: string): Promise<DirEntry[]>;
  /** Size in bytes, or `undefined` if absent or not a file. */
  size(path: string): Promise<number | undefined>;
  /** Whole-file read, for the small text files a disc is identified by. */
  read(path: string): Promise<Uint8Array | undefined>;
  /**
   * A sliceable handle, for reading an archive's central directory.
   *
   * Separate from `read` because an archive can be 945 MB and the importer
   * only ever needs pieces of it.
   */
  openBytes(path: string): Promise<ByteSource | undefined>;
}

/** Writing the imported tree. */
export interface TargetFs {
  /**
   * Is a file already there at this size?
   *
   * Size rather than content, matching what `--resume` does: re-reading 15 GB
   * to hash it would cost more than the copy it saves.
   */
  sizeOf(path: string): Promise<number | undefined>;
  /** Write from a stream. Creates parent directories. */
  writeStream(path: string, data: ReadableStream<Uint8Array>): Promise<void>;
  /** Write bytes. Creates parent directories. */
  writeBytes(path: string, data: Uint8Array): Promise<void>;
}

/** Join path segments with "/", dropping empties. Both backends use "/". */
export function joinPath(...parts: (string | undefined)[]): string {
  return parts
    .filter((p): p is string => p !== undefined && p.length > 0)
    .join("/")
    .replace(/\/+/g, "/");
}

/** The directory part of a path, or "" at the root. */
export function dirName(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/**
 * Walk a tree depth-first, yielding files with their sizes.
 *
 * Skips nothing: what to ignore is `components.ts`'s decision, and a walker
 * with opinions about names would hide files that the plan reports as
 * unclaimed — which is how `TM.zip`, `tarif.zip` and `REACH.zip` were found in
 * the first place.
 */
export async function* walkFiles(
  fs: SourceFs,
  root: string,
  prefix = "",
): AsyncGenerator<{ path: string; relative: string; size: number }> {
  for (const entry of await fs.list(joinPath(root, prefix))) {
    const relative = joinPath(prefix, entry.name);
    const path = joinPath(root, relative);
    if (entry.isDirectory) {
      yield* walkFiles(fs, root, relative);
      continue;
    }
    const size = entry.size ?? (await fs.size(path)) ?? 0;
    yield { path, relative, size };
  }
}
