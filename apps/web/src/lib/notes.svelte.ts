/**
 * Notes, as reactive state. Thin over `notes.ts`, for the reason given there.
 */
import {
  NOTES_KEY,
  merge,
  parseStoredNotes,
  sorted,
  type MergeResult,
  type PartNote,
} from "./notes.js";
import { cleanNote } from "./notes.js";

class Notes {
  private map = $state<Record<string, PartNote>>({});
  /** The reference whose note is being edited, or `undefined`. */
  editing = $state<{ ref: string; name?: string } | undefined>(undefined);

  readonly count = $derived(Object.keys(this.map).length);
  readonly all = $derived(sorted(this.map));

  constructor() {
    this.map = parseStoredNotes(read());
  }

  get(ref: string | undefined): string | undefined {
    return ref ? this.map[ref]?.text : undefined;
  }

  /** Write a note, or remove it when the text is emptied. */
  set(ref: string, text: string, now = Date.now()): void {
    const value = cleanNote(text);
    if (value === "") {
      this.remove(ref);
      return;
    }
    this.map = { ...this.map, [ref]: { ref, text: value, updated: now } };
    this.save();
  }

  remove(ref: string): void {
    if (!(ref in this.map)) return;
    const next = { ...this.map };
    delete next[ref];
    this.map = next;
    this.save();
  }

  clear(): void {
    this.map = {};
    this.save();
  }

  /** Everything, for export. */
  snapshot(): Record<string, PartNote> {
    return { ...this.map };
  }

  /** Merge an imported set in and report what happened to the user's own. */
  merge(incoming: Readonly<Record<string, PartNote>>): MergeResult {
    const result = merge(this.map, incoming);
    this.map = result.notes;
    this.save();
    return result;
  }

  private save(): void {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify({ notes: this.map }));
    } catch {
      // See `bin.svelte.ts`.
    }
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(NOTES_KEY);
  } catch {
    return null;
  }
}

export const notes = new Notes();
