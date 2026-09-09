/**
 * The copy of a tree held in this browser.
 *
 * OPFS, reached through `@emdzej/csfs-opfs`. The reason to copy into it rather
 * than keep a directory handle is that it **never prompts**: a picked folder
 * comes back after a reload but its permission does not, so "open the app and
 * it works" is not achievable that way. One copy buys silent access from then
 * on.
 *
 * Everything with a decision in it is in `offline.ts`; this holds the OPFS
 * calls, the reactive state, and the reading of the source's own manifest.
 */
import type { FileSource } from "@dialogysx/catalogue";
import { opfsFileSystem, persist, quota, clearNamespace } from "@emdzej/csfs-opfs";
import {
  fits,
  planCopy,
  runCopy,
  type CopyProgress,
  type CopyScope,
  type Sizes,
} from "./offline.js";

/** One namespace, so nothing else on this origin is disturbed. */
const NAMESPACE = "dialogysx";

/**
 * The manifest that describes a tree.
 *
 * Named here rather than imported from csfs: this is a *path within a
 * FileSource*, which addresses the tree relatively, while csfs's own constant
 * is the rooted form.
 */
const MANIFEST = "csfs-manifest.json";

export interface OfflineState {
  /** Files held, and what they weigh. */
  files: number;
  bytes: number;
}

class Offline {
  supported = $state(false);
  /** What is already held here. */
  held = $state<OfflineState>({ files: 0, bytes: 0 });
  /** Bytes used and available for this origin, when the browser will say. */
  storage = $state<{ usage?: number; quota?: number }>({});
  /** Whether the browser has promised not to evict it. */
  persisted = $state(false);
  /** Non-undefined while a copy is running. */
  progress = $state<CopyProgress | undefined>(undefined);
  /** What the last copy did, until dismissed. */
  outcome = $state<{ copied: number; failed: number; cancelled: boolean } | undefined>(undefined);
  /** Set when a copy was refused for want of room, with the figures. */
  tooBig = $state<{ needed: number; available?: number } | undefined>(undefined);
  private controller: AbortController | undefined;

  constructor() {
    this.supported = isSupported();
    if (this.supported) void this.refresh();
  }

  /** Re-read what is held and what the browser will allow. */
  async refresh(): Promise<void> {
    if (!this.supported) return;
    this.held = await heldInOpfs();
    this.storage = await quota().catch(() => ({}));
    this.persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false;
  }

  /** A file system over the copy, for reading. */
  async open() {
    return await opfsFileSystem({ namespace: NAMESPACE });
  }

  /**
   * Copy the tree that is open now into this browser.
   *
   * Works from whichever source is in use — an HTTP tree or a folder — which
   * is the point: whatever you can read, you can take offline. Enumeration is
   * the source's own `csfs-manifest.json`, because a `FileSource` cannot walk
   * and that manifest already lists every path with its size.
   */
  async copyFrom(source: FileSource, scope: CopyScope): Promise<void> {
    if (!this.supported || this.progress) return;
    this.outcome = undefined;
    this.tooBig = undefined;
    this.controller = new AbortController();
    try {
      const sizes = await manifestSizes(source);
      if (!sizes) {
        this.outcome = { copied: 0, failed: 0, cancelled: false };
        return;
      }
      const fs = await this.open();
      const plan = planCopy(sizes, (await heldSizes()) ?? {}, scope);

      // Asked before starting. A browser grants a fraction of free disk and it
      // is routinely less than a whole tree, so this is the difference between
      // a refusal now and a failure an hour in.
      await this.refresh();
      const room = fits(
        plan,
        this.storage,
        plan.items.reduce((max, i) => Math.max(max, i.size), 0),
      );
      if (!room.ok) {
        this.tooBig = { needed: room.needed, available: room.available };
        return;
      }
      this.progress = {
        done: 0,
        total: plan.items.length,
        bytes: 0,
        totalBytes: plan.bytes,
        current: "",
      };

      const result = await runCopy(
        plan,
        async (path, start, end) => {
          const bytes = await source.byteSource?.(path.replace(/^\//, ""));
          if (!bytes) throw new Error("cannot read");
          return new Uint8Array(await bytes.slice(start, end).arrayBuffer());
        },
        async (path, body) => {
          await fs.write(path, body);
        },
        {
          signal: this.controller.signal,
          onProgress: (p) => (this.progress = p),
        },
      );
      this.outcome = {
        copied: result.copied,
        failed: result.failed.length,
        cancelled: result.cancelled,
      };
      // Asked for *after* a successful copy, not before: a permission prompt
      // makes more sense once there is something worth keeping.
      if (result.copied > 0) this.persisted = await persist().catch(() => false);
    } finally {
      this.progress = undefined;
      this.controller = undefined;
      await this.refresh();
    }
  }

  cancel(): void {
    this.controller?.abort();
  }

  /** Throw the copy away. */
  async clear(): Promise<void> {
    await clearNamespace(NAMESPACE).catch(() => {});
    this.outcome = undefined;
    await this.refresh();
  }
}

function isSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
}

/** The source's manifest, as a path-to-size map. */
async function manifestSizes(source: FileSource): Promise<Sizes | undefined> {
  const bytes = await source.readAll(MANIFEST).catch(() => undefined);
  if (!bytes) return undefined;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { files?: Sizes };
    return parsed.files;
  } catch {
    return undefined;
  }
}

/** What OPFS holds, by path, so a copy can resume. */
async function heldSizes(): Promise<Sizes | undefined> {
  try {
    const fs = await opfsFileSystem({ namespace: NAMESPACE });
    const bytes = await fs.read(`/${MANIFEST}`);
    if (!bytes) return {};
    // The copy carries the manifest across, so what is held describes itself.
    // Sizes are re-checked against OPFS rather than trusted, since a cancelled
    // copy leaves the manifest claiming files it never wrote.
    const claimed = (JSON.parse(new TextDecoder().decode(bytes)) as { files?: Sizes }).files ?? {};
    const actual: Record<string, number> = {};
    for (const path of Object.keys(claimed)) {
      const stat = await fs.stat(path);
      if (stat?.kind === "file") actual[path] = stat.size;
    }
    return actual;
  } catch {
    return {};
  }
}

async function heldInOpfs(): Promise<OfflineState> {
  const sizes = (await heldSizes()) ?? {};
  const values = Object.values(sizes);
  return { files: values.length, bytes: values.reduce((a, b) => a + b, 0) };
}

export const offline = new Offline();
