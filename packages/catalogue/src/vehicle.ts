/**
 * A vehicle, and the `ConditionContext` it presents to the evaluator.
 *
 * This is the join: a plate's conditions are written against criterion names,
 * whose value lists live in the PR group's `ListeVarVal`, whose translated
 * entries resolve through `classicvar.utf`, and whose ordered comparisons need
 * the `Dates` dataset. `VehicleContext` holds all four so callers do not have
 * to.
 */
import type { CriterionCode, PrGroup, VehicleType } from "@dialogysx/core";
import type { ConditionContext, OperatorCode, Troolean } from "./conditions.js";
import type { CriteriaVocabulary } from "./criteria.js";
import {
  dateViewOf,
  isDateVariable,
  resolveDateCondition,
  type DateBlock,
  type DateGroup,
} from "./dates.js";
import type { GroupValues } from "./values.js";

/**
 * Variables matched with `-` as a wildcard.
 *
 * `VarFactory.S_AVEC_JOKE = "TYP_|EQPT"` — exactly two.
 */
const JOKER_VARIABLES = new Set<CriterionCode>(["TYP_", "EQPT"]);

export interface VehicleSpec {
  pr: PrGroup;
  type: VehicleType;
  /**
   * Known criterion values, keyed by code: `TYP_`, `EQPT`, `MOT3`, `AIRC`, ...
   * Anything absent evaluates to unknown, which the interface should turn into
   * a question rather than an exclusion.
   */
  criteria: Readonly<Partial<Record<CriterionCode, string>>>;
  /**
   * Build numbers, factory letter included (e.g. `"K0000412"`), one per date
   * group. Without these the ordered operators cannot be resolved.
   */
  buildNumbers?: Readonly<Partial<Record<DateGroup, string>>>;
}

export interface VehicleContextParts {
  /** The PR group's `ListeVarVal`. */
  values?: GroupValues;
  /** `classicvar.utf`, needed to resolve translated value tables. */
  vocabulary?: CriteriaVocabulary;
  /** The `Dates` record per group, keyed by group. */
  dates?: Readonly<Partial<Record<DateGroup, DateBlock>>>;
}

export class VehicleContext implements ConditionContext {
  constructor(
    readonly spec: VehicleSpec,
    private readonly parts: VehicleContextParts = {},
  ) {}

  criterionValue(variable: CriterionCode): string | undefined {
    return this.spec.criteria[variable];
  }

  valuesFor(variable: CriterionCode): readonly string[] | undefined {
    return this.parts.values?.valuesFor(variable, this.parts.vocabulary);
  }

  isJoker(variable: CriterionCode): boolean {
    return JOKER_VARIABLES.has(variable);
  }

  /**
   * `CondElemJoker.getTValeurConditions`: the table named `<variable>COND`.
   *
   * `Constantes.S_COND = "COND"`, so `TYP_` resolves through `TYP_COND`, whose
   * entries carry the `-` wildcards the joker comparison exists for.
   */
  jokerValuesFor(variable: CriterionCode): readonly string[] | undefined {
    return this.parts.values?.valuesFor(`${variable}COND`, this.parts.vocabulary);
  }

  /**
   * `CondFactory`'s test: in `H_VUES_DATE`, **except `UVEH`**.
   *
   * `CondFactory.newCondElem` reads
   * `if (nomVar.equalsIgnoreCase("UVEH")) new CondElem(...) else new CondElemDate(...)`,
   * so the vehicle factory is compared like an ordinary criterion while the
   * engine and gearbox factories (`UFMO`, `UFBV`) go through the date path.
   * Inconsistent in the original; reproduced because it changes answers.
   */
  isDateElem(variable: CriterionCode): boolean {
    return isDateVariable(variable) && variable !== "UVEH";
  }

  /**
   * Ordered comparison on a date or build-number variable.
   *
   * Returns `undefined` when the variable is not one of the ten date views, so
   * the caller falls back to its own unknown — as opposed to `"unknown"`, which
   * asserts that it *is* a date variable but cannot be decided.
   */
  resolveDate(
    variable: CriterionCode,
    operator: OperatorCode,
    conditionValue: string,
  ): Troolean | undefined {
    const view = dateViewOf(variable);
    if (!view) return undefined;
    return resolveDateCondition(view, operator, conditionValue, {
      buildNumber: this.spec.buildNumbers?.[view.group],
      dates: this.parts.dates?.[view.group],
    });
  }

  /** A copy with one criterion set — what answering a question produces. */
  with(variable: CriterionCode, value: string): VehicleContext {
    return new VehicleContext(
      { ...this.spec, criteria: { ...this.spec.criteria, [variable]: value } },
      this.parts,
    );
  }
}

/**
 * The `Dates` dataset key for one build record — and there are **two key
 * spaces**, which is not obvious from the format.
 *
 * Of the 7,028 keys, 4,080 are `PR(4) + TYPE(4)` for the vehicle, and 2,948
 * start with `or` ("organe") for the engine and gearbox:
 *
 * | Group | Key | Example |
 * | --- | --- | --- |
 * | `dveh` | `PR + TYP_` | `1132D500` |
 * | `dmot` | `"or" + MOT3 + MOTI` | `orZ6W700` |
 * | `dbvi` | `"or" + BVI3 + BVII` | `orZF6300` |
 *
 * This follows `VarFactory.getVarDate(..., S_DATE_MOT, S_MOT6)`: the engine
 * record's "type" is the `MOT6` value, which is `MOT3` and `MOTI` joined.
 * Verified against the discs — `orZ6W700`, `orZ7U730` and `orZ7U734` all
 * resolve to real records for the vehicles the envelope lists.
 *
 * Returns `undefined` when a component the key needs is unknown, so the caller
 * gets unknown rather than a lookup on a malformed key. Note `BVII` is **not**
 * an envelope field — the envelope's seven columns stop at `BVI3` — so it has
 * to come from the vehicle's criteria.
 */
export function datesKey(group: DateGroup, spec: VehicleSpec): string | undefined {
  const part = (code: CriterionCode) => {
    const v = spec.criteria[code];
    return v !== undefined && v.length > 0 ? v : undefined;
  };
  switch (group) {
    case "dveh":
      return spec.pr && spec.type ? spec.pr + spec.type : undefined;
    case "dmot": {
      const m = part("MOT3");
      const i = part("MOTI");
      return m && i ? `or${m}${i}` : undefined;
    }
    case "dbvi": {
      const b = part("BVI3");
      const i = part("BVII");
      return b && i ? `or${b}${i}` : undefined;
    }
  }
}
