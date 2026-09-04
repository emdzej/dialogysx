/**
 * Work out what a disc is by looking at it.
 *
 * The set is not self-describing. The only version stamp is `update/VersionData`,
 * and it does not identify a disc: the four repair discs carry a byte-identical
 * `versmpf=4.56.20160921` while the catalogue disc says `versmpf=4.5.6`. So a
 * disc is classified by the marker paths it carries, and a language set is
 * reassembled from whichever discs happen to hold its pieces.
 */
import { joinPath, type SourceFs } from "./fs.js";

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

/**
 * Read every file in a disc's `update/` directory as a trimmed string.
 *
 * Decoded as latin1 deliberately: these stamps are ASCII, and a stray byte
 * decoded as UTF-8 would become U+FFFD and change a version string that gets
 * compared.
 */
async function readVersions(fs: SourceFs, updateDir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await fs.list(updateDir)) {
    if (entry.isDirectory) continue;
    const bytes = await fs.read(joinPath(updateDir, entry.name));
    if (bytes === undefined) continue;
    let text = "";
    for (const b of bytes) text += String.fromCharCode(b);
    out[entry.name] = text.trim();
  }
  return out;
}

/**
 * Does this path exist as a directory with something in it?
 *
 * `list` returns `[]` for both an empty directory and a missing one, and
 * asking a browser handle to tell them apart costs another round trip. Every
 * marker path this module tests holds files on a real disc, so an empty result
 * counts as absent. If that ever stops being true, the symptom is "the disc was
 * not recognised" rather than a crash.
 */
async function isDir(fs: SourceFs, path: string): Promise<boolean> {
  return (await fs.list(path)).length > 0;
}

async function dirs(fs: SourceFs, path: string): Promise<string[]> {
  return (await fs.list(path)).filter((e) => e.isDirectory).map((e) => e.name);
}

/** Non-empty subdirectories of a `d3k` directory — what this disc actually adds. */
async function d3kParts(fs: SourceFs, d3k: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await dirs(fs, d3k)) {
    const entries = await fs.list(joinPath(d3k, name));
    if (entries.length > 0) out.push(name);
  }
  return out.sort();
}

/**
 * Classify one mounted disc. Returns `undefined` when nothing recognisable is
 * there, which is not an error — the caller reports it and moves on.
 */
export async function identify(fs: SourceFs, root: string): Promise<DiscSource | undefined> {
  // Catalogue disc: `dialogys/data/pr` holds Planches/Organes.
  if (await isDir(fs, joinPath(root, "dialogys", "data", "pr"))) {
    return {
      root,
      kind: "catalogue",
      dataDir: joinPath("dialogys", "data"),
      languages: (await dirs(fs, joinPath(root, "dialogys", "data", "langue")))
        .sort()
        .map((code) => ({
          code,
          parts: ["langue"],
        })),
      label: "parts catalogue",
      versions: await readVersions(fs, joinPath(root, "dialogys", "data", "update")),
    };
  }

  // Application disc: the jars live under `Dialogys/data/java`. Note the
  // capital D — DVD-0 differs from DVD-1 in case, which matters on a
  // case-sensitive filesystem even though macOS hides it.
  if (await isDir(fs, joinPath(root, "Dialogys", "data", "java"))) {
    return {
      root,
      kind: "app",
      dataDir: joinPath("Dialogys", "data"),
      languages: [],
      label: "application and help documents",
      versions: await readVersions(fs, joinPath(root, "Dialogys", "data", "update")),
    };
  }

  // Repair-documentation disc: `data/mrnt/<lang>/d3k`.
  const mrnt = joinPath(root, "data", "mrnt");
  if (await isDir(fs, mrnt)) {
    const languages: { code: string; parts: string[] }[] = [];
    for (const code of (await dirs(fs, mrnt)).sort()) {
      const parts = await d3kParts(fs, joinPath(mrnt, code, "d3k"));
      if (parts.length > 0) languages.push({ code, parts });
    }
    if (languages.length > 0) {
      return {
        root,
        kind: "mrnt",
        dataDir: joinPath("data"),
        languages,
        label:
          "repair documentation: " +
          languages.map((l) => `${l.code} (${l.parts.join(", ")})`).join("; "),
        versions: await readVersions(fs, joinPath(root, "data", "update")),
      };
    }
  }

  return undefined;
}
