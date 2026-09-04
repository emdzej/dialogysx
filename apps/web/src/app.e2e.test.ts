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
 * Which read layer to exercise.
 *
 * `DIALOGYSX_E2E_ENGINE=csfs` runs the whole suite through `@emdzej/csfs-*`
 * instead of the local storage layer, which is how "csfs behaves identically"
 * gets measured rather than asserted. It needs the tree to carry a
 * `csfs-manifest.json`, since HTTP cannot list a directory.
 */
const ENGINE = process.env.DIALOGYSX_E2E_ENGINE;
const QUERY = ENGINE ? `?engine=${ENGINE}` : "";

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

  /**
   * Open the tree the way a first-time visitor does.
   *
   * `browser.newPage()` gets its own context, so `localStorage` is empty and
   * the settings panel opens by itself — which is the flow worth exercising.
   * A returning visitor is covered separately, by reloading.
   */
  async function openCatalogue(): Promise<Page> {
    const page = await browser!.newPage();
    await page.goto(`${URL!}${QUERY}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("settings").waitFor({ timeout: 30_000 });
    await page.getByTestId("settings-url").fill("/data");
    await page.getByRole("button", { name: "Open", exact: true }).click();
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

  /**
   * Choose an assembly from the panel.
   *
   * A list with a search box rather than a combobox: the menu is 346 entries in
   * three levels, and the repair documents never see the assembly, so it
   * belongs to the parts view rather than to identification.
   */
  async function pickAssembly(page: Page, name: string) {
    await page.getByTestId("assembly-search").fill(name);
    await page
      .locator('[data-testid="assembly-list"] button')
      .filter({ hasText: name })
      .first()
      .click();
  }

  /** Walk brand, model and vehicle to the reported case. */
  async function identify(page: Page) {
    await pick(page, "brands", "Renault");
    await pick(page, "models", "Master II", MODEL);
    await pick(page, "vehicles", "ED01", "G9U-632");
    // Availability is 154 assemblies evaluated; the "hide N" control in the
    // assembly panel appears when it lands.
    await page.locator('[data-testid="assembly-list"] button').first().waitFor({
      timeout: 90_000,
    });
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
    await pickAssembly(page, ASSEMBLY);

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
    await pickAssembly(page, ASSEMBLY);
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
    await pickAssembly(page, ASSEMBLY);
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
    await pickAssembly(page, ASSEMBLY);
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
    await pickAssembly(page, ASSEMBLY);
    await page.getByTestId("plate-key").waitFor({ timeout: 30_000 });

    // Before narrowing, the ordered clauses cannot be decided.
    const before = (await page.getByTestId("plate-key").textContent()) ?? "";
    expect(before).toMatch(/undecided/);

    // A build number needs a factory to mean anything — `resolveDate` compares
    // `factory + number` — and the factory auto-selects when the vehicle was
    // built at only one.
    expect(await page.getByTestId("factory").inputValue()).not.toBe("");
    await page.getByTestId("build-number").fill("0071007");
    await page.getByTestId("build-number").dispatchEvent("change");

    // Then answer the remaining criteria, which the original prompts for.
    //
    // Two things this loop has to get right, both of which it got wrong first:
    // re-query the selects every pass, because answering one re-evaluates the
    // plate and re-renders the rest; and never read "no questions on screen" as
    // "everything is decided". The re-evaluation after the build number takes a
    // couple of seconds, and an empty `.ask` list during it made the loop exit
    // immediately with six parts still undecided.
    for (let guard = 0; guard < 8; guard++) {
      const settled = (await page.getByTestId("plate-key").textContent()) ?? "";
      if (/\b0 undecided/.test(settled)) break;
      const asks = page.locator(".ask select");
      await asks.first().waitFor({ timeout: 30_000 });
      const remaining = await asks.count();
      let answered = false;
      for (let i = 0; i < remaining; i++) {
        const sel = asks.nth(i);
        if ((await sel.inputValue()) !== "") continue;
        if ((await sel.locator("option").count()) < 2) continue;
        await sel.selectOption({ index: 1 });
        await page.waitForTimeout(1_000);
        answered = true;
        break;
      }
      if (!answered) break;
    }
    await page.waitForFunction(
      () =>
        /0 undecided/.test(document.querySelector('[data-testid="plate-key"]')?.textContent ?? ""),
      null,
      { timeout: 30_000 },
    );
    const after = (await page.getByTestId("plate-key").textContent()) ?? "";
    expect(after).toMatch(/0 undecided/);
    expect(after).not.toMatch(/^0 decided/);
    await page.close();
  });

  it("offers repair documentation for the identified model", async () => {
    const page = await openCatalogue();
    await pick(page, "brands", "Renault");
    await pick(page, "models", "Master II", MODEL);

    // The documentation is per *family*, so a model alone is enough — no
    // vehicle needed. Master II is family X70, from `pr/FamilleModeleAll.dat`.
    await page.getByTestId("tab-docs").click();
    await page.getByTestId("doc-count").waitFor({ timeout: 60_000 });
    const count = (await page.getByTestId("doc-count").textContent()) ?? "";
    expect(count).toMatch(/topics/);
    expect(count).toMatch(/family X70/);

    const topics = await page.locator('[data-testid="doc-elements"] li').count();
    expect(topics).toBeGreaterThan(1);
    const docs = await page.locator('[data-testid="doc-list"] li').count();
    expect(docs).toBeGreaterThan(0);
    await page.close();
  });

  it("filters the documents by name", async () => {
    const page = await openCatalogue();
    await pick(page, "brands", "Renault");
    await pick(page, "models", "Master II", MODEL);
    await page.getByTestId("tab-docs").click();
    await page.getByTestId("doc-count").waitFor({ timeout: 60_000 });

    const before = await page.locator('[data-testid="doc-elements"] li').count();
    await page.getByTestId("doc-query").fill("brake");
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="doc-elements"] li').length < n,
      before,
      { timeout: 15_000 },
    );
    const after = await page.locator('[data-testid="doc-elements"] li').count();
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
    await page.close();
  });

  it("opens a manual in a viewer", async () => {
    const page = await openCatalogue();
    await pick(page, "brands", "Renault");
    await pick(page, "models", "Master II", MODEL);
    await page.getByTestId("tab-docs").click();
    await page.getByTestId("doc-count").waitFor({ timeout: 60_000 });

    await page.locator('[data-testid="doc-list"] li button').first().click();
    const frame = page.getByTestId("doc-frame");
    await frame.waitFor({ timeout: 30_000 });
    // The frame has to point at a real PDF in the tree. An empty or HTML src
    // is how "the document is indexed but not imported" would look.
    const src = await frame.getAttribute("src");
    expect(src ?? "").toMatch(/\.pdf$/);
    // `URL` is the base-URL constant in this file, which shadows the global
    // class — so join by hand rather than reaching for the constructor.
    const absolute = src!.startsWith("http") ? src! : `${URL!.replace(/\/$/, "")}${src}`;
    const res = await page.request.get(absolute);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toMatch(/pdf/);
    await page.close();
  });

  it("remembers the tree and reopens it without asking", async () => {
    const page = await openCatalogue();
    const stored = await page.evaluate(() => localStorage.getItem("dialogysx.settings.v1"));
    expect(stored).toMatch(/"kind":"http"/);

    // A returning visitor: the panel must not appear, and the catalogue must
    // come back on its own.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("brands").waitFor({ timeout: 90_000 });
    expect(await page.getByTestId("settings").count()).toBe(0);

    // The gear reopens it, and it names what is remembered.
    await page.getByTestId("settings-open").click();
    await page.getByTestId("settings").waitFor({ timeout: 10_000 });
    expect((await page.getByTestId("settings-current-http").textContent()) ?? "").toMatch(/\/data/);
    await page.close();
  });

  it("remembers what you were looking at and puts it back", async () => {
    const page = await openCatalogue();
    await identify(page);
    await pickAssembly(page, ASSEMBLY);
    await page.getByTestId("plate-key").waitFor({ timeout: 30_000 });
    const before = (await page.getByTestId("plate-key").textContent()) ?? "";

    const stored = JSON.parse(
      (await page.evaluate(() => localStorage.getItem("dialogysx.settings.v1"))) ?? "{}",
    ) as { selection?: { model?: string; assembly?: string; vehicle?: { pr?: string } } };
    expect(stored.selection?.model).toBe(MODEL);
    expect(stored.selection?.assembly).toBeDefined();
    expect(stored.selection?.vehicle?.pr).toBe(GROUP);

    // The point: a reload comes back to the same plate without touching a
    // single picker.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("plate-key").waitFor({ timeout: 120_000 });
    const after = (await page.getByTestId("plate-key").textContent()) ?? "";
    expect(after.replace(/\s+/g, " ")).toBe(before.replace(/\s+/g, " "));

    // And the pickers show it, rather than the plate hanging off nothing.
    expect(await page.getByTestId("models").inputValue()).toBe(MODEL);
    expect(await page.getByTestId("vehicles").inputValue()).toMatch(/ED01/);
    await page.close();
  });

  it("reports a tree that is not there instead of failing silently", async () => {
    const page = await browser!.newPage();
    await page.goto(`${URL!}${QUERY}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("settings").waitFor({ timeout: 30_000 });
    await page.getByTestId("settings-url").fill("/nope");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    // Reported inside the panel, which stays open: the point is that you can
    // correct the URL without the interface having thrown you out.
    const error = page.getByTestId("settings-error");
    await error.waitFor({ timeout: 30_000 });
    expect((await error.textContent()) ?? "").toMatch(/No parts catalogue|nope/);
    // And a URL that did not open is not remembered, or every future visit
    // would reopen to the typo.
    const stored = await page.evaluate(() => localStorage.getItem("dialogysx.settings.v1"));
    expect(stored).toBeNull();
    await page.close();
  });
});
