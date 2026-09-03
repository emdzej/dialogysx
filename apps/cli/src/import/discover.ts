/**
 * Work out what a disc is by looking at it.
 *
 * The set is not self-describing. The only version stamp is `update/VersionData`,
 * and it does not identify a disc: the four repair discs carry a byte-identical
 * `versmpf=4.56.20160921` while the catalogue disc says `versmpf=4.5.6`. So a
 * disc is classified by the marker paths it carries, and a language set is
 * reassembled from whichever discs happen to hold its pieces.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export type DiscKind = "app" | "catalogue" | "mrnt";

export interface DiscSource {
  /** Where the disc is mounted, or the directory standing in for one. */
  root: string;
  kind: DiscKind;
  /** Directory under `root` that holds the payload. */
  dataDir: string;
  /** For `mrnt` discs: the language codes present, and what each contributes. */
  languages: { code: string; parts: string[] }[];
  /** Human summary for the plan output. */
  label: string;
  /**
   * Contents of the disc's `update/*` version stamps, verbatim.
   *
   * These are disc metadata and they genuinely disagree between discs — the
   * catalogue says `versmpf=4.5.6`, the repair discs say
   * `versmpf=4.56.20160921`, the application disc says `versmpfappli =V7.5.6`.
   * Merging them into one tree path would mean picking a winner, so they are
   * recorded here and land in the manifest instead of being copied.
   */
  versions: Record<string, string>;
}

/** Read every file in a disc's `update/` directory as a trimmed string. */
async function readVersions(updateDir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of await readdir(updateDir).catch(() => [] as string[])) {
    const text = await readFile(join(updateDir, name), "latin1").catch(() => undefined);
    if (text !== undefined) out[name] = text.trim();
  }
  return out;
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function dirs(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Non-empty subdirectories of a `d3k` directory — what this disc actually adds. */
async function d3kParts(d3k: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await dirs(d3k)) {
    const entries = await readdir(join(d3k, name)).catch(() => []);
    if (entries.length > 0) out.push(name);
  }
  return out.sort();
}

/**
 * Classify one mounted disc. Returns `undefined` when nothing recognisable is
 * there, which is not an error — the caller reports it and moves on.
 */
export async function identify(root: string): Promise<DiscSource | undefined> {
  // Catalogue disc: `dialogys/data/pr` holds Planches/Organes.
  if (await isDir(join(root, "dialogys", "data", "pr"))) {
    return {
      root,
      kind: "catalogue",
      dataDir: join("dialogys", "data"),
      languages: (await dirs(join(root, "dialogys", "data", "langue"))).sort().map((code) => ({
        code,
        parts: ["langue"],
      })),
      label: "parts catalogue",
      versions: await readVersions(join(root, "dialogys", "data", "update")),
    };
  }

  // Application disc: the jars live under `Dialogys/data/java`. Note the
  // capital D — DVD-0 differs from DVD-1 in case, which matters on a
  // case-sensitive filesystem even though macOS hides it.
  if (await isDir(join(root, "Dialogys", "data", "java"))) {
    return {
      root,
      kind: "app",
      dataDir: join("Dialogys", "data"),
      languages: [],
      label: "application and help documents",
      versions: await readVersions(join(root, "Dialogys", "data", "update")),
    };
  }

  // Repair-documentation disc: `data/mrnt/<lang>/d3k`.
  const mrnt = join(root, "data", "mrnt");
  if (await isDir(mrnt)) {
    const languages: { code: string; parts: string[] }[] = [];
    for (const code of (await dirs(mrnt)).sort()) {
      const parts = await d3kParts(join(mrnt, code, "d3k"));
      if (parts.length > 0) languages.push({ code, parts });
    }
    if (languages.length > 0) {
      return {
        root,
        kind: "mrnt",
        dataDir: join("data"),
        languages,
        label:
          "repair documentation: " +
          languages.map((l) => `${l.code} (${l.parts.join(", ")})`).join("; "),
        versions: await readVersions(join(root, "data", "update")),
      };
    }
  }

  return undefined;
}
