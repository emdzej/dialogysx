import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  server: {
    // The static data tree is served from wherever the user put it; during
    // development point this at a local copy. Range requests must pass through.
    fs: { allow: [".."] },
  },
});
