/**
 * Importing one disc at a time.
 *
 * The CLI plans every disc at once, which it can because it mounts them all.
 * A browser cannot mount anything: the user mounts one ISO, points at it, and
 * repeats. That changes a real assumption, so this is a separate entry point
 * rather than a flag on the other one.
 *
 * What the all-at-once planner gets for free and this has to keep on disk:
 *
 * - **Cross-disc collisions.** Three discs each ship an `images_1.zip`, and
 *   DVD-4 and DVD-5 both write `images_1.zip` in the Russian set. Extracting
 *   is safe only because their entry names do not overlap. With one disc per
 *   run, disc 5 has no way to know disc 2 already wrote a file unless the sizes
 *   written so far were recorded.
 * - **Identical duplicates.** The same file ships on several discs; the CLI
 *   hashes the repeats and drops them. Here a same-size file already present is
 *   skipped, and a *different*-size one is reported as a conflict rather than
 *   silently overwritten.
 * - **The manifest.** Version stamps genuinely disagree between discs, so they
 *   accumulate.
 *
 * The state lives in the target tree as `.dialogysx-import.json`, so it
 * survives a closed tab, and so a tree half-built by the CLI can be continued
 * here and the other way round.
 *
 * The manifest is written **last**, deliberately: a failed or abandoned import
 * then leaves a tree with no manifest rather than one that looks complete.
 */
import { componentFor, isJunk, type ComponentSpec } from "./components.js";
import type { DiscSource } from "./discover.js";
import { joinPath, walkFiles, type SourceFs, type TargetFs } from "./fs.js";
import {
  destination,
  imageEntryFilter,
  isGroupArchive,
  isImageArchive,
  isLabourTimeArchive,
  isLanguageArchive,
  isTarifArchive,
  isVersionStamp,
  tarifEntryFilter,
} from "./paths.js";
import { openZipEntry, readZipEntries, type ByteSource } from "./zip.js";

/** Accumulated across discs, kept in the target tree. */
export interface ImportState {
  version: 1;
  /** Destination path -> the size written, for skip and conflict detection. */
  written: Record<string, number>;
  /** Disc label -> its `update/*` stamps, verbatim. */
  discs: Record<string, Record<string, string>>;
  /** Catalogue languages seen, for the manifest. */
  catalogueLanguages: string[];
  /** Repair-documentation languages seen. */
  repairLanguages: string[];
}

export const STATE_FILE = ".dialogysx-import.json";

export function emptyState(): ImportState {
  return {
    version: 1,
    written: {},
    discs: {},
    catalogueLanguages: [],
    repairLanguages: [],
  };
}

export interface DiscPlanEntry {
  /** Absolute path on the source, for reading. */
  from: string;
  /** Path in the output tree. */
  to: string;
  bytes: number;
  component: string;
  /** Extract this archive rather than copying it. */
  extract?: { intoDir: string; keepEntry?: (name: string) => boolean };
}

export interface DiscPlan {
  disc: DiscSource;
  entries: DiscPlanEntry[];
  /** Files whose destination is already there at a different size. */
  conflicts: { to: string; had: number; now: number }[];
  /** Already present at the same size, so nothing to do. */
  skipped: number;
  /** Matched no component: reported rather than copied. */
  unclaimed: { to: string; bytes: number }[];
  /** Per component, what this disc contributes. */
  tally: Record<string, { files: number; bytes: number }>;
  totalBytes: number;
}

export interface DiscPlanOptions {
  components: Iterable<string>;
  /** Language codes to keep, or all when absent. */
  languages?: string[];
  extractImages?: boolean;
  extractDrawings?: boolean;
}

/**
 * Plan one disc against what has already been imported.
 *
 * Reads the source tree; writes nothing.
 */
export async function planDisc(
  fs: SourceFs,
  disc: DiscSource,
  state: ImportState,
  opts: DiscPlanOptions,
): Promise<DiscPlan> {
  const selected = new Set(opts.components);
  const { languages, extractImages = true, extractDrawings = false } = opts;
  const entries: DiscPlanEntry[] = [];
  const conflicts: DiscPlan["conflicts"] = [];
  const unclaimed: DiscPlan["unclaimed"] = [];
  const tally: DiscPlan["tally"] = {};
  let skipped = 0;
  let totalBytes = 0;

  const dataRoot = joinPath(disc.root, disc.dataDir);
  for await (const file of walkFiles(fs, dataRoot)) {
    const dest = destination(disc, file.relative);
    if (isJunk(dest)) continue;
    // Version stamps disagree between discs on purpose; they go in the
    // manifest rather than into the tree, where one would have to win.
    if (isVersionStamp(dest)) continue;

    // One language filter for both trees: `mrnt/<lg>/...` and `langue/<lg>/...`.
    // Without this the option would be cosmetic — the plan would report a
    // selection and then import all 22 languages anyway.
    if (languages) {
      const m = /^(?:mrnt|langue)\/([^/]+)\//.exec(dest);
      if (m && !languages.includes(m[1]!)) continue;
    }

    const component: ComponentSpec | undefined = componentFor(dest);
    if (!component) {
      unclaimed.push({ to: dest, bytes: file.size });
      continue;
    }

    const t = tally[component.id] ?? { files: 0, bytes: 0 };
    t.files += 1;
    t.bytes += file.size;
    tally[component.id] = t;
    if (!selected.has(component.id)) continue;

    const extract = archiveTarget(dest, { extractImages, extractDrawings, selected, languages });
    if (!extract) {
      // A plain copy: skip an identical one, flag a different one.
      const had = state.written[dest];
      if (had === file.size) {
        skipped += 1;
        continue;
      }
      if (had !== undefined && had !== file.size) {
        conflicts.push({ to: dest, had, now: file.size });
        continue;
      }
    }

    entries.push({
      from: file.path,
      to: dest,
      bytes: file.size,
      component: component.id,
      ...(extract ? { extract } : {}),
    });
    totalBytes += file.size;
  }

  return { disc, entries, conflicts, skipped, unclaimed, tally, totalBytes };
}

/** Which archives are extracted, and where to. Mirrors the CLI's planner. */
function archiveTarget(
  dest: string,
  opts: {
    extractImages: boolean;
    extractDrawings: boolean;
    selected: Set<string>;
    languages?: string[];
  },
): DiscPlanEntry["extract"] | undefined {
  if (opts.extractImages && isImageArchive(dest)) {
    return { intoDir: dest.replace(/\/[^/]+\.zip$/, ""), keepEntry: imageEntryFilter };
  }
  if (isGroupArchive(dest)) return { intoDir: dest.replace(/\.zip$/, "") };
  if (isTarifArchive(dest)) {
    // Both this and the language archives carry their own directory prefix
    // internally, so they extract next to themselves.
    return { intoDir: "", keepEntry: tarifEntryFilter(opts.selected, opts.languages) };
  }
  if (isLanguageArchive(dest)) return { intoDir: dest.replace(/\/[^/]+\.zip$/, "") };
  // This archive's entries are already prefixed `TM/<lang>/...`, so naming a
  // subdirectory here would produce `TM/TM/`.
  if (isLabourTimeArchive(dest)) return { intoDir: "" };
  return undefined;
}

export interface DiscProgress {
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  /** What is being written right now. */
  current: string;
}

export interface DiscResult {
  copied: number;
  extractedArchives: number;
  extractedEntries: number;
  bytesWritten: number;
  skipped: number;
  /** Entry names an extraction would have overwritten with different content. */
  entryConflicts: { path: string; had: number; now: number }[];
}

/**
 * Carry out a plan, updating the state as it goes.
 *
 * The state is mutated per file rather than at the end so an interrupted
 * import — a closed tab, a browser that killed the worker — resumes from where
 * it stopped rather than starting over. The caller is responsible for writing
 * it out; how often is its decision.
 */
export async function executeDisc(
  source: SourceFs,
  target: TargetFs,
  plan: DiscPlan,
  state: ImportState,
  opts: {
    onProgress?: (p: DiscProgress) => void;
    /** Called after each file, so the caller can persist state periodically. */
    onFileDone?: (dest: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<DiscResult> {
  const result: DiscResult = {
    copied: 0,
    extractedArchives: 0,
    extractedEntries: 0,
    bytesWritten: 0,
    skipped: plan.skipped,
    entryConflicts: [],
  };
  let done = 0;
  let bytesDone = 0;

  const report = (current: string) =>
    opts.onProgress?.({
      done,
      total: plan.entries.length,
      bytesDone,
      bytesTotal: plan.totalBytes,
      current,
    });

  for (const entry of plan.entries) {
    if (opts.signal?.aborted) throw new DOMException("Import cancelled", "AbortError");

    if (entry.extract) {
      const archive = await source.openBytes(entry.from);
      if (!archive) throw new Error(`${entry.from}: could not open the archive`);
      const zipEntries = await readZipEntries(archive);
      for (const ze of zipEntries) {
        if (opts.signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
        if (ze.isDirectory) continue;
        if (entry.extract.keepEntry && !entry.extract.keepEntry(ze.name)) continue;
        // Reject traversal outright rather than sanitising it silently.
        if (ze.name.includes("..")) {
          throw new Error(`${entry.from}: entry ${JSON.stringify(ze.name)} escapes the tree`);
        }
        const dest = joinPath(entry.extract.intoDir, ze.name);
        const had = state.written[dest];
        if (had === ze.uncompressedSize) {
          result.skipped += 1;
          continue;
        }
        if (had !== undefined) {
          // Two archives writing the same name with different content. For the
          // image sets this is expected to be empty — measured, 0 of 36,374
          // names overlap — so a non-empty list means the assumption behind
          // extracting rather than copying has broken.
          result.entryConflicts.push({ path: dest, had, now: ze.uncompressedSize });
          continue;
        }
        await target.writeStream(dest, await openZipEntry(archive, ze));
        state.written[dest] = ze.uncompressedSize;
        result.extractedEntries += 1;
        result.bytesWritten += ze.uncompressedSize;
        opts.onFileDone?.(dest);
      }
      result.extractedArchives += 1;
    } else {
      const bytes = await source.openBytes(entry.from);
      if (!bytes) throw new Error(`${entry.from}: could not be read`);
      await target.writeStream(
        entry.to,
        bytes.slice(0, bytes.size).stream() as ReadableStream<Uint8Array>,
      );
      state.written[entry.to] = entry.bytes;
      result.copied += 1;
      result.bytesWritten += entry.bytes;
      opts.onFileDone?.(entry.to);
    }

    done += 1;
    bytesDone += entry.bytes;
    report(entry.to);
  }

  // Record what this disc contributed, for the manifest.
  state.discs[discLabel(plan.disc)] = plan.disc.versions;
  for (const l of plan.disc.languages) {
    const list = plan.disc.kind === "catalogue" ? state.catalogueLanguages : state.repairLanguages;
    if (!list.includes(l.code)) list.push(l.code);
  }
  return result;
}

/** A stable name for a disc in the state file. */
export function discLabel(disc: DiscSource): string {
  const stamp = Object.values(disc.versions).join(" ");
  return `${disc.kind}${stamp ? ` ${stamp}` : ""}`;
}

/** Re-export so a caller does not need to reach into the zip module. */
export type { ByteSource };
