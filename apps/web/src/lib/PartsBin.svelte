<script lang="ts">
  /**
   * The parts bin, and the pick list it prints.
   *
   * Two renderings of the same data. The panel is for assembling the list; the
   * sheet below it is what comes out of a printer, and it exists in the DOM at
   * all times rather than being built on demand — `window.print()` cannot wait
   * for a component to mount, and a print stylesheet is the only reliable way
   * to control what a browser puts on paper.
   */
  import Printer from "@lucide/svelte/icons/printer";
  import Table from "@lucide/svelte/icons/table";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import Copy from "@lucide/svelte/icons/copy";
  import { CSV_COLUMNS, toCsv, type CsvColumn } from "./bin.js";
  import { bin } from "./bin.svelte.js";
  import { notes } from "./notes.svelte.js";
  import { copyText, download } from "./clipboard.js";
  import { ui, uiLocale } from "./ui.svelte.js";

  let { onClose }: { onClose: () => void } = $props();

  /** Which row's copy button has just fired, for the transient tick. */
  let copied = $state("");

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
  }

  async function copy(key: string, value: string): Promise<void> {
    copied = (await copyText(value)) ? key : "";
    setTimeout(() => (copied = ""), 1600);
  }

  function exportCsv(): void {
    const headers = Object.fromEntries(
      CSV_COLUMNS.map((c) => [c, ui(`bin.column.${c}` as never)]),
    ) as Record<CsvColumn, string>;
    download(
      ui("bin.csvFile"),
      toCsv(bin.entries, headers, {
        note: (ref) => notes.get(ref),
        confirmWord: ui("bin.confirm"),
      }),
      // A BOM here on purpose: it is what makes Excel read the file as UTF-8
      // rather than the system code page, and a part name with an accent is
      // otherwise mangled. The notes export must *not* have one.
      { bom: true },
    );
  }

  /** The vehicle the list was collected for, if every line agrees on one. */
  const forVehicle = $derived.by(() => {
    const set = new Set(bin.entries.map((e) => `${e.model ?? ""} ${e.vehicle ?? ""}`.trim()));
    return set.size === 1 ? [...set][0] : undefined;
  });

  const printedAt = $derived(
    new Intl.DateTimeFormat(uiLocale(), { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(),
    ),
  );
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="scrim" role="presentation" onclick={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={ui("bin.title")}
    data-testid="bin"
    onclick={(e) => e.stopPropagation()}
  >
    <header>
      <span class="eyebrow">{ui("bin.title")}</span>
      {#if bin.count > 0}
        <span class="counts" data-testid="bin-counts">
          {ui("bin.lines", { count: bin.count })} &middot; {ui("bin.pieces", {
            count: bin.pieces,
          })}
        </span>
      {/if}
      <span class="spacer"></span>
      <button class="close" onclick={onClose} aria-label={ui("chrome.close")} data-testid="bin-close">
        <X size={16} strokeWidth={1.9} />
      </button>
    </header>

    <div class="body">
      {#if bin.count === 0}
        <p class="empty">{ui("bin.empty")}</p>
      {:else}
        <table data-testid="bin-list">
          <thead>
            <tr>
              <th>{ui("bin.column.ref")}</th>
              <th>{ui("bin.column.name")}</th>
              <th class="qty">{ui("bin.quantity")}</th>
              <th class="act"></th>
            </tr>
          </thead>
          <tbody>
            {#each bin.entries as entry (entry.ref)}
              <tr data-testid="bin-row" data-ref={entry.ref}>
                <td class="ref">
                  <code>{entry.ref}</code>
                  {#if entry.undecided}
                    <span class="confirm" title={ui("bin.confirmTitle")}>{ui("bin.confirm")}</span>
                  {/if}
                  <button
                    class="mini"
                    class:done={copied === `r${entry.ref}`}
                    onclick={() => copy(`r${entry.ref}`, entry.ref)}
                    title={ui("parts.copyRef", { ref: entry.ref })}
                    aria-label={ui("parts.copyRef", { ref: entry.ref })}
                  >
                    <Copy size={11} strokeWidth={2} />
                  </button>
                </td>
                <td class="name">
                  {entry.name ?? ""}
                  <!-- Where it was found, because a pick list has to be acted
                       on and "which plate was this?" is the first question. -->
                  <span class="from">
                    {[entry.assemblyLabel ?? entry.assembly, entry.plate].filter(Boolean).join(" · ")}
                  </span>
                  {#if notes.get(entry.ref)}
                    <span class="note">{notes.get(entry.ref)}</span>
                  {/if}
                </td>
                <td class="qty">
                  <input
                    type="number"
                    min="1"
                    max="9999"
                    value={entry.quantity}
                    aria-label={ui("bin.quantity")}
                    data-testid="bin-qty"
                    onchange={(e) => bin.setQuantity(entry.ref, e.currentTarget.valueAsNumber)}
                  />
                </td>
                <td class="act">
                  <button
                    class="mini danger"
                    onclick={() => bin.remove(entry.ref)}
                    title={ui("bin.remove", { ref: entry.ref })}
                    aria-label={ui("bin.remove", { ref: entry.ref })}
                    data-testid="bin-remove"
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    {#if bin.count > 0}
      <footer>
        <button onclick={() => bin.clear()} class="danger" data-testid="bin-clear">
          <Trash2 size={13} strokeWidth={1.9} /> {ui("bin.clear")}
        </button>
        <span class="spacer"></span>
        <button onclick={exportCsv} data-testid="bin-csv">
          <Table size={13} strokeWidth={1.9} /> {ui("bin.csv")}
        </button>
        <button class="primary" onclick={() => window.print()} data-testid="bin-print">
          <Printer size={13} strokeWidth={1.9} /> {ui("bin.print")}
        </button>
      </footer>
    {/if}
  </div>
</div>

<!--
  The pick list. Present in the DOM whenever the panel is, hidden on screen and
  revealed only by the print stylesheet — `window.print()` is synchronous and
  cannot wait for anything to be built.
-->
<section class="sheet" data-print aria-hidden="true">
  <header>
    <h1>{ui("bin.title")}</h1>
    <p class="meta">
      {#if forVehicle}{ui("bin.printedFor")}: {forVehicle} &middot; {/if}{printedAt}
      &middot; {ui("bin.lines", { count: bin.count })} &middot; {ui("bin.pieces", {
        count: bin.pieces,
      })}
    </p>
  </header>
  <table>
    <thead>
      <tr>
        <th>{ui("bin.column.ref")}</th>
        <th>{ui("bin.column.name")}</th>
        <th>{ui("bin.quantity")}</th>
        <th>{ui("bin.from")}</th>
        <th>{ui("bin.column.note")}</th>
      </tr>
    </thead>
    <tbody>
      {#each bin.entries as entry (entry.ref)}
        <tr>
          <td><code>{entry.ref}</code>{#if entry.undecided} ({ui("bin.confirm")}){/if}</td>
          <td>{entry.name ?? ""}</td>
          <td>{entry.quantity}</td>
          <td>{[entry.assemblyLabel ?? entry.assembly, entry.plate].filter(Boolean).join(" · ")}</td>
          <td>{notes.get(entry.ref) ?? ""}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="footer">{ui("bin.footer")}</p>
</section>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 34%, transparent);
    display: grid;
    place-items: center;
    z-index: 40;
    padding: 1.5rem;
  }
  .dialog {
    width: min(46rem, 100%);
    max-height: min(80vh, 42rem);
    display: flex;
    flex-direction: column;
    background: var(--card);
    border: 1px solid var(--rule);
    border-radius: 4px;
    box-shadow: 0 12px 40px color-mix(in srgb, var(--ink) 22%, transparent);
  }
  header,
  footer {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--rule);
  }
  footer {
    border-bottom: none;
    border-top: 1px solid var(--rule);
  }
  .eyebrow {
    font-size: 0.72rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--dim);
  }
  .counts {
    font-size: 0.74rem;
    color: var(--dim);
    font-variant-numeric: tabular-nums;
  }
  .spacer {
    flex: 1;
  }
  .body {
    overflow: auto;
    padding: 0.4rem 0.9rem 0.9rem;
  }
  .empty {
    color: var(--dim);
    font-size: 0.85rem;
    padding: 1.4rem 0;
    text-align: center;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.84rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.35rem 0.5rem 0.35rem 0;
    border-bottom: 1px solid var(--rule);
    vertical-align: top;
  }
  th {
    font-weight: 600;
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--dim);
  }
  code {
    font-family: var(--mono);
    font-size: 0.82rem;
  }
  .from,
  .note {
    display: block;
    font-size: 0.72rem;
    color: var(--dim);
  }
  .note {
    color: var(--blue);
  }
  .confirm {
    margin-left: 0.35rem;
    padding: 0 0.25rem;
    border-radius: 2px;
    background: color-mix(in srgb, var(--red) 14%, transparent);
    color: var(--red);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  td.qty,
  th.qty {
    width: 4.5rem;
  }
  td.qty input {
    width: 3.6rem;
    font: inherit;
    font-variant-numeric: tabular-nums;
    padding: 0.15rem 0.3rem;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--bg);
    color: var(--ink);
  }
  th.act,
  td.act {
    width: 1.6rem;
    text-align: right;
  }
  .mini {
    border: 0;
    background: none;
    padding: 0 0.15rem;
    color: var(--dim);
    cursor: pointer;
    vertical-align: -1px;
  }
  .mini:hover {
    color: var(--ink);
  }
  .mini.done {
    color: var(--blue);
  }
  .mini.danger:hover {
    color: var(--red);
  }
  footer button {
    font: inherit;
    font-size: 0.8rem;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--rule);
    border-radius: 3px;
    background: var(--card);
    color: var(--ink);
    cursor: pointer;
  }
  footer button.primary {
    border-color: var(--blue);
    color: var(--blue);
  }
  footer button.danger:hover {
    color: var(--red);
    border-color: var(--red);
  }

  /* The printed sheet: absent from the screen, and the only thing on paper. */
  .sheet {
    display: none;
  }
  @media print {
    .sheet {
      display: block;
      font-size: 10pt;
      color: #000;
    }
    .sheet h1 {
      font-size: 14pt;
      margin: 0;
    }
    .sheet .meta {
      margin: 0.2rem 0 0.8rem;
      font-size: 9pt;
      color: #333;
    }
    .sheet table {
      width: 100%;
      border-collapse: collapse;
    }
    .sheet th,
    .sheet td {
      border-bottom: 1px solid #999;
      padding: 3pt 6pt 3pt 0;
      text-align: left;
      vertical-align: top;
    }
    /* Repeat the header on every page: a two-page pick list whose second page
       has unlabelled columns is worse than useless at a parts desk. */
    .sheet thead {
      display: table-header-group;
    }
    .sheet tr {
      page-break-inside: avoid;
    }
    .sheet .footer {
      margin-top: 0.8rem;
      font-size: 8pt;
      color: #333;
    }
  }
</style>
