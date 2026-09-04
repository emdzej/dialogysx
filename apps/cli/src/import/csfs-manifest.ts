/**
 * `csfs-manifest.json` — the tree, described for any csfs reader.
 *
 * Two manifests sit in a built tree and they are not redundant:
 *
 * - `manifest.json` is dialogysx's own. Disc provenance, version stamps that
 *   genuinely disagree between discs, which languages are present, how many
 *   keys each dataset holds. None of that is a file system's business.
 * - `csfs-manifest.json` is a **directory listing**, which HTTP cannot
 *   otherwise provide: every path and its size, so a reader can list and can
 *   range-request without probing.
 *
 * The one thing they share is `archives`, and it is deliberately the *same
 * value* written twice rather than one derived from the other. `ArchiveMount`
 * is rooted for exactly this reason: dialogysx invented the shape, csfs
 * adopted it unchanged, so there is nothing to convert and so nothing that can
 * drift out of step.
 *
 * The format itself is not reimplemented here — this calls csfs's own builder,
 * so if the format changes, a tree built by this command follows automatically
 * instead of quietly emitting last year's shape.
 */
import type { ArchiveMount } from "@dialogysx/catalogue";
import {
  MANIFEST_FILE,
  buildManifest as buildCsfsManifest,
  formatManifest,
} from "@emdzej/csfs-manifest";
import { nodeFileSystem } from "@emdzej/csfs-node";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export { MANIFEST_FILE as CSFS_MANIFEST_FILE };

export interface CsfsManifestResult {
  /** Files described. Excludes the two manifests themselves. */
  files: number;
  /** Bytes those files account for. */
  bytes: number;
  /** Size of the written JSON, which the reader pays on open. */
  jsonBytes: number;
}

/**
 * Walk a finished tree and describe it.
 *
 * A walk is unavoidable — nothing else knows every file's size — but it is one
 * walk at the end of an import rather than a separate translation step, and
 * the tree is servable the moment it returns.
 */
export async function writeCsfsManifest(
  outRoot: string,
  input: {
    /** The same array that goes into `manifest.json`. Rooted already. */
    archives?: readonly ArchiveMount[];
    /** So a tree can say what it is. */
    label?: string;
    /** ISO-8601, supplied rather than invented. */
    builtAt: string;
    onProgress?: (found: number) => void;
  },
): Promise<CsfsManifestResult> {
  const manifest = await buildCsfsManifest(nodeFileSystem(outRoot), {
    label: input.label,
    builtAt: input.builtAt,
    archives: input.archives ? [...input.archives] : undefined,
    /*
     * Only csfs's own manifest is excluded, and only because it cannot list
     * itself: its size would depend on its contents, which does not settle.
     * It is fetched by name anyway, never through the file system.
     *
     * `manifest.json` **is** listed, and leaving it out was a real bug. It
     * looks like peer metadata rather than data, but when csfs is the file
     * system every read goes through this map — so an unlisted file is simply
     * absent. dialogysx reads `manifest.json` to find its archive mounts and
     * its languages, and both silently became empty: no request is even made,
     * because a manifest miss answers null without asking the host. The
     * catalogue then fell back to part codes instead of model names, which
     * looks like a data problem and is not.
     */
    filter: (path) => path !== `/${MANIFEST_FILE}`,
    onProgress: input.onProgress ? (found) => input.onProgress!(found) : undefined,
  });

  const json = formatManifest(manifest);
  await writeFile(join(outRoot, MANIFEST_FILE), json);

  const sizes = Object.values(manifest.files);
  return {
    files: sizes.length,
    bytes: sizes.reduce((a, b) => a + b, 0),
    jsonBytes: json.length,
  };
}
