<script lang="ts">
  /**
   * The parts on a plate, grouped by callout.
   *
   * Undecided candidates are shown, marked, and **not hidden** — that is the
   * whole point of the three-valued evaluation. A part whose applicability
   * could not be decided might well fit; dropping it would quietly narrow the
   * catalogue, which is the failure this project is most careful about.
   */
  // Condition text is precomputed by the session, which holds the PR group's
  // value table; the interface has no way to resolve operand indices itself.
  import Copy from "@lucide/svelte/icons/copy";
  import Info from "@lucide/svelte/icons/info";
  import ShoppingCart from "@lucide/svelte/icons/shopping-cart";
  import StickyNote from "@lucide/svelte/icons/sticky-note";
  import { ui } from "./ui.svelte.js";
  import X from "@lucide/svelte/icons/x";
  import type { ResolvedPlate } from "@dialogysx/catalogue";
  import type { BinProvenance } from "./bin.js";
  import { bin } from "./bin.svelte.js";
  import { notes } from "./notes.svelte.js";
  import { copyText } from "./clipboard.js";

  interface Props {
    plate: ResolvedPlate;
    active: number | undefined;
    onHover: (repere: number | undefined) => void;
    onPin: (repere: number) => void;
    /** Where these parts were found, recorded on anything added to the bin. */
    provenance?: BinProvenance;
    /** Opens the note editor for a reference. */
    onNote?: (ref: string, name?: string) => void;
  }

  let { plate, active, onHover, onPin, provenance = {}, onNote }: Props = $props();

  /** Which action has just fired, for the transient tick. */
  let flashed = $state("");

  function flash(key: string): void {
    flashed = key;
    setTimeout(() => (flashed = ""), 1600);
  }

  /**
   * Copy, without also selecting the callout.
   *
   * The row's own click pins a callout, which is not what a copy button means,
   * so the event stops here.
   */
  async function copy(key: string, value: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    if (await copyText(value)) flash(key);
  }

  const rows = $derived(
    plate.reperes.flatMap((r) => [
      ...r.fits.map((c) => ({ repere: r.repere, cand: c, state: "fits" as const })),
      ...r.unknown.map((c) => ({ repere: r.repere, cand: c, state: "unknown" as const })),
    ]),
  );

  type Row = (typeof rows)[number];

  /**
   * Add a row to the bin.
   *
   * Quantity is 1, not the plate's own: `RefQte` exists in this data but lives
   * in the consigne blocks and never reaches the parts list, so there is
   * nothing truthful to seed from. It is editable in the bin.
   *
   * `undecided` rides along because it changes what the line *means* — a
   * number to confirm before ordering rather than one shown to fit.
   */
  function addToBin(row: Row, event: MouseEvent): void {
    event.stopPropagation();
    bin.add({
      ref: row.cand.ref,
      name: row.cand.name,
      quantity: 1,
      undecided: row.state === "unknown",
      repere: row.repere,
      ...provenance,
    });
    flash(`b${row.cand.ref}`);
  }

  /** The row whose applicability is being shown, if any. */
  let detail = $state<{ row: Row; i: number } | undefined>(undefined);

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") detail = undefined;
  }
</script>

<svelte:window onkeydown={onKey} />

{#if detail}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="scrim" role="presentation" onclick={() => (detail = undefined)}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="why-dialog"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label={ui("parts.detailTitle")}
      data-testid="applies-detail"
      onclick={(e) => e.stopPropagation()}
    >
      <header>
        <code>{detail.row.cand.ref}</code>
        {#if detail.row.cand.name}<span class="dname">{detail.row.cand.name}</span>{/if}
        <button class="close" onclick={() => (detail = undefined)} aria-label={ui("chrome.close")}>
          <X size={16} strokeWidth={1.9} />
        </button>
      </header>
      <p class="lead">
        {#if detail.row.state === "unknown"}
          {ui("parts.detailUndecidedLead")}
        {:else}
          {ui("parts.detailFitsLead")}
        {/if}
      </p>
      <ol>
        {#each detail.row.cand.conditionLines ?? [] as line (line)}
          <li>{line}</li>
        {/each}
      </ol>
    </div>
  </div>
{/if}

{#if rows.length === 0}
  <p class="empty">{ui("parts.empty")}</p>
{:else}
  <table>
    <thead>
      <tr>
        <th class="num">{ui("parts.no")}</th>
        <th>{ui("parts.reference")}</th>
        <th>{ui("parts.description")}</th>
        <th class="cond" aria-label={ui("parts.applies")}></th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row, i (`${row.repere}-${row.cand.ref}-${i}`)}
        <tr
          class:active={active === row.repere}
          class:unknown={row.state === "unknown"}
          onmouseenter={() => onHover(row.repere)}
          onmouseleave={() => onHover(undefined)}
          onclick={() => onPin(row.repere)}
        >
          <td class="num">{row.repere}</td>
          <td class="ref">
            <code>{row.cand.ref}</code>
            {#if row.cand.replacements}
              <span class="sup" title={ui("parts.supersededBy")}>&rarr; {row.cand.replacements.join(", ")}</span>
            {/if}
            {#if row.cand.needsChoice}
              <span class="tag choice" title={ui("parts.choiceTitle")}
                >{ui("parts.choice")}</span
              >
            {/if}
            <!--
              Row actions. A cart with the reference, a note marker, and copy
              for the number and the name. Revealed rather than always shown —
              see the note in the stylesheet.
            -->
            <button
              class="reveal add"
              class:has={bin.has(row.cand.ref)}
              class:done={flashed === `b${row.cand.ref}`}
              onclick={(e) => addToBin(row, e)}
              title={ui("bin.add", { ref: row.cand.ref })}
              aria-label={ui("bin.add", { ref: row.cand.ref })}
              data-testid="row-add"
            >
              <ShoppingCart size={12} strokeWidth={2} />
            </button>
            <button
              class="reveal note"
              class:has={Boolean(notes.get(row.cand.ref))}
              onclick={(e) => {
                e.stopPropagation();
                onNote?.(row.cand.ref, row.cand.name);
              }}
              title={notes.get(row.cand.ref) ?? ui("note.add", { ref: row.cand.ref })}
              aria-label={ui("note.edit", { ref: row.cand.ref })}
              data-testid="row-note"
            >
              <StickyNote size={12} strokeWidth={2} />
            </button>
            <button
              class="reveal copy"
              class:done={flashed === `r${row.cand.ref}`}
              onclick={(e) => copy(`r${row.cand.ref}`, row.cand.ref, e)}
              title={ui("parts.copyRef", { ref: row.cand.ref })}
              aria-label={ui("parts.copyRef", { ref: row.cand.ref })}
              data-testid="row-copy-ref"
            >
              <Copy size={11} strokeWidth={2} />
            </button>
          </td>
          <td class="name">
            {#if row.cand.name}
              {row.cand.name}
              <!-- Only when there is a name to copy: a button that would put
                   "not in this tariff" on the clipboard is worse than none. -->
              <button
                class="reveal copy"
                class:done={flashed === `n${row.cand.ref}`}
                onclick={(e) => copy(`n${row.cand.ref}`, row.cand.name ?? "", e)}
                title={ui("parts.copyName", { name: row.cand.name })}
                aria-label={ui("parts.copyName", { name: row.cand.name })}
                data-testid="row-copy-name"
              >
                <Copy size={11} strokeWidth={2} />
              </button>
            {:else}
              <!-- A tariff names only the parts sold in that market, so under
                   half of all references have a description. Say so rather
                   than leave the cell blank, which reads as a bug. -->
              <span class="dim" title={ui("parts.notInTariffTitle")}>{ui("parts.notInTariff")}</span>
            {/if}
          </td>
          <td class="cond">
            {#if row.cand.applicabilityUnresolved}
              <span class="dim" title={ui("parts.damagedTitle")}
                >{ui("parts.damaged")}</span
              >
            {:else if row.cand.conditionLines && row.cand.conditionLines.length > 0}
              <!--
                On demand, not inline. One engine-block candidate has twenty
                OR'd alternatives, each naming a dozen criterion values, and
                rendered in the cell it made a single row taller than the
                drawing beside it. The count is the useful part at a glance —
                "one condition" and "twenty" mean different things — and the
                text is a click away.
              -->
              <button
                class="why"
                class:undecided={row.state === "unknown"}
                title={row.state === "unknown"
                  ? ui("parts.whyUndecidedTitle")
                  : ui("parts.whyTitle")}
                aria-label={row.state === "unknown"
                  ? ui("parts.whyUndecidedLabel", { ref: row.cand.ref })
                  : ui("parts.whyLabel", { ref: row.cand.ref })}
                onclick={(e) => (e.stopPropagation(), (detail = { row, i }))}
              >
                <Info size={13} strokeWidth={1.9} />
                {#if row.cand.conditionLines.length > 1}
                  <span class="n">{row.cand.conditionLines.length}</span>
                {/if}
              </button>
            {/if}
            <!-- Nothing at all when the part has no conditions, which is most
                 of them: "always" on every second row was a column of the same
                 word. No icon means nothing to ask about. -->
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  /*
   * Revealed, not added.
   *
   * Ninety rows each carrying four visible buttons is a wall of icons, so they
   * sit at zero opacity and appear for the row in question — on hover where
   * there is a hovering pointer, and on the *selected* row where there is not,
   * because a touch user's only way to indicate a row is to tap it, which is
   * already what pins the callout.
   *
   * `pointer-events: none` while hidden matters: an invisible button that was
   * still clickable would put a copy control over every part number on the
   * plate. Keyboard focus is unaffected, so tabbing in still reveals them
   * through `:focus-within`.
   */
  .reveal {
    display: inline-flex;
    vertical-align: -1px;
    margin-left: 0.28rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--dim);
    opacity: 0;
    pointer-events: none;
    cursor: pointer;
    transition: opacity 90ms linear;
  }
  tr.active .reveal,
  tr:focus-within .reveal {
    opacity: 1;
    pointer-events: auto;
  }
  @media (hover: hover) and (pointer: fine) {
    tr:hover .reveal {
      opacity: 1;
      pointer-events: auto;
    }
  }
  .reveal:hover {
    color: var(--ink);
  }
  /* A confirmation that reads at a glance and needs no layout shift. */
  .reveal.done {
    opacity: 1;
    pointer-events: auto;
    color: var(--blue);
  }
  /*
   * A part already in the bin, or carrying a note, keeps its marker visible —
   * so both can be found again without hovering every row in turn.
   */
  .add.has,
  .note.has {
    opacity: 1;
    pointer-events: auto;
    color: var(--blue);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.86rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.3rem 0.6rem 0.3rem 0;
    border-bottom: 1px solid var(--rule);
    vertical-align: top;
  }
  th {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-faint);
    font-weight: 600;
    position: sticky;
    top: 0;
    background: var(--card);
  }
  .num {
    width: 2.5rem;
    text-align: right;
    padding-right: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--ink-faint);
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: color-mix(in srgb, var(--blue) 7%, transparent);
  }
  tbody tr.active {
    background: color-mix(in srgb, var(--blue) 15%, transparent);
  }
  tbody tr.active .num {
    color: var(--blue);
    font-weight: 600;
  }
  tr.unknown code {
    color: var(--ink-faint);
  }
  code {
    font-family: var(--mono);
    font-size: 0.95em;
  }
  .cond {
    color: var(--ink-faint);
    font-size: 0.8rem;
  }
  .ref {
    white-space: nowrap;
  }
  .name {
    color: var(--ink);
    min-width: 9rem;
  }
  .dim {
    color: var(--ink-faint);
  }
  .sup {
    font-family: var(--mono);
    font-size: 0.8em;
    color: var(--blue);
    margin-left: 0.4rem;
  }
  .tag {
    display: inline-block;
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.05rem 0.3rem;
    border-radius: 2px;
    border: 1px solid currentColor;
    margin-right: 0.35rem;
  }
  .tag.choice {
    color: var(--ink-faint);
  }
  .empty {
    color: var(--ink-faint);
    font-size: 0.85rem;
  }
  .why {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.05rem 0.2rem;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--card);
    color: var(--ink-soft);
    cursor: pointer;
    vertical-align: middle;
  }
  .why:hover {
    background: var(--paper);
    color: var(--blue);
  }
  /*
   * Undecided is a property of the row, and it was a word in its own column.
   * As the icon's colour it costs no width and still reads at a glance; the
   * reason is in the tooltip and the accessible name, so it is not colour
   * alone that carries it.
   */
  .why.undecided {
    color: var(--red);
    border-color: color-mix(in srgb, var(--red) 45%, var(--rule));
  }
  .why.undecided:hover {
    color: var(--red);
    background: color-mix(in srgb, var(--red) 8%, transparent);
  }
  .why .n {
    font-family: var(--mono);
    font-size: 0.66rem;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 45;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(16 21 28 / 45%);
  }
  .why-dialog {
    width: 100%;
    max-width: 44rem;
    max-height: 100%;
    overflow-y: auto;
    padding: 12px 16px 16px;
    background: var(--card);
    border: 1px solid var(--rule);
    border-left: 3px solid var(--blue);
  }
  .why-dialog header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 8px;
  }
  .dname {
    font-size: 0.86rem;
    color: var(--ink-soft);
  }
  .why-dialog .close {
    margin-left: auto;
    display: flex;
    padding: 2px;
    border: 0;
    background: none;
    color: var(--ink-faint);
    cursor: pointer;
  }
  .lead {
    margin: 0 0 10px;
    font-size: 0.8rem;
    color: var(--ink-soft);
  }
  .why-dialog ol {
    margin: 0;
    padding-left: 1.4rem;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--ink);
  }
  .why-dialog li + li {
    margin-top: 4px;
  }
</style>
