/**
 * `ListeVarVal` — a PR group's value table, which is what condition operands
 * actually index into.
 *
 * From `dialogys.vehiculet.VarFactory.newHListeVal`. There are **two kinds** of
 * entry and the difference matters:
 *
 * - `TValPRMult` — literal strings stored in the group. Language-independent:
 *   its `get(referentielLangue)` ignores the argument. These are things like
 *   dimensions and thread sizes.
 * - `TValPRTrad` — *indices* into `classicvar.utf`'s value list for the same
 *   variable. Its `get` calls
 *   `classicVar.getTValeur(nomVar, tIndVal)`, so resolving one takes **two
 *   hops**: the condition's `valIndi` picks a position in this group's list,
 *   and that position holds an index into the shared vocabulary.
 *
 * Getting that indirection wrong does not throw. It silently compares against
 * the wrong label, and the parts list still looks reasonable.
 */
import type { CriterionCode } from "@dialogysx/core";
import { DataCursor } from "@dialogysx/raf";
import type { CriteriaVocabulary } from "./criteria.js";

export type ValueTable =
  | { kind: "literal"; variable: CriterionCode; values: string[] }
  | { kind: "translated"; variable: CriterionCode; indices: number[] };

/** A group's whole `ListeVarVal`, keyed by variable. */
export class GroupValues {
  private constructor(private readonly tables: Map<CriterionCode, ValueTable>) {}

  /** `VarFactory.newHListeVal` — two sections, literal then translated. */
  static parse(bytes: Uint8Array): GroupValues {
    const c = new DataCursor(bytes);
    const tables = new Map<CriterionCode, ValueTable>();

    const nbLiteral = c.i16();
    for (let i = 0; i < nbLiteral; i++) {
      const variable = c.utf();
      const nbVal = c.i16();
      const values: string[] = [];
      for (let j = 0; j < nbVal; j++) values.push(c.utf());
      tables.set(variable, { kind: "literal", variable, values });
    }

    const nbTranslated = c.i16();
    for (let i = 0; i < nbTranslated; i++) {
      const variable = c.utf();
      const nbVal = c.i16();
      const indices: number[] = [];
      for (let j = 0; j < nbVal; j++) indices.push(c.i16());
      tables.set(variable, { kind: "translated", variable, indices });
    }

    if (c.remaining !== 0) {
      throw new Error(
        `ListeVarVal: ${c.remaining} of ${bytes.length} bytes left unread — grammar mismatch`,
      );
    }
    return new GroupValues(tables);
  }

  get size(): number {
    return this.tables.size;
  }

  variables(): CriterionCode[] {
    return [...this.tables.keys()];
  }

  table(variable: CriterionCode): ValueTable | undefined {
    return this.tables.get(variable);
  }

  /**
   * `PR.getTValeur(referentielLangue, nomVar)` — the group's value list for a
   * variable, resolved to display strings.
   *
   * Needs the vocabulary only for translated tables; pass `undefined` and
   * translated variables resolve to `undefined`, exactly as `TValPRTrad.get`
   * returns null without a `classicVar`.
   */
  valuesFor(
    variable: CriterionCode,
    vocabulary?: CriteriaVocabulary,
  ): readonly string[] | undefined {
    const t = this.tables.get(variable);
    if (!t) return undefined;
    if (t.kind === "literal") return t.values;
    if (!vocabulary) return undefined;
    const criterion = vocabulary.get(variable);
    if (!criterion) return undefined;
    // Two hops: our position -> vocabulary index -> label.
    return t.indices.map((i) => criterion.values[i] ?? "");
  }
}
