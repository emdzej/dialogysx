import { describe, expect, it } from "vitest";
import { Operator } from "./conditions.js";
import { describeBloc, describeElem } from "./describe.js";

const elem = (variable: string, operator: number, valueIndices: number[]) => ({
  variable,
  operator,
  valueIndices,
});

/** Minimal stand-ins; the real types come from the disc. */
const vocabulary = {
  get: (code: string) =>
    ({
      AIRC: { code, kind: "T", label: "Air conditioning", question: "", values: ["No", "Yes"] },
      // The disc really does label the engine factory "NFMO".
      UFMO: { code, kind: "T", label: "NFMO", question: "", values: ["$", "F"] },
      NFMO: {
        code,
        kind: "T",
        label: "Engine fabrication number",
        question: "",
        values: ["0000001"],
      },
    })[code],
} as never;

const values = {
  valuesFor: (v: string) => ({ AIRC: ["No", "Yes"], UFMO: ["$", "F"], NFMO: ["0000001"] })[v],
} as never;

describe("describeElem", () => {
  it("renders the operand, not just the operator", () => {
    // A first cut omitted operands entirely and produced "Air conditioning =",
    // which rendered fine and said nothing.
    expect(describeElem(elem("AIRC", Operator.Equal, [1]), { vocabulary, values })).toBe(
      "Air conditioning = Yes",
    );
  });

  it("joins several operands as alternatives", () => {
    expect(describeElem(elem("AIRC", Operator.Equal, [0, 1]), { vocabulary, values })).toBe(
      "Air conditioning = No | Yes",
    );
  });

  it("shows a missing operand as its index rather than as nothing", () => {
    expect(describeElem(elem("AIRC", Operator.Equal, [9]), { vocabulary, values })).toBe(
      "Air conditioning = #9",
    );
  });

  it("overrides the factory variables, which the vocabulary mislabels", () => {
    // classicvar gives UFMO the label "NFMO" — the code of a *different*
    // variable that appears in the same conditions.
    expect(describeElem(elem("UFMO", Operator.Equal, [0]), { vocabulary, values })).toBe(
      "Engine factory = $",
    );
    expect(describeElem(elem("NFMO", Operator.LessOrEqual, [0]), { vocabulary, values })).toBe(
      "Engine fabrication number ≤ 0000001",
    );
  });

  it("falls back to the code when there is no vocabulary", () => {
    expect(describeElem(elem("XYZ_", Operator.Equal, []), {})).toBe("XYZ_ =");
  });
});

describe("describeBloc", () => {
  it("returns one line per alternative as well as a joined form", () => {
    const bloc = {
      lignes: [
        { elems: [elem("AIRC", Operator.Equal, [0])] },
        { elems: [elem("AIRC", Operator.Equal, [1])] },
      ],
    };
    const d = describeBloc(bloc, { vocabulary, values });
    expect(d.lines).toEqual(["Air conditioning = No", "Air conditioning = Yes"]);
    expect(d.text).toBe("Air conditioning = No or Air conditioning = Yes");
  });

  it("calls an empty bloc never, matching the evaluator", () => {
    expect(describeBloc({ lignes: [] }).text).toBe("never");
  });

  it("calls an empty line always, matching the evaluator", () => {
    expect(describeBloc({ lignes: [{ elems: [] }] }).text).toBe("always");
  });
});
