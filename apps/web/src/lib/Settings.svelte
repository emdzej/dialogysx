<script lang="ts">
  /**
   * Where the data comes from, and how to change it.
   *
   * The same panel serves two jobs: reached from the gear it is a settings
   * dialog, and on a first run — nothing remembered — it is the thing that
   * opens the catalogue at all. That is why it can be shown without a scrim
   * dismiss: with no source there is nothing behind it to go back to.
   *
   * Tabbed for one tab, deliberately. Data is the only setting worth keeping
   * today, and a dialog that grows a second one later should not have to be
   * rebuilt into a different shape to hold it.
   */
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import HardDrive from "@lucide/svelte/icons/hard-drive";
  import Link from "@lucide/svelte/icons/link";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import CloudDownload from "@lucide/svelte/icons/cloud-download";
  import Database from "@lucide/svelte/icons/database";
  import { formatBytes, type CopyScope } from "./offline.js";
  import { offline } from "./offline.svelte.js";
  import {
    UI_LOCALES,
    setUiPreference,
    ui,
    uiLocale,
    uiPreference,
    type UiPreference,
  } from "./ui.svelte.js";
  import type { SavedSource } from "./settings";

  interface Props {
    /** What is remembered, if anything. */
    saved: SavedSource | undefined;
    /** A remembered folder whose permission has to be re-granted by a click. */
    needsPermission: boolean;
    /** No source yet: this is the first run, so it cannot be dismissed. */
    firstRun: boolean;
    folderSupported: boolean;
    busy: string | undefined;
    error: string | undefined;
    onOpenUrl: (url: string) => void;
    onPickFolder: () => void;
    onReopenFolder: () => void;
    onForgetFolder: () => void;
    /** Absent when the browser cannot write, so the offer is not made. */
    onImport?: () => void;
    /** Copy the tree that is open now into this browser. */
    onCopyOffline?: (scope: CopyScope) => void;
    /** Open the copy already held here. */
    onOpenOffline?: () => void;
    /** Catalogue languages the open tree carries. */
    languages?: string[];
    language?: string;
    /** Which country's part names resolved, if any. */
    partNameCountry?: string;
    onLanguage?: (code: string) => void;
    onClose: () => void;
  }

  let {
    saved,
    needsPermission,
    firstRun,
    folderSupported,
    busy,
    error,
    onOpenUrl,
    onPickFolder,
    onReopenFolder,
    onForgetFolder,
    onImport,
    onCopyOffline,
    onOpenOffline,
    languages = [],
    language,
    partNameCountry,
    onLanguage,
    onClose,
  }: Props = $props();

  /**
   * Which section is showing.
   *
   * Language only appears when the open tree offers a choice — a tree imported
   * with `-l en` has exactly one, and a tab that can only confirm what is
   * already true is noise.
   */
  let tab = $state<"data" | "language">("data");
  /**
   * Whether the *tree* offers a catalogue-language choice.
   *
   * The tab itself is always shown, because the interface language is not a
   * property of the tree — this only decides whether the catalogue selector
   * appears beside it. A tree imported with `-l en` has exactly one catalogue
   * language and a control that can only confirm that is noise.
   */
  const showCatalogueLanguage = $derived(languages.length > 1 && onLanguage !== undefined);

  /** What "match my browser" currently resolves to, named in its own language. */
  const systemLabel = $derived(
    UI_LOCALES.find((l) => l.tag === uiLocale())?.label ?? uiLocale(),
  );

  // Seeded from what is remembered, so reopening the dialog shows the tree in
  // use rather than the default. Capturing the initial value is the intent
  // here — the dialog is mounted fresh each time it opens, and a `$derived`
  // would fight the user as they typed.
  // svelte-ignore state_referenced_locally
  let url = $state(saved?.kind === "http" ? saved.url : "/data");
  /** Default to the catalogue: it is a fraction of the size and the part
      most people want offline. */
  let scope = $state<CopyScope>("catalogue");

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && !firstRun) onClose();
  }

  /*
   * Re-read the stored copy whenever this opens.
   *
   * The store reads it once at module load, which is stale by the time anyone
   * opens this: a copy may have finished in another tab, storage may have been
   * evicted, or the browser may have granted more room. Cheap enough to just
   * ask again.
   */
  $effect(() => {
    void offline.refresh();
  });
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="scrim"
  role="presentation"
  onclick={() => {
    if (!firstRun) onClose();
  }}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={ui("settings.title")}
    data-testid="settings"
    onclick={(e) => e.stopPropagation()}
  >
    <header>
      <span class="eyebrow">{firstRun ? ui("settings.firstRunTitle") : ui("settings.title")}</span>
      {#if !firstRun}
        <button class="close" onclick={onClose} aria-label={ui("chrome.close")} data-testid="settings-close">
          <X size={16} strokeWidth={1.9} />
        </button>
      {/if}
    </header>

    <div class="tabs" role="tablist" aria-label={ui("settings.sections")}>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "data"}
        class:on={tab === "data"}
        onclick={() => (tab = "data")}
        data-testid="tab-data">{ui("settings.data")}</button
      >
      <button
        type="button"
        role="tab"
        aria-selected={tab === "language"}
        class:on={tab === "language"}
        onclick={() => (tab = "language")}
        data-testid="tab-language">{ui("language.section")}</button
      >
    </div>

    <div class="body" class:hidden={tab !== "data"}>
      {#if firstRun}
        <p class="lede">{ui("settings.lede")}</p>
      {/if}

      {#if error}<p class="error" data-testid="settings-error">{error}</p>{/if}
      {#if busy}<p class="busy">{busy}&hellip;</p>{/if}

      <section>
        <h2><Link size={14} strokeWidth={1.9} /> {ui("settings.httpTitle")}</h2>
        <p class="hint">{ui("settings.httpHint")}</p>
        <form
          class="row"
          onsubmit={(e) => {
            e.preventDefault();
            onOpenUrl(url.trim());
          }}
        >
          <input
            bind:value={url}
            spellcheck="false"
            placeholder={ui("settings.urlPlaceholder")}
            aria-label={ui("settings.urlLabel")}
            data-testid="settings-url"
          />
          <button type="submit" class="primary" disabled={url.trim().length === 0}>{ui("settings.open")}</button>
        </form>
        {#if saved?.kind === "http"}
          <p class="current" data-testid="settings-current-http">
            {ui("settings.remembered")} <code>{saved.url}</code>
          </p>
        {/if}
      </section>

      <section>
        <h2><FolderOpen size={14} strokeWidth={1.9} /> {ui("settings.folderTitle")}</h2>
        {#if !folderSupported}
          <p class="hint">{ui("settings.noFsaHint")}</p>
        {:else}
          <p class="hint">{ui("settings.folderHint")}</p>
          {#if saved?.kind === "folder"}
            <p class="current" data-testid="settings-current-folder">
              {ui("settings.remembered")} <code>{saved.name}</code>
              {#if needsPermission}
                <span class="warn">{ui("settings.needsPermission")}</span>
              {/if}
            </p>
            <div class="row">
              <button type="button" class="primary" onclick={onReopenFolder}>
                {needsPermission
                  ? ui("settings.grantAccess", { name: saved.name })
                  : ui("settings.reopen", { name: saved.name })}
              </button>
              <button type="button" onclick={onPickFolder}>{ui("settings.chooseAnother")}</button>
              <button type="button" class="danger" onclick={onForgetFolder} data-testid="forget">
                <Trash2 size={14} strokeWidth={1.9} /> {ui("settings.forget")}
              </button>
            </div>
          {:else}
            <div class="row">
              <button type="button" class="primary" onclick={onPickFolder} data-testid="pick-folder">
                {ui("settings.openFolder")}
              </button>
            </div>
          {/if}
        {/if}
      </section>

      {#if onImport}
        <section>
          <h2><HardDrive size={14} strokeWidth={1.9} /> {ui("settings.noTreeTitle")}</h2>
          <p class="hint">{ui("settings.noTreeHint")}</p>
          <div class="row">
            <button type="button" onclick={onImport} data-testid="settings-import">
              {ui("settings.importButton")}
            </button>
          </div>
        </section>
      {/if}

      <!--
        The copy held in this browser.
        
        Last in the tab because it is a step you take *after* opening a tree
        somewhere else: it copies whatever is open now, so it cannot be the
        first thing anyone does.
      -->
      <section data-testid="offline-section">
        <h2><Database size={14} strokeWidth={1.9} /> {ui("offline.title")}</h2>

        {#if !offline.supported}
          <p class="hint warn">{ui("offline.unsupported")}</p>
        {:else if offline.progress}
          <p class="hint">
            {ui("offline.copying", {
              done: offline.progress.done,
              total: offline.progress.total,
              size: formatBytes(offline.progress.bytes, uiLocale()),
            })}
          </p>
          <div class="bar" data-testid="offline-progress">
            <div
              class="fill"
              style={`width: ${
                offline.progress.totalBytes > 0
                  ? (offline.progress.bytes / offline.progress.totalBytes) * 100
                  : 0
              }%`}
            ></div>
          </div>
          <p class="hint mono">{offline.progress.current}</p>
          <div class="row">
            <button type="button" onclick={() => offline.cancel()} data-testid="offline-cancel">
              {ui("offline.cancel")}
            </button>
          </div>
        {:else}
          {#if offline.held.files > 0}
            <p class="current" data-testid="offline-held">
              {ui("offline.held", {
                files: offline.held.files.toLocaleString(uiLocale()),
                size: formatBytes(offline.held.bytes, uiLocale()),
              })}
              <span class:warn={!offline.persisted}>
                &middot; {offline.persisted
                  ? ui("offline.persisted")
                  : ui("offline.notPersisted")}
              </span>
            </p>
          {:else}
            <p class="hint">{ui("offline.empty")}</p>
          {/if}

          {#if offline.tooBig}
            <p class="hint warn" data-testid="offline-toobig">
              {ui("offline.tooBig", {
                needed: formatBytes(offline.tooBig.needed, uiLocale()),
                available: formatBytes(offline.tooBig.available ?? 0, uiLocale()),
              })}
            </p>
          {/if}

          {#if offline.outcome}
            <p class="current" data-testid="offline-outcome">
              {offline.outcome.cancelled
                ? ui("offline.cancelled", { copied: offline.outcome.copied })
                : offline.outcome.failed > 0
                  ? ui("offline.doneFailed", {
                      copied: offline.outcome.copied,
                      failed: offline.outcome.failed,
                    })
                  : offline.outcome.copied === 0
                    ? ui("offline.noManifest")
                    : ui("offline.done", { copied: offline.outcome.copied })}
            </p>
          {/if}

          <!-- The split is the whole reason there is a choice: the catalogue
               with every drawing is a fraction of a full tree, and the repair
               manuals are the rest of it. -->
          <label class="scope">
            <span>{ui("offline.scope")}</span>
            <select bind:value={scope} data-testid="offline-scope">
              <option value="catalogue">{ui("offline.scopeCatalogue")}</option>
              <option value="everything">{ui("offline.scopeEverything")}</option>
            </select>
          </label>
          <p class="hint">{ui("offline.scopeHint")}</p>

          <div class="row">
            <button
              type="button"
              class="primary"
              disabled={!onCopyOffline}
              title={onCopyOffline ? undefined : ui("offline.copyNeedsTree")}
              onclick={() => onCopyOffline?.(scope)}
              data-testid="offline-copy"
            >
              <CloudDownload size={14} strokeWidth={1.9} /> {ui("offline.copy")}
            </button>
            {#if offline.held.files > 0}
              <button type="button" onclick={() => onOpenOffline?.()} data-testid="offline-open">
                {ui("offline.open")}
              </button>
            {/if}
            <!--
              Clearing is offered whenever the browser reports *any* usage, not
              only when a tree was recognised. A cancelled copy, or one from an
              older version, leaves bytes that nothing here would list — and
              storage you cannot reclaim from the page that wrote it is a trap.
            -->
            {#if offline.held.files > 0 || (offline.storage.usage ?? 0) > 65536}
              <button
                type="button"
                class="danger"
                onclick={() => offline.clear()}
                data-testid="offline-delete"
              >
                <Trash2 size={14} strokeWidth={1.9} />
                {offline.held.files > 0 ? ui("offline.delete") : ui("offline.clearAnyway")}
              </button>
            {/if}
          </div>

          {#if offline.storage.quota}
            <p class="hint">
              {ui("offline.storage", {
                used: formatBytes(offline.storage.usage ?? 0, uiLocale()),
                available: formatBytes(offline.storage.quota, uiLocale()),
              })}
            </p>
          {/if}
        {/if}
      </section>

      <!-- Said plainly because the asymmetry is surprising: a URL reopens by
           itself, a folder cannot. -->
      <p class="note">{ui("settings.reopenNote")}</p>
    </div>

    {#if tab === "language"}
      <div class="body">
        <section>
          <h2>{ui("language.interface")}</h2>
          <p class="hint">{ui("language.note")}</p>
          <div class="row">
            <select
              aria-label={ui("language.interface")}
              value={uiPreference()}
              onchange={(e) => setUiPreference(e.currentTarget.value as UiPreference)}
              data-testid="ui-language-select"
            >
              <!-- Naming what the browser resolves to, because "match my
                   browser" otherwise gives no way to tell what you will get
                   without selecting it and watching the page change. -->
              <option value="system">{ui("language.systemResolved", { label: systemLabel })}</option
              >
              {#each UI_LOCALES as l (l.tag)}
                <option value={l.tag}>{l.label}</option>
              {/each}
            </select>
          </div>
        </section>

        {#if showCatalogueLanguage}
          <section>
            <h2>{ui("language.catalogue")}</h2>
            <p class="hint">{ui("language.catalogueNote")}</p>
            <div class="row">
              <select
                aria-label={ui("language.catalogue")}
                value={language}
                onchange={(e) => onLanguage?.(e.currentTarget.value)}
                data-testid="language-select"
              >
                {#each languages as l (l)}
                  <option value={l}>{l}</option>
                {/each}
              </select>
            </div>
          </section>
        {/if}

        <section>
          <h2>{ui("settings.partNamesTitle")}</h2>
          {#if partNameCountry}
            <p class="hint">{ui("settings.partNamesResolved", { country: partNameCountry })}</p>
          {:else}
            <p class="hint warn">{ui("settings.partNamesMissing")}</p>
          {/if}
        </section>
      </div>
    {/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(16 21 28 / 45%);
  }
  .dialog {
    width: 100%;
    max-width: 620px;
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
  .close:hover {
    color: var(--ink);
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0 16px;
    border-bottom: 1px solid var(--rule);
  }
  .tabs button {
    padding: 0.3rem 0.7rem;
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
  .tabs button.on {
    background: var(--card);
    border-color: var(--rule);
    color: var(--ink);
    font-weight: 600;
  }
  .body {
    padding: 14px 16px 16px;
  }
  .body.hidden {
    display: none;
  }
  select {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--card);
    color: var(--ink);
  }
  .hint.warn {
    color: var(--red);
  }
  .lede {
    margin: 0 0 14px;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--ink-soft);
  }
  section {
    margin-bottom: 18px;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 4px;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--ink);
  }
  .hint {
    margin: 0 0 8px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--ink-faint);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  input {
    flex: 1;
    min-width: 14rem;
    font: inherit;
    font-size: 0.8rem;
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--card);
    color: var(--ink);
  }
  input:focus-visible,
  .row button:focus-visible {
    outline: 2px solid var(--blue);
    outline-offset: 1px;
  }
  .row button {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.55rem;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--card);
    font: inherit;
    font-size: 0.8rem;
    color: var(--ink);
    cursor: pointer;
  }
  .row button:hover:not(:disabled) {
    background: var(--paper);
  }
  .row button.primary {
    background: var(--blue);
    border-color: var(--blue);
    color: #fff;
  }
  .row button.primary:hover:not(:disabled) {
    background: var(--blue-soft);
  }
  .row button.danger {
    color: var(--red);
  }
  .row button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .current {
    margin: 8px 0 0;
    font-size: 11.5px;
    color: var(--ink-soft);
  }
  .warn {
    color: var(--red);
  }
  code {
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .error {
    margin: 0 0 10px;
    padding: 6px 8px;
    font-size: 12px;
    color: var(--red);
    background: color-mix(in srgb, var(--red) 6%, transparent);
    border-left: 2px solid var(--red);
  }
  .busy {
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--ink-soft);
  }
  .note {
    margin: 0;
    padding-top: 10px;
    border-top: 1px solid var(--rule-soft);
    font-size: 11px;
    line-height: 1.5;
    color: var(--ink-faint);
  }
</style>
