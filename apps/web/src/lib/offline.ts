/**
 * Copying a tree into this browser, so it can be read with no network.
 *
 * The pure half; the OPFS calls and the reactive state are in
 * `offline.svelte.ts`. Split for the usual reason — runes need the Svelte
 * compiler and this project's vitest runs plain Node — and it matters more
 * here than most: this walks 15 GB, and "skip what is already there" and
 * "chunk a 945 MB archive" are exactly the decisions that must not be guessed
 * at.
 *
 * **Enumeration comes from `csfs-manifest.json`**, not from walking. A
 * `FileSource` has no walk — HTTP cannot list a directory, which is why that
 * manifest exists at all — and it already holds every path with its size,
 * which is also what makes skipping and progress possible.
 */

/** One file to copy. */
export interface CopyItem {
  path: string;
  size: number;
}

export interface CopyPlan {
  items: CopyItem[];
  /** Bytes the plan will read, after skipping. */
  bytes: number;
  /** Files already present at the right size. */
  skipped: number;
  /** Bytes those skipped files account for, for an honest "already done". */
  skippedBytes: number;
}

/** What a manifest gives us: path to size. */
export type Sizes = Readonly<Record<string, number>>;

/**
 * Which parts of a tree to take.
 *
 * The split is not arbitrary: on a real English set the catalogue with every
 * drawing is 0.85 GB across 642 files, and the repair documentation is 14.44
 * GB across 43,273. Offering one number for both would mean nobody could take
 * the useful 6 % without the rest.
 */
export type CopyScope = "catalogue" | "everything";

/** Repair documentation lives under `mrnt/`, and is most of the tree. */
export const isRepairDoc = (path: string): boolean => path.startsWith("/mrnt/");

/**
 * Plan a copy from a manifest's file map.
 *
 * `present` is what the destination already holds, so a cancelled copy
 * resumes rather than starting again — and a *changed* file is re-copied,
 * because a size that differs is the only evidence available that the source
 * moved on.
 */
export function planCopy(sizes: Sizes, present: Sizes, scope: CopyScope = "everything"): CopyPlan {
  const items: CopyItem[] = [];
  let bytes = 0;
  let skipped = 0;
  let skippedBytes = 0;
  for (const [path, size] of Object.entries(sizes)) {
    if (scope === "catalogue" && isRepairDoc(path)) continue;
    if (present[path] === size) {
      skipped++;
      skippedBytes += size;
      continue;
    }
    items.push({ path, size });
    bytes += size;
  }
  // Largest last. The big archives are 600–950 MB each, and finishing the 640
  // small files first means the progress bar moves early and a cancellation
  // part-way leaves a mostly useful tree rather than three archives and
  // nothing to read them with.
  items.sort((a, b) => a.size - b.size);
  return { items, bytes, skipped, skippedBytes };
}

/** Bytes per read. 8 MB keeps a 945 MB archive off the heap. */
export const CHUNK = 8 * 1024 * 1024;

/** How much of a file to read at a time, as `[start, end)` pairs. */
export function chunksOf(size: number, chunk = CHUNK): [number, number][] {
  if (size <= 0) return [];
  const out: [number, number][] = [];
  for (let at = 0; at < size; at += chunk) out.push([at, Math.min(at + chunk, size)]);
  return out;
}

export interface CopyProgress {
  /** Files finished. */
  done: number;
  total: number;
  /** Bytes written. */
  bytes: number;
  totalBytes: number;
  /** What is being copied now, for something to look at. */
  current: string;
}

export interface CopyResult {
  copied: number;
  bytes: number;
  /** Paths that failed, with why. A partial tree is still worth having. */
  failed: { path: string; reason: string }[];
  /** True when the signal stopped it. */
  cancelled: boolean;
}

/**
 * Run a plan.
 *
 * `read` and `write` are injected so this is testable without OPFS and
 * without a network — and so the same driver serves a copy from HTTP and from
 * a picked folder, which is the point: whatever you can read now, you can take
 * offline.
 *
 * A file that fails is recorded and the copy continues. Stopping at the first
 * failure would throw away an hour of work over one unreadable drawing.
 */
export async function runCopy(
  plan: CopyPlan,
  read: (path: string, start: number, end: number) => Promise<Uint8Array>,
  write: (path: string, data: ReadableStream<Uint8Array>, size: number) => Promise<void>,
  opts: {
    signal?: AbortSignal;
    onProgress?: (p: CopyProgress) => void;
    chunk?: number;
  } = {},
): Promise<CopyResult> {
  const chunk = opts.chunk ?? CHUNK;
  const failed: CopyResult["failed"] = [];
  let copied = 0;
  let bytes = 0;

  for (const item of plan.items) {
    if (opts.signal?.aborted) {
      return { copied, bytes, failed, cancelled: true };
    }
    opts.onProgress?.({
      done: copied,
      total: plan.items.length,
      bytes,
      totalBytes: plan.bytes,
      current: item.path,
    });
    try {
      // A stream rather than one buffer: the archives are 600–950 MB and
      // reading one whole would put it on the heap in full.
      const ranges = chunksOf(item.size, chunk);
      let at = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (opts.signal?.aborted) return controller.close();
          const range = ranges[at++];
          if (!range) return controller.close();
          const part = await read(item.path, range[0], range[1]);
          bytes += part.byteLength;
          controller.enqueue(part);
        },
      });
      await write(item.path, body, item.size);
      copied++;
    } catch (e) {
      failed.push({ path: item.path, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  opts.onProgress?.({
    done: copied,
    total: plan.items.length,
    bytes,
    totalBytes: plan.bytes,
    current: "",
  });
  return { copied, bytes, failed, cancelled: Boolean(opts.signal?.aborted) };
}

/**
 * Will this plan fit?
 *
 * Worth asking before starting rather than discovering hours in. A browser
 * grants a fraction of free disk and it is routinely *less than a full tree* —
 * measured at 7.52 GB in one profile against 15.30 GB of data — so a copy of
 * everything can be impossible on a machine with plenty of room.
 *
 * `available` is what the browser says is left, so the headroom is deliberate
 * rather than exact: the figure is an estimate, it moves, and OPFS writes
 * stage to a temporary file and swap on close, which briefly needs room for
 * both copies of the file in flight.
 */
export function fits(
  plan: Pick<CopyPlan, "bytes">,
  storage: { usage?: number; quota?: number },
  largestFile = 0,
): { ok: boolean; needed: number; available?: number } {
  const available = storage.quota === undefined ? undefined : storage.quota - (storage.usage ?? 0);
  // The plan's bytes, plus room for the largest single file twice over.
  const needed = plan.bytes + largestFile;
  return { ok: available === undefined || needed <= available, needed, available };
}

/**
 * A size in the units a person reads.
 *
 * There is a KB tier because the first version went straight from bytes to
 * megabytes, so 7,168 bytes rendered as "0 MB" — visibly wrong on screen, and
 * missed by tests that checked a byte-scale value and a megabyte-scale value
 * and nothing in between.
 *
 * Decimal units, matching what a disc's own figures are quoted in.
 */
export function formatBytes(n: number, locale = "en"): string {
  const round = (value: number, unit: string) =>
    `${value.toLocaleString(locale, { maximumFractionDigits: value < 10 ? 1 : 0 })} ${unit}`;
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return round(n / 1e3, "KB");
  if (n < 1e9) return round(n / 1e6, "MB");
  return `${(n / 1e9).toLocaleString(locale, { maximumFractionDigits: 2 })} GB`;
}
