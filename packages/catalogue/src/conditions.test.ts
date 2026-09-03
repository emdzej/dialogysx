import { describe, expect, it } from "vitest";
import { DataCursor } from "@dialogysx/raf";
import {
  equalsWithJoker,
  evalCondBloc,
  evalCondElem,
  evalCondLign,
  Operator,
  operatorName,
  readCondBloc,
  trooleanAnd,
  trooleanOr,
  type CondBloc,
  type ConditionContext,
} from "./conditions.js";

/** Build a condition context from a plain map of criterion -> value list. */
function ctx(
  values: Record<string, string[]>,
  vehicle: Record<string, string | undefined>,
  jokers: string[] = [],
): ConditionContext {
  return {
    criterionValue: (v) => vehicle[v],
    valuesFor: (v) => values[v],
    isJoker: (v) => jokers.includes(v),
  };
}

const elem = (variable: string, operator: number, valueIndices: number[]) => ({
  variable,
  operator,
  valueIndices,
});

describe("Troolean", () => {
  // Kleene semantics, transcribed from dialogys.conditionsfp.Troolean.
  it.each([
    [true, true, true],
    [true, false, true],
    [true, "unknown", true],
    [false, false, false],
    [false, "unknown", "unknown"],
    ["unknown", "unknown", "unknown"],
  ] as const)("or(%s, %s) = %s", (a, b, expected) => {
    expect(trooleanOr(a, b)).toBe(expected);
    expect(trooleanOr(b, a)).toBe(expected);
  });

  it.each([
    [true, true, true],
    [true, false, false],
    [true, "unknown", "unknown"],
    [false, false, false],
    [false, "unknown", false],
    ["unknown", "unknown", "unknown"],
  ] as const)("and(%s, %s) = %s", (a, b, expected) => {
    expect(trooleanAnd(a, b)).toBe(expected);
    expect(trooleanAnd(b, a)).toBe(expected);
  });

  it("lets a known true win over an unknown in OR, and false win in AND", () => {
    // This is the property that keeps a half-identified vehicle usable: one
    // satisfied line is enough, and one violated clause is enough.
    expect(trooleanOr("unknown", true)).toBe(true);
    expect(trooleanAnd("unknown", false)).toBe(false);
  });
});

describe("operator codes", () => {
  it("encodes 'not equal' as U+2260, not as a byte", () => {
    // CODE_OPER_DIFFERENT = 8800. Reading the operator as a single byte would
    // make every "≠" clause unrecognised, and CondElem's default is unknown —
    // so parts would silently become unresolvable rather than error.
    expect(Operator.NotEqual).toBe(0x2260);
    expect(operatorName(8800)).toBe("≠");
  });

  it("names the ordered operators the original defines for dates", () => {
    expect(operatorName(Operator.LessOrEqual)).toBe("≤");
    expect(operatorName(Operator.GreaterOrEqual)).toBe("≥");
  });
});

describe("evalCondElem", () => {
  const values = { AIRC: ["Chauffage normal", "Air conditionné normal"] };

  it("matches an equality against the indexed value", () => {
    const c = ctx(values, { AIRC: "Air conditionné normal" });
    expect(evalCondElem(elem("AIRC", Operator.Equal, [1]), c)).toBe(true);
    expect(evalCondElem(elem("AIRC", Operator.Equal, [0]), c)).toBe(false);
  });

  it("treats several indices as alternatives", () => {
    const c = ctx(values, { AIRC: "Chauffage normal" });
    expect(evalCondElem(elem("AIRC", Operator.Equal, [0, 1]), c)).toBe(true);
  });

  it("inverts for not-equal", () => {
    const c = ctx(values, { AIRC: "Chauffage normal" });
    expect(evalCondElem(elem("AIRC", Operator.NotEqual, [1]), c)).toBe(true);
    expect(evalCondElem(elem("AIRC", Operator.NotEqual, [0]), c)).toBe(false);
  });

  it("is unknown when the vehicle has no value for the criterion", () => {
    // The original returns `new Troolean()` here and the UI asks the user.
    // Returning false instead would hide parts that do fit.
    const c = ctx(values, {});
    expect(evalCondElem(elem("AIRC", Operator.Equal, [0]), c)).toBe("unknown");
  });

  it("is unknown when the group has no value table for the criterion", () => {
    const c = ctx({}, { AIRC: "Chauffage normal" });
    expect(evalCondElem(elem("AIRC", Operator.Equal, [0]), c)).toBe("unknown");
  });

  it("ignores an out-of-range value index instead of throwing", () => {
    // `_TValIndi[i] < tValeur.length` guards this in the original.
    const c = ctx(values, { AIRC: "Chauffage normal" });
    expect(evalCondElem(elem("AIRC", Operator.Equal, [99]), c)).toBe(false);
  });

  it("treats an informational clause as satisfied, not as a filter", () => {
    const c = ctx(values, {});
    expect(evalCondElem(elem("AIRC", Operator.Information, [0]), c)).toBe(true);
  });

  it("is unknown for an ordered operator, which belongs to date variables", () => {
    const c = ctx(values, { AIRC: "Chauffage normal" });
    expect(evalCondElem(elem("AIRC", Operator.Less, [0]), c)).toBe("unknown");
  });

  it("applies the '-' wildcard for joker variables", () => {
    const c = ctx({ TYP_: ["B53-"] }, { TYP_: "B531" }, ["TYP_"]);
    expect(evalCondElem(elem("TYP_", Operator.Equal, [0]), c)).toBe(true);
    const c2 = ctx({ TYP_: ["B53-"] }, { TYP_: "C531" }, ["TYP_"]);
    expect(evalCondElem(elem("TYP_", Operator.Equal, [0]), c2)).toBe(false);
  });
});

describe("equalsWithJoker", () => {
  it("matches the wildcard position and nothing else", () => {
    expect(equalsWithJoker("B531", "B53-")).toBe(true);
    expect(equalsWithJoker("B531", "B-31")).toBe(true);
    expect(equalsWithJoker("B531", "C53-")).toBe(false);
  });

  it("requires equal lengths", () => {
    expect(equalsWithJoker("B531", "B53")).toBe(false);
    expect(equalsWithJoker("B53", "B53-")).toBe(false);
  });
});

describe("bloc and ligne", () => {
  const values = { A: ["1", "2"], B: ["x", "y"] };

  it("ANDs the elements of a line", () => {
    const line = { elems: [elem("A", Operator.Equal, [0]), elem("B", Operator.Equal, [0])] };
    expect(evalCondLign(line, ctx(values, { A: "1", B: "x" }))).toBe(true);
    expect(evalCondLign(line, ctx(values, { A: "1", B: "y" }))).toBe(false);
  });

  it("treats an empty line as true", () => {
    // CondLign.newCondLignVraie() is exactly this.
    expect(evalCondLign({ elems: [] }, ctx(values, {}))).toBe(true);
  });

  it("ORs the lines of a bloc", () => {
    const bloc: CondBloc = {
      lignes: [
        { elems: [elem("A", Operator.Equal, [0])] },
        { elems: [elem("B", Operator.Equal, [1])] },
      ],
    };
    expect(evalCondBloc(bloc, ctx(values, { A: "1", B: "x" }))).toBe(true);
    expect(evalCondBloc(bloc, ctx(values, { A: "2", B: "y" }))).toBe(true);
    expect(evalCondBloc(bloc, ctx(values, { A: "2", B: "x" }))).toBe(false);
  });

  it("returns true from a bloc when one line is satisfied and another unknown", () => {
    const bloc: CondBloc = {
      lignes: [
        { elems: [elem("A", Operator.Equal, [0])] },
        { elems: [elem("B", Operator.Equal, [0])] }, // B unknown
      ],
    };
    expect(evalCondBloc(bloc, ctx(values, { A: "1" }))).toBe(true);
  });

  it("returns unknown from a bloc when nothing is satisfied but something is unknown", () => {
    const bloc: CondBloc = {
      lignes: [
        { elems: [elem("A", Operator.Equal, [0])] },
        { elems: [elem("B", Operator.Equal, [0])] },
      ],
    };
    expect(evalCondBloc(bloc, ctx(values, { A: "2" }))).toBe("unknown");
  });

  it("treats an empty bloc as false", () => {
    expect(evalCondBloc({ lignes: [] }, ctx(values, {}))).toBe(false);
  });
});

describe("readCondBloc", () => {
  it("round-trips the wire format", () => {
    // 1 line, 1 elem: variable "AIRC", operator '=', one value index 1.
    const bytes = new Uint8Array([
      0x00,
      0x01, // nbLign
      0x00,
      0x01, // nbElem
      0x00,
      0x04,
      0x41,
      0x49,
      0x52,
      0x43, // writeUTF "AIRC"
      0x00,
      0x3d, // operator '='
      0x00,
      0x01, // nbVal
      0x00,
      0x01, // valIndi 1
    ]);
    const bloc = readCondBloc(new DataCursor(bytes));
    expect(bloc.lignes).toHaveLength(1);
    expect(bloc.lignes[0]!.elems[0]).toEqual({
      variable: "AIRC",
      operator: 0x3d,
      valueIndices: [1],
    });
  });

  it("reads a not-equal operator as 8800", () => {
    const bytes = new Uint8Array([
      0, 1, 0, 1, 0, 1, 0x41, 0x22, 0x60, 0, 0,
      // nbLign=1 nbLign, nbElem=1, utf len 1 "A", operator 0x2260, nbVal=0
    ]);
    const bloc = readCondBloc(new DataCursor(bytes));
    expect(bloc.lignes[0]!.elems[0]!.operator).toBe(8800);
  });
});
