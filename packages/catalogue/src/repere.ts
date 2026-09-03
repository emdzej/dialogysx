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
 *     count:uint16be || count x (repere:uint16be, x:uint16be, y:uint16be)
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

export class RepereIndex {
  constructor(private readonly raf: IndexedRAF) {}

  /** Callouts for a drawing, or `undefined` if the drawing has none on record. */
  async get(drawing: string): Promise<Repere[] | undefined> {
    const recs = await this.raf.get(repereKey(drawing));
    const first = recs?.[0];
    return first === undefined ? undefined : parseReperes(first);
  }
}
