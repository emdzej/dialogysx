<script lang="ts" generics="T">
  /**
   * A searchable combobox.
   *
   * A native `<select>` was the wrong control here: the lists are long — 6,753
   * vehicles for one model, 346 assemblies — and type-ahead on a native select
   * only matches from the first character, so finding "Cylinder block" means
   * scrolling. This filters on any substring.
   *
   * Built rather than taken from a library because the behaviour needed is
   * small and specific: filter, keyboard-navigate, commit or cancel. Kept to
   * the ARIA combobox pattern so it is operable without a mouse, which matters
   * for a tool used one-handed next to a car.
   */
  interface Props {
    label: string;
    items: T[];
    /** Display text, also what the filter matches against. */
    text: (item: T) => string;
    /** Stable key for each item. */
    key: (item: T) => string;
    selected: T | undefined;
    disabled?: boolean;
    placeholder?: string;
    /** Extra right-aligned text per row, e.g. a code. */
    hint?: (item: T) => string | undefined;
    /** Marks a row as not fully decidable. */
    muted?: (item: T) => boolean;
    onPick: (item: T) => void;
    testid?: string;
  }

  let {
    label,
    items,
    text,
    key,
    selected,
    disabled = false,
    placeholder,
    hint,
    muted,
    onPick,
    testid,
  }: Props = $props();

  let open = $state(false);
  let query = $state("");
  let active = $state(0);
  let root: HTMLDivElement | undefined;
  let input: HTMLInputElement | undefined;
  let listbox = $state<HTMLUListElement | undefined>(undefined);

  const filtered = $derived(
    query.trim().length === 0
      ? items
      : items.filter((i) => {
          const needle = query.trim().toLowerCase();
          return (
            text(i).toLowerCase().includes(needle) ||
            (hint?.(i) ?? "").toLowerCase().includes(needle)
          );
        }),
  );

  // Keep the highlight inside the filtered range, or arrowing after a filter
  // lands on nothing.
  $effect(() => {
    if (active >= filtered.length) active = Math.max(0, filtered.length - 1);
  });

  function show() {
    if (disabled) return;
    open = true;
    query = "";
    active = Math.max(
      0,
      filtered.findIndex((i) => selected !== undefined && key(i) === key(selected)),
    );
  }

  function commit(item: T | undefined) {
    if (!item) return;
    onPick(item);
    open = false;
    query = "";
    input?.blur();
  }

  function onKey(e: KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      show();
      e.preventDefault();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      active = Math.min(active + 1, filtered.length - 1);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      active = Math.max(active - 1, 0);
      e.preventDefault();
    } else if (e.key === "Enter") {
      commit(filtered[active]);
      e.preventDefault();
    } else if (e.key === "Escape") {
      open = false;
      query = "";
      e.preventDefault();
    }
  }

  // Scroll the highlighted row into view while arrowing.
  $effect(() => {
    if (!open || !listbox) return;
    listbox.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  });

  function onBlur(e: FocusEvent) {
    // Only close when focus really left the widget, or clicking a row would
    // close it before the click registers.
    if (root && e.relatedTarget instanceof Node && root.contains(e.relatedTarget)) return;
    open = false;
    query = "";
  }
</script>

<div class="combo" bind:this={root} onfocusout={onBlur}>
  <span class="label" id="{testid}-label">{label}</span>
  <input
    bind:this={input}
    data-testid={testid}
    role="combobox"
    aria-expanded={open}
    aria-controls="{testid}-list"
    aria-labelledby="{testid}-label"
    aria-autocomplete="list"
    autocomplete="off"
    {disabled}
    placeholder={placeholder ?? `${items.length}…`}
    value={open ? query : (selected ? text(selected) : "")}
    oninput={(e) => {
      query = e.currentTarget.value;
      open = true;
    }}
    onfocus={show}
    onkeydown={onKey}
  />
  {#if open}
    <ul class="list" id="{testid}-list" role="listbox" bind:this={listbox}>
      {#if filtered.length === 0}
        <li class="none">no match</li>
      {:else}
        {#each filtered as item, i (key(item))}
          <li
            data-i={i}
            role="option"
            aria-selected={selected !== undefined && key(item) === key(selected)}
            class:active={i === active}
            class:muted={muted?.(item)}
            onmousedown={() => commit(item)}
            onmouseenter={() => (active = i)}
          >
            <span class="t">{text(item)}</span>
            {#if hint?.(item)}<span class="h">{hint(item)}</span>{/if}
          </li>
        {/each}
      {/if}
    </ul>
  {/if}
</div>

<style>
  .combo {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .label {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  input {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.2rem 0.35rem;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--card);
    color: var(--ink);
  }
  input:focus-visible {
    outline: 2px solid var(--blue);
    outline-offset: 1px;
  }
  input:disabled {
    opacity: 0.45;
  }
  .list {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 20;
    margin: 2px 0 0;
    padding: 0;
    list-style: none;
    min-width: 100%;
    max-width: 34rem;
    max-height: 20rem;
    overflow-y: auto;
    background: var(--card);
    border: 1px solid var(--blue);
    border-radius: 2px;
    box-shadow: 0 6px 18px rgb(16 21 28 / 18%);
  }
  .list li {
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.18rem 0.45rem;
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .list li.active {
    background: var(--blue);
    color: #fff;
  }
  .list li.muted .t {
    color: var(--ink-faint);
  }
  .list li.active.muted .t {
    color: #fff;
  }
  .h {
    font-family: var(--mono);
    font-size: 0.7rem;
    color: var(--ink-faint);
    flex: none;
  }
  .list li.active .h {
    color: rgb(255 255 255 / 75%);
  }
  .none {
    color: var(--ink-faint);
    cursor: default;
  }
</style>
