/**
 * The vehicle-criteria vocabulary: `langue/<lg>/classicvar.utf`.
 *
 * This file is load-bearing rather than cosmetic. Plate condition trees encode
 * their operands as **indices into a criterion's value list**, so without this
 * table an applicability condition cannot be evaluated at all — only displayed.
 * See `docs/data-format.md` §3.7.
 */
import type { Criterion, CriterionCode } from "@dialogysx/core";
import { decodeUtf8, splitFields, splitRecords, trimPadding } from "@dialogysx/raf";

export class CriteriaVocabulary {
  private readonly byCode: Map<CriterionCode, Criterion>;

  private constructor(criteria: readonly Criterion[]) {
    this.byCode = new Map(criteria.map((c) => [c.code, c]));
  }

  /**
   * Parse `classicvar.utf`. CR-separated, TAB-delimited, and **UTF-8** — the
   * `.utf` suffix means what it says. Reading it as cp1252 produces mojibake
   * that still parses ("Air conditionnÃ© normal"), so this is a decode that
   * fails silently if you get it wrong.
   *
   *     CODE  T  label  question  value0  value1  ...
   */
  static parse(bytes: Uint8Array): CriteriaVocabulary {
    const out: Criterion[] = [];
    for (const line of splitRecords(decodeUtf8(bytes))) {
      if (line.length === 0) continue;
      const f = splitFields(line);
      const code = f[0];
      if (code === undefined || code.length === 0) continue;
      out.push({
        code,
        kind: f[1] ?? "",
        label: (f[2] ?? "").trim(),
        question: (f[3] ?? "").trim(),
        values: f.slice(4).map((v) => v.trim()),
      });
    }
    return new CriteriaVocabulary(out);
  }

  get size(): number {
    return this.byCode.size;
  }

  get(code: CriterionCode): Criterion | undefined {
    return this.byCode.get(code) ?? this.byCode.get(trimPadding(code));
  }

  /**
   * Resolve a criterion value index to its label.
   *
   * Returns `undefined` for an out-of-range index rather than a placeholder
   * string: an index the vocabulary cannot explain means either the criterion
   * code is wrong or the condition grammar was misparsed, and both are bugs
   * worth surfacing rather than papering over.
   */
  valueLabel(code: CriterionCode, index: number): string | undefined {
    return this.get(code)?.values[index];
  }

  codes(): CriterionCode[] {
    return [...this.byCode.keys()];
  }
}
