/**
 * How a disc's paths map into the output tree, and which archives are special.
 *
 * Pure string logic, and shared deliberately: the browser importer and the CLI
 * must agree on every one of these or they will build different trees from the
 * same discs. A second implementation of "is this an image archive" is exactly
 * the kind of thing that diverges on the first disc nobody tested with.
 *
 * Lifted out of the CLI's planner unchanged, which is why the comments read as
 * field notes — each one records a disc that behaved unexpectedly.
 */
import type { DiscSource } from "./discover.js";
import { joinPath } from "./fs.js";

export function destination(source: DiscSource, relativePath: string): string {
  // Normalise separators rather than importing `node:path`. Windows paths only
  // reach here from the CLI, and a browser handle always yields "/" — but a
  // stray backslash would become part of a filename rather than a directory.
  const p = relativePath.replace(/\\/g, "/");
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
      return joinPath("app", p);
  }
}

export function isImageArchive(dest: string): boolean {
  return /^mrnt\/[^/]+\/d3k\/images\/[^/]+\.zip$/.test(dest);
}

export function isDrawingArchive(dest: string): boolean {
  return dest === "dessins/100.zip" || dest === "eclate/100.zip";
}

/**
 * `pr/<group>.zip` holds a group's `ListeVarVal` — the value table every
 * applicability condition indexes into. Extracting it makes that a plain URL,
 * so the browser needs no zip reader on the critical path.
 */
export function isGroupArchive(dest: string): boolean {
  return /^pr\/[0-9A-Za-z]+\.zip$/.test(dest);
}

/**
 * `tarif.zip` holds 42 country/language datasets — the part **descriptions** as
 * well as the prices. Extracting it lets the two be separate components, and
 * makes `libellePieces-<lg>.txt` a plain URL.
 */
export function isTarifArchive(dest: string): boolean {
  return dest === "tarif.zip";
}

/**
 * `langue/<lg>/<lg>.zip` carries the `menu` tree, which is the only source of
 * assembly and domain names. Extracted for the same reason as the group zips.
 */
export function isLanguageArchive(dest: string): boolean {
  return /^langue\/([^/]+)\/\1\.zip$/.test(dest);
}

/**
 * `TM.zip` holds 99,056 small XML documents. Extracting makes each one an
 * individually addressable URL, which is the whole point of the static-tree
 * design — a client cannot range-read its way into a zip's deflate stream.
 */
export function isLabourTimeArchive(dest: string): boolean {
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
export function isVersionStamp(dest: string): boolean {
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
/**
 * Keep only illustrations out of an image archive.
 *
 * `images_1.zip` on the English DVD-5 contains `bkp.tar.gz` — 52 MB — and a
 * `bkp/` directory beside the 5,745 illustrations: somebody left a backup
 * inside a shipped archive. Extracting everything faithfully wrote it into
 * `mrnt/<lg>/d3k/images/`, where nothing will ever read it.
 *
 * An allow-list rather than a deny-list on `bkp`: the archives hold `.png` and
 * `.tif` references from `GRAPHICAL-LAYER`, and anything else in there is not
 * something the renderer can use. Unknown extensions are reported by
 * `--dry-run` as unclaimed rather than silently copied.
 */
export function imageEntryFilter(entryName: string): boolean {
  return /\.(png|tif|tiff|jpg|jpeg|gif)$/i.test(entryName);
}

export function tarifEntryFilter(
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

/**
 * SHA-256 of some bytes, via WebCrypto so both backends can use it.
 *
 * Whole-buffer rather than streaming because `crypto.subtle` has no streaming
 * digest — and because this only ever runs on paths that repeat across discs,
 * which is a handful of files, not the 15 GB.
 */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
