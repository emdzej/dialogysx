/**
 * The parts bin's logic.
 *
 * Testable because it is separate from the store: runes need the Svelte
 * compiler and this suite runs plain Node. Everything here fails quietly and
 * everything here reaches a printed pick list or a spreadsheet, which is the
 * argument for testing it rather than the store's plumbing.
 */
import { describe, expect, it } from "vitest";
import {
  BIN_LIMIT,
  CSV_COLUMNS,
  addTo,
  clampQuantity,
  lineCount,
  parseStored,
  pieceCount,
  removeFrom,
  setQuantityIn,
  toCsv,
  type BinAddition,
  type BinEntry,
  type CsvColumn,
} from "./bin.js";

const part = (ref: string, over: Partial<BinAddition> = {}): BinAddition => ({
  ref,
  name: `PART ${ref}`,
  quantity: 1,
  ...over,
});

const HEADERS = Object.fromEntries(CSV_COLUMNS.map((c) => [c, c.toUpperCase()])) as Record<
  CsvColumn,
  string
>;

describe("clampQuantity", () => {
  it("keeps whole pieces, at least one", () => {
    expect(clampQuantity(3)).toBe(3);
    expect(clampQuantity(2.4)).toBe(2);
    // A line for zero of something is not a line, and the user asked for the
    // part, so nothing below one is honoured.
    expect(clampQuantity(0)).toBe(1);
    expect(clampQuantity(-5)).toBe(1);
  });

  it("survives what a text input actually produces", () => {
    // The quantity field is an input; these are the values it hands back.
    expect(clampQuantity(Number("") || 1)).toBe(1);
    expect(clampQuantity(Number.NaN)).toBe(1);
    expect(clampQuantity(Number("abc") || 1)).toBe(1);
    expect(clampQuantity(Number.POSITIVE_INFINITY)).toBe(9999);
  });
});

describe("addTo", () => {
  it("adds a new reference", () => {
    const bin = addTo([], part("7701477454"));
    expect(bin).toHaveLength(1);
    expect(bin[0]).toMatchObject({ ref: "7701477454", quantity: 1, added: 0 });
  });

  it("raises the quantity of a reference already there", () => {
    // Adding the same number twice means two of them, not two lines.
    let bin = addTo([], part("7701477454", { quantity: 2 }));
    bin = addTo(bin, part("7701477454", { quantity: 3 }));
    expect(bin).toHaveLength(1);
    expect(bin[0]!.quantity).toBe(5);
  });

  it("keeps the first line's provenance when the quantity rises", () => {
    // Where the part was *found* is the useful record; the second sighting is
    // the same bolt on another plate.
    let bin = addTo([], part("7701477454", { plate: "N100812", assembly: "1010A" }));
    bin = addTo(bin, part("7701477454", { plate: "N372510", assembly: "3737A" }));
    expect(bin[0]).toMatchObject({ plate: "N100812", assembly: "1010A", quantity: 2 });
  });

  it("keeps insertion order stable as quantities change", () => {
    // The list must not reshuffle under the cursor while someone edits it.
    let bin = addTo(addTo(addTo([], part("A")), part("B")), part("C"));
    bin = setQuantityIn(bin, "A", 9);
    expect(bin.map((e) => e.ref)).toEqual(["A", "B", "C"]);
    bin = addTo(bin, part("B", { quantity: 4 }));
    expect(bin.map((e) => e.ref)).toEqual(["A", "B", "C"]);
  });

  it("gives each new line an order past every existing one", () => {
    let bin = addTo(addTo([], part("A")), part("B"));
    bin = removeFrom(bin, "A");
    bin = addTo(bin, part("C"));
    // Not reusing 0: `added` has to keep increasing or a re-added line could
    // sort ahead of one that was there first.
    expect(bin.map((e) => e.added)).toEqual([1, 2]);
  });

  it("stops at the limit rather than growing without bound", () => {
    let bin: BinEntry[] = [];
    for (let i = 0; i < BIN_LIMIT + 10; i++) bin = addTo(bin, part(`R${i}`));
    expect(bin).toHaveLength(BIN_LIMIT);
    // But an existing line can still be raised: the cap is on lines, not use.
    const raised = addTo(bin, part("R0", { quantity: 2 }));
    expect(raised.find((e) => e.ref === "R0")!.quantity).toBe(3);
  });
});

describe("counts", () => {
  it("separates lines from pieces", () => {
    // Lines is what the list shows; pieces is what gets ordered.
    const bin = addTo(addTo([], part("A", { quantity: 2 })), part("B", { quantity: 3 }));
    expect(lineCount(bin)).toBe(2);
    expect(pieceCount(bin)).toBe(5);
  });
});

describe("parseStored", () => {
  it("reads back what it wrote", () => {
    const bin = addTo([], part("7701477454", { quantity: 4, plate: "N100812" }));
    expect(parseStored(JSON.stringify(bin))).toEqual(bin);
  });

  it("returns an empty bin for anything unreadable", () => {
    // Losing the bin is bad; a page that will not load is worse.
    for (const raw of [null, "", "not json", "{}", '"a string"', "42", "[1,2,3]"]) {
      expect(parseStored(raw), JSON.stringify(raw)).toEqual([]);
    }
  });

  it("drops lines with no reference", () => {
    const raw = JSON.stringify([
      { ref: "", quantity: 1 },
      { quantity: 1 },
      { ref: "A", quantity: 1 },
    ]);
    expect(parseStored(raw).map((e) => e.ref)).toEqual(["A"]);
  });

  it("repairs a quantity that storage should not have held", () => {
    // This is user-editable storage. Without the clamp, `"3"` reaches the CSV
    // as a string and `NaN` prints as blank on the pick list.
    const raw = JSON.stringify([
      { ref: "A", quantity: "3" },
      { ref: "B", quantity: null },
      { ref: "C", quantity: -2 },
      { ref: "D", quantity: 1e9 },
    ]);
    expect(parseStored(raw).map((e) => e.quantity)).toEqual([3, 1, 1, 9999]);
  });

  it("gives an order to a line written before there was one", () => {
    const raw = JSON.stringify([
      { ref: "A", quantity: 1 },
      { ref: "B", quantity: 1 },
    ]);
    expect(parseStored(raw).map((e) => e.added)).toEqual([0, 1]);
  });

  it("truncates beyond the limit", () => {
    const raw = JSON.stringify(
      Array.from({ length: BIN_LIMIT + 50 }, (_, i) => ({ ref: `R${i}`, quantity: 1 })),
    );
    expect(parseStored(raw)).toHaveLength(BIN_LIMIT);
  });
});

describe("toCsv", () => {
  it("quotes every field, always", () => {
    const csv = toCsv(addTo([], part("A", { name: "BOLT" })), HEADERS);
    const [header, row] = csv.trimEnd().split("\r\n");
    expect(header!.startsWith('"REF","NAME"')).toBe(true);
    expect(row!.startsWith('"A","PART A"')).toBe(false); // name was overridden
    expect(row).toContain('"BOLT"');
  });

  it("survives a comma in a part name", () => {
    // `GASKET, FUEL FILLER NECK` is the norm, not the exception. Unquoted this
    // silently shifts every later column by one.
    const csv = toCsv(addTo([], part("A", { name: "GASKET, FUEL FILLER NECK" })), HEADERS);
    expect(csv).toContain('"GASKET, FUEL FILLER NECK"');
    expect(csv.trimEnd().split("\r\n")[1]!.split('","')).toHaveLength(CSV_COLUMNS.length);
  });

  it("doubles an embedded quote, per RFC 4180", () => {
    const csv = toCsv(addTo([], part("A", { name: 'SEAL 1/2"' })), HEADERS);
    expect(csv).toContain('"SEAL 1/2"""');
  });

  it("uses CRLF, because a parts desk is a Windows desk", () => {
    const csv = toCsv(addTo([], part("A")), HEADERS);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.includes("\n\r")).toBe(false);
    // Exactly one row plus one header.
    expect(csv.trimEnd().split("\r\n")).toHaveLength(2);
  });

  it("marks an undecided line as one to confirm", () => {
    const bin = addTo(addTo([], part("A")), part("B", { undecided: true }));
    const rows = toCsv(bin, HEADERS, { confirmWord: "check" }).trimEnd().split("\r\n");
    expect(rows[1]).not.toContain('"check"');
    expect(rows[2]).toContain('"check"');
  });

  it("joins notes in without the bin knowing about them", () => {
    const csv = toCsv(addTo([], part("A")), HEADERS, {
      note: (ref) => (ref === "A" ? "M6x10" : undefined),
    });
    expect(csv).toContain('"M6x10"');
  });

  it("writes a header even for an empty bin", () => {
    // A file with no header is not a spreadsheet, it is an empty file.
    const csv = toCsv([], HEADERS);
    expect(csv.trimEnd().split("\r\n")).toHaveLength(1);
    expect(csv).toContain('"REF"');
  });

  it("keeps cells aligned with the declared columns", () => {
    // The header and the row are built from the same list, so a column added
    // to one cannot go missing from the other.
    const csv = toCsv(addTo([], part("A")), HEADERS)
      .trimEnd()
      .split("\r\n");
    const cells = (line: string) => line.split(",").length;
    expect(cells(csv[0]!)).toBe(CSV_COLUMNS.length);
    expect(cells(csv[1]!)).toBe(CSV_COLUMNS.length);
  });
});
