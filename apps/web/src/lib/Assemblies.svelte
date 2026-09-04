<script lang="ts">
  /**
   * The assembly menu, as a panel rather than a dropdown.
   *
   * It was a combobox in the identification bar, which was wrong twice over.
   * It is not identification — the repair documents are indexed by vehicle
   * *family* and never see the assembly, so it belongs to the parts view alone.
   * And a dropdown is a poor fit for a menu of 346 entries in three levels
   * (3 sections, 77 domains, 346 assemblies): you cannot see where you are, and
   * every move costs an open-and-close.
   *
   * The original shows three cascading columns plus a name search. One scrolling
   * list grouped by domain does the same work in the space available, and the
   * search matches a substring of the name, the domain or the code — because
   * "Complete engine" is findable by "engine", by "10" and by "1010A", and a
   * mechanic will try all three.
   */
  import Search from "@lucide/svelte/icons/search";
  import type { AssemblyEntry } from "@dialogysx/catalogue";

  interface Props {
    /** Already filtered by the "hide with no parts" toggle. */
    items: AssemblyEntry[];
    selected: string | undefined;
    /** How many are hidden as empty, for the toggle's label. */
    hiddenCount: number;
    onlyAvailable: boolean;
    /** Per assembly, how many plates it yields; absent while still counting. */
    availability: Map<string, { plates: number; unknown: number }>;
    disabled: boolean;
    onPick: (code: string) => void;
    onToggleAvailable: (value: boolean) => void;
  }

  let {
    items,
    selected,
    hiddenCount,
    onlyAvailable,
    availability,
    disabled,
    onPick,
    onToggleAvailable,
  }: Props = $props();

  let query = $state("");

  const filtered = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return items;
    return items.filter((a) =>
      [a.label, a.domainLabel, a.sectionLabel, a.code, a.domain]
        .filter((s): s is string => s !== undefined)
        .some((s) => s.toLowerCase().includes(needle)),
    );
  });

  /** Grouped by section then domain, so the three levels stay visible. */
  const groups = $derived.by(() => {
    const out: { key: string; section: string; domain: string; items: AssemblyEntry[] }[] = [];
    const index = new Map<string, number>();
    for (const a of filtered) {
      const key = `${a.section ?? "?"}/${a.domain ?? "?"}`;
      let at = index.get(key);
      if (at === undefined) {
        at = out.length;
        index.set(key, at);
        out.push({
          key,
          section: a.sectionLabel ?? a.section ?? "",
          domain: a.domainLabel ?? a.domain ?? "",
          items: [],
        });
      }
      out[at]!.items.push(a);
    }
    return out;
  });

  /** Does this assembly yield anything for the vehicle? */
  function empty(a: AssemblyEntry): boolean {
    const av = availability.get(a.code);
    return av !== undefined && av.plates === 0 && av.unknown === 0;
  }
</script>

<div class="panel">
  <div class="head">
    <span class="label">Assembly</span>
    <span class="count">{filtered.length}</span>
  </div>

  <div class="search">
    <Search size={13} strokeWidth={1.9} />
    <input
      type="search"
      bind:value={query}
      {disabled}
      placeholder="engine, 1010A, brakes…"
      aria-label="Search assemblies"
      data-testid="assembly-search"
    />
  </div>

  {#if hiddenCount > 0}
    <!-- Say what is hidden. Two thirds of the menu can be empty for a given
         vehicle, and silently shortening it looks like missing data. -->
    <label class="hide">
      <input
        type="checkbox"
        checked={onlyAvailable}
        onchange={(e) => onToggleAvailable(e.currentTarget.checked)}
      />
      hide {hiddenCount} with no parts
    </label>
  {/if}

  <div class="list" data-testid="assembly-list">
    {#if disabled}
      <p class="none">Choose a vehicle first.</p>
    {:else if filtered.length === 0}
      <p class="none">
        {query.trim().length > 0 ? "Nothing matches that." : "No assemblies for this vehicle."}
      </p>
    {:else}
      {#each groups as g (g.key)}
        <div class="group">
          <div class="gh">
            <span class="dom">{g.domain}</span>
            {#if g.section}<span class="sec">{g.section}</span>{/if}
          </div>
          {#each g.items as a (a.code)}
            <button
              type="button"
              class:on={a.code === selected}
              class:empty={empty(a)}
              onclick={() => onPick(a.code)}
              title={a.label ?? a.code}
            >
              <span class="t">{a.label ?? a.code}</span>
              <code>{a.code}</code>
            </button>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--rule-soft);
    border-radius: 2px;
    background: var(--card);
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem 0.2rem;
  }
  .label {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .count {
    font-family: var(--mono);
    font-size: 0.7rem;
    color: var(--ink-faint);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0 0.5rem 0.35rem;
    color: var(--ink-faint);
  }
  input[type="search"] {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 0.78rem;
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--card);
    color: var(--ink);
  }
  input[type="search"]:focus-visible {
    outline: 2px solid var(--blue);
    outline-offset: 1px;
  }
  .hide {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0 0.5rem 0.35rem;
    font-size: 0.7rem;
    color: var(--ink-faint);
  }
  .hide input {
    margin: 0;
  }
  .list {
    flex: 1;
    min-height: 0;
    /* Tall enough to be worth scrolling, short enough that the drawing beside
       it stays the thing you look at. */
    max-height: 34rem;
    overflow-y: auto;
    border-top: 1px solid var(--rule-soft);
  }
  .none {
    margin: 0;
    padding: 0.5rem;
    font-size: 0.78rem;
    color: var(--ink-faint);
  }
  .gh {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem 0.15rem;
    background: var(--paper);
    border-bottom: 1px solid var(--rule-soft);
    position: sticky;
    top: 0;
  }
  .dom {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .sec {
    font-size: 0.64rem;
    color: var(--ink-faint);
    white-space: nowrap;
  }
  button {
    display: flex;
    width: 100%;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.2rem 0.5rem;
    border: 0;
    background: none;
    font: inherit;
    font-size: 0.78rem;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }
  button:hover {
    background: var(--paper);
  }
  button.on {
    background: var(--blue);
    color: #fff;
  }
  button.on code {
    color: rgb(255 255 255 / 75%);
  }
  /* Nothing for this vehicle, shown only when the hide toggle is off. */
  button.empty .t {
    color: var(--ink-faint);
  }
  button.on.empty .t {
    color: #fff;
  }
  .t {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  code {
    font-family: var(--mono);
    font-size: 0.68rem;
    color: var(--ink-faint);
    flex: none;
  }
</style>
