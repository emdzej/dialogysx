/**
 * The parts bin, as reactive state.
 *
 * Deliberately thin: every decision lives in `bin.ts`, which is plain
 * TypeScript and therefore testable. What is left here is the `$state`, the
 * `localStorage` round trip, and nothing else — so there is no logic in this
 * file that a test could not reach.
 *
 * The panel that renders this is `PartsBin.svelte`, not `Bin.svelte`: a
 * component named `Bin` and this module differ only in case, and on a
 * case-insensitive filesystem `./bin.svelte` then resolves to either one.
 */
import {
  BIN_KEY,
  addTo,
  lineCount,
  parseStored,
  pieceCount,
  removeFrom,
  setQuantityIn,
  type BinAddition,
  type BinEntry,
} from "./bin.js";

class Bin {
  entries = $state<BinEntry[]>([]);
  /** Whether the panel is showing. Here rather than in a component so the
      top-bar button and the panel agree without prop-drilling. */
  open = $state(false);

  readonly count = $derived(lineCount(this.entries));
  readonly pieces = $derived(pieceCount(this.entries));

  constructor() {
    this.entries = parseStored(read());
  }

  has(ref: string): boolean {
    return this.entries.some((e) => e.ref === ref);
  }

  quantityOf(ref: string): number {
    return this.entries.find((e) => e.ref === ref)?.quantity ?? 0;
  }

  add(addition: BinAddition): void {
    this.entries = addTo(this.entries, addition);
    this.save();
  }

  setQuantity(ref: string, quantity: number): void {
    this.entries = setQuantityIn(this.entries, ref, quantity);
    this.save();
  }

  remove(ref: string): void {
    this.entries = removeFrom(this.entries, ref);
    this.save();
  }

  clear(): void {
    this.entries = [];
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(BIN_KEY, JSON.stringify(this.entries));
    } catch {
      // Storage full or blocked. The bin still works for this session, which
      // is better than refusing the click.
    }
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(BIN_KEY);
  } catch {
    return null;
  }
}

export const bin = new Bin();
