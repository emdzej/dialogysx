/**
 * Notes on part references. Pure logic; the store is in `notes.svelte.ts`.
 *
 * `7701477454` is `ENGINE TYPE XXX-X` in the tariff, which does not tell you
 * it is the one with the 22 mm spigot. That knowledge comes from having had the
 * part in your hand, the catalogue has nowhere to put it, and it is exactly
 * what you want the next time the number comes up.
 *
 * Keyed by reference and deliberately **not** scoped to a model or a plate: the
 * same reference appears across many plates, and a note that only showed up
 * where it was written would be worth much less.
 *
 * These are the user's own words and the only copy is this browser's
 * `localStorage`, which a cleared cache takes with it. Hence import and export:
 * notes are the one thing here worth backing up, because everything else can be
 * re-derived from the discs.
 */

export interface PartNote {
  ref: string;
  text: string;
  /** Milliseconds, stamped on write. Carried through export so a merge can pick. */
  updated: number;
}

export const NOTES_KEY = "dialogysx.notes.v1";

/** Long enough for a real description, short enough not to become a document. */
export const NOTE_LIMIT = 500;

export const cleanNote = (text: string): string => text.trim().slice(0, NOTE_LIMIT);

/**
 * Accept anything shaped like notes, from storage or from an imported file.
 *
 * Two shapes are read: the object this writes (`{ notes: { … } }`), and a plain
 * `{ "7701477454": "text" }` map — because that is what someone will hand-write
 * or produce from a spreadsheet, and refusing it would be pedantry. Anything
 * else in the file is dropped rather than failing the whole import: a partial
 * restore beats none.
 */
export function normalise(input: unknown): Record<string, PartNote> {
  // Arrays are rejected explicitly. An array *is* an object, and
  // `Object.entries(["a","b"])` yields `[["0","a"],["1","b"]]` — so a JSON
  // array would import as notes on references called "0" and "1". Plausible
  // input, silent garbage.
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const wrapped = (input as { notes?: unknown }).notes;
  const source = (
    typeof wrapped === "object" && wrapped !== null && !Array.isArray(wrapped) ? wrapped : input
  ) as Record<string, unknown>;

  const out: Record<string, PartNote> = {};
  for (const [ref, value] of Object.entries(source)) {
    if (!ref) continue;
    const text = typeof value === "string" ? value : (value as PartNote | undefined)?.text;
    if (typeof text !== "string" || cleanNote(text) === "") continue;
    const stamp = (value as PartNote | undefined)?.updated;
    out[ref] = {
      ref,
      text: cleanNote(text),
      // No timestamp means no claim to being newer; see `merge`.
      updated: typeof value === "object" && Number.isFinite(stamp) ? stamp! : 0,
    };
  }
  return out;
}

export function parseStoredNotes(raw: string | null): Record<string, PartNote> {
  if (!raw) return {};
  try {
    return normalise(JSON.parse(raw));
  } catch {
    return {};
  }
}

export interface MergeResult {
  notes: Record<string, PartNote>;
  added: number;
  updated: number;
  kept: number;
}

/**
 * Merge an imported set into the current one, newest wins.
 *
 * Merge rather than replace: importing a colleague's notes should not discard
 * your own. Where both hold a note for one reference the later `updated` wins,
 * and an imported note with no timestamp loses to anything local — it cannot be
 * shown to be newer, so it is not assumed to be.
 *
 * The counts are reported because a silent merge is untrustworthy: "added 3,
 * updated 1, kept 12" tells the user what happened to their own notes.
 */
export function merge(
  current: Readonly<Record<string, PartNote>>,
  incoming: Readonly<Record<string, PartNote>>,
): MergeResult {
  const notes: Record<string, PartNote> = { ...current };
  let added = 0;
  let updated = 0;
  let kept = 0;
  for (const [ref, note] of Object.entries(incoming)) {
    const mine = notes[ref];
    if (!mine) {
      notes[ref] = note;
      added++;
    } else if (note.updated > mine.updated) {
      notes[ref] = note;
      updated++;
    } else {
      kept++;
    }
  }
  return { notes, added, updated, kept };
}

/** Newest first, which is the order someone reviewing them wants. */
export function sorted(notes: Readonly<Record<string, PartNote>>): PartNote[] {
  return Object.values(notes).sort((a, b) => b.updated - a.updated || a.ref.localeCompare(b.ref));
}

/**
 * Notes as a file.
 *
 * Wrapped in an object with a version rather than written as a bare map, so a
 * future shape change can be detected instead of guessed at. `normalise` reads
 * both, so an older export still imports.
 */
export function toJson(notes: Readonly<Record<string, PartNote>>, builtAt: string): string {
  return JSON.stringify({ dialogysxNotes: 1, builtAt, notes }, null, 2) + "\n";
}
