<script lang="ts">
  /**
   * The parts drawing, with its callouts as clickable hotspots.
   *
   * Coordinates come from `TRepere` and are pixels in the drawing's own space
   * (1000 x 820 for parts drawings, with a 20 x 20 hotspot per
   * `Repere.contains`). The image is scaled to fit, so hotspots are positioned
   * in **percentages of the natural size** rather than pixels — otherwise they
   * drift the moment the panel is any other width.
   *
   * Natural size is read off the loaded image rather than assumed: a handful of
   * drawings are not 1000 x 820, and a hard-coded denominator would put every
   * hotspot in the wrong place on those.
   */
  import { DRAWING_SIZE, REPERE_HOTSPOT_SIZE } from "@dialogysx/catalogue";

  interface Props {
    src: string | undefined;
    reperes: { repere: number; position?: { x: number; y: number } }[];
    active: number | undefined;
    onHover: (repere: number | undefined) => void;
    onPin: (repere: number) => void;
  }

  let { src, reperes, active, onHover, onPin }: Props = $props();

  // Explicitly widened: DRAWING_SIZE is `as const`, so inferring from it would
  // fix the type at 1000 x 820 and reject the measured size.
  let natural = $state<{ width: number; height: number }>({
    width: DRAWING_SIZE.width,
    height: DRAWING_SIZE.height,
  });
  let loaded = $state(false);
  let failed = $state(false);

  // Reset on a new drawing, or the previous one's size briefly mispositions
  // the new one's hotspots.
  $effect(() => {
    src;
    loaded = false;
    failed = false;
  });

  function onLoad(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    if (img.naturalWidth > 0) natural = { width: img.naturalWidth, height: img.naturalHeight };
    loaded = true;
  }

  const placed = $derived(
    reperes
      .filter((r) => r.position !== undefined)
      .map((r) => ({
        repere: r.repere,
        left: (r.position!.x / natural.width) * 100,
        top: (r.position!.y / natural.height) * 100,
        width: (REPERE_HOTSPOT_SIZE / natural.width) * 100,
        height: (REPERE_HOTSPOT_SIZE / natural.height) * 100,
      })),
  );
</script>

<div class="frame">
  {#if src === undefined}
    <p class="empty">No drawing for this plate.</p>
  {:else if failed}
    <p class="empty">
      Drawing not found in this tree.<br />
      <code>{src}</code>
    </p>
  {:else}
    <div class="stage">
      <img
        {src}
        alt="Parts drawing"
        onload={onLoad}
        onerror={() => (failed = true)}
        draggable="false"
      />
      {#if loaded}
        {#each placed as h (h.repere)}
          <button
            class="hotspot"
            class:active={active === h.repere}
            style="left:{h.left}%; top:{h.top}%; width:{h.width}%; height:{h.height}%"
            title="Callout {h.repere}"
            aria-label="Callout {h.repere}"
            onmouseenter={() => onHover(h.repere)}
            onmouseleave={() => onHover(undefined)}
            onfocus={() => onHover(h.repere)}
            onclick={() => onPin(h.repere)}
          ></button>
        {/each}
      {/if}
    </div>
    {#if loaded && placed.length === 0}
      <p class="note">No callout positions on record for this drawing.</p>
    {/if}
  {/if}
</div>

<style>
  .frame {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .stage {
    position: relative;
    /* A white mat: the drawings are black line art on transparent, so they
       vanish on a dark background. */
    background: #fff;
    border: 1px solid var(--rule);
    border-radius: 3px;
    line-height: 0;
  }
  img {
    width: 100%;
    height: auto;
    display: block;
    user-select: none;
  }
  .hotspot {
    position: absolute;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 2px;
    background: transparent;
    cursor: pointer;
    /* Give the 20x20 box a usable target without moving it: grow outward
       from its own centre. */
    outline-offset: 0;
    transition:
      background 90ms,
      border-color 90ms;
  }
  .hotspot:hover,
  .hotspot:focus-visible {
    background: color-mix(in srgb, var(--blue) 22%, transparent);
    border-color: var(--blue);
  }
  .hotspot.active {
    background: color-mix(in srgb, var(--blue) 34%, transparent);
    border-color: var(--blue);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--blue) 30%, transparent);
  }
  .empty,
  .note {
    color: var(--ink-faint);
    font-size: 0.85rem;
    margin: 0.5rem 0 0;
  }
  .empty {
    padding: 2rem 0;
    text-align: center;
  }
  code {
    font-family: var(--mono);
    font-size: 0.85em;
  }
</style>
