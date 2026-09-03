/**
 * Apply a plan: copy files, extract archives, report progress.
 *
 * Zip reading goes through `yauzl`, which reads the **central directory**. That
 * matters here: the Dialogys archives put CRC-32 = 0 in every *local* file
 * header while the central directory holds the correct value, so `unzip` fails
 * these files and yauzl validates them cleanly. See `docs/data-format.md` §3.8.
 */
import { createWriteStream } from "node:fs";
import { mkdir, copyFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import type { Action, Plan } from "./plan.js";

export interface Progress {
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  current: string;
}

export interface ExecuteResult {
  copied: number;
  extractedArchives: number;
  extractedEntries: number;
  bytesWritten: number;
  skipped: number;
  /** Entry names an extraction would have overwritten with different content. */
  entryCollisions: { path: string; from: string }[];
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) reject(err ?? new Error(`${path}: could not open`));
      else resolve(zip);
    });
  });
}

/**
 * Extract every entry into `intoDir`.
 *
 * Records rather than overwrites a name that already exists from another
 * archive: for the Russian image set that case is expected to be empty (DVD-4
 * and DVD-5 share 0 of 36,374 entry names), so a non-empty list means the
 * assumption behind extracting has broken and should be looked at.
 */
async function extractArchive(
  archive: string,
  intoDir: string,
  seen: Map<string, string>,
  onEntry: (name: string, bytes: number) => void,
  keepEntry?: (entryName: string) => boolean,
): Promise<{ entries: number; bytes: number; collisions: { path: string; from: string }[] }> {
  const zip = await openZip(archive);
  const collisions: { path: string; from: string }[] = [];
  let entries = 0;
  let bytes = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry: yauzl.Entry) => {
        // Directory entries end in "/" and carry no data.
        if (entry.fileName.endsWith("/")) return void zip.readEntry();
        if (keepEntry && !keepEntry(entry.fileName)) return void zip.readEntry();
        // Reject traversal outright rather than sanitising it silently.
        if (entry.fileName.includes("..")) {
          reject(new Error(`${archive}: entry ${JSON.stringify(entry.fileName)} escapes the tree`));
          return;
        }
        const key = `${intoDir}/${entry.fileName}`;
        const previous = seen.get(key);
        if (previous !== undefined) {
          collisions.push({ path: key, from: previous });
          return void zip.readEntry();
        }
        seen.set(key, archive);

        zip.openReadStream(entry, (err, readStream) => {
          if (err || !readStream) {
            reject(err ?? new Error(`${archive}: ${entry.fileName}: no stream`));
            return;
          }
          const out = join(intoDir, entry.fileName);
          mkdir(dirname(out), { recursive: true })
            .then(() => pipeline(readStream, createWriteStream(out)))
            .then(() => {
              entries++;
              bytes += entry.uncompressedSize;
              onEntry(entry.fileName, entry.uncompressedSize);
              zip.readEntry();
            })
            .catch(reject);
        });
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  return { entries, bytes, collisions };
}

async function upToDate(from: string, to: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([stat(from), stat(to)]);
    return a.size === b.size;
  } catch {
    return false;
  }
}

export async function execute(
  plan: Plan,
  outRoot: string,
  opts: { resume?: boolean; onProgress?: (p: Progress) => void } = {},
): Promise<ExecuteResult> {
  const { resume = true, onProgress } = opts;
  const result: ExecuteResult = {
    copied: 0,
    extractedArchives: 0,
    extractedEntries: 0,
    bytesWritten: 0,
    skipped: 0,
    entryCollisions: [],
  };
  // Entry name -> the archive that wrote it, shared across archives so a
  // second archive writing the same name is detected rather than silently
  // winning.
  const seenEntries = new Map<string, string>();
  let done = 0;
  let bytesDone = 0;

  const report = (current: string) =>
    onProgress?.({
      done,
      total: plan.actions.length,
      bytesDone,
      bytesTotal: plan.totalBytes,
      current,
    });

  for (const action of plan.actions as Action[]) {
    if (action.type === "copy") {
      const out = join(outRoot, action.to);
      if (resume && (await upToDate(action.from, out))) {
        result.skipped++;
      } else {
        await mkdir(dirname(out), { recursive: true });
        await copyFile(action.from, out);
        result.copied++;
        result.bytesWritten += action.bytes;
      }
      done++;
      bytesDone += action.bytes;
      report(action.to);
    } else {
      const intoDir = join(outRoot, action.intoDir);
      await mkdir(intoDir, { recursive: true });
      const r = await extractArchive(
        action.from,
        intoDir,
        seenEntries,
        () => {},
        action.keepEntry,
      );
      result.extractedArchives++;
      result.extractedEntries += r.entries;
      result.bytesWritten += r.bytes;
      result.entryCollisions.push(...r.collisions);
      done++;
      bytesDone += action.bytes;
      report(`${action.intoDir} (${r.entries} entries)`);
    }
  }

  return result;
}
