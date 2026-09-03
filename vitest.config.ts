import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    // The browser suite launches Chromium and walks a real catalogue, so the
    // default 5 s timeout is not enough for opening a 7 MB index.
    testTimeout: process.env.DIALOGYSX_E2E_URL ? 120_000 : 5_000,
    hookTimeout: 60_000,
  },
});
