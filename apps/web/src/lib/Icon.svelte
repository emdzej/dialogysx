<script lang="ts">
  /**
   * An icon, drawn from its path data rather than from a package.
   *
   * ddtx imports `@lucide/svelte/icons/<name>` and that is the right call
   * there. Here it would mean a 65 MB dependency with a file per icon for the
   * handful of glyphs this interface uses, so the paths are inlined — the same
   * thing ddtx does for the GitHub mark, and for the same reason: it takes
   * `currentColor` and needs no fetch. Lucide is ISC-licensed, which permits
   * this with the notice below.
   *
   * The `d` strings and the stroke defaults are copied verbatim from
   * `@lucide/svelte` v1.40.0 (`dist/icons/*.svelte` and
   * `dist/defaultAttributes.js`), so the rendering is identical to ddtx's. To
   * add an icon, take its `iconNode` from that package rather than drawing one:
   * hand-tuned paths in a set like this look subtly wrong next to the others.
   *
   * Lucide — ISC License. Copyright (c) for portions of Lucide are held by
   * Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for
   * Lucide are held by Lucide Contributors 2022.
   */
  interface Glyph {
    /** Lucide draws on 24x24 and strokes; GitHub's mark is 16x16 and filled. */
    box: number;
    filled?: boolean;
    paths: readonly string[];
  }

  const GLYPHS: Readonly<Record<string, Glyph>> = {
    download: {
      box: 24,
      paths: ["M12 15V3", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5"],
    },
    "external-link": {
      box: 24,
      paths: [
        "M15 3h6v6",
        "M10 14 21 3",
        "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
      ],
    },
    x: { box: 24, paths: ["M18 6 6 18", "m6 6 12 12"] },
    /**
     * GitHub's own mark, not a Lucide approximation of it.
     *
     * ddtx inlines this same path for the same reason: it takes `currentColor`
     * and needs no fetch. Filled on a 16x16 grid, which is why this component
     * carries a box size and a fill flag rather than assuming Lucide's.
     */
    github: {
      box: 16,
      filled: true,
      paths: [
        "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z",
      ],
    },
  };

  interface Props {
    name: keyof typeof GLYPHS;
    size?: number;
    strokeWidth?: number;
  }

  let { name, size = 15, strokeWidth = 1.9 }: Props = $props();
  const glyph = $derived(GLYPHS[name]);
</script>

{#if glyph}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox={`0 0 ${glyph.box} ${glyph.box}`}
    fill={glyph.filled ? "currentColor" : "none"}
    stroke={glyph.filled ? "none" : "currentColor"}
    stroke-width={glyph.filled ? undefined : strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#each glyph.paths as d (d)}
      <path {d} />
    {/each}
  </svg>
{/if}

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
