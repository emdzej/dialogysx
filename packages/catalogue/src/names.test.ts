/**
 * Searching the tariff by description.
 *
 * The whole tariff is one text file, read into memory when a session opens —
 * 143,675 descriptions on a real English set — so a name search is a scan of
 * a Map and not I/O. What matters is that it matches the way a person types:
 * any case, and without the accents the descriptions carry.
 */
import { describe, expect, it } from "vitest";
import { PartNames } from "./names.js";

/**
 * A tariff, in the file's own shape and encoding.
 *
 * Encoded by hand rather than with `TextEncoder`, which emits UTF-8. The file
 * is windows-1252, and the two agree only on ASCII: `É` is the single byte
 * 0xC9 here and two bytes in UTF-8, so a `TextEncoder` fixture reaches
 * `decodeText` as `Ã‰` and the accent test passes or fails for the wrong
 * reason. Every character used below is inside Latin-1, where windows-1252 is
 * one byte per code point.
 */
function tariff(rows: [ref: string, name: string][]): PartNames {
  const text = rows.map(([ref, name]) => `${ref}\t${name}`).join("\r\n");
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new Error(`${text[i]} is outside Latin-1; the fixture cannot encode it`);
    bytes[i] = code;
  }
  return PartNames.parse(bytes);
}

const NAMES = tariff([
  ["7700000001", "BRAKE PEDAL"],
  ["7700000002", "PEDAL RUBBER"],
  ["7700000003", "CLUTCH CABLE"],
  ["7700000004", "PÉDALE D'EMBRAYAGE"],
  ["7700000005", "Bearing, wheel"],
]);

describe("PartNames.searchByName", () => {
  it("matches a substring anywhere in the description", () => {
    // Not a prefix: "pedal" has to find "BRAKE PEDAL", where the word is last.
    //
    // `PÉDALE` is in the result too, and correctly: folding the accent leaves
    // `pedale`, which contains `pedal`. A useful side effect on a tariff that
    // mixes languages — an English query reaches the French description.
    expect(NAMES.searchByName("pedal").sort()).toEqual(["7700000001", "7700000002", "7700000004"]);
  });

  it("ignores case", () => {
    expect(NAMES.searchByName("BrAkE")).toEqual(["7700000001"]);
  });

  it("ignores accents, in either direction", () => {
    // The descriptions carry accents and a keyboard often does not, so typing
    // `pedale` must find `PÉDALE`. The reverse holds too: someone who does
    // type the accent should not get fewer results.
    expect(NAMES.searchByName("pedale")).toEqual(["7700000004"]);
    expect(NAMES.searchByName("pédale")).toEqual(["7700000004"]);
  });

  it("returns nothing for an empty or blank query", () => {
    // Otherwise a cleared search box matches all 143,675 references, and each
    // one costs a plate scan downstream.
    expect(NAMES.searchByName("")).toEqual([]);
    expect(NAMES.searchByName("   ")).toEqual([]);
  });

  it("stops at the limit", () => {
    const many = tariff(
      Array.from({ length: 50 }, (_, i) => [String(i).padStart(10, "0"), `WIDGET ${i}`]),
    );
    expect(many.searchByName("widget", 10)).toHaveLength(10);
    expect(many.searchByName("widget", 999)).toHaveLength(50);
  });

  it("still resolves a reference to its name", () => {
    expect(NAMES.get("7700000005")).toBe("Bearing, wheel");
    expect(NAMES.get("  7700000005  ")).toBe("Bearing, wheel");
    expect(NAMES.get("0000000000")).toBeUndefined();
  });
});
