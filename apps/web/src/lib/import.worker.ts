/**
 * A Worker, for the ordinary reason: an import writes tens of thousands of
 * files and inflates gigabytes, and on the main thread the tab would be frozen
 * for the duration.
 *
 * The pickers stay on the main thread — `showDirectoryPicker` needs a user
 * gesture — and the resulting handles are posted here, which works because
 * `FileSystemDirectoryHandle` is structured-cloneable.
 *
 * One disc per message. The wizard asks for the next ISO between rounds, so
 * this holds no loop of its own; the accumulated state travels back and forth
 * so the worker stays stateless and a reload cannot lose it.
 */
import {
  emptyState,
  executeDisc,
  identify,
  planDisc,
  STATE_FILE,
  type DiscPlan,
  type DiscProgress,
  type DiscResult,
  type DiscSource,
  type ImportState,
} from "@dialogysx/importer";
import { BrowserSourceFs, BrowserTargetFs } from "./browser-fs";

/** Inspect a disc without writing anything. */
export interface ScanRequest {
  kind: "scan";
  source: FileSystemDirectoryHandle;
  target: FileSystemDirectoryHandle;
  state: ImportState;
  components: string[];
  languages?: string[];
}

/** Carry out a plan that was already shown to the user. */
export interface RunRequest {
  kind: "run";
  source: FileSystemDirectoryHandle;
  target: FileSystemDirectoryHandle;
  state: ImportState;
  components: string[];
  languages?: string[];
}

/** Write the manifest and finish. */
export interface FinishRequest {
  kind: "finish";
  target: FileSystemDirectoryHandle;
  state: ImportState;
  /** Supplied by the caller so the worker does not invent a clock. */
  builtAt: string;
}

export type ImportRequest = ScanRequest | RunRequest | FinishRequest;

export type ImportResponse =
  | { kind: "scanned"; disc: DiscSource; plan: SerialisablePlan; state: ImportState }
  | { kind: "unrecognised" }
  | { kind: "progress"; progress: DiscProgress }
  | { kind: "done"; result: DiscResult; state: ImportState }
  | { kind: "finished"; manifest: unknown }
  | { kind: "failed"; message: string };

/**
 * A plan minus its closures.
 *
 * `DiscPlanEntry.extract.keepEntry` is a function, so a plan cannot be posted
 * as it stands. Only the summary crosses the boundary; the worker re-plans
 * before running, which is cheap next to the writing and means the plan that
 * runs is the plan the state implies rather than one that went stale while the
 * user read it.
 */
export interface SerialisablePlan {
  files: number;
  bytes: number;
  skipped: number;
  conflicts: DiscPlan["conflicts"];
  unclaimed: DiscPlan["unclaimed"];
  tally: DiscPlan["tally"];
}

function summarise(plan: DiscPlan): SerialisablePlan {
  return {
    files: plan.entries.length,
    bytes: plan.totalBytes,
    skipped: plan.skipped,
    conflicts: plan.conflicts,
    unclaimed: plan.unclaimed,
    tally: plan.tally,
  };
}

const post = (m: ImportResponse) => self.postMessage(m);

self.onmessage = async (event: MessageEvent<ImportRequest>) => {
  const req = event.data;
  try {
    if (req.kind === "finish") {
      await writeManifest(req);
      return;
    }

    const source = new BrowserSourceFs(req.source);
    const target = new BrowserTargetFs(req.target);
    const state = req.state ?? emptyState();

    // The picked directory may be the disc root or the data directory inside
    // it; `identify` looks for marker paths, so it answers both.
    const disc = await identify(source, "");
    if (!disc) {
      post({ kind: "unrecognised" });
      return;
    }

    const plan = await planDisc(source, disc, state, {
      components: req.components,
      ...(req.languages ? { languages: req.languages } : {}),
    });

    if (req.kind === "scan") {
      post({ kind: "scanned", disc, plan: summarise(plan), state });
      return;
    }

    const result = await executeDisc(source, target, plan, state, {
      onProgress: (progress) => post({ kind: "progress", progress }),
    });
    // The state is written after every disc rather than only at the end, so a
    // tab closed between discs resumes instead of starting over.
    await target.writeBytes(STATE_FILE, encode(state));
    post({ kind: "done", result, state });
  } catch (e) {
    post({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
  }
};

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");
}

/**
 * The manifest, written last.
 *
 * Deliberately the final act: HTTP cannot list a directory, so the app reads
 * this to learn which languages a tree carries. A tree without it reads as
 * incomplete, which is exactly what an abandoned import leaves behind — better
 * than one that looks finished.
 *
 * `datasets` is left empty here. The CLI fills it by opening every index and
 * counting keys; doing that in the worker would mean pulling the whole storage
 * engine in, and `dialogysx verify` reports the same thing on demand.
 */
async function writeManifest(req: FinishRequest): Promise<void> {
  const target = new BrowserTargetFs(req.target);
  const manifest = {
    manifestVersion: 1 as const,
    builtAt: req.builtAt,
    sources: Object.entries(req.state.discs).map(([label, versions]) => ({
      kind: label.split(" ")[0] ?? label,
      label,
      root: "(imported in a browser)",
      versions,
    })),
    catalogueLanguages: [...req.state.catalogueLanguages].sort(),
    repairLanguages: [...req.state.repairLanguages].sort(),
    datasets: [],
    counts: {
      files: Object.keys(req.state.written).length,
      extractedEntries: 0,
      bytes: Object.values(req.state.written).reduce((n, b) => n + b, 0),
    },
  };
  await target.writeBytes("manifest.json", encode(manifest));
  post({ kind: "finished", manifest });
}
