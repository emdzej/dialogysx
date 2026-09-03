import { describe, expect, it } from "vitest";
import { Operator } from "./conditions.js";
import {
  compareBuildNumbers,
  DateBlock,
  dateViewOf,
  eventToInt,
  expandTwoDigitYear,
  formatBuildNumber,
  resolveDateCondition,
  splitBuildNumber,
  successorEvent,
} from "./dates.js";

/** Build a Dates record: header row of events, then one row per factory. */
function datesRecord(events: string[], rows: [string, ...string[]][]): Uint8Array {
  const lines = [["0202U75B", ...events].join("\t"), ...rows.map((r) => r.join("\t"))];
  return new TextEncoder().encode(lines.join("\r"));
}

describe("date views", () => {
  it("maps each variable to its group and vue", () => {
    expect(dateViewOf("NFAB")).toEqual({ group: "dveh", vue: 0 });
    expect(dateViewOf("MILL")).toEqual({ group: "dveh", vue: 1 });
    expect(dateViewOf("MFAB")).toEqual({ group: "dveh", vue: 1 });
    expect(dateViewOf("UVEH")).toEqual({ group: "dveh", vue: 2 });
    expect(dateViewOf("NFMO")).toEqual({ group: "dmot", vue: 0 });
    expect(dateViewOf("D_BV")).toEqual({ group: "dbvi", vue: 1 });
    expect(dateViewOf("AIRC")).toBeUndefined();
  });
});

describe("build numbers", () => {
  it("splits the factory letter from the number", () => {
    expect(splitBuildNumber("K0000412")).toEqual({ factory: "K", number: "0000412" });
    expect(splitBuildNumber("")).toEqual({ factory: "", number: "" });
  });

  it("pads a short number to seven digits", () => {
    expect(formatBuildNumber("412")).toBe("0000412");
    expect(formatBuildNumber("0000412")).toBe("0000412");
  });

  it("strips leading zeros only down to seven characters", () => {
    // An 8-digit number keeps its width rather than being truncated.
    expect(formatBuildNumber("00000412")).toBe("0000412");
    expect(formatBuildNumber("12345678")).toBe("12345678");
  });

  it("compares as strings, so padding is what makes ordering work", () => {
    // Unpadded, "9" would sort above "412" and the answer would invert.
    expect(compareBuildNumbers("K9", Operator.Less, "K412")).toBe(true);
    expect(compareBuildNumbers("K412", Operator.Less, "K9")).toBe(false);
  });

  it("applies every ordered operator", () => {
    expect(compareBuildNumbers("K0000412", Operator.Less, "K0000723")).toBe(true);
    expect(compareBuildNumbers("K0000412", Operator.GreaterOrEqual, "K0000001")).toBe(true);
    expect(compareBuildNumbers("K0000412", Operator.LessOrEqual, "K0000412")).toBe(true);
    expect(compareBuildNumbers("K0000412", Operator.Greater, "K0000723")).toBe(false);
    expect(compareBuildNumbers("K0000412", Operator.Equal, "K0000412")).toBe(true);
  });

  it("lets the factory letter participate in the ordering", () => {
    expect(compareBuildNumbers("A0000999", Operator.Less, "K0000001")).toBe(true);
  });
});

describe("event labels", () => {
  it("expands a two-digit year on the original's hard-coded 18 pivot", () => {
    // 17 -> 2017 but 18 -> 1918. Wrong for real 2018+ dates, and deliberately
    // preserved: it is the original's behaviour.
    expect(expandTwoDigitYear("17")).toBe(2017);
    expect(expandTwoDigitYear("18")).toBe(1918);
    expect(expandTwoDigitYear("98")).toBe(1998);
    expect(expandTwoDigitYear("05")).toBe(2005);
  });

  it("converts yymmdd to a sortable integer", () => {
    expect(eventToInt("980615")).toBe(1998 * 10000 + 6 * 100 + 15);
    expect(eventToInt("050406")).toBe(20050406);
  });

  it("treats a bare four-digit year as the previous year, mid-June", () => {
    expect(eventToInt("2005")).toBe(2004 * 10000 + 615);
  });

  it("reads yymm as the first of the month", () => {
    expect(eventToInt("0504")).toBe(20050401);
  });

  it("rolls month 00 back to the previous December", () => {
    expect(eventToInt("0500")).toBe(20041201);
  });

  it("maps the sentinel lengths to a fixed date", () => {
    expect(eventToInt("")).toBe(19801215);
    expect(eventToInt("MO0615")).toBe(19801215);
  });

  it("takes the last four characters of a seven-character label", () => {
    expect(eventToInt("XXX2005")).toBe(eventToInt("2005"));
  });

  it("rejects a length it has no rule for", () => {
    expect(() => eventToInt("123")).toThrow();
  });

  it("steps to the next event label", () => {
    expect(successorEvent("0504")).toBe("505"); // 05*100+5
    expect(successorEvent("0512")).toBe("0601"); // December rolls the year
    expect(successorEvent("2005")).toBe("2006");
    expect(successorEvent("200512")).toBe("200601");
  });
});

describe("DateBlock", () => {
  const events = ["980615", "010615", "010701", "020111"];

  it("parses the header row and one row per factory", () => {
    const b = DateBlock.parse(
      datesRecord(events, [
        ["A", "000100", "000200", "000300", "000400"],
        ["K", "000010", "000020", "000030", "000040"],
      ]),
    );
    expect(b.key).toBe("0202U75B");
    expect(b.events).toEqual(events);
    expect(b.factories).toEqual(["A", "K"]);
    expect(b.buildNumberForEvent("010701", "K")).toBe("K000030");
  });

  it("renames the $ factory to 0", () => {
    const b = DateBlock.parse(datesRecord(events, [["$", "1", "2", "3", "4"]]));
    expect(b.factories).toEqual(["0"]);
  });

  it("treats a literal 0 cell as 'after everything', not build number zero", () => {
    // Whole factory rows are zeros where that factory never built the type.
    const b = DateBlock.parse(datesRecord(events, [["A", "0", "0", "0", "0"]]));
    expect(b.buildNumberForEvent("010701", "A")).toBe("AZZZZZZ");
  });

  it("fills a gap between two populated cells with the earlier one", () => {
    const b = DateBlock.parse(datesRecord(events, [["A", "000100", "", "", "000400"]]));
    expect(b.buildNumberForEvent("010701", "A")).toBe("A000100");
  });

  it("uses 'from the start' when nothing precedes the gap", () => {
    const b = DateBlock.parse(datesRecord(events, [["A", "", "", "000300", "000400"]]));
    expect(b.buildNumberForEvent("980615", "A")).toBe("A000001");
  });

  it("uses 'after everything' when nothing follows the gap", () => {
    // The ragged rows in the real data make this the common case: a record
    // here has 945 event columns and 854 numbers.
    const b = DateBlock.parse(datesRecord(events, [["A", "000100", "000200"]]));
    expect(b.buildNumberForEvent("020111", "A")).toBe("AZZZZZZ");
  });

  it("sorts the ZZZZZZ sentinel above build numbers below 1,000,000", () => {
    // A 6-digit number pads to "0060050" and the sentinel to "0ZZZZZZ", so the
    // comparison falls to position 2 and "0" < "Z". That covers 99.98% of the
    // shipped cells.
    expect(compareBuildNumbers("A060050", Operator.Less, "AZZZZZZ")).toBe(true);
    expect(compareBuildNumbers("A060050", Operator.GreaterOrEqual, "AZZZZZZ")).toBe(false);
  });

  it("has a sentinel that FAILS at or above 1,000,000 — the original's bug, kept", () => {
    // "ZZZZZZ" is six characters, so it pads to "0ZZZZZZ" and loses at
    // position 1 to any 7-digit number. 310 of 1,681,628 shipped cells are
    // >= 1,000,000 (max 2,366,801), so this is real, not theoretical.
    // Reproduced deliberately: "fixing" it would diverge from the original
    // and there is no evidence which answer Renault's data intends.
    expect(compareBuildNumbers("A1234567", Operator.Less, "AZZZZZZ")).toBe(false);
  });

  it("returns undefined for an unknown event or factory", () => {
    const b = DateBlock.parse(datesRecord(events, [["A", "1", "2", "3", "4"]]));
    expect(b.buildNumberForEvent("999999", "A")).toBeUndefined();
    expect(b.buildNumberForEvent("010701", "Z")).toBeUndefined();
  });
});

describe("resolveDateCondition", () => {
  const dates = DateBlock.parse(
    datesRecord(["980615", "010615", "010701"], [["K", "000100", "000400", "000900"]]),
  );

  it("compares build numbers directly in vue 0", () => {
    const view = { group: "dveh", vue: 0 } as const;
    const build = { buildNumber: "K0000412" };
    expect(resolveDateCondition(view, Operator.GreaterOrEqual, "0000001", build)).toBe(true);
    expect(resolveDateCondition(view, Operator.LessOrEqual, "0000723", build)).toBe(true);
    expect(resolveDateCondition(view, Operator.LessOrEqual, "0000100", build)).toBe(false);
  });

  it("is unknown in vue 0 without a build number", () => {
    expect(
      resolveDateCondition({ group: "dveh", vue: 0 }, Operator.Less, "0000723", {}),
    ).toBe("unknown");
  });

  it("resolves an event to a build number in vue 1", () => {
    const view = { group: "dveh", vue: 1 } as const;
    const build = { buildNumber: "K000500", dates };
    // Event 010615 is build K000400; 500 >= 400.
    expect(resolveDateCondition(view, Operator.GreaterOrEqual, "010615", build)).toBe(true);
    // Event 010701 is build K000900; 500 < 900.
    expect(resolveDateCondition(view, Operator.Less, "010701", build)).toBe(true);
  });

  it("is unknown in vue 1 without the Dates record", () => {
    expect(
      resolveDateCondition({ group: "dveh", vue: 1 }, Operator.Less, "010701", {
        buildNumber: "K000500",
      }),
    ).toBe("unknown");
  });

  it("compares the factory in vue 2", () => {
    const view = { group: "dveh", vue: 2 } as const;
    const build = { buildNumber: "K0000412" };
    expect(resolveDateCondition(view, Operator.Equal, "K", build)).toBe(true);
    expect(resolveDateCondition(view, Operator.Equal, "A", build)).toBe(false);
    expect(resolveDateCondition(view, Operator.NotEqual, "A", build)).toBe(true);
    // Ordered operators are a user-facing error in the original.
    expect(resolveDateCondition(view, Operator.Less, "A", build)).toBe("unknown");
  });
});
