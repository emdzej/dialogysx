/**
 * The interface language, in a real browser.
 *
 * `i18n/parity.test.ts` checks the catalogues against each other; this checks
 * the part that only a browser can answer. Three things it covers that unit
 * tests cannot:
 *
 * - **Re-render on change.** i18next is not reactive, so `ui()` reads the
 *   locale rune before delegating. Drop that line and every catalogue is still
 *   correct, every unit test still passes, and the interface simply does not
 *   change until you reload.
 * - **Negotiation from the browser.** `locale` here becomes the page's
 *   `navigator.languages`, which is the input the app actually negotiates
 *   against.
 * - **Persistence.** A choice has to survive a reload, and "match my browser"
 *   has to *keep* following the browser rather than caching what it first saw —
 *   which is the bug `i18next-browser-languagedetector` has and the reason it
 *   is not used.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env.DIALOGYSX_E2E_URL;

let browser: Browser | undefined;
let executable: string | undefined;
try {
  executable = chromium.executablePath();
} catch {
  executable = undefined;
}

const runnable = Boolean(URL) && Boolean(executable);

describe.skipIf(!runnable)("interface language", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: executable });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  /** A page reporting `locale`, optionally with a preference already stored. */
  async function open(locale: string, stored?: string): Promise<Page> {
    const context = await browser!.newContext({ locale });
    const page = await context.newPage();
    if (stored !== undefined) {
      await page.addInitScript((v) => localStorage.setItem("dialogysx.uiLocale", v), stored);
    }
    await page.goto(URL!, { waitUntil: "domcontentloaded" });
    // The settings dialog opens by itself on a first visit, and its tabs are
    // the earliest translated text on screen.
    await page.getByTestId("settings").waitFor({ timeout: 30_000 });
    return page;
  }

  const langTab = (page: Page) => page.getByTestId("tab-language");

  it("comes up in English for an English browser", async () => {
    const page = await open("en-GB");
    await expect.poll(() => langTab(page).textContent()).toBe("Language");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    await page.context().close();
  });

  it("comes up in Polish for a Polish browser", async () => {
    // `pl-PL` carries a region and the catalogue is plain `pl`, so this only
    // works if negotiation falls back to the base tag.
    const page = await open("pl-PL");
    await expect.poll(() => langTab(page).textContent()).toBe("Język");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("pl");
    await page.context().close();
  });

  it("falls back to English for a language it does not have", async () => {
    const page = await open("de-DE");
    await expect.poll(() => langTab(page).textContent()).toBe("Language");
    await page.context().close();
  });

  it("switches without a reload", async () => {
    // The test that catches a missing rune read in `ui()`.
    const page = await open("en-GB");
    await langTab(page).click();
    await page.getByTestId("ui-language-select").selectOption("pl");
    await expect.poll(() => langTab(page).textContent()).toBe("Język");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("pl");

    // And back, so this cannot pass by rendering Polish once and sticking.
    await page.getByTestId("ui-language-select").selectOption("en");
    await expect.poll(() => langTab(page).textContent()).toBe("Language");
    await page.context().close();
  });

  it("remembers an explicit choice across a reload", async () => {
    const page = await open("en-GB");
    await langTab(page).click();
    await page.getByTestId("ui-language-select").selectOption("pl");
    await expect.poll(() => langTab(page).textContent()).toBe("Język");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("settings").waitFor({ timeout: 30_000 });
    await expect.poll(() => langTab(page).textContent()).toBe("Język");
    await page.context().close();
  });

  it("lets an explicit choice override the browser", async () => {
    const page = await open("pl-PL", "en");
    await expect.poll(() => langTab(page).textContent()).toBe("Language");
    await page.context().close();
  });

  it("keeps following the browser when set to match it", async () => {
    // The reason a detector library is not used: storing "system" must mean
    // "ask again every time", not "remember what the browser said once". A
    // cached detection would answer English here because the preference was
    // set in an English context.
    const page = await open("pl-PL", "system");
    await expect.poll(() => langTab(page).textContent()).toBe("Język");
    expect(await page.evaluate(() => localStorage.getItem("dialogysx.uiLocale"))).toBe("system");
    await page.context().close();
  });
});
