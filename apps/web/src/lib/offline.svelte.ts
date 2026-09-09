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
import { walkFileSystem } from "@emdzej/csfs-core";
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
      const plan = planCopy(sizes, await heldSizes(), scope);

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

      // Copied explicitly, because it cannot list itself and so is absent from
      // the plan. Without it the stored tree is readable — OPFS lists for
      // itself — but not *self-describing*, which it should be if it is ever
      // exported or served.
      const manifestBytes = await source.readAll(MANIFEST).catch(() => undefined);
      if (manifestBytes) {
        await fs.write(`/${MANIFEST}`, manifestBytes).catch(() => {});
      }

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

  /**
   * Throw the copy away.
   *
   * The namespace directory reappears immediately, empty: the `refresh()`
   * below re-opens it, and `opfsFileSystem` creates what it opens. The files
   * are gone and the usage figure drops, which is what matters — an empty
   * directory is not a leak, and chasing it would mean either not refreshing
   * afterwards or not creating on open.
   */
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

/**
 * What OPFS holds, by path, so a copy can resume.
 *
 * **Walked, not read from a manifest**, and the first version got this wrong
 * in a way that made the whole feature look broken. `csfs-manifest.json`
 * cannot appear in its own file list, so it was never in the copy plan, so it
 * was never written — and reading it back to find out what was stored then
 * found nothing. A 0.85 GB copy would finish and the interface would say
 * nothing was stored, with no way to open or delete it.
 *
 * Walking has no such circularity, and it is the better answer anyway: OPFS is
 * a real directory tree that lists itself, so this reports what is *actually*
 * there rather than what something claims. A copy interrupted half way is
 * described accurately.
 */
async function heldSizes(): Promise<Sizes> {
  const out: Record<string, number> = {};
  try {
    const fs = await opfsFileSystem({ namespace: NAMESPACE });
    for await (const entry of walkFileSystem(fs, "/")) {
      if (entry.kind !== "file") continue;
      // `entry.size` is **0 here**, and silently. A handle-based backend does
      // not learn a size from a directory listing — it has to open the file —
      // so `WalkEntry.size` is documented as 0 for backends that cannot say.
      // Taking it at face value gave "3 files · 0 B" on screen, and worse:
      // `planCopy` compares sizes, so nothing ever matched and resume quietly
      // did nothing.
      const stat = await fs.stat(entry.path);
      out[entry.path] = stat?.size ?? 0;
    }
  } catch {
    // An unreadable store is an empty one as far as planning goes.
  }
  return out;
}

async function heldInOpfs(): Promise<OfflineState> {
  const values = Object.values(await heldSizes());
  return { files: values.length, bytes: values.reduce((a, b) => a + b, 0) };
}

export const offline = new Offline();
