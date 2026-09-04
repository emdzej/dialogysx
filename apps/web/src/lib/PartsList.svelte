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
  import Info from "@lucide/svelte/icons/info";
  import X from "@lucide/svelte/icons/x";
  import type { ResolvedPlate } from "@dialogysx/catalogue";

  interface Props {
    plate: ResolvedPlate;
    active: number | undefined;
    onHover: (repere: number | undefined) => void;
    onPin: (repere: number) => void;
  }

  let { plate, active, onHover, onPin }: Props = $props();

  const rows = $derived(
    plate.reperes.flatMap((r) => [
      ...r.fits.map((c) => ({ repere: r.repere, cand: c, state: "fits" as const })),
      ...r.unknown.map((c) => ({ repere: r.repere, cand: c, state: "unknown" as const })),
    ]),
  );

  type Row = (typeof rows)[number];

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
      aria-label="When this part applies"
      data-testid="applies-detail"
      onclick={(e) => e.stopPropagation()}
    >
      <header>
        <code>{detail.row.cand.ref}</code>
        {#if detail.row.cand.name}<span class="dname">{detail.row.cand.name}</span>{/if}
        <button class="close" onclick={() => (detail = undefined)} aria-label="Close">
          <X size={16} strokeWidth={1.9} />
        </button>
      </header>
      <p class="lead">
        {#if detail.row.state === "unknown"}
          Undecided: this vehicle does not answer every criterion below. Fits if <em>any</em> of
          these hold.
        {:else}
          Fits because <em>one</em> of these holds.
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
  <p class="empty">No parts on this plate fit the selected vehicle.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th class="num">No.</th>
        <th>Reference</th>
        <th>Description</th>
        <th class="cond" aria-label="Applies"></th>
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
              <span class="sup" title="Superseded by">&rarr; {row.cand.replacements.join(", ")}</span>
            {/if}
            {#if row.cand.needsChoice}
              <span class="tag choice" title="The original asks the user to pick between variants"
                >choice</span
              >
            {/if}
          </td>
          <td class="name">
            {#if row.cand.name}
              {row.cand.name}
            {:else}
              <!-- A tariff names only the parts sold in that market, so under
                   half of all references have a description. Say so rather
                   than leave the cell blank, which reads as a bug. -->
              <span class="dim" title="This tariff does not name this part">not in this tariff</span>
            {/if}
          </td>
          <td class="cond">
            {#if row.cand.applicabilityUnresolved}
              <span class="dim" title="This plate references a condition that is not in its pool"
                >damaged</span
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
                  ? "Undecided — this vehicle does not answer every criterion. Click for the conditions."
                  : "Click for the conditions this part applies under"}
                aria-label={row.state === "unknown"
                  ? `${row.cand.ref}: undecided, show the conditions`
                  : `${row.cand.ref}: show the conditions`}
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
