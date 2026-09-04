/**
 * Selectable components of a Dialogys data set.
 *
 * The full set is ~17 GB for two languages, most of it repair documentation, so
 * "import everything" is often the wrong default. These are the pieces you can
 * choose between, and what the app can and cannot do without each.
 *
 * Sizes are *not* hard-coded here — the planner measures the actual discs and
 * prints a table, because a hard-coded number goes stale and lies quietly.
 */

export interface ComponentSpec {
  id: string;
  /** One-line description, shown by `--list-components`. */
  what: string;
  /** What breaks without it. */
  withoutIt: string;
  /** Matches a destination path (POSIX, relative to the output root). */
  matches: (dest: string) => boolean;
  /** Included when the user names no components. */
  defaultOn: boolean;
  /**
   * The catalogue cannot be read at all without this, so `--components` may not
   * deselect it.
   */
  required?: true;
}

const inDir =
  (...prefixes: string[]) =>
  (dest: string) =>
    prefixes.some((p) => dest === p || dest.startsWith(p + "/"));

export const COMPONENTS: readonly ComponentSpec[] = [
  {
    id: "parts",
    what: "Parts plates, assemblies, part-number index, vehicle envelope",
    withoutIt: "nothing works — this is the catalogue",
    matches: (d) =>
      inDir("pr", "enveloppe")(d) || d === "typesvin" || d.startsWith("dessins/TRepere"),
    defaultOn: true,
    required: true,
  },
  {
    id: "criteria",
    what: "Per-language criteria vocabulary, model names and menu labels (langue/)",
    withoutIt:
      "criteria show as raw codes (MOT3, AIRC) and cannot be evaluated, and " +
      "assemblies and models have no names",
    matches: inDir("langue"),
    defaultOn: true,
  },
  {
    id: "drawings",
    what: "Parts drawings as one archive, dessins/100.zip — 38,488 PNGs, read in place",
    withoutIt: "no plate illustrations; the parts list still works",
    matches: (d) => d === "dessins/100.zip",
    defaultOn: true,
  },
  {
    id: "drawings-extracted",
    /*
     * The drawings ship twice: this flat archive and a `dessins/100/` tree
     * bucketed by the first four characters of each name. The archive is
     * *smaller* and one file instead of 38,488, and the app reads it in place
     * — so it is now the default and this is the opt-out.
     *
     * Note the two layouts differ. `100.zip` stores `1132C000.png` at its top
     * level while the tree stores `dessins/100/1132/1132C000.png`, so a naive
     * extraction of the archive produces paths nothing can read. That is why
     * `ArchiveSource` is told how to name an entry rather than deriving it.
     */
    what: "The same drawings again, pre-extracted into dessins/100/ (0.71 GB, 38,489 files)",
    withoutIt: "nothing — `drawings` serves the same images out of the archive",
    matches: (d) => d.startsWith("dessins/100/"),
    defaultOn: false,
  },
  {
    id: "exploded",
    what: "Exploded-view images (eclate/) and thumbnails (vignette/)",
    withoutIt: "no exploded views or thumbnail navigation",
    matches: inDir("eclate", "vignette"),
    defaultOn: true,
  },
  {
    id: "dates",
    what: "Applicability dates (Dates/)",
    withoutIt: "no date-based applicability; semantics are undecoded anyway",
    matches: inDir("Dates"),
    defaultOn: true,
  },
  {
    id: "substitutions",
    what: "Part substitutions / supersessions (PR1100/)",
    withoutIt: "no 'replaced by' lookups",
    matches: inDir("PR1100"),
    defaultOn: true,
  },
  {
    id: "extras",
    what:
      "Reference contexts, accessory data, page-turner, Actis, and the REACH " +
      "substance declarations (Refcontexte/, autres/, PRPer/, tournepages/, Actis/, REACH.zip)",
    withoutIt: "nothing yet — none of it is decoded or used",
    matches: (d) =>
      inDir("Refcontexte", "autres", "PRPer", "tournepages", "Actis")(d) || d === "REACH.zip",
    defaultOn: false,
  },
  {
    id: "repair-pdf",
    what: "Repair manuals and technical notes as PDFs, plus their navigation index (mrnt/*/d3k/{1-MR,1-NT,indexation})",
    withoutIt: "no PDF repair documentation",
    matches: (d) => /^mrnt\/[^/]+\/d3k\/(1-MR|1-NT|indexation)(\/|$)/.test(d),
    defaultOn: true,
  },
  {
    id: "repair-xml",
    what: "Structured D3K/SPI repair procedures and their illustrations (mrnt/*/d3k/{chapitres,images}) — by far the largest component",
    withoutIt: "no structured repair procedures; the PDFs still work",
    matches: (d) => /^mrnt\/[^/]+\/d3k\/(chapitres|images)(\/|$)/.test(d),
    defaultOn: true,
  },
  {
    id: "labour-times",
    what: "Labour times: 99,056 LABOUR-TIME-*.xml plus a per-family search index (TM.zip, 173 MB unpacked)",
    withoutIt:
      "no repair-time figures. Off by default because labour times are the input to " +
      "quoting, which is out of scope — but they are standalone repair data too, so " +
      "they are here rather than discarded",
    matches: (d) => d === "TM.zip",
    defaultOn: false,
  },
  {
    id: "part-names",
    what: "Part descriptions per country and language (tarif/d3k/*/*/libellePieces-*.txt and libelles)",
    withoutIt: "the parts list shows bare 10-digit references and nothing else",
    // Extracted from tarif.zip, which also holds the prices — see `pricing`.
    matches: (d) =>
      d === "tarif.zip" ||
      /^tarif\/d3k\/[^/]+\/[^/]+\/(libellePieces-[^/]+\.txt|libelles(\.idx)?)$/.test(d),
    defaultOn: true,
  },
  {
    id: "pricing",
    what: "Tariffs and price scales (tarif/d3k/*/*/tarif, tarif.idx, CBareme)",
    withoutIt:
      "no prices. Explicitly out of scope for this project — named here so the " +
      "omission is deliberate rather than an oversight",
    matches: (d) => /^tarif\/d3k\/[^/]+\/[^/]+\/(tarif(\.idx)?|CBareme)$/.test(d),
    defaultOn: false,
  },
  {
    id: "app",
    what: "Original application: jars, the repair.xsl renderer, help documents",
    withoutIt: "nothing at run time — useful only as reverse-engineering reference",
    matches: inDir("app"),
    defaultOn: false,
  },
];

/** Windows detritus that is on the discs and should never be imported. */
export function isJunk(dest: string): boolean {
  const name = dest.split("/").pop() ?? "";
  return name === "Thumbs.db" || name === ".DS_Store" || name === ".png";
}

export function componentFor(dest: string): ComponentSpec | undefined {
  return COMPONENTS.find((c) => c.matches(dest));
}

export const REQUIRED_COMPONENTS = COMPONENTS.filter((c) => c.required).map((c) => c.id);
export const DEFAULT_COMPONENTS = COMPONENTS.filter((c) => c.defaultOn).map((c) => c.id);

/**
 * Resolve a `--components` value.
 *
 * Accepts `all`, `min` (just what the catalogue needs), or a comma-separated
 * list. Required components are always added back, and unknown names are an
 * error rather than a silent no-op.
 */
export function resolveComponents(value: string | undefined): string[] {
  if (value === undefined) return DEFAULT_COMPONENTS;
  const raw = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (raw.includes("all")) return COMPONENTS.map((c) => c.id);

  const named = raw.filter((id) => id !== "min");
  const unknown = named.filter((id) => !COMPONENTS.some((c) => c.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `unknown component(s): ${unknown.join(", ")}. ` +
        `Known: ${COMPONENTS.map((c) => c.id).join(", ")}, plus "all" and "min".`,
    );
  }

  // `min` *adds* the minimal set; it does not replace what else was asked for.
  // An earlier version short-circuited on it, so `-c min,labour-times` quietly
  // imported the minimum and dropped labour-times with no message at all.
  const base = raw.includes("min") ? ["criteria"] : [];
  return [...new Set([...base, ...named, ...REQUIRED_COMPONENTS])];
}
