/**
 * Finding a part, and getting back the diagrams that show it.
 *
 * Two indexes do most of the work and one gap has to be scanned.
 *
 * `refNumPr` maps a reference to the PR groups holding it — 327,169 of them,
 * one lookup — and the loaded tariff maps descriptions to references in
 * memory. Between them, a query becomes a set of references and the groups
 * they live in, for no I/O worth counting.
 *
 * What no index gives is *which plate* draws a reference. `trepere` goes the
 * other way, drawing to callouts. So that last step is a scan of the plates in
 * the surviving groups, and the value of the two indexes is how much of it
 * they remove: a part that is not in this vehicle's groups is answered without
 * opening a single plate.
 *
 * Scoped to the identified vehicle deliberately. It keeps the scan to one
 * model — 304 plates for a Master II rather than 40,910 — and every result is
 * evaluated through the same applicability path the parts view uses, so a hit
 * is a diagram that actually applies rather than one that merely mentions the
 * number.
 *
 * The diagram index in a hit is the tab number, ordered by the same rule the
 * tab strip uses: ascending by plate code, fitting and undecided interleaved.
 * They share `inTabOrder` rather than each having their own, because if the
 * two disagreed a result would navigate to the wrong tab.
 */
import type { CatalogueSession } from "./session.js";
import type { PartRef, PrGroup } from "@dialogysx/core";

/** Which part matched, on one diagram. */
export interface PartMatch {
  ref: PartRef;
  name?: string;
  /** The callout it hangs off, so the drawing can highlight it once opened. */
  repere: number;
  /** Listed, but its own conditions are unanswered for this vehicle. */
  undecided: boolean;
}

/** One diagram that shows at least one matching part. */
export interface DiagramHit {
  pr: PrGroup;
  /** Assembly code, e.g. `3737A` — what `selectAssembly` takes. */
  assembly: string;
  assemblyLabel?: string;
  /** 7-character plate code, e.g. `N372510`. */
  plate: string;
  drawing?: string;
  /** 1-based position among the assembly's diagrams: the tab number. */
  index: number;
  /** How many diagrams the assembly has, so a hit reads "2 of 5". */
  total: number;
  /** The diagram applies only under conditions this vehicle cannot answer. */
  diagramUndecided: boolean;
  matches: PartMatch[];
}

export interface SearchOptions {
  /** PR groups to consider — normally the selected model's. */
  groups: readonly PrGroup[];
  /**
   * The vehicle to evaluate applicability against.
   *
   * Pass the *effective* vehicle, with the user's criterion answers already
   * merged in. Answers reach applicability through the spec rather than as a
   * separate argument, so a search and the parts view agree by construction
   * instead of by remembering to pass the same thing to both.
   */
  vehicle: Parameters<CatalogueSession["plate"]>[2];
  /** A scan is interruptible; the user may type again or give up. */
  signal?: AbortSignal;
  onProgress?: (scanned: number, total: number, hits: number) => void;
  /** Cap on diagrams returned. */
  limit?: number;
  /** Cap on references a name search may expand to. */
  refLimit?: number;
}

export interface SearchResult {
  /** How the query was read. */
  kind: "reference" | "name";
  /** The references the query resolved to, with their descriptions. */
  refs: { ref: PartRef; name?: string }[];
  hits: DiagramHit[];
  /** Plates examined, so a partial answer can say how partial. */
  scanned: number;
  total: number;
  /** `limit` or the signal stopped it short. */
  truncated: boolean;
  /**
   * True when the indexes answered without a scan: the part exists but is in
   * no PR group this vehicle uses. A different statement from "not found".
   */
  outOfScope: boolean;
}

/** Fixed key width in `refNumPr`; shorter input is a prefix. */
const REF_WIDTH = 10;

/**
 * Does this look like a part number rather than a description?
 *
 * References are digits; a user may type them with spaces or dashes. Four is
 * the floor — fewer digits is likelier part of a word ("300") than a
 * reference, and would match thousands.
 */
function looksLikeReference(query: string): boolean {
  const digits = query.replace(/[\s-]/g, "");
  return digits.length >= 4 && /^\d+$/.test(digits);
}

/** Ascending by plate code — the order the tab strip numbers. */
export function inTabOrder<T extends { plate: string }>(plates: readonly T[]): T[] {
  return [...plates].sort((x, y) => x.plate.localeCompare(y.plate));
}

/**
 * Resolve a typed number to real references, via `refNumPr`.
 *
 * Tried two ways, because the stored keys are zero-padded to ten and a user
 * types what is stamped on the part. `7700273264` is already ten and matches
 * exactly; `1484` is a reference stored as `0000001484`, which a prefix query
 * would miss entirely, so the padded form is tried as well.
 */
async function referencesFor(
  session: CatalogueSession,
  typed: string,
  limit: number,
): Promise<{ found: { ref: PartRef; groups: PrGroup[] }[]; truncated: boolean }> {
  const search = session.partSearch;
  if (!search) return { found: [], truncated: false };
  const digits = typed.replace(/[\s-]/g, "");

  const byPrefix = await search.byPrefix(digits, limit);
  const out = new Map(byPrefix.results.map((r) => [r.ref.trim(), r]));

  if (digits.length < REF_WIDTH) {
    const padded = digits.padStart(REF_WIDTH, "0");
    const groups = await search.groupsFor(padded);
    if (groups && !out.has(padded)) out.set(padded, { ref: padded, groups });
  }
  return { found: [...out.values()], truncated: byPrefix.truncated };
}

/**
 * Search for a part and return the diagrams that show it.
 *
 * Sequential on purpose. The reads share one `FileSource` and the plate parses
 * are CPU-bound, so a worker pool complicates cancellation and progress
 * without finishing sooner. If this ever needs to be faster the answer is an
 * index from reference to plate, which the catalogue does not ship.
 */
export async function searchDiagrams(
  session: CatalogueSession,
  query: string,
  opts: SearchOptions,
): Promise<SearchResult> {
  const trimmed = query.trim();
  const limit = opts.limit ?? 100;
  const kind: SearchResult["kind"] = looksLikeReference(trimmed) ? "reference" : "name";
  const inScope = new Set(opts.groups);

  const empty = (outOfScope = false): SearchResult => ({
    kind,
    refs: [],
    hits: [],
    scanned: 0,
    total: 0,
    truncated: false,
    outOfScope,
  });
  if (trimmed.length === 0) return empty();

  // --- 1. query -> references, and the groups holding them ----------------
  const names = session.partNamesIndex;
  let candidates: { ref: PartRef; groups: PrGroup[] }[] = [];
  let truncated = false;

  if (kind === "reference") {
    const r = await referencesFor(session, trimmed, opts.refLimit ?? 200);
    candidates = r.found;
    truncated = r.truncated;
  } else {
    if (!names) return empty();
    const refLimit = opts.refLimit ?? 200;
    // Asked for one more than the cap purely to learn whether there was one.
    // Without that, hitting the cap and matching it exactly are the same
    // answer, and a silently short result looks complete.
    const refs = names.searchByName(trimmed, refLimit + 1);
    if (refs.length > refLimit) {
      truncated = true;
      refs.length = refLimit;
    }
    // One index lookup per name hit. Cheap next to a plate parse, and it is
    // what lets an out-of-scope answer cost no scan at all.
    for (const ref of refs) {
      const groups = (await session.partSearch?.groupsFor(ref)) ?? [];
      candidates.push({ ref, groups });
    }
  }

  if (candidates.length === 0) return empty();

  const refs = candidates.map((c) => ({ ref: c.ref, name: names?.get(c.ref) }));
  const relevant = candidates.filter((c) => c.groups.some((g) => inScope.has(g)));
  if (relevant.length === 0) {
    // The part exists; it is just not used by this vehicle's groups. Said
    // distinctly, because "not found" would be wrong and misleading.
    return { ...empty(true), refs };
  }
  const wanted = new Set(relevant.map((c) => c.ref.trim()));
  const groupsToScan = [...inScope].filter((g) => relevant.some((c) => c.groups.includes(g)));

  // --- 2. enumerate the plates worth opening ------------------------------
  const work: {
    pr: PrGroup;
    assembly: string;
    label?: string;
    plates: { plate: string; drawing?: string; undecided: boolean }[];
  }[] = [];
  for (const pr of groupsToScan) {
    for (const a of await session.assemblyList(pr)) {
      const r = await session.assemblyPlates(pr, a.code, opts.vehicle);
      const plates = inTabOrder([
        ...r.plates.map((p) => ({ plate: p.plate, drawing: p.drawing, undecided: false })),
        ...r.unknown.map((p) => ({ plate: p.plate, drawing: p.drawing, undecided: true })),
      ]);
      if (plates.length > 0) work.push({ pr, assembly: a.code, label: a.label, plates });
    }
  }
  const total = work.reduce((n, w) => n + w.plates.length, 0);

  // --- 3. the scan --------------------------------------------------------
  const hits: DiagramHit[] = [];
  let scanned = 0;

  outer: for (const w of work) {
    for (let i = 0; i < w.plates.length; i++) {
      if (opts.signal?.aborted) {
        truncated = true;
        break outer;
      }
      const p = w.plates[i]!;
      scanned++;
      const resolved = await session
        .plate(w.pr, p.plate, opts.vehicle, p.drawing)
        .catch(() => undefined);
      opts.onProgress?.(scanned, total, hits.length);
      if (!resolved) continue;

      const matches: PartMatch[] = [];
      for (const rep of resolved.reperes) {
        for (const [list, undecided] of [
          [rep.fits, false],
          [rep.unknown, true],
        ] as const) {
          for (const cand of list) {
            if (wanted.has(cand.ref.trim())) {
              matches.push({ ref: cand.ref, name: cand.name, repere: rep.repere, undecided });
            }
          }
        }
      }
      if (matches.length === 0) continue;

      hits.push({
        pr: w.pr,
        assembly: w.assembly,
        assemblyLabel: w.label,
        plate: p.plate,
        drawing: p.drawing,
        index: i + 1,
        total: w.plates.length,
        diagramUndecided: p.undecided,
        matches,
      });
      if (hits.length >= limit) {
        truncated = true;
        break outer;
      }
    }
  }

  return { kind, refs, hits, scanned, total, truncated, outOfScope: false };
}
