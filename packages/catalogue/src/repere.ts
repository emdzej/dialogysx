/**
 * Drawing callouts — `TRepere.dat`, `docs/data-format.md` §3.4.
 *
 * Joined with a plate's parts list, this is what makes a drawing clickable:
 * each callout number on the PNG gets a coordinate and a part reference.
 */
import type { Repere } from "@dialogysx/core";
import { DataCursor, encodeKey, IndexedRAF } from "@dialogysx/raf";

/** Key layout: an 8-character drawing number padded to 13 with spaces. */
export const REPERE_KEY_LENGTH = 13;

export function repereKey(drawing: string): Uint8Array {
  const key = new Uint8Array(REPERE_KEY_LENGTH).fill(0x20); // space padding
  const src = encodeKey(drawing);
  key.set(src.subarray(0, REPERE_KEY_LENGTH));
  return key;
}

/**
 * Parse a callout record:
 *
 *     count:uint16be || count x (repere:uint16be, g:uint16be, h:uint16be)
 *
 * From `TRepereFactory.newRepere`. `g` and `h` are the hotspot's **left and
 * top in image pixels**, and `Repere.contains` tests a fixed **20 x 20 box**
 * from there (`_CoteH = _CoteV = 20`). Parts drawings measure 1000 x 820, and
 * observed coordinates sit inside that — e.g. `y = 8` for callouts along the
 * top edge and `y = 786` along the bottom.
 *
 * `newRepere` stores `readShort() - 1` and `Repere.getNom()` adds it back, so
 * the **stored value is the number printed on the drawing**. That is what is
 * kept here, and it lines up with `PlateRepere.repere`, which is its 0-based
 * array position plus one.
 *
 * The declared count is checked against the record length — `2 + 6*count` must
 * match exactly, and it does for every shipped record. A mismatch means the
 * record was read at the wrong offset, which is worth failing on rather than
 * returning a plausible-looking short list.
 */
export function parseReperes(bytes: Uint8Array): Repere[] {
  const c = new DataCursor(bytes);
  const count = c.u16();
  const expected = 2 + 6 * count;
  if (bytes.length !== expected) {
    throw new Error(
      `TRepere record declares ${count} callouts (${expected} bytes) but is ${bytes.length} bytes`,
    );
  }
  const out: Repere[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ repere: c.u16(), x: c.u16(), y: c.u16() });
  }
  return out;
}

/** Hotspot size in image pixels. `Repere._CoteH` / `_CoteV`, both 20. */
export const REPERE_HOTSPOT_SIZE = 20;

/** Nominal parts-drawing size, measured on the discs. */
export const DRAWING_SIZE = { width: 1000, height: 820 } as const;

export class RepereIndex {
  constructor(private readonly raf: IndexedRAF) {}

  /** Callouts for a drawing, or `undefined` if the drawing has none on record. */
  async get(drawing: string): Promise<Repere[] | undefined> {
    const recs = await this.raf.get(repereKey(drawing));
    const first = recs?.[0];
    return first === undefined ? undefined : parseReperes(first);
  }
}
