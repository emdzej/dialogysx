import { describe, expect, it } from "vitest";
import { Generations } from "./generation.js";

describe("Generations", () => {
  it("keeps the newest claim current", () => {
    const g = new Generations();
    const first = g.claim();
    expect(g.stale(first)).toBe(false);
    const second = g.claim();
    expect(g.stale(first)).toBe(true);
    expect(g.stale(second)).toBe(false);
  });

  it("lets the newer result win even when the older one finishes last", async () => {
    // The shape of the bug: two resolutions of the same plate, the older one
    // slower. Without the guard the store ends up holding the stale answer.
    const g = new Generations();
    let store = "initial";
    const settle = async (value: string, delayMs: number) => {
      const gen = g.claim();
      await new Promise((r) => setTimeout(r, delayMs));
      if (g.stale(gen)) return;
      store = value;
    };

    const slowOlder = settle("before the answer", 20);
    // Claimed second, so it wins regardless of which promise settles first.
    const fastNewer = settle("after the answer", 1);
    await Promise.all([slowOlder, fastNewer]);

    expect(store).toBe("after the answer");
  });
});
