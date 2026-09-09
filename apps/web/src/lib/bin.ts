/**
 * The parts bin: what you have decided to order.
 *
 * Everything here is pure, and the reactive store is a thin wrapper in
 * `bin.svelte.ts`. The split is for testing: a `.svelte.ts` file needs the
 * Svelte compiler for its runes and this project's vitest runs plain Node, so
 * logic left inside the store cannot be tested at all. The CSV escaping, the
 * quantity clamp and the storage validation are exactly the parts worth
 * testing — each fails quietly and each reaches a printed pick list.
 *
 * Keyed by part reference, not by the callout it was found under. The same
 * reference appears on many plates under different callout numbers — a bolt is
 * a bolt — and someone adding it twice means "two of them", not "two lines
 * that happen to match". Adding an existing reference therefore raises its
 * quantity and keeps the first line's provenance, since that is where the part
 * was actually found.
 */

/** Where a line came from, so a pick list can be acted on. */
export interface BinProvenance {
  brand?: string;
  model?: string;
  /** Vehicle type, e.g. `ED01`. */
  vehicle?: string;
  /** PR group, e.g. `1256`. */
  group?: string;
  /** Assembly code, e.g. `3737A`. */
  assembly?: string;
  assemblyLabel?: string;
  /** Plate code, e.g. `N372510`. */
  plate?: string;
  /** 1-based diagram number within the assembly, as the tabs show it. */
  diagram?: number;
  /** Callout the part hangs off. */
  repere?: number;
}

export interface BinEntry extends BinProvenance {
  ref: string;
  name?: string;
  quantity: number;
  /**
   * The part was listed but its conditions were unanswered for this vehicle.
   *
   * Carried onto the line and into the export because it changes what the line
   * *means*: it is a number to confirm before ordering, not one that has been
   * shown to fit. 83 % of plates have at least one, so this is the common case
   * rather than an edge.
   */
  undecided?: boolean;
  /** Insertion order, so the list does not reshuffle as quantities change. */
  added: number;
}

/** What a caller hands over; the bin fills in `added`. */
export type BinAddition = Omit<BinEntry, "added">;

export const BIN_KEY = "dialogysx.bin.v1";

/** A pick list is tens of lines. A cap stops a stuck loop filling storage. */
export const BIN_LIMIT = 500;

/** Whole pieces, at least one. A line for zero of something is not a line. */
export function clampQuantity(n: number): number {
  return Math.max(1, Math.min(9999, Math.round(Number(n) || 1)));
}

/**
 * Read entries from a stored string.
 *
 * Validated rather than trusted: this is user-editable storage, and a quantity
 * of `"3"` or `NaN` would reach the CSV and the printed list. Anything
 * unreadable yields an empty bin instead of throwing — losing the bin is bad,
 * but a page that will not load at all is worse.
 */
export function parseStored(raw: string | null): BinEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (e): e is BinEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as BinEntry).ref === "string" &&
        (e as BinEntry).ref !== "",
    )
    .map((e, at) => ({
      ...e,
      quantity: clampQuantity(e.quantity),
      // A line written before `added` existed still needs an order; its
      // position in the file is the best evidence available.
      added: Number.isFinite(e.added) ? e.added : at,
    }))
    .slice(0, BIN_LIMIT);
}

/** Add, or raise the quantity of a reference already present. */
export function addTo(entries: readonly BinEntry[], addition: BinAddition): BinEntry[] {
  const at = entries.findIndex((e) => e.ref === addition.ref);
  if (at >= 0) {
    const existing = entries[at]!;
    const next = [...entries];
    next[at] = { ...existing, quantity: clampQuantity(existing.quantity + addition.quantity) };
    return next;
  }
  if (entries.length >= BIN_LIMIT) return [...entries];
  const added = entries.reduce((max, e) => Math.max(max, e.added), -1) + 1;
  return [...entries, { ...addition, quantity: clampQuantity(addition.quantity), added }];
}

export function setQuantityIn(
  entries: readonly BinEntry[],
  ref: string,
  quantity: number,
): BinEntry[] {
  return entries.map((e) => (e.ref === ref ? { ...e, quantity: clampQuantity(quantity) } : e));
}

export function removeFrom(entries: readonly BinEntry[], ref: string): BinEntry[] {
  return entries.filter((e) => e.ref !== ref);
}

/** Lines in the bin. */
export const lineCount = (entries: readonly BinEntry[]): number => entries.length;

/** Pieces in the bin, which is the number that matters when ordering. */
export const pieceCount = (entries: readonly BinEntry[]): number =>
  entries.reduce((sum, e) => sum + e.quantity, 0);

/** Column order of the CSV, so headers and cells cannot drift apart. */
export const CSV_COLUMNS = [
  "ref",
  "name",
  "quantity",
  "confirm",
  "brand",
  "model",
  "vehicle",
  "group",
  "assembly",
  "plate",
  "diagram",
  "repere",
  "note",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

/**
 * The bin as CSV.
 *
 * Every field is quoted, always. A part name is `GASKET, FUEL FILLER NECK` —
 * commas are the norm here, not the exception — and quoting unconditionally is
 * shorter than deciding per field and impossible to get wrong. Doubling an
 * embedded quote is the RFC 4180 escape.
 *
 * CRLF line endings, also from the RFC, because that is what spreadsheet
 * software on Windows expects and a parts desk is a Windows desk.
 *
 * `confirm` carries the undecided flag as a word rather than a boolean: this
 * is read by a person on a printout, and `TRUE` in a column called `confirm`
 * is ambiguous about which way round it means.
 */
export function toCsv(
  entries: readonly BinEntry[],
  headers: Readonly<Record<CsvColumn, string>>,
  opts: { note?: (ref: string) => string | undefined; confirmWord?: string } = {},
): string {
  const cell = (value: string | number | undefined) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const row = (e: BinEntry): string =>
    [
      e.ref,
      e.name,
      e.quantity,
      e.undecided ? (opts.confirmWord ?? "confirm") : "",
      e.brand,
      e.model,
      e.vehicle,
      e.group,
      e.assemblyLabel ?? e.assembly,
      e.plate,
      e.diagram,
      e.repere,
      opts.note?.(e.ref),
    ]
      .map(cell)
      .join(",");
  return (
    [CSV_COLUMNS.map((c) => cell(headers[c])).join(","), ...entries.map(row)].join("\r\n") + "\r\n"
  );
}
