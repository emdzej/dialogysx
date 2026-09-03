/**
 * Part-number lookup — `refNumPr`, `docs/data-format.md` §3.3.
 *
 * 327,169 references, each mapping to the PR groups that contain it. This is
 * the index that makes "search by part number" cheap: without it, answering
 * takes a scan of all 41,758 plates.
 */
import type { PartRef, PrGroup } from "@dialogysx/core";
import { DataCursor, encodeKey, IndexedRAF } from "@dialogysx/raf";

export const PART_REF_KEY_LENGTH = 10;

/**
 * Part references are stored as a fixed 10-character key. Shorter input is a
 * prefix query; longer input cannot match.
 */
export function partRefKey(ref: PartRef): Uint8Array {
  return encodeKey(ref.trim());
}

/**
 * Parse a `refNumPr` payload: a single Java `writeUTF` string holding the PR
 * group list, e.g. `[1090]` or `[1090,1104]`.
 *
 * The brackets are part of the stored string; they are stripped here so the
 * caller gets group ids.
 */
export function parsePrGroupList(bytes: Uint8Array): PrGroup[] {
  const raw = new DataCursor(bytes).utf();
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export class PartSearch {
  constructor(private readonly raf: IndexedRAF) {}

  /** The PR groups containing an exact part reference. */
  async groupsFor(ref: PartRef): Promise<PrGroup[] | undefined> {
    const recs = await this.raf.get(partRefKey(ref));
    const first = recs?.[0];
    return first === undefined ? undefined : parsePrGroupList(first);
  }

  /**
   * Every reference starting with `prefix`, with its groups.
   *
   * `limit` exists because a one-character prefix legitimately matches tens of
   * thousands of references. When the result is truncated the caller is told,
   * rather than being handed a silently short list that looks complete.
   */
  async byPrefix(
    prefix: string,
    limit = 100,
  ): Promise<{ results: { ref: PartRef; groups: PrGroup[] }[]; truncated: boolean }> {
    const matches = await this.raf.index1.findPrefix(encodeKey(prefix.trim()));
    const truncated = matches.length > limit;
    const results: { ref: PartRef; groups: PrGroup[] }[] = [];
    for (const i of matches.slice(0, limit)) {
      const key = await this.raf.keyAt(i);
      const recs = await this.raf.recordsAt(i);
      const first = recs[0];
      results.push({
        ref: new TextDecoder("windows-1252").decode(key).trim(),
        groups: first === undefined ? [] : parsePrGroupList(first),
      });
    }
    return { results, truncated };
  }
}
