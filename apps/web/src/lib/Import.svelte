<script lang="ts">
  /**
   * Build a data tree from mounted discs, in the browser.
   *
   * The flow follows what the discs force: a browser cannot mount an ISO, so
   * the user mounts one, points at it, and repeats until they say there are no
   * more. Each round scans, shows what it found, writes it, and asks again.
   *
   * Two things are said out loud rather than left to be discovered. The target
   * needs *write* permission, which is a different prompt from the read-only
   * one the catalogue uses. And the manifest is written at the end, so a tree
   * abandoned half-way reads as incomplete instead of looking finished.
   */
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import HardDrive from "@lucide/svelte/icons/hard-drive";
  import X from "@lucide/svelte/icons/x";
  import Check from "@lucide/svelte/icons/check";
  import {
    COMPONENTS,
    DEFAULT_COMPONENTS,
    emptyState,
    STATE_FILE,
    type DiscProgress,
    type DiscResult,
    type DiscSource,
    type ImportState,
  } from "@dialogysx/importer";
  import type { ImportRequest, ImportResponse, SerialisablePlan } from "./import.worker";
  import ImportWorker from "./import.worker?worker";

  interface Props {
    onClose: () => void;
    /** Called with the finished tree so the app can open it straight away. */
    onFinished: (handle: FileSystemDirectoryHandle) => void;
  }
  let { onClose, onFinished }: Props = $props();

  type Stage = "target" | "disc" | "review" | "writing" | "between" | "finished";

  let stage = $state<Stage>("target");
  let target = $state<FileSystemDirectoryHandle | undefined>(undefined);
  let source = $state<FileSystemDirectoryHandle | undefined>(undefined);
  let carried = $state<ImportState>(emptyState());
  let disc = $state<DiscSource | undefined>(undefined);
  let plan = $state<SerialisablePlan | undefined>(undefined);
  let progress = $state<DiscProgress | undefined>(undefined);
  let results = $state<{ label: string; result: DiscResult }[]>([]);
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);
  let chosen = $state<Set<string>>(new Set(DEFAULT_COMPONENTS));

  const gb = (n: number) => `${(n / 1e9).toFixed(2)} GB`;
  const num = (n: number) => n.toLocaleString();

  let worker: Worker | undefined;

  function send(req: ImportRequest): Promise<ImportResponse> {
    worker ??= new ImportWorker();
    return new Promise((resolve, reject) => {
      const w = worker!;
      const onMessage = (e: MessageEvent<ImportResponse>) => {
        // Progress is a stream, not an answer: keep listening.
        if (e.data.kind === "progress") {
          progress = e.data.progress;
          return;
        }
        w.removeEventListener("message", onMessage);
        if (e.data.kind === "failed") reject(new Error(e.data.message));
        else resolve(e.data);
      };
      w.addEventListener("message", onMessage);
      w.addEventListener("error", (e) => reject(new Error(e.message)), { once: true });
      w.postMessage(req);
    });
  }

  async function pickTarget(): Promise<void> {
    error = undefined;
    const picker = globalThis.showDirectoryPicker;
    if (typeof picker !== "function") {
      error = "This browser has no File System Access API. Use the CLI importer instead.";
      return;
    }
    try {
      // `readwrite`, unlike the catalogue's read-only pick: this one writes.
      const handle = await picker({ mode: "readwrite" });
      target = handle;
      // Continue a tree this or another importer started.
      carried = (await readState(handle)) ?? emptyState();
      stage = "disc";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      error = e instanceof Error ? e.message : String(e);
    }
  }

  /** Read `.dialogysx-import.json`, so a resumed import skips what is there. */
  async function readState(handle: FileSystemDirectoryHandle): Promise<ImportState | undefined> {
    try {
      const file = await (await handle.getFileHandle(STATE_FILE)).getFile();
      const parsed = JSON.parse(await file.text()) as ImportState;
      return parsed.version === 1 ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async function pickDisc(): Promise<void> {
    error = undefined;
    const picker = globalThis.showDirectoryPicker;
    if (typeof picker !== "function") return;
    try {
      source = await picker({ mode: "read" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      error = e instanceof Error ? e.message : String(e);
      return;
    }
    busy = true;
    try {
      const res = await send({
        kind: "scan",
        source: source!,
        target: target!,
        state: carried,
        components: [...chosen],
      });
      if (res.kind === "unrecognised") {
        error =
          `Nothing recognisable in ${source!.name}. Point at the mounted disc, or at the ` +
          `directory holding dialogys/data or data/mrnt.`;
        source = undefined;
        return;
      }
      if (res.kind === "scanned") {
        disc = res.disc;
        plan = res.plan;
        stage = "review";
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function runDisc(): Promise<void> {
    error = undefined;
    stage = "writing";
    progress = undefined;
    try {
      const res = await send({
        kind: "run",
        source: source!,
        target: target!,
        state: carried,
        components: [...chosen],
      });
      if (res.kind === "done") {
        carried = res.state;
        results = [...results, { label: disc?.label ?? "disc", result: res.result }];
        stage = "between";
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      stage = "review";
    }
  }

  async function finish(): Promise<void> {
    error = undefined;
    busy = true;
    try {
      await send({
        kind: "finish",
        target: target!,
        state: carried,
        builtAt: new Date().toISOString(),
      });
      stage = "finished";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function toggle(id: string): void {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // `parts` is what makes a tree readable at all; the CLI marks it required
    // and so does this.
    for (const c of COMPONENTS) if (c.required) next.add(c.id);
    chosen = next;
  }

  const totalWritten = $derived(
    results.reduce((n, r) => n + r.result.bytesWritten, 0),
  );
  const filesWritten = $derived(
    results.reduce((n, r) => n + r.result.copied + r.result.extractedEntries, 0),
  );
  const pct = $derived(
    progress && progress.bytesTotal > 0 ? (progress.bytesDone / progress.bytesTotal) * 100 : 0,
  );
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="scrim" role="presentation">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Import from discs" data-testid="import">
    <header>
      <span class="eyebrow">Import from discs</span>
      {#if stage !== "writing"}
        <button class="close" onclick={onClose} aria-label="Close" data-testid="import-close">
          <X size={16} strokeWidth={1.9} />
        </button>
      {/if}
    </header>

    <div class="body">
      {#if error}<p class="error" data-testid="import-error">{error}</p>{/if}

      {#if stage === "target"}
        <p>
          Choose an empty folder to build the tree in. It needs <strong>write</strong> access —
          a different prompt from the read-only one the catalogue uses.
        </p>
        <p class="hint">
          Mount your ISOs first (double-click each one). You will be asked for them one at a
          time, and can stop whenever you like.
        </p>
        <div class="row">
          <button class="primary" onclick={pickTarget} data-testid="pick-target">
            <FolderOpen size={14} strokeWidth={1.9} /> Choose target folder&hellip;
          </button>
        </div>
      {:else if stage === "disc"}
        <p>
          Building in <code>{target?.name}</code>.
          {#if Object.keys(carried.written).length > 0}
            <span class="resume" data-testid="import-resume">
              {num(Object.keys(carried.written).length)} files already there — they will be skipped.
            </span>
          {/if}
        </p>

        <details class="components">
          <summary>{chosen.size} of {COMPONENTS.length} components selected</summary>
          <ul>
            {#each COMPONENTS as c (c.id)}
              <li>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.has(c.id)}
                    disabled={c.required}
                    onchange={() => toggle(c.id)}
                  />
                  <span class="cid">{c.id}</span>
                  {#if c.required}<span class="req">always</span>{/if}
                  <span class="cwhat">{c.what}</span>
                </label>
              </li>
            {/each}
          </ul>
        </details>

        <div class="row">
          <button class="primary" onclick={pickDisc} disabled={busy} data-testid="pick-disc">
            <HardDrive size={14} strokeWidth={1.9} />
            {busy ? "Scanning…" : results.length === 0 ? "Choose first disc…" : "Choose next disc…"}
          </button>
          {#if Object.keys(carried.written).length > 0}
            <button onclick={finish} disabled={busy} data-testid="no-more">No more discs</button>
          {/if}
        </div>
      {:else if stage === "review" && plan && disc}
        <p>
          <strong>{disc.kind}</strong> — {disc.label}
        </p>
        <table>
          <tbody>
            <tr><th>To write</th><td>{num(plan.files)} files, {gb(plan.bytes)}</td></tr>
            {#if plan.skipped > 0}
              <tr><th>Already there</th><td>{num(plan.skipped)} files, skipped</td></tr>
            {/if}
            {#if plan.unclaimed.length > 0}
              <!-- Reported, not copied. This is how `TM.zip`, `tarif.zip` and
                   `REACH.zip` were found in the first place. -->
              <tr>
                <th>Unclaimed</th>
                <td class="warn">
                  {num(plan.unclaimed.length)} files match no component — not copied
                </td>
              </tr>
            {/if}
            {#if plan.conflicts.length > 0}
              <tr>
                <th>Conflicts</th>
                <td class="bad" data-testid="import-conflicts">
                  {num(plan.conflicts.length)} files differ from what is already there — skipped
                </td>
              </tr>
            {/if}
          </tbody>
        </table>

        <ul class="tally">
          {#each Object.entries(plan.tally) as [id, t] (id)}
            <li>
              <span class="mark">{chosen.has(id) ? "+" : "−"}</span>
              <span class="cid">{id}</span>
              <span class="n">{num(t.files)} files</span>
              <span class="n">{gb(t.bytes)}</span>
            </li>
          {/each}
        </ul>

        <div class="row">
          <button class="primary" onclick={runDisc} data-testid="write-disc">
            Write {num(plan.files)} files
          </button>
          <button onclick={() => (stage = "disc")}>Choose a different disc</button>
        </div>
      {:else if stage === "writing"}
        <p>Writing {disc?.kind} &mdash; do not close this tab.</p>
        <div class="bar" data-testid="import-progress">
          <div class="fill" style={`width: ${pct.toFixed(1)}%`}></div>
        </div>
        <p class="mono">
          {progress ? `${num(progress.done)}/${num(progress.total)}` : "starting"}
          &middot; {progress ? gb(progress.bytesDone) : "0.00 GB"} of
          {progress ? gb(progress.bytesTotal) : "?"}
        </p>
        <p class="hint current">{progress?.current ?? ""}</p>
      {:else if stage === "between"}
        <p><Check size={14} strokeWidth={1.9} /> Written.</p>
        <ul class="results">
          {#each results as r, i (i)}
            <li>
              {r.label}: {num(r.result.copied)} copied,
              {num(r.result.extractedEntries)} extracted,
              {gb(r.result.bytesWritten)}
              {#if r.result.entryConflicts.length > 0}
                <span class="bad">
                  — {num(r.result.entryConflicts.length)} archive entries clashed
                </span>
              {/if}
            </li>
          {/each}
        </ul>
        <p class="hint">
          Mount the next ISO now if you have one. Nothing is lost by stopping: the tree is
          usable for whatever has been imported, and you can come back to it later.
        </p>
        <div class="row">
          <button class="primary" onclick={pickDisc} disabled={busy} data-testid="another-disc">
            <HardDrive size={14} strokeWidth={1.9} /> Add another disc&hellip;
          </button>
          <button onclick={finish} disabled={busy} data-testid="finish-import">
            No more data &mdash; finish
          </button>
        </div>
      {:else if stage === "finished"}
        <p><Check size={14} strokeWidth={1.9} /> Tree built in <code>{target?.name}</code>.</p>
        <p class="mono">{num(filesWritten)} files written &middot; {gb(totalWritten)}</p>
        <p class="hint">
          The manifest is written, so the app can read this tree. Run
          <code>dialogysx verify -d &lt;folder&gt;</code> if you want the indexes checked — the
          browser importer does not count keys.
        </p>
        <div class="row">
          <button
            class="primary"
            onclick={() => target && onFinished(target)}
            data-testid="open-tree">Open it now</button
          >
          <button onclick={onClose}>Close</button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(16 21 28 / 55%);
  }
  .dialog {
    width: 100%;
    max-width: 680px;
    max-height: 100%;
    overflow-y: auto;
    background: var(--card);
    border: 1px solid var(--rule);
    border-left: 3px solid var(--blue);
  }
  header {
    display: flex;
    align-items: center;
    padding: 12px 16px 8px;
  }
  .eyebrow {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .close {
    display: flex;
    margin-left: auto;
    padding: 2px;
    border: 0;
    background: none;
    color: var(--ink-faint);
    cursor: pointer;
  }
  .body {
    padding: 4px 16px 16px;
  }
  .body p {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin: 0 0 10px;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--ink-soft);
  }
  .hint {
    font-size: 11.5px;
    color: var(--ink-faint);
  }
  .current {
    font-family: var(--mono);
    min-height: 1.2em;
    word-break: break-all;
  }
  .mono {
    font-family: var(--mono);
    font-size: 11.5px;
  }
  code {
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 12px;
  }
  .row button {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--card);
    font: inherit;
    font-size: 0.8rem;
    color: var(--ink);
    cursor: pointer;
  }
  .row button.primary {
    background: var(--blue);
    border-color: var(--blue);
    color: #fff;
  }
  .row button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    margin-bottom: 10px;
  }
  th {
    text-align: left;
    font-weight: 600;
    color: var(--ink-faint);
    padding: 2px 8px 2px 0;
    white-space: nowrap;
  }
  td {
    color: var(--ink);
  }
  .warn {
    color: var(--ink-soft);
  }
  .bad {
    color: var(--red);
  }
  .resume {
    color: var(--ink-faint);
  }
  .components {
    margin: 0 0 10px;
    font-size: 12px;
  }
  .components summary {
    cursor: pointer;
    color: var(--blue);
  }
  .components ul,
  .tally,
  .results {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  .components label {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 1px 0;
  }
  .cid {
    font-family: var(--mono);
    font-size: 11px;
    min-width: 8.5rem;
  }
  .req {
    font-size: 10px;
    color: var(--red);
  }
  .cwhat {
    color: var(--ink-faint);
    font-size: 11px;
  }
  .tally li,
  .results li {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    font-size: 11.5px;
    color: var(--ink-soft);
    padding: 1px 0;
  }
  .tally .mark {
    font-family: var(--mono);
    width: 1ch;
  }
  .tally .n {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-faint);
  }
  .results {
    margin-bottom: 10px;
  }
  .bar {
    height: 6px;
    border: 1px solid var(--rule);
    border-radius: 2px;
    overflow: hidden;
    background: var(--paper);
    margin-bottom: 6px;
  }
  .fill {
    height: 100%;
    background: var(--blue);
    transition: width 120ms linear;
  }
  .error {
    padding: 6px 8px;
    color: var(--red);
    background: color-mix(in srgb, var(--red) 6%, transparent);
    border-left: 2px solid var(--red);
  }
</style>
