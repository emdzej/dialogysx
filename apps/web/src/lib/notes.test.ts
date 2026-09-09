/**
 * Notes: reading files, and merging without losing anyone's work.
 *
 * The merge is the part that matters. It runs against the user's own words,
 * which are the only thing in this application that cannot be re-derived from
 * the discs — a merge that drops a note is unrecoverable, and it would not
 * announce itself.
 */
import { describe, expect, it } from "vitest";
import {
  NOTE_LIMIT,
  cleanNote,
  merge,
  normalise,
  parseStoredNotes,
  sorted,
  toJson,
  type PartNote,
} from "./notes.js";

const note = (ref: string, text: string, updated = 0): PartNote => ({ ref, text, updated });
const set = (...notes: PartNote[]): Record<string, PartNote> =>
  Object.fromEntries(notes.map((n) => [n.ref, n]));

describe("cleanNote", () => {
  it("trims and caps", () => {
    expect(cleanNote("  M6 x 10  ")).toBe("M6 x 10");
    expect(cleanNote("x".repeat(NOTE_LIMIT + 50))).toHaveLength(NOTE_LIMIT);
  });
});

describe("normalise", () => {
  it("reads its own exported shape", () => {
    const written = toJson(set(note("A", "M6 x 10", 5)), "2026-01-01T00:00:00.000Z");
    expect(normalise(JSON.parse(written))).toEqual(set(note("A", "M6 x 10", 5)));
  });

  it("reads a plain reference-to-text map", () => {
    // What someone hand-writes, or produces from a spreadsheet. Refusing it
    // would be pedantry.
    expect(normalise({ "7701477454": "22 mm spigot" })).toEqual(
      set(note("7701477454", "22 mm spigot", 0)),
    );
  });

  it("treats a missing timestamp as no claim to being newer", () => {
    expect(normalise({ A: "text" }).A!.updated).toBe(0);
    expect(normalise({ A: { ref: "A", text: "text" } }).A!.updated).toBe(0);
  });

  it("drops what it cannot read rather than failing the whole import", () => {
    // A partial restore beats none.
    const out = normalise({
      A: "keep me",
      B: "",
      C: "   ",
      D: null,
      E: 42,
      F: { ref: "F" },
      "": "no reference",
      G: { ref: "G", text: "also keep" },
    });
    expect(Object.keys(out).sort()).toEqual(["A", "G"]);
  });

  it("returns nothing for input that is not an object", () => {
    for (const input of [null, undefined, 42, "text", true]) {
      expect(normalise(input)).toEqual({});
    }
  });

  it("does not mistake an array for a note map", () => {
    // `Object.entries` on an array yields index keys, which would import as
    // notes on references called "0" and "1".
    expect(normalise(["a", "b"])).toEqual({});
  });
});

describe("parseStoredNotes", () => {
  it("survives anything in storage", () => {
    for (const raw of [null, "", "not json", "[]", "42"]) {
      expect(parseStoredNotes(raw), JSON.stringify(raw)).toEqual({});
    }
  });

  it("round-trips through storage", () => {
    const notes = set(note("A", "M6 x 10", 7));
    expect(parseStoredNotes(JSON.stringify({ notes }))).toEqual(notes);
  });
});

describe("merge", () => {
  it("adds notes it does not have", () => {
    const r = merge(set(note("A", "mine", 1)), set(note("B", "theirs", 1)));
    expect(Object.keys(r.notes).sort()).toEqual(["A", "B"]);
    expect(r).toMatchObject({ added: 1, updated: 0, kept: 0 });
  });

  it("takes the newer of two notes on the same reference", () => {
    const r = merge(set(note("A", "old", 1)), set(note("A", "new", 2)));
    expect(r.notes.A!.text).toBe("new");
    expect(r).toMatchObject({ added: 0, updated: 1, kept: 0 });
  });

  it("keeps mine when it is newer", () => {
    // Importing a colleague's file must not roll back my own work.
    const r = merge(set(note("A", "mine", 9)), set(note("A", "theirs", 2)));
    expect(r.notes.A!.text).toBe("mine");
    expect(r).toMatchObject({ kept: 1, updated: 0 });
  });

  it("keeps mine when the import has no timestamp", () => {
    // A hand-written file cannot be shown to be newer, so it is not assumed to
    // be. This is the case that would otherwise silently overwrite real work.
    const r = merge(set(note("A", "mine", 5)), normalise({ A: "theirs" }));
    expect(r.notes.A!.text).toBe("mine");
    expect(r.kept).toBe(1);
  });

  it("keeps mine on an exact timestamp tie", () => {
    // Equal is not newer.
    const r = merge(set(note("A", "mine", 5)), set(note("A", "theirs", 5)));
    expect(r.notes.A!.text).toBe("mine");
  });

  it("never loses a reference either side holds", () => {
    const mine = set(note("A", "a", 1), note("B", "b", 9));
    const theirs = set(note("B", "b2", 1), note("C", "c", 1));
    const r = merge(mine, theirs);
    expect(Object.keys(r.notes).sort()).toEqual(["A", "B", "C"]);
    expect(r.notes.B!.text).toBe("b");
    expect(r.added + r.updated + r.kept).toBe(Object.keys(theirs).length);
  });

  it("does not mutate either side", () => {
    const mine = set(note("A", "mine", 1));
    const theirs = set(note("A", "theirs", 2));
    merge(mine, theirs);
    expect(mine.A!.text).toBe("mine");
    expect(theirs.A!.text).toBe("theirs");
  });
});

describe("sorted", () => {
  it("puts the newest first", () => {
    const out = sorted(set(note("A", "a", 1), note("B", "b", 3), note("C", "c", 2)));
    expect(out.map((n) => n.ref)).toEqual(["B", "C", "A"]);
  });

  it("falls back to the reference so the order is stable", () => {
    const out = sorted(set(note("B", "b", 0), note("A", "a", 0)));
    expect(out.map((n) => n.ref)).toEqual(["A", "B"]);
  });
});

describe("toJson", () => {
  it("writes something JSON.parse accepts", () => {
    // The BOM that makes Excel read a CSV correctly makes `JSON.parse` throw,
    // which is why the notes export must never carry one.
    const text = toJson(set(note("A", "M6 x 10", 1)), "2026-01-01T00:00:00.000Z");
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("carries a version and the timestamp it was given", () => {
    const parsed = JSON.parse(toJson({}, "2026-01-01T00:00:00.000Z"));
    expect(parsed.dialogysxNotes).toBe(1);
    expect(parsed.builtAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
