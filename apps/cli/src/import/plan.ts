/**
 * Turn a set of discs into a file-level plan, and refuse to guess.
 *
 * The merge is not a union of trees — two discs really do write the same path
 * with different content. For the Russian set, DVD-4 and DVD-5 both carry
 * `mrnt/ru/d3k/images/images_1.zip`, 945 MB and 696 MB respectively. A plain
 * copy silently keeps whichever ran last and loses ~12,000 illustrations.
 *
 * They do not collide *inside*: those two archives share 0 entry names out of
 * 36,374. So image archives are planned as **extractions**, which merges their
 * contents instead of their filenames, and any genuine content collision is
 * reported rather than overwritten.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { COMPONENTS, componentFor, isJunk, type ComponentSpec } from "./components.js";
import type { DiscSource } from "./discover.js";

export interface CopyAction {
  type: "copy";
  component: string;
  from: string;
  /** Destination path relative to the output root, POSIX-separated. */
  to: string;
  bytes: number;
  source: DiscSource;
}

export interface ExtractAction {
  type: "extract";
  component: string;
  from: string;
  /** Destination *directory* relative to the output root. */
  intoDir: string;
  bytes: number;
  source: DiscSource;
  /**
   * Which entries to keep, by their name inside the archive.
   *
   * `tarif.zip` is 207 MB of 42 country/language datasets; without this,
   * asking for English part names unpacks all 42. Filtering at the entry level
   * is the difference between ~10 MB and ~200 MB.
   */
  keepEntry?: (entryName: string) => boolean;
}

export type Action = CopyAction | ExtractAction;

export interface Collision {
  to: string;
  actions: Action[];
}

export interface Plan {
  actions: Action[];
  collisions: Collision[];
  /** Paths that repeated across discs with byte-identical content, so one copy was kept. */
  duplicatesDropped: number;
  /** Per-component totals, measured from the discs rather than assumed. */
  byComponent: { component: ComponentSpec; files: number; bytes: number; included: boolean }[];
  /** Files that matched no component, so were not imported. */
  unclaimed: { dest: string; bytes: number }[];
  totalBytes: number;
  /** Language codes that will exist under `mrnt/` when this plan is applied. */
  mrntLanguages: string[];
  catalogueLanguages: string[];
}

export interface PlanOptions {
  /** Component ids to include. Default: every `defaultOn` component. */
  components?: string[];
  /**
   * Restrict to these language codes, for **both** `langue/` (the catalogue's
   * own translations) and `mrnt/` (the repair documentation). Default: all
   * present. This is the single biggest lever on total size: one repair
   * language is several GB.
   */
  languages?: string[];
  /**
   * Extract image archives so their contents merge. On by default — leaving it
   * off reproduces the collision described above, so the CLI warns when it is
   * disabled.
   */
  extractImages?: boolean;
  /** Also extract the parts drawings (`dessins/100.zip`, 39,584 PNGs). */
  extractDrawings?: boolean;
}

/** Where a disc's file lands in the merged tree. */
function destination(source: DiscSource, relativePath: string): string {
  const p = relativePath.split(sep).join(posix.sep);
  switch (source.kind) {
    // The catalogue disc *is* the root: `pr/`, `enveloppe/`, `dessins/` ...
    // so readers see the same layout they see on a mounted disc.
    case "catalogue":
      return p;
    // Repair discs contribute `mrnt/<lang>/d3k/...`; strip their `data/` prefix.
    case "mrnt":
      return p.replace(/^data\//, "");
    // Application resources are kept aside; they are not catalogue data.
    case "app":
      return posix.join("app", p);
  }
}

async function* walk(dir: string): AsyncIterableIterator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

/** Image archives that must be extracted rather than copied. */
function isImageArchive(dest: string): boolean {
  return /^mrnt\/[^/]+\/d3k\/images\/[^/]+\.zip$/.test(dest);
}

function isDrawingArchive(dest: string): boolean {
  return dest === "dessins/100.zip" || dest === "eclate/100.zip";
}

/**
 * `pr/<group>.zip` holds a group's `ListeVarVal` — the value table every
 * applicability condition indexes into. Extracting it makes that a plain URL,
 * so the browser needs no zip reader on the critical path.
 */
function isGroupArchive(dest: string): boolean {
  return /^pr\/[0-9A-Za-z]+\.zip$/.test(dest);
}

/**
 * `tarif.zip` holds 42 country/language datasets — the part **descriptions** as
 * well as the prices. Extracting it lets the two be separate components, and
 * makes `libellePieces-<lg>.txt` a plain URL.
 */
function isTarifArchive(dest: string): boolean {
  return dest === "tarif.zip";
}

/**
 * `langue/<lg>/<lg>.zip` carries the `menu` tree, which is the only source of
 * assembly and domain names. Extracted for the same reason as the group zips.
 */
function isLanguageArchive(dest: string): boolean {
  return /^langue\/([^/]+)\/\1\.zip$/.test(dest);
}

/**
 * `TM.zip` holds 99,056 small XML documents. Extracting makes each one an
 * individually addressable URL, which is the whole point of the static-tree
 * design — a client cannot range-read its way into a zip's deflate stream.
 */
function isLabourTimeArchive(dest: string): boolean {
  return dest === "TM.zip";
}

/**
 * Version stamps under `update/` are disc metadata, not data.
 *
 * Every disc has one and they disagree — catalogue `versmpf=4.5.6` against the
 * repair discs' `versmpf=4.56.20160921` — so merging them into one tree path
 * would mean silently picking a winner. `discover` reads them instead and the
 * manifest records all of them, so nothing is lost by not copying them.
 */
function isVersionStamp(dest: string): boolean {
  return dest.startsWith("update/");
}

/**
 * Which `tarif.zip` entries to unpack.
 *
 * Paths inside are `tarif/d3k/<COUNTRY>/<lang>/<file>`. Language is the filter
 * that matters — a country is only a pricing region, and several share one
 * language — so this keeps every country whose language was asked for, and
 * splits `libelles*` (part names) from `tarif`/`CBareme` (prices) by component.
 */
function tarifEntryFilter(
  selected: Set<string>,
  languages: string[] | undefined,
): (entryName: string) => boolean {
  const wantNames = selected.has("part-names");
  const wantPrices = selected.has("pricing");
  return (entryName) => {
    const m = /^tarif\/d3k\/[^/]+\/([^/]+)\/(.+)$/.exec(entryName);
    if (!m) return false;
    const [, lang, file] = m;
    if (languages && lang !== undefined && !languages.includes(lang)) return false;
    const isName = /^(libellePieces-.+\.txt|libelles(\.idx)?)$/.test(file ?? "");
    return isName ? wantNames : wantPrices;
  };
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function buildPlan(sources: DiscSource[], opts: PlanOptions = {}): Promise<Plan> {
  const { components, languages, extractImages = true, extractDrawings = false } = opts;
  const selected = new Set(components ?? []);
  const tally = new Map<string, { files: number; bytes: number }>();
  const unclaimed: { dest: string; bytes: number }[] = [];
  const actions: Action[] = [];
  const byDest = new Map<string, Action[]>();
  const mrntLanguages = new Set<string>();
  const catalogueLanguages = new Set<string>();

  for (const source of sources) {
    if (source.kind === "mrnt") {
      for (const l of source.languages) {
        if (!languages || languages.includes(l.code)) mrntLanguages.add(l.code);
      }
    }
    if (source.kind === "catalogue") {
      // Respect the language filter here too, or the plan reports all 21
      // languages while importing one.
      for (const l of source.languages) {
        if (!languages || languages.includes(l.code)) catalogueLanguages.add(l.code);
      }
    }

    const base = join(source.root, source.dataDir);
    for await (const from of walk(base)) {
      const dest = destination(source, relative(base, from));

      if (isVersionStamp(dest) || isJunk(dest)) continue;

      // One language filter for both trees: `mrnt/<lg>/...` and `langue/<lg>/...`.
      if (languages) {
        const m = /^(?:mrnt|langue)\/([^/]+)\//.exec(dest);
        if (m && !languages.includes(m[1]!)) continue;
      }

      const bytes = (await stat(from)).size;

      // Tally every file against its component, whether selected or not, so the
      // plan can show what was left out and how big it would have been.
      const component = componentFor(dest);
      if (!component) {
        unclaimed.push({ dest, bytes });
        continue;
      }
      const t = tally.get(component.id) ?? { files: 0, bytes: 0 };
      t.files++;
      t.bytes += bytes;
      tally.set(component.id, t);
      if (!selected.has(component.id)) continue;

      let action: Action;
      if (extractImages && isImageArchive(dest)) {
        action = {
          type: "extract",
          from,
          intoDir: dest.replace(/\/[^/]+\.zip$/, ""),
          bytes,
          source,
          component: component.id,
        };
      } else if (isGroupArchive(dest)) {
        action = {
          type: "extract",
          from,
          intoDir: dest.replace(/\.zip$/, ""),
          bytes,
          source,
          component: component.id,
        };
      } else if (isTarifArchive(dest) || isLanguageArchive(dest)) {
        action = {
          type: "extract",
          from,
          // Both archives carry their own directory prefix internally, so they
          // extract next to themselves rather than into a new subdirectory.
          intoDir: isTarifArchive(dest) ? "" : dest.replace(/\/[^/]+\.zip$/, ""),
          bytes,
          source,
          component: component.id,
          keepEntry: isTarifArchive(dest) ? tarifEntryFilter(selected, languages) : undefined,
        };
      } else if (isLabourTimeArchive(dest)) {
        action = {
          type: "extract",
          from,
          // Into the *root*, not into "TM": this archive's own entries are
          // already prefixed `TM/<lang>/...`, so naming a subdirectory here
          // produced `TM/TM/ru/UI/...`. The image archives are the opposite —
          // their entries are flat, so they do need a target directory.
          intoDir: "",
          bytes,
          source,
          component: component.id,
        };
      } else if (extractDrawings && isDrawingArchive(dest)) {
        action = {
          type: "extract",
          from,
          intoDir: dest.replace(/\.zip$/, ""),
          bytes,
          source,
          component: component.id,
        };
      } else {
        action = { type: "copy", from, to: dest, bytes, source, component: component.id };
      }
      actions.push(action);

      // Only copies can collide on a path; extractions collide on entry names,
      // which is checked while extracting because it needs the archives open.
      if (action.type === "copy") {
        const list = byDest.get(dest);
        if (list) list.push(action);
        else byDest.set(dest, [action]);
      }
    }
  }

  // Two discs writing the same path is only a conflict if the *bytes* differ.
  // Duplicated identical files are common across a disc set, and hashing is
  // cheap here because it only runs on the handful of paths that repeat.
  const collisions: Collision[] = [];
  let duplicates = 0;
  const keep = new Set<Action>(actions);

  for (const [to, list] of byDest) {
    if (list.length < 2) continue;
    const hashes = await Promise.all(list.map((a) => sha256(a.from)));
    const identical = hashes.every((h) => h === hashes[0]);
    if (identical) {
      // Keep the first, drop the rest. Nothing is lost.
      for (const a of list.slice(1)) keep.delete(a);
      duplicates += list.length - 1;
    } else {
      collisions.push({ to, actions: list });
    }
  }

  const kept = actions.filter((a) => keep.has(a));
  return {
    actions: kept,
    collisions,
    duplicatesDropped: duplicates,
    byComponent: COMPONENTS.map((component) => ({
      component,
      files: tally.get(component.id)?.files ?? 0,
      bytes: tally.get(component.id)?.bytes ?? 0,
      included: selected.has(component.id),
    })),
    unclaimed,
    totalBytes: kept.reduce((n, a) => n + a.bytes, 0),
    mrntLanguages: [...mrntLanguages].sort(),
    catalogueLanguages: [...catalogueLanguages].sort(),
  };
}
