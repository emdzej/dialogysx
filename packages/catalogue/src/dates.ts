/**
 * Date and build-number comparison — the ordered operators (`< > [ ]`).
 *
 * Ported from `dialogys.dates.UtilDate`, `dialogys.dates.BlocDate` and
 * `dialogys.vehiculet.VarDate.resolveDate`. This closes the 28.7 % of part
 * candidates that §3.1.1 of the format doc left unresolvable.
 *
 * The shape: ten variables are **views onto three underlying build records** —
 * the vehicle's, the engine's and the gearbox's. Each view answers a different
 * question about the same record, and `VarDate.resolveDate` switches on which:
 *
 * | vue | question | needs |
 * | --- | --- | --- |
 * | 0 | build *number* comparison | the vehicle's build number |
 * | 1 | build *date* / event comparison | the `Dates` dataset as well |
 * | 2 | which *factory* | the build number's leading letter |
 */
import type { CriterionCode } from "@dialogysx/core";
import { decodeText, splitFields, splitRecords } from "@dialogysx/raf";
import { Operator } from "./conditions.js";

/** The three underlying build records. `Constantes.S_DATE_{VEH,MOT,BVI}`. */
export type DateGroup = "dveh" | "dmot" | "dbvi";

export interface DateView {
  group: DateGroup;
  /** 0 = build number, 1 = date/event, 2 = factory. */
  vue: 0 | 1 | 2;
}

/**
 * Which view each variable is, from `VarFactory.newVarVueSurDate`.
 *
 * `S_VUES_DVEH = "NFAB|MILL|UVEH|MFAB"`, `S_VUES_DMOT = "NFMO|D_MO|UFMO"`,
 * `S_VUES_DBVI = "NFBV|D_BV|UFBV"`.
 *
 * The vehicle branch reads
 * `else if (!nomVar.equals("MILL") && nomVar.equals("UVEH")) vue = 2;`
 * — the first test is redundant, since a string equal to `UVEH` cannot equal
 * `MILL`. The behaviour is unambiguous even so: `NFAB` is 0, `UVEH` is 2, and
 * `MILL` and `MFAB` fall through to 1.
 */
const DATE_VIEWS: Readonly<Record<string, DateView>> = {
  NFAB: { group: "dveh", vue: 0 },
  MILL: { group: "dveh", vue: 1 },
  MFAB: { group: "dveh", vue: 1 },
  UVEH: { group: "dveh", vue: 2 },
  NFMO: { group: "dmot", vue: 0 },
  D_MO: { group: "dmot", vue: 1 },
  UFMO: { group: "dmot", vue: 2 },
  NFBV: { group: "dbvi", vue: 0 },
  D_BV: { group: "dbvi", vue: 1 },
  UFBV: { group: "dbvi", vue: 2 },
};

export function dateViewOf(variable: CriterionCode): DateView | undefined {
  return DATE_VIEWS[variable];
}

export function isDateVariable(variable: CriterionCode): boolean {
  return variable in DATE_VIEWS;
}

// --------------------------------------------------------------------------
// Build numbers
// --------------------------------------------------------------------------

/**
 * A build number is one factory letter followed by digits, e.g. `K0000412`.
 * `UtilDate.getUsiWithoutNFab` takes character 0; `getNFabWithoutUsi` takes
 * the rest.
 */
export function splitBuildNumber(nfab: string): { factory: string; number: string } {
  if (nfab.length === 0) return { factory: "", number: "" };
  return { factory: nfab.slice(0, 1), number: nfab.slice(1) };
}

/**
 * `UtilDate.formateNumFab` — normalise to 7 digits so the comparison can be a
 * plain string compare.
 *
 * Shorter is left-padded with zeros. Longer has leading zeros stripped, but
 * only down to 7 characters, so an 8-digit number keeps its width rather than
 * being truncated.
 */
export function formatBuildNumber(n: string): string {
  if (n.length === 0) return n;
  if (n.length < 7) return "0000000".slice(n.length) + n;
  let zeros = 0;
  const stop = n.length - 7;
  while (zeros < stop && n[zeros] === "0") zeros++;
  return zeros > 0 ? n.slice(zeros) : n;
}

function applyOrder(comparison: number, operator: number): boolean {
  switch (operator) {
    case Operator.Less:
      return comparison < 0;
    case Operator.Equal:
      return comparison === 0;
    case Operator.Greater:
      return comparison > 0;
    case Operator.LessOrEqual:
      return comparison <= 0;
    case Operator.GreaterOrEqual:
      return comparison >= 0;
    default:
      return false;
  }
}

/**
 * `UtilDate.compareNFab`.
 *
 * Both sides are normalised to `factory + 7-digit number` and compared as
 * **strings**, not numbers — which is why `formatBuildNumber` exists and why
 * the factory letter participates in the ordering.
 */
export function compareBuildNumbers(
  vehicleNfab: string,
  operator: number,
  conditionNfab: string,
  specialDate = false,
): boolean {
  const v = splitBuildNumber(vehicleNfab);
  const left = v.factory + formatBuildNumber(v.number);
  const c = splitBuildNumber(conditionNfab);
  // With `p_dateSpeciale` the *vehicle's* factory is used on both sides, so the
  // comparison is purely numeric.
  const right = (specialDate ? v.factory : c.factory) + formatBuildNumber(c.number);
  return applyOrder(left < right ? -1 : left > right ? 1 : 0, operator);
}

// --------------------------------------------------------------------------
// Event labels
// --------------------------------------------------------------------------

/** `UtilDate.anneeSurQuatre` — does this look like a 4-digit year? */
function isFourDigitYear(s: string): boolean {
  const p = s.slice(0, 2);
  return p === "19" || p === "20";
}

/**
 * `UtilDate.getAnneeSurQuatre` — expand a 2-digit year.
 *
 * **The pivot is hard-coded at 18**: `aa < 18 ? aa + 2000 : aa + 1900`. So `17`
 * is 2017 and `18` is 1918. The data is from 2016, so this was future-proof for
 * about two years; it is wrong for any 2018-or-later 2-digit year, and that is
 * the original's behaviour, not ours to silently improve.
 */
export function expandTwoDigitYear(aa: string): number {
  const n = Number(aa);
  return n < 18 ? n + 2000 : n + 1900;
}

export class EventFormatError extends Error {}

/**
 * `UtilDate.getIntFromValEvt` — an event label to a sortable `yyyymmdd` int.
 *
 * The literal in the original decompiles as `Constants.TCP_IP_DEFAULT_TIME_OUT`
 * because jadx matched the value 10000 to an unrelated constant. It is just
 * 10000.
 */
export function eventToInt(evt: string): number {
  let s = evt;
  if (s.length === 7) s = s.slice(3, 7);

  let year: number;
  let month: number;
  let day: number;

  switch (s.length) {
    case 0:
    case 5:
      // Both map to a fixed sentinel date in the original.
      year = 1980;
      month = 12;
      day = 15;
      break;
    case 4:
      if (isFourDigitYear(s)) {
        // A bare year means "the year before, mid-June" — the original's own
        // approximation, not a rounding of ours.
        year = Number(s) - 1;
        month = 6;
        day = 15;
      } else {
        month = Number(s.slice(2, 4));
        year = expandTwoDigitYear(s.slice(0, 2));
        day = 1;
        if (month === 0) {
          year--;
          month = 12;
        }
      }
      break;
    case 6:
      if (s.slice(0, 2) === "MO") {
        year = 1980;
        month = 12;
        day = 15;
      } else {
        year = expandTwoDigitYear(s.slice(0, 2));
        month = Number(s.slice(2, 4));
        day = Number(s.slice(4, 6));
      }
      break;
    default:
      throw new EventFormatError(evt);
  }
  return year * 10000 + month * 100 + day;
}

function nextMonth(mm: string): number {
  // `UtilDate.moisSuivant`: December wraps to 0, which callers treat as
  // "roll the year".
  const n = Number(mm) + 1;
  return n > 12 ? 0 : n;
}

/** `UtilDate.succDateEvt` — the next event label after this one. */
export function successorEvent(evt: string): string {
  if (evt.length === 4) {
    if (isFourDigitYear(evt)) return String(Number(evt) + 1);
    const aa = Number(evt.slice(0, 2));
    const mm = nextMonth(evt.slice(2, 4));
    if (mm === 0) return `${String((aa + 1) % 100).padStart(2, "0")}01`;
    return String(aa * 100 + mm);
  }
  if (evt.length === 6 && isFourDigitYear(evt.slice(0, 4))) {
    const yyyy = Number(evt.slice(0, 4));
    const mm = nextMonth(evt.slice(4, 6));
    if (mm === 0) return `${yyyy + 1}01`;
    return String(yyyy * 100 + mm);
  }
  throw new EventFormatError(evt);
}

// --------------------------------------------------------------------------
// The Dates dataset
// --------------------------------------------------------------------------

/**
 * One `Dates` record: a build-number table indexed by event and factory.
 *
 * `BlocDate.chargeBlocDate` reads it as CR-separated rows of TAB-separated
 * fields. The first row is the key followed by event labels; each later row is
 * a factory code followed by its build number at each event:
 *
 * ```
 * 0202U75B   980615   010615   010701  ...      <- key, then events
 * K          0000001  0000412  0000980 ...      <- factory K
 * B          0000001  0000377  0000902 ...      <- factory B
 * ```
 *
 * A factory code of `$` is stored as `0` (`ExportExcelFiles.DOLLAR`).
 */
export class DateBlock {
  private constructor(
    readonly key: string,
    readonly events: string[],
    readonly factories: string[],
    /** `[factoryIndex][eventIndex]`. */
    private readonly numbers: string[][],
  ) {}

  static parse(bytes: Uint8Array): DateBlock {
    const rows = splitRecords(decodeText(bytes)).filter((r) => r.length > 0);
    const header = rows[0];
    if (header === undefined) throw new Error("Dates record: empty");
    const headerFields = splitFields(header);
    const key = headerFields[0] ?? "";
    const events = headerFields.slice(1);

    const factories: string[] = [];
    const numbers: string[][] = [];
    for (const row of rows.slice(1)) {
      const f = splitFields(row);
      const name = f[0] ?? "";
      factories.push(name === "$" ? "0" : name);
      numbers.push(f.slice(1));
    }
    return new DateBlock(key, events, factories, numbers);
  }

  factoryIndex(factory: string): number {
    return this.factories.indexOf(factory);
  }

  /**
   * `BlocDate.getNFabFromEvt` — the build number at which an event happened,
   * for one factory.
   *
   * Returns `undefined` rather than throwing when the event or factory is
   * absent; the original raises `DialogysRuntimeException`, but here that has
   * to become *unknown* so the condition asks rather than asserts.
   */
  buildNumberForEvent(event: string, factory: string): string | undefined {
    const e = this.events.indexOf(event);
    if (e < 0) return undefined;
    const f = this.factoryIndex(factory);
    if (f < 0) return undefined;
    const n = this.searchNFab(e, f);
    if (n.length === 0) return undefined;
    return factory + n;
  }

  /**
   * `BlocDate.searchNFab` — resolve one cell of a **sparse and ragged** table.
   *
   * The rows really are ragged: one record here has 945 event columns but only
   * 854 numbers for factory `A`. So most lookups land on a missing cell, and
   * how they are filled decides applicability answers.
   *
   * Two sentinels do the work, and neither is guessable from the data:
   *
   * - **`"ZZZZZZ"`** means "after everything". It is a *string* sentinel, which
   *   is why `compareNFab` compares strings rather than numbers: it pads to
   *   `"0ZZZZZZ"`, so a 6-digit build number like `"0060050"` sorts below it at
   *   position 2.
   *
   *   **It breaks at 1,000,000.** A 7-digit number has no leading zero, so it
   *   beats `"0ZZZZZZ"` at position 1 and "after everything" compares as
   *   *before*. 310 of the 1,681,628 shipped cells are >= 1,000,000 (the
   *   largest is 2,366,801), so 0.018 % of lookups get the inverted answer.
   *   This is the original's bug and it is reproduced rather than corrected:
   *   diverging would give answers Dialogys never gave, and nothing in the data
   *   says which one Renault intended.
   * - **`"000001"`** means "from the start of production".
   *
   * And a cell that literally contains `0` is **not build number zero** — it
   * normalises to `"0000000"` and is treated as `"ZZZZZZ"`, i.e. this factory
   * never built this type. Whole factory rows are zeros for that reason:
   * 17.5 % of all cells.
   *
   * Measured over the shipped `Dates` dataset, 1,681,628 cells:
   * 15.9 % empty (so this function decides them), 17.5 % a literal `0`,
   * 2.0 % carrying a factory letter of their own (e.g. `A45312`, whose meaning
   * is **not established** — they sort above digits, so they behave like large
   * values, but why they are written that way is unknown).
   */
  private searchNFab(eventIndex: number, factoryIndex: number): string {
    const AFTER_EVERYTHING = "ZZZZZZ";
    const FROM_THE_START = "000001";
    if (eventIndex >= this.events.length) return AFTER_EVERYTHING;

    const row = this.numbers[factoryIndex] ?? [];
    const cell = row[eventIndex];
    if (cell !== undefined && cell.length > 0) {
      return formatBuildNumber(cell) === "0000000" ? AFTER_EVERYTHING : cell;
    }

    // `getNFabBeforeEvt` / `getNFabAfterEvt`: nearest populated cell each way.
    let before = "";
    for (let i = eventIndex - 1; i >= 0; i--) {
      before = row[i] ?? "";
      if (before.length > 0) break;
    }
    let after = "";
    for (let i = eventIndex + 1; i < this.events.length; i++) {
      after = row[i] ?? "";
      if (after.length > 0) break;
    }

    if (before === after) return before.length > 0 ? before : AFTER_EVERYTHING;
    if (before.length === 0 && after.length > 0) return FROM_THE_START;
    if (before.length > 0 && after.length === 0) return AFTER_EVERYTHING;
    return before;
  }
}

// --------------------------------------------------------------------------
// Resolution
// --------------------------------------------------------------------------

/** What the vehicle actually is, for one of the three build records. */
export interface VehicleBuild {
  /** Full build number including the factory letter, e.g. `"K0000412"`. */
  buildNumber?: string;
  /** The `Dates` record for this vehicle's PR group and type. */
  dates?: DateBlock;
}

export type DateVerdict = true | false | "unknown";

/**
 * `VarDate.resolveDate` — the deterministic paths only.
 *
 * The original has three further fallbacks for a *partially* identified
 * vehicle: `resolveDateApprox` (an approximate `yymm`), `resolveDateEvt` (the
 * date known only as a range, which prompts the user), and
 * `resolveDatesSpeciales` (per-type overrides). All three end in a question, so
 * they are reported here as `"unknown"` rather than guessed — which is the same
 * answer the interface would end up showing.
 */
export function resolveDateCondition(
  view: DateView,
  operator: number,
  conditionValue: string,
  build: VehicleBuild,
): DateVerdict {
  switch (view.vue) {
    case 0: {
      // Build-number view: compare the numeric parts, factory stripped from
      // both sides.
      if (build.buildNumber === undefined) return "unknown";
      const v = splitBuildNumber(build.buildNumber).number;
      const c = splitBuildNumber(conditionValue).number;
      if (v.length === 0 || c.length === 0) return "unknown";
      return applyOrder(
        formatBuildNumber(v) < formatBuildNumber(c)
          ? -1
          : formatBuildNumber(v) > formatBuildNumber(c)
            ? 1
            : 0,
        operator,
      );
    }

    case 1: {
      // Date/event view. `[` and `>` are rewritten onto the successor event so
      // only `<` and `]` need handling — the original recurses for exactly this.
      if (operator === Operator.LessOrEqual) {
        return resolveDateCondition(view, Operator.Less, successorEvent(conditionValue), build);
      }
      if (operator === Operator.Greater) {
        return resolveDateCondition(
          view,
          Operator.GreaterOrEqual,
          successorEvent(conditionValue),
          build,
        );
      }
      if (build.buildNumber === undefined || build.dates === undefined) return "unknown";
      const factory = splitBuildNumber(build.buildNumber).factory;
      const target = build.dates.buildNumberForEvent(conditionValue, factory);
      if (target === undefined) return "unknown";
      return compareBuildNumbers(build.buildNumber, operator, target);
    }

    case 2: {
      // Factory view: equality only. The original raises a user-facing error
      // for any other operator, so anything else is unknown here.
      if (build.buildNumber === undefined) return "unknown";
      const factory = splitBuildNumber(build.buildNumber).factory;
      if (operator === Operator.Equal) return conditionValue === factory;
      if (operator === Operator.NotEqual) return conditionValue !== factory;
      return "unknown";
    }
  }
}
