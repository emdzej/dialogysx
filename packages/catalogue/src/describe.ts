/**
 * Rendering a condition as words.
 *
 * Lives here rather than in the interface because both the CLI and the browser
 * need it, and because doing it correctly needs three things the presentation
 * layer should not have to hold: the criterion vocabulary for labels, the PR
 * group's value table for the operands, and the knowledge that the operands are
 * *indices* rather than values.
 *
 * Getting the operands wrong is not a crash. A first cut here printed
 * `"Type moteur = or NFMO = and ..."` — every clause with its value omitted,
 * repeated across a dozen OR'd lines. It rendered, it was wrong, and it was
 * unreadable.
 */
import type { CriterionCode } from "@dialogysx/core";
import { operatorName, type CondBloc, type CondElem, type CondLign } from "./conditions.js";
import type { CriteriaVocabulary } from "./criteria.js";
import type { GroupValues } from "./values.js";

export interface DescribeOptions {
  vocabulary?: CriteriaVocabulary;
  values?: GroupValues;
  /** Use the short criterion code instead of its label. */
  codes?: boolean;
}

function nameOf(variable: CriterionCode, opts: DescribeOptions): string {
  if (opts.codes) return variable;
  const label = opts.vocabulary?.get(variable)?.label;
  return label && label.length > 0 ? label : variable;
}

/** One clause: `Type de climatisation = Air conditionné normal`. */
export function describeElem(elem: CondElem, opts: DescribeOptions = {}): string {
  const list = opts.values?.valuesFor(elem.variable, opts.vocabulary);
  const operands = elem.valueIndices.map((i) => {
    const v = list?.[i];
    // Fall back to the raw index rather than to an empty string: `X = ` reads
    // as a rendering bug, `X = #3` reads as missing data, which it is.
    return v !== undefined && v.length > 0 ? v : `#${i}`;
  });
  const rendered = operands.length > 0 ? ` ${operands.join(" | ")}` : "";
  return `${nameOf(elem.variable, opts)} ${operatorName(elem.operator)}${rendered}`;
}

/** A conjunction: clauses joined by "and". */
export function describeLign(lign: CondLign, opts: DescribeOptions = {}): string {
  if (lign.elems.length === 0) return "always";
  return lign.elems.map((e) => describeElem(e, opts)).join(" and ");
}

export interface DescribedBloc {
  /** One string per OR'd line. */
  lines: string[];
  /** A single-line form, for a table cell. */
  text: string;
}

/**
 * A whole condition.
 *
 * Returned as lines as well as a joined string because real conditions are
 * often a dozen alternatives long — one engine-block plate here has 20 — and a
 * table cell has to be able to show two and offer the rest.
 */
export function describeBloc(bloc: CondBloc, opts: DescribeOptions = {}): DescribedBloc {
  const lines = bloc.lignes.map((l) => describeLign(l, opts));
  return { lines, text: lines.length === 0 ? "never" : lines.join(" or ") };
}
