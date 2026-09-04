/**
 * `manifest.json` — what the tree contains.
 *
 * This exists because **HTTP cannot list a directory.** `HttpTreeSource` has to
 * be told which languages are present rather than probing for them, and the app
 * should not have to guess which datasets a tree carries. The importer knows
 * both, so it writes them down.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DATASETS, Disc, LANGUAGE_DATASETS, type ArchiveMount } from "@dialogysx/catalogue";
import { NodeDirectorySource } from "../node-source.js";

export interface Manifest {
  /** Bump when the shape below changes incompatibly. */
  manifestVersion: 1;
  /** ISO-8601, supplied by the caller so the value is not invented here. */
  builtAt: string;
  /**
   * Which discs the tree was assembled from, with their version stamps.
   *
   * The stamps live here rather than in the tree because they disagree between
   * discs (catalogue `versmpf=4.5.6`, repair `versmpf=4.56.20160921`) and
   * merging them into one path would mean picking a winner.
   */
  sources: { kind: string; label: string; root: string; versions: Record<string, string> }[];
  /** Language codes under `langue/` — the catalogue's own translations. */
  catalogueLanguages: string[];
  /** Language codes under `mrnt/` — the repair documentation. */
  repairLanguages: string[];
  /** Datasets actually present, with their key counts. */
  datasets: { id: string; keyLength: number; depth: number; keys: number; language?: string }[];
  counts: { files: number; extractedEntries: number; bytes: number };
  /**
   * Archives the tree keeps packed, and the directory each stands in for.
   *
   * A reader that ignores this sees a tree with no drawings and no
   * illustrations, so it is not optional decoration — `ArchiveSource` is what
   * makes those paths resolve.
   */
  archives?: ArchiveMount[];
}

/**
 * Probe the finished tree and describe it.
 *
 * Deliberately reads the result rather than trusting the plan: the manifest
 * should describe what is on disk, so that a resumed or partial import is
 * described accurately instead of optimistically.
 */
export async function buildManifest(
  outRoot: string,
  input: {
    builtAt: string;
    sources: { kind: string; label: string; root: string; versions: Record<string, string> }[];
    repairLanguages: string[];
    counts: { files: number; extractedEntries: number; bytes: number };
    /** Archives left packed, and which directory each stands in for. */
    archives?: ArchiveMount[];
  },
): Promise<Manifest> {
  const disc = new Disc(new NodeDirectorySource(outRoot));
  const catalogueLanguages = await disc.languages();
  const datasets: Manifest["datasets"] = [];

  for (const spec of DATASETS) {
    const opened = await disc.open(spec).catch(() => undefined);
    if (!opened) continue;
    datasets.push({
      id: spec.id,
      keyLength: spec.keyLength,
      depth: spec.depth,
      keys: opened.raf.index1.count,
    });
    await opened.raf.close();
  }
  for (const spec of LANGUAGE_DATASETS) {
    for (const language of catalogueLanguages) {
      const opened = await disc.open(spec, language).catch(() => undefined);
      if (!opened) continue;
      datasets.push({
        id: spec.id,
        keyLength: spec.keyLength,
        depth: spec.depth,
        keys: opened.raf.index1.count,
        language,
      });
      await opened.raf.close();
    }
  }

  return {
    manifestVersion: 1,
    builtAt: input.builtAt,
    sources: input.sources,
    catalogueLanguages,
    repairLanguages: input.repairLanguages,
    datasets,
    counts: input.counts,
    ...(input.archives && input.archives.length > 0 ? { archives: input.archives } : {}),
  };
}

export async function writeManifest(outRoot: string, manifest: Manifest): Promise<void> {
  await writeFile(join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}
