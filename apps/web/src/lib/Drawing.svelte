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
  import Copy from "@lucide/svelte/icons/copy";
  import { DRAWING_SIZE, REPERE_HOTSPOT_SIZE } from "@dialogysx/catalogue";
  import { ui } from "./ui.svelte.js";
  import { canvasToPng, copyImage } from "./clipboard.js";

  interface Props {
    src: string | undefined;
    reperes: { repere: number; position?: { x: number; y: number } }[];
    active: number | undefined;
    onHover: (repere: number | undefined) => void;
    onPin: (repere: number) => void;
  }

  let { src, reperes, active, onHover, onPin }: Props = $props();

  let image = $state<HTMLImageElement | undefined>(undefined);
  /** `""` while idle, then `ok` or `no` for a moment after a copy. */
  let copied = $state<"" | "ok" | "no">("");

  /**
   * Copy the drawing, with its callout numbers on it.
   *
   * The callouts are DOM overlays, so a copy of the image alone would be the
   * bare artwork — which is the half a colleague cannot read. They are painted
   * onto an offscreen canvas here instead, at the image's natural size so the
   * result does not depend on how wide the panel happened to be.
   *
   * `copyImage` is handed a *factory*: Safari only accepts a promise created
   * inside the user gesture, so building the blob first and awaiting it works
   * in Chrome and fails there.
   */
  async function copyDrawing(): Promise<void> {
    const img = image;
    if (!img) return;
    copied = (await copyImage(() => canvasToPng(compose(img)))) ? "ok" : "no";
    setTimeout(() => (copied = ""), 1800);
  }

  /** The drawing plus its callouts, on a canvas at natural size. */
  function compose(img: HTMLImageElement): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = natural.width;
    canvas.height = natural.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;

    // White, not transparent. A PNG with an alpha background pasted into a
    // document that assumes dark text becomes an invisible drawing.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const r = Math.max(9, Math.round(REPERE_HOTSPOT_SIZE * 0.6));
    ctx.font = `600 ${Math.round(r * 1.15)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const h of reperes) {
      if (!h.position) continue;
      // `TRepere` gives the hotspot's corner; the marker belongs at its
      // centre. `REPERE_HOTSPOT_SIZE` is a single number — the hotspot is
      // square — and reading `.width` off it yielded `undefined / 2`, so every
      // coordinate was NaN. `ctx.arc(NaN, …)` draws nothing and throws
      // nothing, which is why the first version copied a bare drawing and
      // reported success.
      const x = h.position.x + REPERE_HOTSPOT_SIZE / 2;
      const y = h.position.y + REPERE_HOTSPOT_SIZE / 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#c1121f";
      ctx.stroke();
      ctx.fillStyle = "#c1121f";
      ctx.fillText(String(h.repere), x, y);
    }
    return canvas;
  }

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
    <p class="empty">{ui("drawing.none")}</p>
  {:else if failed}
    <p class="empty">
      {ui("drawing.notFound")}<br />
      <code>{src}</code>
    </p>
  {:else}
    <div class="stage">
      <img
        bind:this={image}
        {src}
        alt={ui("drawing.alt")}
        onload={onLoad}
        onerror={() => (failed = true)}
        draggable="false"
      />
      {#if loaded}
        <!-- On the drawing rather than beside it: it acts on this image, and
             the frame has no other chrome to sit in. -->
        <button
          class="copy"
          class:ok={copied === "ok"}
          class:no={copied === "no"}
          onclick={copyDrawing}
          title={copied === "no" ? ui("drawing.copyFailed") : ui("drawing.copy")}
          aria-label={ui("drawing.copy")}
          data-testid="copy-drawing"
        >
          <Copy size={13} strokeWidth={2} />
          {#if copied === "ok"}<span class="said">{ui("drawing.copied")}</span>{/if}
        </button>
      {/if}
      {#if loaded}
        {#each placed as h (h.repere)}
          <button
            class="hotspot"
            class:active={active === h.repere}
            style="left:{h.left}%; top:{h.top}%; width:{h.width}%; height:{h.height}%"
            title={ui("drawing.callout", { id: h.repere })}
            aria-label={ui("drawing.callout", { id: h.repere })}
            onmouseenter={() => onHover(h.repere)}
            onmouseleave={() => onHover(undefined)}
            onfocus={() => onHover(h.repere)}
            onclick={() => onPin(h.repere)}
          ></button>
        {/each}
      {/if}
    </div>
    {#if loaded && placed.length === 0}
      <p class="note">{ui("drawing.noPositions")}</p>
    {/if}
  {/if}
</div>

<style>
  .copy {
    position: absolute;
    top: 4px;
    right: 4px;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.22rem 0.35rem;
    border: 1px solid var(--rule);
    border-radius: 3px;
    background: color-mix(in srgb, var(--card) 88%, transparent);
    color: var(--dim);
    cursor: pointer;
    opacity: 0;
    transition: opacity 90ms linear;
  }
  /* Same reasoning as the parts list: shown when the drawing is engaged, and
     always on a device with no hover to engage with. */
  .stage:hover .copy,
  .copy:focus-visible {
    opacity: 1;
  }
  @media (hover: none) {
    .copy {
      opacity: 1;
    }
  }
  .copy.ok {
    opacity: 1;
    color: var(--blue);
    border-color: var(--blue);
  }
  .copy.no {
    opacity: 1;
    color: var(--red);
    border-color: var(--red);
  }
  .said {
    font-size: 0.7rem;
  }
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
