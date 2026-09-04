<script lang="ts">
  /**
   * dialogysx — parts catalogue and repair documentation.
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
   *
   * Two views share the identification bar: parts, and the repair manuals. In
   * the original those are separate applets over one selected vehicle, and they
   * stay separate here — the documents are indexed by *family* rather than by
   * PR group, and their applicability is a different, much simpler grammar.
   */
  import { plateLabel, type VehicleSpec } from "@dialogysx/catalogue";
  import Combo from "./lib/Combo.svelte";
  import About from "./lib/About.svelte";
  import Documents from "./lib/Documents.svelte";
  import Drawing from "./lib/Drawing.svelte";
  import PartsList from "./lib/PartsList.svelte";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import Settings from "./lib/Settings.svelte";
  import { HttpTreeSource } from "./lib/http-source";
  import { isSupported, LocalDirectorySource, revokeImageUrl } from "./lib/local-source";
  import {
    clearDirectoryHandle,
    clearSettings,
    handleReadable,
    loadDirectoryHandle,
    loadSettings,
    requestHandleAccess,
    saveDirectoryHandle,
    saveSettings,
    type SavedSource,
  } from "./lib/settings";
  import { app } from "./lib/state.svelte";

  let aboutOpen = $state(false);
  let settingsOpen = $state(false);
  let saved = $state<SavedSource | undefined>(undefined);
  /** A remembered folder the browser will not let us read without a click. */
  let needsPermission = $state(false);
  let settingsError = $state<string | undefined>(undefined);

  /** Nothing remembered, so the settings panel is the only way in. */
  const firstRun = $derived(saved === undefined && app.status.kind !== "ready");

  const busy = $derived(app.status.kind === "loading" ? app.status.what : undefined);

  /**
   * Restore the last source.
   *
   * A URL reopens itself. A folder cannot: browsers drop a handle's permission
   * across a reload and `requestPermission` only works inside a user gesture,
   * so the most this can do is check and, if access survived, open — otherwise
   * it shows the panel with a button that asks.
   */
  async function restore(): Promise<void> {
    const settings = loadSettings();
    saved = settings.source;
    if (!settings.source) {
      settingsOpen = true;
      return;
    }
    if (settings.source.kind === "http") {
      await app.open(new HttpTreeSource({ baseUrl: settings.source.url }), settings.source.url, settings.language);
      return;
    }
    const handle = await loadDirectoryHandle();
    if (!handle) {
      // The choice was remembered but the handle was not — clearing site data
      // wipes IndexedDB and leaves `localStorage` alone often enough to matter.
      saved = undefined;
      clearSettings();
      settingsOpen = true;
      return;
    }
    if (await handleReadable(handle)) {
      await app.open(new LocalDirectorySource(handle), handle.name, settings.language);
    } else {
      needsPermission = true;
      settingsOpen = true;
    }
  }

  $effect(() => {
    void restore();
  });

  async function openUrl(url: string): Promise<void> {
    settingsError = undefined;
    await app.open(new HttpTreeSource({ baseUrl: url }), url);
    if (app.status.kind === "error") {
      settingsError = app.status.message;
      return;
    }
    // Remembered only once it opened. Saving on click would make a typo the
    // thing the app reopens to on every future visit.
    saved = { kind: "http", url };
    saveSettings({ source: saved, language: app.language });
    await clearDirectoryHandle();
    settingsOpen = false;
  }

  async function pickFolder(): Promise<void> {
    settingsError = undefined;
    try {
      const source = await LocalDirectorySource.pick();
      await app.open(source, source.name);
      if (app.status.kind === "error") {
        settingsError = app.status.message;
        return;
      }
      saved = { kind: "folder", name: source.name };
      needsPermission = false;
      saveSettings({ source: saved, language: app.language });
      await saveDirectoryHandle(source.handle);
      settingsOpen = false;
    } catch (e) {
      // Cancelling the picker throws `AbortError`; that is not a failure.
      if (e instanceof DOMException && e.name === "AbortError") return;
      settingsError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Re-grant access to the remembered folder. Runs inside the click. */
  async function reopenFolder(): Promise<void> {
    settingsError = undefined;
    const handle = await loadDirectoryHandle();
    if (!handle) {
      settingsError = "That folder is no longer remembered. Choose it again.";
      saved = undefined;
      return;
    }
    if (!(await handleReadable(handle)) && !(await requestHandleAccess(handle))) {
      settingsError = "Access to that folder was denied.";
      return;
    }
    needsPermission = false;
    await app.open(new LocalDirectorySource(handle), handle.name, loadSettings().language);
    if (app.status.kind === "error") {
      settingsError = app.status.message;
      return;
    }
    settingsOpen = false;
  }

  async function forgetFolder(): Promise<void> {
    await clearDirectoryHandle();
    clearSettings();
    saved = undefined;
    needsPermission = false;
    settingsError = undefined;
  }

  let imageSrc = $state<string | undefined>(undefined);
  $effect(() => {
    const path = app.plate?.drawingPath;
    const source = app.session?.source;
    let stale = false;
    let mine: string | undefined;
    (async () => {
      const next = path && source?.fileUrl ? await source.fileUrl(path) : undefined;
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

  /** Stable identity for a vehicle: the full envelope key. */
  function vehicleKey(v: VehicleSpec): string {
    const c = v.criteria;
    return [v.pr, c.TYP_, c.NEQT, c.EQPT, c.MOT3, c.MOTI, c.BVI3].join("|");
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

{#if aboutOpen}
  <About onClose={() => (aboutOpen = false)} />
{/if}

{#if settingsOpen}
  <Settings
    {saved}
    {needsPermission}
    {firstRun}
    folderSupported={isSupported()}
    {busy}
    error={settingsError}
    onOpenUrl={(u) => openUrl(u)}
    onPickFolder={() => pickFolder()}
    onReopenFolder={() => reopenFolder()}
    onForgetFolder={() => forgetFolder()}
    onClose={() => (settingsOpen = false)}
  />
{/if}

<main>
  <header>
    <!--
      Wordmark, version, repository — the arrangement ddtx uses. The version is
      a build-time literal from `package.json`, so it cannot disagree with the
      repository, and it links to that release's tag without a `v` prefix.
    -->
    <div class="title">
      <button
        class="wordmark"
        onclick={() => (aboutOpen = true)}
        title="About dialogysx"
        aria-haspopup="dialog"
        data-testid="wordmark">dialogys<span class="accent">x</span></button
      >
      <a
        class="version"
        href={`${__REPO_URL__}/releases/tag/${__APP_VERSION__}`}
        target="_blank"
        rel="noopener noreferrer"
        title="Release notes"
        data-testid="version">{__APP_VERSION__}</a
      >
      <a
        class="repo"
        href={__REPO_URL__}
        target="_blank"
        rel="noopener noreferrer"
        title="Source on GitHub"
        aria-label="Source on GitHub"
        data-testid="repo"
      >
        <!-- GitHub's own mark, inlined so it takes `currentColor` and needs no
             fetch — the one icon that does not come from Lucide, because
             Lucide's approximation of it is not the brand mark. -->
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
      </a>
    </div>
    <div class="open">
      <!-- The source controls live in the settings dialog now. They were a
           permanent fixture in the bar for a choice made once, and the tree in
           use is already named in the chrome below. -->
      <button
        class="gear"
        onclick={() => (settingsOpen = true)}
        title="Settings"
        aria-haspopup="dialog"
        aria-label="Settings"
        data-testid="settings-open"><SettingsIcon size={16} strokeWidth={1.9} /></button
      >
    </div>
  </header>

  {#if app.status.kind !== "ready"}
    <section class="splash">
      {#if app.status.kind === "loading"}
        <p class="working">{app.status.what}&hellip;</p>
      {:else if app.status.kind === "error"}
        <!-- Also shown in the dialog while it is open; here for when it is
             not, so a failed restore is not a blank page. -->
        <p class="error">{app.status.message}</p>
        <button class="retry" onclick={() => (settingsOpen = true)}>Choose a data tree</button>
      {:else if !settingsOpen}
        <p>
          No data tree open. <button class="retry" onclick={() => (settingsOpen = true)}
            >Choose one</button
          >
        </p>
      {/if}
    </section>
  {:else}
    <div class="bar">
      {#if app.brands.length > 1}
        <Combo
          testid="brands"
          label="Brand"
          items={[...app.brands]}
          text={(b) => b.label}
          key={(b) => b.id}
          hint={(b) => `${b.modelIndices.length}`}
          selected={app.brand}
          onPick={(b) => app.selectBrand(b)}
        />
      {/if}

      <Combo
        testid="models"
        label="Model"
        items={app.models}
        text={(m) => m.name}
        key={(m) => m.name}
        hint={(m) => m.prGroups.join(" ")}
        selected={app.model}
        onPick={(m) => app.selectModel(m)}
      />

      <Combo
        testid="vehicles"
        label="Vehicle"
        items={app.vehicles}
        text={vehicleLabel}
        key={(v) => vehicleKey(v)}
        selected={app.vehicle}
        disabled={!app.model}
        onPick={(v) => app.selectVehicle(v)}
      />

      <!-- The narrowing controls the original also has. A build number needs a
           factory: `resolveDate` compares `factory + number` against the Dates
           table, so one without the other decides nothing. -->
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

      <Combo
          testid="assemblies"
          label="Assembly"
          items={app.visibleAssemblies}
          text={(a) => a.label ?? a.code}
          key={(a) => a.code}
          hint={(a) => `${a.domainLabel ?? ""} ${a.code}`.trim()}
          muted={(a) => {
            const av = app.availability.get(a.code);
            return av !== undefined && av.plates === 0;
          }}
          selected={app.visibleAssemblies.find((a) => a.code === app.assembly)}
          disabled={!app.group}
          onPick={(a) => app.selectAssembly(a.code)}
        />

      {#if app.hiddenAssemblyCount > 0}
        <!--
          Say what is hidden. Two thirds of the menu can be empty for a given
          vehicle, and silently shortening it looks like missing data.

          A sibling of the comboboxes, not a child of the Assembly one. Stacked
          underneath it the checkbox became part of that column's height, and
          `align-items: flex-end` then aligned the *checkbox* with the other
          inputs' baseline — lifting the Assembly field a row above its
          neighbours. The controls line up; the note sits beside them.
        -->
        <label class="inline">
          <input type="checkbox" bind:checked={app.onlyAvailable} />
          hide {app.hiddenAssemblyCount} with no parts
        </label>
      {/if}

      <!-- Shown only when there is a choice. Two thirds of assemblies resolve
           to a single plate, which is opened automatically. -->
      {#if plates.length > 1}
        <Combo
          testid="plates"
          label="Plate"
          items={plates}
          text={(x) => (app.group ? plateLabel(app.group, x.p.plate) : x.p.plate)}
          key={(x) => x.p.raw}
          hint={(x) => (x.undecided ? "?" : undefined)}
          muted={(x) => x.undecided}
          selected={plates.find((x) => x.p.plate === app.plate?.plate)}
          onPick={(x) => app.selectPlate(x.p)}
        />
      {/if}
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
      {#if app.plate && app.view === "parts"}
        <span class="right">
          {app.decidedCount} decided &middot;
          <span class:warn-text={app.undecidedCount > 0}>{app.undecidedCount} undecided</span>
        </span>
      {/if}
    </div>

    <!-- The tabs sit below the identification bar because identification is
         shared: both views are about the same vehicle. -->
    <div class="tabs" role="tablist" aria-label="View">
      <button
        type="button"
        role="tab"
        data-testid="tab-parts"
        aria-selected={app.view === "parts"}
        class:on={app.view === "parts"}
        onclick={() => app.setView("parts")}>Parts</button
      >
      <button
        type="button"
        role="tab"
        data-testid="tab-docs"
        aria-selected={app.view === "docs"}
        class:on={app.view === "docs"}
        disabled={!app.model}
        onclick={() => app.setView("docs")}
      >
        Repair documentation
        {#if app.docs}<span class="badge">{app.docs.total}</span>{/if}
      </button>
    </div>

    {#if app.view === "docs"}
      <div class="content">
        {#if !app.model}
          <p class="hint">Choose a model — the manuals are indexed by vehicle family.</p>
        {:else}
          <Documents
            elements={app.visibleDocElements}
            documents={app.visibleDocuments}
            family={app.docs?.family}
            query={app.docQuery}
            loading={app.docsLoading}
            unavailable={app.docsUnavailable}
            notice={app.docNotice}
            open={app.openDoc}
            onQuery={(q) => (app.docQuery = q)}
            onOpen={(d) => app.showDoc(d)}
            onClose={() => app.closeDoc()}
          />
        {/if}
      </div>
    {:else}
    <div class="content">
      {#if !app.plate}
        <p class="hint">
          {#if !app.brand && app.brands.length > 1}
            Choose a brand to begin.
          {:else if !app.model}
            Choose a model.
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
          <span class="meta" data-testid="plate-key">
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
  /*
   * The wordmark is a button, so it needs the heading's look rather than a
   * button's. `font: inherit` first, then only what differs.
   */
  .wordmark {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 0.98rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #fff;
    cursor: pointer;
  }
  .wordmark:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  /*
   * Marianne red, lightened for this ground.
   *
   * `--red` is 2.99:1 against Blue France — fine as a block, muddy as a single
   * glyph. This tint keeps the same red and clears 6:1.
   */
  .wordmark .accent {
    color: #ff8080;
  }
  .version {
    flex-shrink: 0;
    font-family: var(--mono);
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    color: rgb(255 255 255 / 62%);
    text-decoration: none;
  }
  .version:hover {
    color: #fff;
  }
  .gear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.7rem;
    padding: 0;
    border: 1px solid rgb(255 255 255 / 28%);
    border-radius: 2px;
    background: none;
    color: rgb(255 255 255 / 82%);
    cursor: pointer;
  }
  .gear:hover {
    background: rgb(255 255 255 / 12%);
    color: #fff;
  }
  .gear:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 1px;
  }
  .retry {
    padding: 0.15rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--card);
    font: inherit;
    font-size: 0.8rem;
    color: var(--blue);
    cursor: pointer;
  }
  .retry:hover {
    background: var(--paper);
  }
  .repo {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: rgb(255 255 255 / 62%);
  }
  .repo:hover {
    color: #fff;
  }
  .open {
    display: flex;
    gap: 0.35rem;
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
  .bar label.inline {
    flex-direction: row;
    align-items: center;
    gap: 0.3rem;
    /* Sits on the inputs' baseline, so it needs the same bottom padding they
       have rather than a top nudge. */
    padding-bottom: 0.25rem;
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
  .tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0 0.9rem;
    border-bottom: 1px solid var(--rule);
    background: var(--paper);
  }
  .tabs button {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid transparent;
    border-bottom: 0;
    border-radius: 2px 2px 0 0;
    margin-bottom: -1px;
    background: none;
    font: inherit;
    font-size: 0.8rem;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .tabs button:hover:not(:disabled) {
    color: var(--ink);
  }
  .tabs button.on {
    background: var(--card);
    border-color: var(--rule);
    color: var(--ink);
    font-weight: 600;
  }
  .tabs button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .tabs .badge {
    font-family: var(--mono);
    font-size: 0.7rem;
    color: var(--ink-faint);
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
</style>
