<script lang="ts">
  /**
   * A Lucide icon, drawn from its path data rather than from the package.
   *
   * ddtx imports `@lucide/svelte/icons/<name>` and that is the right call
   * there. Here it would mean a 65 MB dependency with a file per icon for the
   * three glyphs this interface uses, so the paths are inlined — the same thing
   * ddtx does for the GitHub mark, and for the same reason: it takes
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
  const PATHS: Readonly<Record<string, readonly string[]>> = {
    download: ["M12 15V3", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5"],
    "external-link": [
      "M15 3h6v6",
      "M10 14 21 3",
      "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
    ],
    x: ["M18 6 6 18", "m6 6 12 12"],
  };

  interface Props {
    name: keyof typeof PATHS;
    size?: number;
    strokeWidth?: number;
  }

  let { name, size = 15, strokeWidth = 1.9 }: Props = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each PATHS[name] ?? [] as d (d)}
    <path {d} />
  {/each}
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
