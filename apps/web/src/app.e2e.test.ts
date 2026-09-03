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
 * A model known to have the full chain, and its PR group.
 *
 * Master II is the case a user reported: `ED01` under "Complete engine" gives
 * plate `N100812` on drawing `01009837`, which the original renders with the
 * title `1256/M/10/0812`.
 */
const MODEL = "Master II";
const GROUP = "1256";
const ASSEMBLY = "Complete engine";

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
    // Loading the indexes is a real amount of I/O; the brand combobox is the
    // signal that the session opened.
    await page.getByTestId("brands").waitFor({ timeout: 60_000 });
    return page;
  }

  /**
   * Drive one of the searchable comboboxes: focus, type, pick a row.
   *
   * They are inputs with an ARIA listbox, not `<select>`s, so `selectOption`
   * does not apply — an earlier version of this file used it and broke the
   * moment the controls became searchable.
   */
  async function pick(page: Page, testid: string, query: string, rowText?: string) {
    await page.getByTestId(testid).click();
    await page.getByTestId(testid).fill(query);
    const row = page.locator(`#${testid}-list li`).filter({ hasText: rowText ?? query });
    await row.first().click();
  }

  /** Walk brand, model and vehicle to the reported case. */
  async function identify(page: Page) {
    await pick(page, "brands", "Renault");
    await pick(page, "models", "Master II", MODEL);
    await pick(page, "vehicles", "ED01", "G9U-632");
    // Availability is 154 assemblies evaluated; the "hide N" control appears
    // when it lands.
    await page.locator(".bar label.inline").waitFor({ timeout: 90_000 });
  }

  it("opens a data tree over HTTP Range and offers both brands", async () => {
    const page = await openCatalogue();
    await page.getByTestId("brands").click();
    const brands = await page.locator("#brands-list li").allTextContents();
    // Renault lists 76 model indices, Dacia 3 — from `pr/ListeDoc<Brand>`.
    expect(brands.some((b) => b.includes("Renault"))).toBe(true);
    expect(brands.some((b) => b.includes("Dacia"))).toBe(true);
    await page.close();
  });

  it("filters the model list by brand", async () => {
    const page = await openCatalogue();
    await pick(page, "brands", "Dacia");
    await page.getByTestId("models").click();
    const models = (await page.locator("#models-list li").allTextContents()).join(" ");
    // Dacia is exactly Solenza, SupeRNova and Pick-up here.
    expect(models).toMatch(/Solenza/);
    expect(models).not.toMatch(/Master/);
    await page.close();
  });

  it("searches a combobox by substring, not just by prefix", async () => {
    const page = await openCatalogue();
    await pick(page, "brands", "Renault");
    await page.getByTestId("models").click();
    await page.getByTestId("models").fill("aster");
    const rows = await page.locator("#models-list li").allTextContents();
    // A native select's type-ahead matches only from the first character, so
    // "aster" would find nothing. That is why these are custom comboboxes.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.join(" ")).toMatch(/Master/);
    await page.close();
  });

  it("walks brand to model to vehicle to assembly, and renders the drawing", async () => {
    const page = await openCatalogue();
    await identify(page);
    await pick(page, "assemblies", "Complete engine", ASSEMBLY);

    // No plate step: this assembly resolves to exactly one plate for this
    // vehicle, so it opens itself. Two thirds of assemblies behave this way,
    // which is why the original appears to have no plate selection.
    const key = page.getByTestId("plate-key");
    await key.waitFor({ timeout: 30_000 });
    // The meta line carries the original's own composed label,
    // `PR/section/domain/rest` — 1256/M/10/0812 for this case.
    expect(await key.textContent()).toMatch(new RegExp(`${GROUP}/M/10/`));
    // And the heading names the assembly, because a plate has no name.
    expect(await page.locator(".platehead h2").textContent()).toMatch(/Complete engine/);

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
    await identify(page);
    await pick(page, "assemblies", "Complete engine", ASSEMBLY);
    await page.getByTestId("plate-key").waitFor({ timeout: 30_000 });
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
    await identify(page);
    await pick(page, "assemblies", "Complete engine", ASSEMBLY);
    await page.getByTestId("plate-key").waitFor({ timeout: 30_000 });
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

  it("lists parts with a reference and a description", async () => {
    const page = await openCatalogue();
    await identify(page);
    await pick(page, "assemblies", "Complete engine", ASSEMBLY);
    await page.getByTestId("plate-key").waitFor({ timeout: 30_000 });

    expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);

    // Part references are 10-character codes; anything else means the wrong
    // field is being rendered.
    const first = await page.locator("tbody tr code").first().textContent();
    expect(first?.trim()).toMatch(/^[0-9A-Z]{6,12}$/);

    // At least one description should resolve. A tariff names only what is
    // sold in that market, so *every* row having one is not expected — but
    // none having one means the part-name table was not loaded at all.
    const names = await page.locator("td.name").allTextContents();
    expect(names.some((n) => !n.includes("not in this tariff"))).toBe(true);
    await page.close();
  });

  it("resolves undecided parts once the vehicle is narrowed", async () => {
    const page = await openCatalogue();
    await identify(page);
    await pick(page, "assemblies", "Complete engine", ASSEMBLY);
    await page.getByTestId("plate-key").waitFor({ timeout: 30_000 });

    // Before narrowing, the ordered clauses cannot be decided.
    const before = (await page.locator(".chrome .right").textContent()) ?? "";
    expect(before).toMatch(/undecided/);

    // A build number needs a factory to mean anything — `resolveDate` compares
    // `factory + number` — and the factory auto-selects when the vehicle was
    // built at only one.
    expect(await page.getByTestId("factory").inputValue()).not.toBe("");
    await page.getByTestId("build-number").fill("0071007");
    await page.getByTestId("build-number").dispatchEvent("change");

    // Then answer the remaining criteria, which the original prompts for.
    for (const ask of await page.locator(".ask select").all()) {
      if ((await ask.locator("option").count()) > 1) {
        await ask.selectOption({ index: 1 });
        await page.waitForTimeout(400);
      }
    }
    await page.waitForFunction(
      () => /0 undecided/.test(document.querySelector(".chrome .right")?.textContent ?? ""),
      null,
      { timeout: 30_000 },
    );
    const after = (await page.locator(".chrome .right").textContent()) ?? "";
    expect(after).toMatch(/0 undecided/);
    expect(after).not.toMatch(/^0 decided/);
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
