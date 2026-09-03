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
  import type { ResolvedPlate } from "@dialogysx/catalogue";

  interface Props {
    plate: ResolvedPlate;
    active: number | undefined;
    onHover: (repere: number | undefined) => void;
    onPin: (repere: number) => void;
  }

  let { plate, active, onHover, onPin }: Props = $props();

  /**
   * How many OR'd alternatives to show before collapsing.
   *
   * Real conditions run long — one engine-block plate here has twenty — so a
   * cell that renders all of them buries the table.
   */
  const SHOWN = 2;

  let expanded = $state<Set<string>>(new Set());
  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  };

  const rows = $derived(
    plate.reperes.flatMap((r) => [
      ...r.fits.map((c) => ({ repere: r.repere, cand: c, state: "fits" as const })),
      ...r.unknown.map((c) => ({ repere: r.repere, cand: c, state: "unknown" as const })),
    ]),
  );
</script>

{#if rows.length === 0}
  <p class="empty">No parts on this plate fit the selected vehicle.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th class="num">No.</th>
        <th>Reference</th>
        <th>Applies</th>
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
          <td>
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
          <td class="cond">
            {#if row.state === "unknown"}
              <span class="tag maybe">undecided</span>
            {/if}
            {#if row.cand.applicabilityUnresolved}
              <span class="dim">damaged condition reference</span>
            {:else if row.cand.conditionLines && row.cand.conditionLines.length > 0}
              {@const id = `${row.repere}-${row.cand.ref}-${i}`}
              {@const all = row.cand.conditionLines}
              {@const open = expanded.has(id)}
              <ul class="alts">
                {#each open ? all : all.slice(0, SHOWN) as line (line)}
                  <li>{line}</li>
                {/each}
              </ul>
              {#if all.length > SHOWN}
                <button class="more" onclick={(e) => (e.stopPropagation(), toggle(id))}>
                  {open ? "fewer" : `+${all.length - SHOWN} more`}
                </button>
              {/if}
            {:else}
              <span class="dim">always</span>
            {/if}
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
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  th {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
    font-weight: 600;
    position: sticky;
    top: 0;
    background: var(--bg);
  }
  .num {
    width: 2.5rem;
    text-align: right;
    padding-right: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--dim);
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: color-mix(in srgb, var(--accent) 7%, transparent);
  }
  tbody tr.active {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }
  tbody tr.active .num {
    color: var(--accent);
    font-weight: 600;
  }
  tr.unknown code {
    color: var(--dim);
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.95em;
  }
  .cond {
    color: var(--dim);
    font-size: 0.8rem;
  }
  .dim {
    color: var(--dim);
  }
  .sup {
    font-family: ui-monospace, monospace;
    font-size: 0.8em;
    color: var(--accent);
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
  .tag.maybe {
    color: var(--warn);
  }
  .tag.choice {
    color: var(--dim);
  }
  .empty {
    color: var(--dim);
    font-size: 0.85rem;
  }
  .alts {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .alts li {
    margin-bottom: 0.1rem;
  }
  .alts li + li::before {
    content: "or ";
    color: var(--accent);
  }
  .more {
    font: inherit;
    font-size: 0.72rem;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
</style>
