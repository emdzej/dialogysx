/**
 * The applicability condition grammar, and its three-valued evaluation.
 *
 * Ported from `dialogys.conditions.CondFactory` (the reader),
 * `CondBloc` / `CondLign` / `CondElem` (the tree) and
 * `dialogys.conditionsfp.{Troolean,Et,Ou}` (the logic). Nothing here is
 * inferred from hexdumps — the original is unobfuscated and this is a
 * transcription of it.
 *
 * This decides **which parts fit which vehicle**, so a wrong answer here is a
 * part fitted to a car it does not belong on. Read `docs/data-format.md` §3.1
 * before changing it.
 */
import type { CriterionCode } from "@dialogysx/core";
import { DataCursor } from "@dialogysx/raf";

/**
 * Operator codes, from `dialogys.util.Constantes.CODE_OPER_*`.
 *
 * Stored as a Java `char` — an unsigned 16-bit big-endian value — so `NotEqual`
 * really is U+2260 (8800), not a byte.
 */
export const Operator = {
  Equal: 0x3d, // '='
  NotEqual: 8800, // '≠' U+2260 — CODE_OPER_DIFFERENT
  Less: 0x3c, // '<'
  LessOrEqual: 0x5b, // '['  CODE_OPER_INFERIEUR_EGAL
  GreaterOrEqual: 0x5d, // ']'  CODE_OPER_SUPERIEUR_EGAL
  Greater: 0x3e, // '>'
  /** '§' (167) — an *informational* clause, not a filter. */
  Information: 167,
} as const;

export type OperatorCode = (typeof Operator)[keyof typeof Operator] | number;

export function operatorName(code: number): string {
  switch (code) {
    case Operator.Equal:
      return "=";
    case Operator.NotEqual:
      return "≠";
    case Operator.Less:
      return "<";
    case Operator.LessOrEqual:
      return "≤";
    case Operator.GreaterOrEqual:
      return "≥";
    case Operator.Greater:
      return ">";
    case Operator.Information:
      return "§";
    default:
      return `?0x${code.toString(16)}`;
  }
}

/** One clause: a criterion, an operator, and value indices. */
export interface CondElem {
  variable: CriterionCode;
  operator: OperatorCode;
  /**
   * Indices into the variable's value list **for this PR group** — the group's
   * `ListeVarVal`, not `classicvar.utf` directly. See `docs/data-format.md`
   * §3.7 for the two levels of indirection.
   */
  valueIndices: number[];
}

/** A conjunction of clauses. `CondLign extends Et`. */
export interface CondLign {
  elems: CondElem[];
}

/** A disjunction of conjunctions. `CondBloc extends Ou`. */
export interface CondBloc {
  lignes: CondLign[];
}

// --------------------------------------------------------------------------
// Reading
// --------------------------------------------------------------------------

/** `CondFactory.newCondElem`. */
export function readCondElem(c: DataCursor): CondElem {
  const variable = c.utf();
  // Java `readChar` — unsigned 16-bit, which is why NotEqual is 8800.
  const operator = c.u16();
  const nbVal = c.i16();
  const valueIndices: number[] = [];
  for (let i = 0; i < nbVal; i++) valueIndices.push(c.i16());
  return { variable, operator, valueIndices };
}

/** `CondFactory.newCondLign`. */
export function readCondLign(c: DataCursor): CondLign {
  const nbElem = c.i16();
  const elems: CondElem[] = [];
  for (let i = 0; i < nbElem; i++) elems.push(readCondElem(c));
  return { elems };
}

/** `CondFactory.newCondBloc`. */
export function readCondBloc(c: DataCursor): CondBloc {
  const nbLign = c.i16();
  const lignes: CondLign[] = [];
  for (let i = 0; i < nbLign; i++) lignes.push(readCondLign(c));
  return { lignes };
}

/** `PRFactory.newTCondBloc` — the pool conditions are referenced by index. */
export function readCondBlocPool(c: DataCursor): CondBloc[] {
  const nbBloc = c.i16();
  const pool: CondBloc[] = [];
  for (let i = 0; i < nbBloc; i++) pool.push(readCondBloc(c));
  return pool;
}

// --------------------------------------------------------------------------
// Three-valued logic
// --------------------------------------------------------------------------

/**
 * `dialogys.conditionsfp.Troolean` — Kleene three-valued logic.
 *
 * `Unknown` is **not** "exclude". In the original an unknown clause raises
 * `DontKnowException`, which the interface turns into a question for the user.
 * Treating it as false would silently hide parts that do fit.
 */
export type Troolean = true | false | "unknown";

export function trooleanOr(a: Troolean, b: Troolean): Troolean {
  if (a === true || b === true) return true;
  if (a === "unknown" || b === "unknown") return "unknown";
  return false;
}

export function trooleanAnd(a: Troolean, b: Troolean): Troolean {
  if (a === false || b === false) return false;
  if (a === "unknown" || b === "unknown") return "unknown";
  return true;
}

/**
 * What a condition is evaluated against.
 *
 * `valuesFor` returns the value list of a variable **as this PR group sees it**,
 * already resolved to strings in the chosen language — that is
 * `PR.getTValeur(referentielLangue, nomVar)`. `criterionValue` is the vehicle's
 * actual value, or `undefined` when it is not known yet.
 */
export interface ConditionContext {
  criterionValue(variable: CriterionCode): string | undefined;
  valuesFor(variable: CriterionCode): readonly string[] | undefined;
  /**
   * True when the variable is matched with `-` as a wildcard
   * (`CondElemJoker` / `UtilJoker.siEgalAvecJoker`).
   */
  isJoker?(variable: CriterionCode): boolean;
  /**
   * Resolve an ordered comparison on a date or build-number variable.
   *
   * Supplied separately because it needs more than the criteria: the vehicle's
   * build number, its factory, and the `Dates` dataset. Omit it and those
   * clauses evaluate to unknown, which is what the catalogue-only path does.
   *
   * See `resolveDateCondition` in `./dates.ts`.
   */
  resolveDate?(
    variable: CriterionCode,
    operator: OperatorCode,
    conditionValue: string,
  ): Troolean | undefined;
  /**
   * True when `CondFactory` would have built a `CondElemDate` for this
   * variable rather than a plain `CondElem`.
   *
   * The distinction is not cosmetic. `CondElemDate.getTroolean` goes straight
   * to `VarDate.resolveDate` and **never reads the vehicle's criterion value**,
   * so routing a date variable through the ordinary path makes it unknown the
   * moment that criterion happens to be unset — which is most of the time for
   * `MILL`.
   */
  isDateElem?(variable: CriterionCode): boolean;
}

/**
 * `UtilJoker.siEgalAvecJoker` with `-` as the wildcard: compare position by
 * position, and treat the wildcard character in the *pattern* as matching
 * anything.
 */
export function equalsWithJoker(value: string, pattern: string, joker = "-"): boolean {
  if (value.length !== pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== joker && pattern[i] !== value[i]) return false;
  }
  return true;
}

/** `CondElem.getTroolean`, plus `CondFactory`'s dispatch to `CondElemDate`. */
export function evalCondElem(elem: CondElem, ctx: ConditionContext): Troolean {
  // An informational clause is not a filter; it carries text for the user.
  if (elem.operator === Operator.Information) return true;

  // `CondFactory.newCondElem` chooses the clause *class* at parse time, and a
  // date variable becomes a `CondElemDate` whose `getTroolean` ignores the
  // criterion value entirely. Dispatch here for the same reason.
  if (ctx.isDateElem?.(elem.variable)) {
    // `CondElemDate` is constructed with `tValeur[tValIndi[0]]` — one already
    // resolved string, not a list of indices.
    const first = elem.valueIndices[0];
    const raw = first === undefined ? undefined : ctx.valuesFor(elem.variable)?.[first];
    if (raw === undefined) return "unknown";
    return ctx.resolveDate?.(elem.variable, elem.operator, raw) ?? "unknown";
  }

  const value = ctx.criterionValue(elem.variable);
  // `valeur == null -> new Troolean()`: unknown, which becomes a question.
  if (value === undefined) return "unknown";

  const values = ctx.valuesFor(elem.variable);
  if (values === undefined) return "unknown";

  const joker = ctx.isJoker?.(elem.variable) ?? false;
  let matched = false;
  for (const index of elem.valueIndices) {
    // The original guards with `_TValIndi[i] < tValeur.length`, so an
    // out-of-range index is a non-match rather than an error.
    if (index >= values.length || index < 0) continue;
    const candidate = values[index]!;
    if (joker ? equalsWithJoker(value, candidate) : value === candidate) {
      matched = true;
      break;
    }
  }

  switch (elem.operator) {
    case Operator.Equal:
      return matched;
    case Operator.NotEqual:
      return !matched;
    default:
      // Plain `CondElem` handles only = and ≠; anything else is
      // `default: return new Troolean()`. Date variables never reach here —
      // they are dispatched above.
      return "unknown";
  }
}

/** `CondLign extends Et` — conjunction, false wins over unknown. */
export function evalCondLign(lign: CondLign, ctx: ConditionContext): Troolean {
  // `CondLign.newCondLignVraie()` is an empty element list, meaning true.
  let result: Troolean = true;
  for (const elem of lign.elems) {
    const t = evalCondElem(elem, ctx);
    if (t === false) return false; // Et.Analyse returns immediately
    result = trooleanAnd(result, t);
  }
  return result;
}

/** `CondBloc extends Ou` — disjunction, true wins over unknown. */
export function evalCondBloc(bloc: CondBloc, ctx: ConditionContext): Troolean {
  // An empty bloc has no true line, so it is false — matching `Ou.Analyse`,
  // which only sets `bAnalyse = true` on finding a true condition.
  let result: Troolean = false;
  for (const lign of bloc.lignes) {
    const t = evalCondLign(lign, ctx);
    if (t === true) return true; // Ou.Analyse returns immediately
    result = trooleanOr(result, t);
  }
  return result;
}

/** Every criterion a condition mentions — what the UI would have to ask about. */
export function variablesOf(bloc: CondBloc): CriterionCode[] {
  const out = new Set<CriterionCode>();
  for (const l of bloc.lignes) for (const e of l.elems) out.add(e.variable);
  return [...out];
}
