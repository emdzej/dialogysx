/**
 * Browser end-to-end tests, driven by `playwright-core` from vitest.
 *
 * No second test runner: this file launches Chromium itself and finds a binary
 * out of the Playwright cache, the same shape ddtx settled on. `pnpm test`
 * alone skips every test here, so a green unit run says nothing about whether
 * the interface works.
 *
 * Assertions are **vitest's** `expect` plus Playwright's own `waitFor`. The
 * matchers from `@playwright/test` (`toBeVisible`, `toHaveCount`, ...) do not
 * exist here and fail with "Invalid Chai property" — which is how the first run
 * of this file went.
 *
 * To actually run them you need a dev server **and** a data tree, because the
 * whole point is to exercise the real chain — group, vehicle, assembly, plate,
 * drawing, callouts:
 *
 * ```sh
 * DIALOGYSX_DATA=/path/to/tree pnpm --filter @dialogysx/web dev --port 5199
 * DIALOGYSX_E2E_URL=http://localhost:5199 pnpm test
 * ```
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env.DIALOGYSX_E2E_URL;

/**
 * A PR group known to have the full chain: 136 assemblies, an envelope row, and
 * plate `N100110` on drawing `1132M001` with five positioned callouts.
 */
const GROUP = "1132";

let browser: Browser | undefined;
let executable: string | undefined;
try {
  executable = chromium.executablePath();
} catch {
  executable = undefined;
}

const runnable = Boolean(URL) && Boolean(executable);

describe.skipIf(!runnable)("dialogysx in a browser", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: executable });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function openCatalogue(): Promise<Page> {
    const page = await browser!.newPage();
    await page.goto(URL!, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open URL" }).click();
    // Loading the indexes is a real amount of I/O; the PR group list is the
    // signal that the session opened.
    await page.getByTestId("groups").waitFor({ timeout: 60_000 });
    return page;
  }

  it("opens a data tree over HTTP Range and lists PR groups", async () => {
    const page = await openCatalogue();
    const groups = page.getByTestId("groups").getByRole("button");
    expect(await groups.count()).toBeGreaterThan(50);
    await page.getByTestId("groups").getByRole("button", { name: GROUP, exact: true }).waitFor();
    await page.close();
  });

  it("walks group to vehicle to assembly to plate, and renders the drawing", async () => {
    const page = await openCatalogue();

    await page.getByTestId("groups").getByRole("button", { name: GROUP, exact: true }).click();
    await page.getByTestId("vehicles").waitFor();
    expect(await page.getByTestId("vehicles").getByRole("button").count()).toBeGreaterThan(0);

    // A vehicle must be chosen before plates appear: applicability is
    // evaluated against it, so the plate list is vehicle-dependent.
    await page.getByTestId("vehicles").getByRole("button").first().click();
    await page.getByTestId("assemblies").getByRole("button").first().click();
    await page.getByTestId("plates").waitFor();

    await page.getByTestId("plates").getByRole("button").first().click();
    const key = page.getByTestId("plate-key");
    await key.waitFor();
    expect(await key.textContent()).toMatch(new RegExp(`^${GROUP}`));

    // The drawing has to actually load — a broken path would leave
    // naturalWidth at 0, and the hotspots would then be positioned against a
    // fallback size.
    const img = page.locator(".stage img");
    await img.waitFor();
    await page.waitForFunction(() => {
      const i = document.querySelector<HTMLImageElement>(".stage img");
      return Boolean(i && i.complete && i.naturalWidth > 0);
    });
    expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(100);

    await page.close();
  });

  it("puts every callout hotspot inside the drawing", async () => {
    const page = await openCatalogue();
    await page.getByTestId("groups").getByRole("button", { name: GROUP, exact: true }).click();
    await page.getByTestId("vehicles").getByRole("button").first().click();
    await page.getByTestId("assemblies").getByRole("button").first().click();
    await page.getByTestId("plates").getByRole("button").first().click();
    await page.waitForFunction(() => {
      const i = document.querySelector<HTMLImageElement>(".stage img");
      return Boolean(i && i.complete && i.naturalWidth > 0);
    });

    const hotspots = page.locator(".hotspot");
    const n = await hotspots.count();
    expect(n).toBeGreaterThan(0);

    // Positions are percentages of the image's natural size, so a wrong
    // denominator shows up as a hotspot off the edge rather than as an error.
    const stage = await page.locator(".stage").boundingBox();
    expect(stage).not.toBeNull();
    for (let i = 0; i < n; i++) {
      const box = await hotspots.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(stage!.x - 1);
      expect(box!.y).toBeGreaterThanOrEqual(stage!.y - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(stage!.x + stage!.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(stage!.y + stage!.height + 1);
    }
    await page.close();
  });

  it("cross-highlights a callout between the drawing and the parts list", async () => {
    const page = await openCatalogue();
    await page.getByTestId("groups").getByRole("button", { name: GROUP, exact: true }).click();
    await page.getByTestId("vehicles").getByRole("button").first().click();
    await page.getByTestId("assemblies").getByRole("button").first().click();
    await page.getByTestId("plates").getByRole("button").first().click();
    await page.waitForFunction(() => {
      const i = document.querySelector<HTMLImageElement>(".stage img");
      return Boolean(i && i.complete && i.naturalWidth > 0);
    });

    // Hover and pin are deliberately different, and this is the assertion that
    // pins it down. An earlier version of the app used one field for both, so
    // `onmouseenter` set it and the following click compared against what hover
    // had just written — clicking toggled the highlight straight back off.
    const first = page.locator(".hotspot").first();
    const active = page.locator(".hotspot.active");
    const away = page.locator(".platehead");

    // 1. Hover highlights.
    await first.hover();
    await active.waitFor();
    expect(await active.count()).toBe(1);

    // 2. Moving away clears a hover.
    await away.hover();
    await page.waitForFunction(() => document.querySelectorAll(".hotspot.active").length === 0);

    // 3. A click pins, and the pin survives the mouse leaving — which is the
    //    whole point of separating them.
    await first.click();
    await away.hover();
    await active.waitFor();
    expect(await active.count()).toBe(1);

    // 4. Clicking the pinned one again releases it.
    await first.click();
    await away.hover();
    await page.waitForFunction(() => document.querySelectorAll(".hotspot.active").length === 0);
    expect(await active.count()).toBe(0);

    await page.close();
  });

  it("lists parts with a reference for the selected plate", async () => {
    const page = await openCatalogue();
    await page.getByTestId("groups").getByRole("button", { name: GROUP, exact: true }).click();
    await page.getByTestId("vehicles").getByRole("button").first().click();

    // Walk assemblies until one yields a plate with at least one part row:
    // plenty of assemblies legitimately have none for a given vehicle, so
    // asserting on the first would be flaky for a reason that is not a bug.
    const assemblies = page.getByTestId("assemblies").getByRole("button");
    const total = Math.min(await assemblies.count(), 12);
    let rows = 0;
    for (let i = 0; i < total && rows === 0; i++) {
      await assemblies.nth(i).click();
      const plates = page.getByTestId("plates").getByRole("button");
      if ((await plates.count()) === 0) continue;
      await plates.first().click();
      await page.getByTestId("plate-key").waitFor();
      rows = await page.locator("tbody tr").count();
    }
    expect(rows).toBeGreaterThan(0);

    // Part references are 10-character codes; anything else means the wrong
    // field is being rendered.
    const first = await page.locator("tbody tr code").first().textContent();
    expect(first?.trim()).toMatch(/^[0-9A-Z]{6,12}$/);
    await page.close();
  });

  it("reports a tree that is not there instead of failing silently", async () => {
    const page = await browser!.newPage();
    await page.goto(URL!, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Static tree URL").fill("/nope");
    await page.getByRole("button", { name: "Open URL" }).click();
    const error = page.locator(".error");
    await error.waitFor({ timeout: 30_000 });
    expect((await error.textContent()) ?? "").toMatch(/No parts catalogue|nope/);
    await page.close();
  });
});
