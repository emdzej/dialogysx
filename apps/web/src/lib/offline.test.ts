/**
 * Copying a tree into the browser.
 *
 * This walks up to 15 GB, so the decisions worth testing are the ones that
 * make it survivable: skip what is already there, chunk what is too big to
 * hold, keep going when one file fails, and stop when asked.
 */
import { describe, expect, it, vi } from "vitest";
import {
  CHUNK,
  fits,
  chunksOf,
  formatBytes,
  isRepairDoc,
  planCopy,
  runCopy,
  type CopyPlan,
} from "./offline.js";

const sizes = (o: Record<string, number>) => o;

describe("planCopy", () => {
  it("takes everything by default", () => {
    const plan = planCopy(sizes({ "/pr/a": 10, "/mrnt/en/b": 20 }), {});
    expect(plan.items.map((i) => i.path).sort()).toEqual(["/mrnt/en/b", "/pr/a"]);
    expect(plan.bytes).toBe(30);
  });

  it("can leave the repair documentation out", () => {
    // Not an arbitrary split: 0.85 GB of catalogue against 14.44 GB of
    // manuals, so one figure for both would mean nobody could take the useful
    // 6 % on its own.
    const plan = planCopy(
      sizes({ "/pr/a": 10, "/mrnt/en/b": 20, "/dessins/100.zip": 5 }),
      {},
      "catalogue",
    );
    expect(plan.items.map((i) => i.path).sort()).toEqual(["/dessins/100.zip", "/pr/a"]);
    expect(plan.bytes).toBe(15);
  });

  it("skips what the destination already holds at the same size", () => {
    // This is what makes a cancelled copy resumable rather than a restart.
    const plan = planCopy(sizes({ "/a": 10, "/b": 20 }), sizes({ "/a": 10 }));
    expect(plan.items.map((i) => i.path)).toEqual(["/b"]);
    expect(plan).toMatchObject({ skipped: 1, skippedBytes: 10, bytes: 20 });
  });

  it("re-copies a file whose size changed", () => {
    // A different size is the only evidence available that the source moved
    // on; keeping the old bytes would serve a tree that is quietly wrong.
    const plan = planCopy(sizes({ "/a": 99 }), sizes({ "/a": 10 }));
    expect(plan.items).toEqual([{ path: "/a", size: 99 }]);
    expect(plan.skipped).toBe(0);
  });

  it("copies the small files first", () => {
    // The archives are 600–950 MB each. Largest-last means the progress bar
    // moves early, and cancelling part-way leaves a mostly readable tree
    // rather than three archives and nothing to read them with.
    const plan = planCopy(sizes({ "/big.zip": 900, "/tiny": 1, "/mid": 50 }), {});
    expect(plan.items.map((i) => i.path)).toEqual(["/tiny", "/mid", "/big.zip"]);
  });

  it("counts an empty plan honestly", () => {
    const plan = planCopy(sizes({ "/a": 10 }), sizes({ "/a": 10 }));
    expect(plan.items).toEqual([]);
    expect(plan).toMatchObject({ bytes: 0, skipped: 1, skippedBytes: 10 });
  });
});

describe("isRepairDoc", () => {
  it("recognises the documentation tree and nothing else", () => {
    expect(isRepairDoc("/mrnt/en/1-MR/x.pdf")).toBe(true);
    expect(isRepairDoc("/pr/Planches.dat")).toBe(false);
    // Not a prefix match on the bare word: a catalogue path could contain it.
    expect(isRepairDoc("/pr/mrnt-notes")).toBe(false);
  });
});

describe("chunksOf", () => {
  it("splits a large file into bounded reads", () => {
    // A 945 MB archive read whole would be 945 MB on the heap.
    const ranges = chunksOf(20, 8);
    expect(ranges).toEqual([
      [0, 8],
      [8, 16],
      [16, 20],
    ]);
  });

  it("covers the file exactly, with no gap or overlap", () => {
    const size = 945_715_211;
    const ranges = chunksOf(size);
    expect(ranges[0]![0]).toBe(0);
    expect(ranges.at(-1)![1]).toBe(size);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBe(ranges[i - 1]![1]);
    expect(ranges.reduce((n, [a, b]) => n + (b - a), 0)).toBe(size);
    // And no chunk exceeds the budget.
    expect(Math.max(...ranges.map(([a, b]) => b - a))).toBeLessThanOrEqual(CHUNK);
  });

  it("has nothing to do for an empty file", () => {
    expect(chunksOf(0)).toEqual([]);
  });

  it("reads a file smaller than a chunk in one go", () => {
    expect(chunksOf(5, 8)).toEqual([[0, 5]]);
  });
});

/** A destination that records what it was given. */
function destination() {
  const written = new Map<string, number>();
  const write = vi.fn(async (path: string, body: ReadableStream<Uint8Array>) => {
    let total = 0;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
    }
    written.set(path, total);
  });
  return { written, write };
}

const reader = (fail?: string) =>
  vi.fn(async (path: string, start: number, end: number) => {
    if (path === fail) throw new Error("unreadable");
    return new Uint8Array(end - start);
  });

describe("runCopy", () => {
  const plan = (items: [string, number][]): CopyPlan => ({
    items: items.map(([path, size]) => ({ path, size })),
    bytes: items.reduce((n, [, s]) => n + s, 0),
    skipped: 0,
    skippedBytes: 0,
  });

  it("copies every file, in chunks", async () => {
    const d = destination();
    const read = reader();
    const r = await runCopy(plan([["/a", 20]]), read, d.write, { chunk: 8 });
    expect(r).toMatchObject({ copied: 1, bytes: 20, cancelled: false });
    expect(d.written.get("/a")).toBe(20);
    // Three reads, not one: the point of the chunking.
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("keeps going when one file fails, and says which", async () => {
    // Stopping at the first failure would throw away an hour of copying over
    // one unreadable drawing.
    const d = destination();
    const r = await runCopy(
      plan([
        ["/a", 4],
        ["/bad", 4],
        ["/c", 4],
      ]),
      reader("/bad"),
      d.write,
      {},
    );
    expect(r.copied).toBe(2);
    expect(r.failed).toEqual([{ path: "/bad", reason: "unreadable" }]);
    expect([...d.written.keys()].sort()).toEqual(["/a", "/c"]);
  });

  it("stops when the signal is already aborted", async () => {
    const d = destination();
    const c = new AbortController();
    c.abort();
    const r = await runCopy(plan([["/a", 4]]), reader(), d.write, { signal: c.signal });
    expect(r).toMatchObject({ copied: 0, cancelled: true });
    expect(d.write).not.toHaveBeenCalled();
  });

  it("stops part-way through a plan", async () => {
    const d = destination();
    const c = new AbortController();
    const read = vi.fn(async (_p: string, start: number, end: number) => {
      c.abort();
      return new Uint8Array(end - start);
    });
    const r = await runCopy(
      plan([
        ["/a", 4],
        ["/b", 4],
      ]),
      read,
      d.write,
      { signal: c.signal },
    );
    expect(r.cancelled).toBe(true);
    // The first file finished; the second was never started.
    expect(r.copied).toBe(1);
  });

  it("reports progress with a total known before it starts", async () => {
    const seen: string[] = [];
    const totals = new Set<number>();
    await runCopy(
      plan([
        ["/a", 4],
        ["/b", 4],
      ]),
      reader(),
      destination().write,
      {
        onProgress: (p) => {
          seen.push(p.current);
          totals.add(p.totalBytes);
        },
      },
    );
    // One tick per file plus a final one, so a bar can reach the end.
    expect(seen).toEqual(["/a", "/b", ""]);
    // A single total throughout: a denominator that moves is not a denominator.
    expect([...totals]).toEqual([8]);
  });

  it("has nothing to do for an empty plan", async () => {
    const d = destination();
    const r = await runCopy(plan([]), reader(), d.write, {});
    expect(r).toMatchObject({ copied: 0, bytes: 0, cancelled: false });
    expect(d.write).not.toHaveBeenCalled();
  });
});

describe("formatBytes", () => {
  it("uses the unit a person would", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1_500_000)).toBe("1.5 MB");
    expect(formatBytes(670_089_677)).toBe("670 MB");
    expect(formatBytes(15_304_228_386)).toBe("15.3 GB");
    expect(formatBytes(852_000_000)).toBe("852 MB");
  });
});

describe("fits", () => {
  const plan = (bytes: number) => ({ bytes });

  it("refuses a plan larger than the browser will allow", () => {
    // The case this exists for, measured in a real profile: 7.52 GB granted
    // against 15.30 GB of data. A machine with plenty of disk, and a copy of
    // everything that cannot succeed.
    const r = fits(plan(15_304_228_386), { usage: 0, quota: 7_520_000_000 });
    expect(r.ok).toBe(false);
    expect(r.available).toBe(7_520_000_000);
  });

  it("allows a plan that fits", () => {
    expect(fits(plan(852_000_000), { usage: 0, quota: 7_520_000_000 }).ok).toBe(true);
  });

  it("counts what is already used", () => {
    expect(fits(plan(5_000_000_000), { usage: 4_000_000_000, quota: 7_520_000_000 }).ok).toBe(
      false,
    );
  });

  it("leaves room for the largest file twice over", () => {
    // OPFS writes stage to a temporary file and swap on close, so a 945 MB
    // archive briefly needs room for both copies. Without the headroom a plan
    // that fits on paper fails on the last archive.
    const nearly = { usage: 0, quota: 1_000_000_000 };
    expect(fits(plan(900_000_000), nearly, 0).ok).toBe(true);
    expect(fits(plan(900_000_000), nearly, 945_715_211).ok).toBe(false);
  });

  it("allows anything when the browser will not say", () => {
    // No quota reported is not a refusal: better to try and fail than to
    // block a copy that would have worked.
    expect(fits(plan(15_304_228_386), {}).ok).toBe(true);
  });
});
