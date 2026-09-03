<script lang="ts">
  /**
   * Phase 1/2 harness, not the product.
   *
   * It exists to prove the thing `docs/plan.md` §1 claims: the same engine
   * reads a Dialogys tree over HTTP `Range` and off a local directory, with no
   * backend and no import step. Part-number lookup and the vehicle envelope
   * are enough to exercise both index depths.
   *
   * The catalogue UI proper (plates, drawings, callouts) waits on the condition
   * grammar — see `docs/plan.md` §4 Phase 3.
   */
  import type { EnvelopeRecord } from "@dialogysx/core";
  import {
    Disc,
    Envelope,
    findDataset,
    PartSearch,
    type FileSource,
    type OpenDataset,
  } from "@dialogysx/catalogue";
  import { HttpTreeSource } from "./lib/http-source";
  import { isSupported, LocalDirectorySource } from "./lib/local-source";

  let baseUrl = $state("/data");
  let status = $state("No tree opened.");
  let busy = $state(false);
  let openedFrom = $state<string | undefined>(undefined);

  let partSearch = $state<PartSearch | undefined>(undefined);
  let envelope = $state<Envelope | undefined>(undefined);

  let partQuery = $state("6001548");
  let partResults = $state<{ ref: string; groups: string[] }[]>([]);
  let partTruncated = $state(false);

  let prQuery = $state("1104");
  let envelopeRows = $state<EnvelopeRecord[]>([]);

  async function openTree(source: FileSource, label: string) {
    busy = true;
    partResults = [];
    envelopeRows = [];
    try {
      const disc = new Disc(source);
      const want = ["ref-num-pr", "envelope-pr-type", "envelope-type-pr"] as const;
      const opened = new Map<string, OpenDataset>();
      for (const id of want) {
        const spec = findDataset(id);
        if (!spec) continue;
        const d = await disc.open(spec);
        if (d) opened.set(id, d);
      }
      if (opened.size === 0) {
        status = `Nothing recognisable at ${label} — is this the dialogys/data directory?`;
        openedFrom = undefined;
        return;
      }
      const refNumPr = opened.get("ref-num-pr");
      partSearch = refNumPr ? new PartSearch(refNumPr.raf) : undefined;
      envelope = new Envelope({
        prType: opened.get("envelope-pr-type")?.raf,
        typePr: opened.get("envelope-type-pr")?.raf,
      });
      openedFrom = label;
      status =
        `Opened ${opened.size} dataset(s): ` +
        [...opened.values()]
          .map((d) => `${d.spec.id} (${d.raf.index1.count.toLocaleString()} keys)`)
          .join(", ");
    } catch (e) {
      status = `Failed to open ${label}: ${e instanceof Error ? e.message : String(e)}`;
      openedFrom = undefined;
    } finally {
      busy = false;
    }
  }

  const openHttp = () => openTree(new HttpTreeSource({ baseUrl }), baseUrl);
  const openLocal = async () => {
    try {
      await openTree(await LocalDirectorySource.pick(), "local directory");
    } catch (e) {
      status = e instanceof Error ? e.message : String(e);
    }
  };

  async function runPartSearch() {
    if (!partSearch) return;
    busy = true;
    try {
      const r = await partSearch.byPrefix(partQuery, 50);
      partResults = r.results;
      partTruncated = r.truncated;
    } catch (e) {
      status = `Part search failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }

  async function runEnvelope() {
    if (!envelope) return;
    busy = true;
    try {
      envelopeRows = await envelope.byPr(prQuery.trim());
    } catch (e) {
      status = `Envelope lookup failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }
</script>

<main>
  <header>
    <h1>dialogysx</h1>
    <p class="sub">
      Renault/Dacia parts catalogue, read client-side. This build is a format harness — it opens a
      Dialogys data tree and queries it, with no backend and no import step.
    </p>
  </header>

  <section>
    <h2>1 &middot; Open a data tree</h2>
    <div class="row">
      <label>
        Static tree URL
        <input bind:value={baseUrl} placeholder="/data" spellcheck="false" />
      </label>
      <button onclick={openHttp} disabled={busy}>Open over HTTP</button>
      <button onclick={openLocal} disabled={busy || !isSupported()}>
        Open a local folder{isSupported() ? "" : " (unsupported browser)"}
      </button>
    </div>
    <p class="status" class:ok={openedFrom !== undefined}>{status}</p>
  </section>

  <section class:disabled={!partSearch}>
    <h2>2 &middot; Part number</h2>
    <p class="sub">
      A prefix lookup in <code>refNumPr</code>, which maps each of 327,169 references to the PR
      groups containing it.
    </p>
    <div class="row">
      <input bind:value={partQuery} spellcheck="false" placeholder="6001548" />
      <button onclick={runPartSearch} disabled={busy || !partSearch}>Search</button>
    </div>
    {#if partResults.length > 0}
      <table>
        <thead><tr><th>Reference</th><th>PR groups</th></tr></thead>
        <tbody>
          {#each partResults as r (r.ref)}
            <tr><td><code>{r.ref}</code></td><td>{r.groups.join(", ")}</td></tr>
          {/each}
        </tbody>
      </table>
      {#if partTruncated}
        <p class="warn">Truncated at 50 matches — narrow the prefix to see the rest.</p>
      {/if}
    {/if}
  </section>

  <section class:disabled={!envelope}>
    <h2>3 &middot; Vehicle envelope</h2>
    <p class="sub">
      Every type, engine and gearbox combination recorded for a PR group. Exercises a depth-3 index:
      one key fans out to many records.
    </p>
    <div class="row">
      <input bind:value={prQuery} spellcheck="false" placeholder="1104" />
      <button onclick={runEnvelope} disabled={busy || !envelope}>Look up</button>
    </div>
    {#if envelopeRows.length > 0}
      <table>
        <thead>
          <tr><th>PR</th><th>Type</th><th>NEQT</th><th>EQPT</th><th>MOT3</th><th>MOTI</th><th>BVI3</th></tr>
        </thead>
        <tbody>
          {#each envelopeRows as e, i (i)}
            <tr>
              <td><code>{e.pr}</code></td><td><code>{e.type}</code></td><td>{e.neqt}</td>
              <td>{e.eqpt}</td><td>{e.mot3}</td><td>{e.moti}</td><td>{e.bvi3}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</main>

<style>
  :global(:root) {
    --bg: #fbfbfa;
    --fg: #1c1b19;
    --dim: #6b6862;
    --line: #ddd9d2;
    --accent: #8a5a2b;
    --warn: #8a2b2b;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #16150f;
      --fg: #eceae3;
      --dim: #97928a;
      --line: #302e26;
      --accent: #d9a05f;
      --warn: #e08585;
    }
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 15px/1.55 ui-sans-serif, system-ui, sans-serif;
  }
  main {
    max-width: 62rem;
    margin: 0 auto;
    padding: 2.5rem 1.25rem 5rem;
  }
  h1 {
    margin: 0;
    font-size: 1.6rem;
    letter-spacing: -0.02em;
  }
  h2 {
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--dim);
    margin: 0 0 0.5rem;
  }
  header {
    border-bottom: 1px solid var(--line);
    padding-bottom: 1.5rem;
    margin-bottom: 2rem;
  }
  .sub {
    color: var(--dim);
    margin: 0.4rem 0 0;
    max-width: 46rem;
  }
  section {
    margin-bottom: 2.5rem;
  }
  section.disabled {
    opacity: 0.45;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: flex-end;
    margin: 0.9rem 0;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8rem;
    color: var(--dim);
  }
  input {
    font: inherit;
    font-family: ui-monospace, monospace;
    padding: 0.42rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--bg);
    color: var(--fg);
    min-width: 14rem;
  }
  button {
    font: inherit;
    padding: 0.45rem 0.85rem;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: transparent;
    color: var(--fg);
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .status {
    font-size: 0.85rem;
    color: var(--dim);
    margin: 0.5rem 0 0;
  }
  .status.ok {
    color: var(--accent);
  }
  .warn {
    font-size: 0.85rem;
    color: var(--warn);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.88rem;
    margin-top: 0.75rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.32rem 0.7rem 0.32rem 0;
    border-bottom: 1px solid var(--line);
  }
  th {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--dim);
    font-weight: 600;
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.92em;
  }
</style>
