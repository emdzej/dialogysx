<script lang="ts">
  /**
   * dialogysx — parts catalogue browser.
   *
   * Navigation follows the data, not a designer's idea of it: PR group ->
   * vehicle -> assembly -> plate, because that is the chain the catalogue
   * actually encodes. The drawing number only exists on the assembly record, so
   * you cannot render a plate without having walked through one.
   */
  import type { OrganePlate, VehicleSpec } from "@dialogysx/catalogue";
  import Drawing from "./lib/Drawing.svelte";
  import PartsList from "./lib/PartsList.svelte";
  import { HttpTreeSource } from "./lib/http-source";
  import { isSupported, LocalDirectorySource, revokeImageUrl } from "./lib/local-source";
  import { app } from "./lib/state.svelte";

  let baseUrl = $state("/data");

  const openHttp = () => app.open(new HttpTreeSource({ baseUrl }), baseUrl);
  const openLocal = async () => {
    try {
      await app.open(await LocalDirectorySource.pick(), "local folder");
    } catch (e) {
      app.status = { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  };

  // The drawing URL is async and backend-specific, so it is resolved here and
  // the previous blob revoked when it changes.
  let imageSrc = $state<string | undefined>(undefined);
  $effect(() => {
    const path = app.plate?.drawingPath;
    const source = app.session?.source;
    let stale = false;
    let mine: string | undefined;
    (async () => {
      const next = path && source?.imageUrl ? await source.imageUrl(path) : undefined;
      if (stale) {
        revokeImageUrl(next);
        return;
      }
      mine = next;
      imageSrc = next;
    })();
    return () => {
      stale = true;
      revokeImageUrl(mine);
    };
  });

  function vehicleLabel(v: VehicleSpec): string {
    const c = v.criteria;
    return [c.TYP_, c.EQPT, c.MOT3, c.MOTI, c.BVI3].filter(Boolean).join(" · ");
  }

  function plateLabel(p: OrganePlate): string {
    return p.plate;
  }
</script>

<main>
  <header>
    <div class="title">
      <h1>dialogysx</h1>
      <span class="tagline">Renault / Dacia parts catalogue</span>
    </div>
    <div class="open">
      <input bind:value={baseUrl} spellcheck="false" aria-label="Static tree URL" />
      <button onclick={openHttp}>Open URL</button>
      <button onclick={openLocal} disabled={!isSupported()}>Open folder</button>
    </div>
  </header>

  {#if app.status.kind !== "ready"}
    <section class="splash">
      {#if app.status.kind === "idle"}
        <p>
          Point this at a data tree — a URL served with <code>Range</code> support, or a folder on
          this machine. Build one with <code>dialogysx import</code>.
        </p>
      {:else if app.status.kind === "loading"}
        <p class="working">{app.status.what}&hellip;</p>
      {:else if app.status.kind === "error"}
        <p class="error">{app.status.message}</p>
      {/if}
    </section>
  {:else}
    <div class="chrome">
      <span class="src">{app.status.from}</span>
      <span class="counts">{app.groups.length} PR groups</span>
    </div>

    <div class="layout">
      <nav>
        <section>
          <h2>PR group</h2>
          <ul class="scroll" data-testid="groups">
            {#each app.groups as g (g)}
              <li>
                <button class:sel={app.group === g} onclick={() => app.selectGroup(g)}>{g}</button>
              </li>
            {/each}
          </ul>
        </section>

        {#if app.group}
          <section>
            <h2>Vehicle</h2>
            {#if app.vehicles.length === 0}
              <p class="none">No envelope rows for this group.</p>
            {:else}
              <ul class="scroll" data-testid="vehicles">
                {#each app.vehicles as v, i (i)}
                  <li>
                    <button class:sel={app.vehicle === v} onclick={() => app.selectVehicle(v)}>
                      {vehicleLabel(v)}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>

          <section>
            <h2>Assembly</h2>
            <ul class="scroll" data-testid="assemblies">
              {#each app.assemblies as a (a)}
                <li>
                  <button class:sel={app.assembly === a} onclick={() => app.selectAssembly(a)}>
                    {a}
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if app.assembly}
          <section>
            <h2>Plate</h2>
            {#if !app.vehicle}
              <p class="none">Pick a vehicle first — the plate list is filtered by it.</p>
            {:else if app.assemblyPlates.length === 0 && app.assemblyUnknown.length === 0}
              <p class="none">No plates for this vehicle.</p>
            {:else}
              <ul data-testid="plates">
                {#each app.assemblyPlates as p (p.raw)}
                  <li>
                    <button class:sel={app.plate?.plate === p.plate} onclick={() => app.selectPlate(p)}>
                      {plateLabel(p)}
                    </button>
                  </li>
                {/each}
                {#each app.assemblyUnknown as p (p.raw)}
                  <li>
                    <button
                      class="maybe"
                      class:sel={app.plate?.plate === p.plate}
                      onclick={() => app.selectPlate(p)}
                      title="Applicability undecided for this vehicle"
                    >
                      {plateLabel(p)} <span class="q">?</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}
      </nav>

      <div class="content">
        {#if !app.plate}
          <p class="hint">
            {#if !app.group}
              Choose a PR group to begin.
            {:else if !app.vehicle}
              Choose a vehicle. Applicability is evaluated against it, so nothing is filtered
              until one is picked.
            {:else if !app.assembly}
              Choose an assembly.
            {:else}
              Choose a plate.
            {/if}
          </p>
        {:else}
          <div class="platehead">
            <h2 class="platekey" data-testid="plate-key">{app.plate.key}</h2>
            <span class="meta">
              drawing {app.plate.drawing ?? "—"} ·
              {app.plate.reperes.length} callouts
            </span>
          </div>

          {#if app.plate.questions.length > 0}
            <div class="questions" data-testid="questions">
              <strong>Undecided.</strong> These criteria would settle the parts marked
              <em>undecided</em> below:
              {#each app.plate.questions as q (q)}
                <span class="qtag" title={app.vocabulary?.get(q)?.question ?? q}>
                  {app.vocabulary?.get(q)?.label || q}
                </span>
              {/each}
            </div>
          {/if}

          <div class="split">
            <Drawing
              src={imageSrc}
              reperes={app.plate.reperes}
              active={app.activeRepere}
              onHover={(r) => app.hover(r)}
              onPin={(r) => app.pin(r)}
            />
            <div class="parts">
              <PartsList
                plate={app.plate}
                active={app.activeRepere}
                onHover={(r) => app.hover(r)}
                onPin={(r) => app.pin(r)}
              />
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</main>

<style>
  :global(:root) {
    --bg: #fbfbfa;
    --panel: #f4f3f0;
    --fg: #1c1b19;
    --dim: #6b6862;
    --line: #ddd9d2;
    --accent: #8a5a2b;
    --warn: #9a4a20;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #16150f;
      --panel: #1e1d16;
      --fg: #eceae3;
      --dim: #97928a;
      --line: #302e26;
      --accent: #d9a05f;
      --warn: #e0a070;
    }
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
  }
  main {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--line);
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  h1 {
    margin: 0;
    font-size: 1.05rem;
    letter-spacing: -0.01em;
  }
  .tagline {
    color: var(--dim);
    font-size: 0.8rem;
  }
  .open {
    display: flex;
    gap: 0.4rem;
  }
  input {
    font: inherit;
    font-family: ui-monospace, monospace;
    font-size: 0.82rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: 3px;
    background: var(--bg);
    color: var(--fg);
    width: 12rem;
  }
  button {
    font: inherit;
    font-size: 0.82rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: 3px;
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
  .splash {
    padding: 3rem 1.25rem;
    max-width: 40rem;
  }
  .splash p {
    color: var(--dim);
  }
  .error {
    color: var(--warn);
  }
  .working::after {
    content: "";
  }
  .chrome {
    display: flex;
    gap: 1rem;
    padding: 0.3rem 1rem;
    font-size: 0.75rem;
    color: var(--dim);
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .src {
    font-family: ui-monospace, monospace;
  }
  .layout {
    display: grid;
    grid-template-columns: 15rem 1fr;
    flex: 1;
    min-height: 0;
  }
  nav {
    border-right: 1px solid var(--line);
    background: var(--panel);
    overflow-y: auto;
    padding-bottom: 2rem;
  }
  nav section {
    border-bottom: 1px solid var(--line);
    padding: 0.6rem 0.75rem;
  }
  h2 {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--dim);
    margin: 0 0 0.35rem;
    font-weight: 600;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
  }
  .scroll {
    max-height: 11rem;
    overflow-y: auto;
  }
  li button {
    font-family: ui-monospace, monospace;
    font-size: 0.76rem;
    padding: 0.15rem 0.4rem;
    border-color: transparent;
  }
  li button:hover {
    background: var(--bg);
  }
  li button.sel {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  li button.maybe {
    color: var(--warn);
  }
  li button.maybe.sel {
    color: var(--bg);
  }
  .q {
    opacity: 0.8;
  }
  .none {
    font-size: 0.76rem;
    color: var(--dim);
    margin: 0;
  }
  .content {
    padding: 1rem 1.25rem 3rem;
    overflow-y: auto;
    min-width: 0;
  }
  .hint {
    color: var(--dim);
    max-width: 32rem;
  }
  .platehead {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  .platekey {
    font-family: ui-monospace, monospace;
    font-size: 1rem;
    text-transform: none;
    letter-spacing: 0;
    color: var(--fg);
    margin: 0;
  }
  .meta {
    font-size: 0.76rem;
    color: var(--dim);
    font-family: ui-monospace, monospace;
  }
  .questions {
    border-left: 2px solid var(--warn);
    padding: 0.4rem 0.7rem;
    margin-bottom: 0.9rem;
    font-size: 0.8rem;
    color: var(--dim);
    background: color-mix(in srgb, var(--warn) 7%, transparent);
  }
  .questions strong {
    color: var(--warn);
  }
  .qtag {
    display: inline-block;
    font-size: 0.74rem;
    padding: 0.05rem 0.35rem;
    margin: 0.1rem 0.15rem 0 0;
    border: 1px solid var(--line);
    border-radius: 2px;
    background: var(--bg);
  }
  .split {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(18rem, 1fr);
    gap: 1.25rem;
    align-items: start;
  }
  @media (max-width: 60rem) {
    .layout {
      grid-template-columns: 1fr;
    }
    nav {
      border-right: none;
      border-bottom: 1px solid var(--line);
    }
    .split {
      grid-template-columns: 1fr;
    }
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.9em;
  }
</style>
