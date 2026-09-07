/**
 * The browser importer's worker round-trip.
 *
 * The native directory picker cannot be automated, which is why this path had
 * no coverage and why a request that could not be posted at all shipped. But
 * the picker is not the interesting part: the failure was in what crosses to
 * the worker afterwards. OPFS hands out real `FileSystemDirectoryHandle`s, so
 * stubbing `showDirectoryPicker` with them exercises the identical code —
 * pick a target, pick a source, post a `scan` request carrying `state`.
 *
 * The bug this exists for: `$state` deep-proxies a plain object, and a Proxy
 * cannot be structured cloned, so `postMessage` threw
 *
 *     Failed to execute 'postMessage' on 'Worker':
 *     #<Object> could not be cloned.
 *
 * which names neither the offending field nor the reason. Nothing in a unit
 * test would catch it: the request is correct, the worker is correct, and the
 * types agree. Only a real `postMessage` disagrees.
 *
 * An empty OPFS directory is not a Dialogys disc, so "nothing recognisable" is
 * the right answer. Getting *any* answer is the assertion — the clone failure
 * happens strictly before the worker can reply.
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

describe.skipIf(!runnable)("the browser importer", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: executable });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  /**
   * A page whose directory picker hands back OPFS directories.
   *
   * `names` is consumed in order, one per pick, so a test can tell the target
   * and the source apart in whatever the interface reports.
   */
  async function openImporter(names: readonly string[]): Promise<Page> {
    const context = await browser!.newContext({ locale: "en-GB" });
    const page = await context.newPage();
    await page.addInitScript((dirs: readonly string[]) => {
      let taken = 0;
      Object.defineProperty(globalThis, "showDirectoryPicker", {
        configurable: true,
        value: async () => {
          const root = await navigator.storage.getDirectory();
          const name = dirs[Math.min(taken++, dirs.length - 1)]!;
          return await root.getDirectoryHandle(name, { create: true });
        },
      });
    }, names);
    await page.goto(URL!, { waitUntil: "domcontentloaded" });
    // The settings dialog opens by itself on a first visit and offers the
    // importer, which is the route a user without a tree actually takes.
    await page.getByTestId("settings").waitFor({ timeout: 30_000 });
    await page.getByTestId("settings-import").click();
    await page.getByTestId("import").waitFor({ timeout: 15_000 });
    return page;
  }

  it("posts a scan request to the worker and gets an answer back", async () => {
    // Unique names, so a rerun does not inherit a previous run's OPFS state.
    const run = `${Date.now().toString(36)}`;
    const page = await openImporter([`t-${run}`, `s-${run}`]);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.getByTestId("pick-target").click();
    // Reaching the disc stage means the target was accepted and its resume
    // state was read.
    await page.getByTestId("pick-disc").waitFor({ timeout: 15_000 });

    await page.getByTestId("pick-disc").click();
    await page.getByTestId("import-error").waitFor({ timeout: 30_000 });
    const message = (await page.getByTestId("import-error").textContent())?.trim() ?? "";

    // The answer for an empty directory. Any answer proves the round trip.
    expect(message).toContain("Nothing recognisable");
    // And the specific regression, asserted by name so a reappearance is
    // unmistakable rather than showing up as a vague failure.
    expect(message).not.toContain("could not be cloned");
    expect(pageErrors.join("\n")).not.toContain("could not be cloned");
    await page.context().close();
  }, 90_000);

  it("keeps the source and target handles distinct across the two picks", async () => {
    // A regression guard for the picker plumbing itself: posting the target
    // as the source would still scan, still answer, and quietly import
    // nothing. The reported name is the only thing that tells them apart.
    const run = `${Date.now().toString(36)}-x`;
    const page = await openImporter([`target-${run}`, `source-${run}`]);

    await page.getByTestId("pick-target").click();
    await page.getByTestId("pick-disc").waitFor({ timeout: 15_000 });
    const building = (await page.locator('[data-testid="import"] p').first().textContent()) ?? "";
    expect(building).toContain(`target-${run}`);

    await page.getByTestId("pick-disc").click();
    await page.getByTestId("import-error").waitFor({ timeout: 30_000 });
    const message = (await page.getByTestId("import-error").textContent()) ?? "";
    expect(message).toContain(`source-${run}`);
    await page.context().close();
  }, 90_000);
});
