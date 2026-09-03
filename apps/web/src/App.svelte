<script lang="ts">
  /**
   * dialogysx — parts catalogue browser.
   *
   * Identification follows the original's order: model, vehicle, then the
   * factory and build number that narrow it further. Everything is a combobox
   * because the lists are long — 147 PR groups, 41 vehicles for one model, 136
   * assemblies — and panels of them left no room for the drawing, which is the
   * thing you came to look at.
   *
   * Note the deliberate absence: **a plate has no name**, here or in Dialogys.
   * `Planche.getLabel()` composes a path instead, and the prose name belongs to
   * the assembly. So the heading names the assembly and the plate sits below it
   * as an identifier.
   */
  import { plateLabel, type VehicleSpec } from "@dialogysx/catalogue";
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

  let imageSrc = $state<string | undefined>(undefined);
  $effect(() => {
    const path = app.plate?.drawingPath;
    const source = app.session?.source;
    let stale = false;
    let mine: string | undefined;
    (async () => {
      const next = path && source?.imageUrl ? await source.imageUrl(path) : undefined;
      if (stale) return revokeImageUrl(next);
      mine = next;
      imageSrc = next;
    })();
    return () => {
      stale = true;
      revokeImageUrl(mine);
    };
  });

  /**
   * A vehicle in full.
   *
   * Every distinguishing envelope field has to appear or the rows look like
   * duplicates: for model 1132 all 41 rows are distinct, but only 6 differ on
   * type, engine and gearbox — **`EQPT`, the equipment code, separates the
   * rest**. Dropping it made the list look broken.
   */
  function vehicleLabel(v: VehicleSpec): string {
    const c = v.criteria;
    const engine = [c.MOT3, c.MOTI].filter(Boolean).join("-");
    return [c.TYP_, c.NEQT, c.EQPT, engine, c.BVI3].filter(Boolean).join(" · ");
  }

  const plates = $derived([
    ...app.assemblyPlates.map((p) => ({ p, undecided: false })),
    ...app.assemblyUnknown.map((p) => ({ p, undecided: true })),
  ]);

  function pickPlate(raw: string) {
    const found = plates.find((x) => x.p.raw === raw);
    if (found) app.selectPlate(found.p);
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
    <div class="bar">
      <label>
        <span>Model</span>
        <select
          data-testid="models"
          value={app.model?.name ?? ""}
          onchange={(e) => {
            const m = app.models.find((x) => x.name === e.currentTarget.value);
            if (m) app.selectModel(m);
          }}
        >
          <option value="" disabled>{app.models.length} models&hellip;</option>
          {#each app.models as m (m.name)}
            <option value={m.name}>{m.name}</option>
          {/each}
        </select>
      </label>

      <label class:off={!app.model}>
        <span>Vehicle</span>
        <select
          data-testid="vehicles"
          disabled={!app.model}
          value={app.vehicle ? String(app.vehicles.indexOf(app.vehicle)) : ""}
          onchange={(e) => {
            const v = app.vehicles[Number(e.currentTarget.value)];
            if (v) app.selectVehicle(v);
          }}
        >
          <option value="" disabled>{app.vehicles.length} vehicles&hellip;</option>
          {#each app.vehicles as v, i (i)}
            <option value={String(i)}>{vehicleLabel(v)}</option>
          {/each}
        </select>
      </label>

      <!-- The narrowing controls the original also has. Without a build number
           every ordered applicability clause is undecidable — the counter in
           the strip below shows how many. -->
      <label class:off={!app.vehicle}>
        <span>Factory</span>
        <select
          data-testid="factory"
          disabled={!app.vehicle || app.factories.length === 0}
          bind:value={app.factory}
          onchange={() => app.refine()}
        >
          <option value="">any</option>
          {#each app.factories as f (f)}
            <option value={f}>{f}</option>
          {/each}
        </select>
      </label>

      <label class:off={!app.vehicle}>
        <span>Build no.</span>
        <input
          data-testid="build-number"
          class="build"
          disabled={!app.vehicle}
          placeholder="0005973"
          bind:value={app.buildNumber}
          onchange={() => app.refine()}
          spellcheck="false"
        />
      </label>

      <label class:off={!app.group}>
        <span>Assembly</span>
        <select
          data-testid="assemblies"
          disabled={!app.group}
          value={app.assembly ?? ""}
          onchange={(e) => app.selectAssembly(e.currentTarget.value)}
        >
          <option value="" disabled>{app.visibleAssemblies.length} assemblies&hellip;</option>
          {#each app.assembliesByDomain as d (d.domain)}
            <optgroup label={d.label}>
              {#each d.items as a (a.code)}
                {@const av = app.availability.get(a.code)}
                <option value={a.code}>
                  {a.label ?? a.code} — {a.code}{av && av.plates === 0 && av.unknown > 0
                    ? " (?)"
                    : ""}
                </option>
              {/each}
            </optgroup>
          {/each}
        </select>
        {#if app.hiddenAssemblyCount > 0}
          <!-- Say what is being hidden. Two thirds of the menu can be empty for
               a given vehicle, and silently shortening it would look like
               missing data. -->
          <label class="inline">
            <input type="checkbox" bind:checked={app.onlyAvailable} />
            hide {app.hiddenAssemblyCount} with no parts
          </label>
        {/if}
      </label>

      <!-- Shown only when there is a choice. Two thirds of assemblies resolve
           to a single plate, which is opened automatically. -->
      <label class:off={plates.length === 0} class:hidden={plates.length < 2}>
        <span>Plate</span>
        <select
          data-testid="plates"
          disabled={plates.length === 0}
          value={plates.find((x) => x.p.plate === app.plate?.plate)?.p.raw ?? ""}
          onchange={(e) => pickPlate(e.currentTarget.value)}
        >
          <option value="" disabled>{plates.length} plates&hellip;</option>
          {#each plates as x (x.p.raw)}
            <option value={x.p.raw}>
              {app.group ? plateLabel(app.group, x.p.plate) : x.p.plate}{x.undecided ? " (?)" : ""}
            </option>
          {/each}
        </select>
      </label>
    </div>

    <div class="chrome">
      <span class="src">{app.status.from}</span>
      {#if app.languages.length > 1}
        <select
          class="lang"
          aria-label="Language"
          value={app.language}
          onchange={(e) => app.reopen((e.currentTarget as HTMLSelectElement).value)}
        >
          {#each app.languages as l (l)}
            <option value={l}>{l}</option>
          {/each}
        </select>
      {:else}
        <span>language {app.language}</span>
      {/if}
      {#if app.session?.partNameCountry}
        <span>part names {app.session.partNameCountry}</span>
      {:else}
        <span class="warn-text">no part names in this tree</span>
      {/if}
      {#if app.plate}
        <span class="right">
          {app.decidedCount} decided &middot;
          <span class:warn-text={app.undecidedCount > 0}>{app.undecidedCount} undecided</span>
        </span>
      {/if}
    </div>

    <div class="content">
      {#if !app.plate}
        <p class="hint">
          {#if !app.model}
            Choose a model to begin.
          {:else if !app.vehicle}
            Choose a vehicle. Applicability is evaluated against it, so nothing is filtered until
            one is picked.
          {:else if !app.assembly}
            Choose an assembly — engine, bodywork, interior and so on.
          {:else if plates.length === 0}
            <strong>Nothing on this assembly fits this vehicle.</strong> Its plates apply to other
            variants of the model, which is normal: for this vehicle
            {app.availability.size - app.hiddenAssemblyCount} of {app.availability.size} assemblies
            have parts. Pick another, or untick <em>hide</em> to see the empty ones.
          {:else}
            Choose a plate. Each one is a drawing within this assembly.
          {/if}
        </p>
      {:else}
        <div class="platehead">
          <h2>{app.assemblyLabel ?? app.assembly}</h2>
          <span class="meta">
            {app.group ? plateLabel(app.group, app.plate.plate) : app.plate.plate}
            &middot; {app.plate.key}
            &middot; drawing {app.plate.drawing ?? "—"}
            &middot; {app.plate.reperes.length} callouts
          </span>
        </div>

        {#if app.plate.questions.length > 0}
          <div class="questions" data-testid="questions">
            <strong>{app.undecidedCount} parts undecided.</strong>
            {#if app.plate.dateQuestions.length > 0}
              {#if !app.buildNumber}
                Enter a build number above to settle the date-based ones.
              {:else if !app.factory}
                <!-- A build number alone cannot be compared: `resolveDate`
                     needs `factory + number` to look up the Dates table. -->
                Pick a <strong>factory</strong> as well — a build number cannot be compared without
                one.
              {/if}
            {/if}
            <div class="asks">
              {#each app.plate.questionOptions as q (q.code)}
                {#if q.values.length > 0}
                  <!-- Answerable, because the original asks rather than
                       guesses: an unknown criterion is a question, and until
                       it is answered the part stays listed and marked. -->
                  <label class="ask">
                    <span>{q.label}</span>
                    <select
                      value={app.answers[q.code] ?? ""}
                      onchange={(e) => app.answer(q.code, e.currentTarget.value)}
                    >
                      <option value="">?</option>
                      {#each q.values as v (v)}
                        <option value={v}>{v}</option>
                      {/each}
                    </select>
                  </label>
                {:else}
                  <span class="qtag" title="No values for this criterion in this PR group"
                    >{q.label}</span
                  >
                {/if}
              {/each}
            </div>
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
  {/if}
</main>

<style>
  /*
   * Palette taken from ddtx, whose reasoning applies here unchanged: a French
   * tool reading a French database about French cars, so the French Republic's
   * own colours are the honest reference rather than an invented scheme. Blue
   * France #000091 carries the chrome; Red Marianne #E1000F is spent on
   * attention only — here, an applicability the data cannot decide.
   *
   * Light only, for the reason ddtx gives: the subject has to be the brightest
   * thing on the page. Renault's drawings are black line art on white, so a
   * dark shell would either wash them out or leave a bright plate fighting the
   * chrome around it.
   */
  :global(:root) {
    --ink: #10151c;
    --ink-soft: #48525e;
    --ink-faint: #8a939d;
    --paper: #eceef2;
    --card: #ffffff;
    --rule: #c7cdd6;
    --rule-soft: #e0e4ea;
    --blue: #000091;
    --blue-soft: #2a2ab0;
    --red: #e1000f;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  :global(body) {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 13px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }

  main {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--paper);
  }
  header {
    background: var(--blue);
    color: #fff;
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 1rem;
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  h1 {
    margin: 0;
    font-size: 0.98rem;
    letter-spacing: -0.01em;
  }
  .tagline {
    opacity: 0.75;
    font-size: 0.78rem;
  }
  .open {
    display: flex;
    gap: 0.35rem;
  }
  .open input {
    font-family: var(--mono);
    font-size: 0.78rem;
    padding: 0.22rem 0.45rem;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    width: 10rem;
  }
  button {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.22rem 0.55rem;
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 2px;
    background: transparent;
    color: #fff;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.16);
  }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* The identification bar: one row of comboboxes, no wasted height. */
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1rem;
    align-items: flex-end;
    padding: 0.6rem 1rem;
    background: var(--card);
    border-bottom: 1px solid var(--rule);
  }
  .bar label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .bar label.off {
    opacity: 0.45;
  }
  .bar label.hidden {
    display: none;
  }
  .bar label.inline {
    flex-direction: row;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.2rem;
    font-size: 0.7rem;
    color: var(--ink-faint);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }
  .bar label.inline input {
    margin: 0;
  }
  .bar label > span {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  select,
  .build {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--card);
    color: var(--ink);
    max-width: 22rem;
  }
  select:focus-visible,
  .build:focus-visible {
    outline: 2px solid var(--blue);
    outline-offset: 1px;
  }
  .build {
    font-family: var(--mono);
    width: 8rem;
  }

  .chrome {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding: 0.2rem 1rem;
    font-size: 0.72rem;
    color: var(--ink-faint);
    background: var(--rule-soft);
    border-bottom: 1px solid var(--rule);
  }
  .src {
    font-family: var(--mono);
  }
  .chrome .right {
    margin-left: auto;
  }
  .warn-text {
    color: var(--red);
  }
  select.lang {
    font-size: 0.72rem;
    padding: 0 0.2rem;
  }

  .splash {
    padding: 3rem 1.25rem;
    max-width: 40rem;
  }
  .splash p {
    color: var(--ink-soft);
  }
  .error {
    color: var(--red);
  }

  .content {
    background: var(--card);
    padding: 1rem 1.25rem 3rem;
    flex: 1;
    min-width: 0;
  }
  .hint {
    color: var(--ink-soft);
    max-width: 32rem;
  }
  .platehead {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }
  .platehead h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .meta {
    font-size: 0.74rem;
    color: var(--ink-faint);
    font-family: var(--mono);
  }
  .questions {
    border-left: 3px solid var(--red);
    padding: 0.4rem 0.7rem;
    margin-bottom: 0.9rem;
    font-size: 0.8rem;
    color: var(--ink-soft);
    background: color-mix(in srgb, var(--red) 5%, transparent);
  }
  .questions strong {
    color: var(--red);
  }
  .asks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.8rem;
    margin-top: 0.35rem;
  }
  .ask {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .ask > span {
    font-size: 0.74rem;
    color: var(--ink-soft);
  }
  .ask select {
    font-size: 0.74rem;
    padding: 0 0.15rem;
    max-width: 14rem;
  }
  .qtag {
    display: inline-block;
    font-size: 0.74rem;
    padding: 0.05rem 0.35rem;
    margin: 0.1rem 0.15rem 0 0;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--card);
  }
  .split {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(20rem, 1fr);
    gap: 1.25rem;
    align-items: start;
  }
  @media (max-width: 62rem) {
    .split {
      grid-template-columns: 1fr;
    }
  }
  code {
    font-family: var(--mono);
    font-size: 0.9em;
  }
</style>
