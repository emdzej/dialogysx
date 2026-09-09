import { chromium } from "playwright-core";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname } from "node:path";
const [dist, tree] = process.argv.slice(2);
const T = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".dat": "application/octet-stream",
};
const server = createServer(async (req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = u.startsWith("/data/")
    ? join(tree, u.slice(6))
    : join(dist, u === "/" ? "index.html" : u);
  let st;
  try {
    st = statSync(file);
  } catch {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader("content-type", T[extname(file)] ?? "application/octet-stream");
  res.setHeader("accept-ranges", "bytes");
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    res.statusCode = 206;
    res.setHeader("content-range", `bytes ${start}-${end}/${st.size}`);
    return createReadStream(file, { start, end }).pipe(res);
  }
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromium.executablePath() });

// ── 1. ?data= opens a tree with nothing remembered ───────────────────────
{
  const ctx = await browser.newContext({ locale: "en-GB" });
  const page = await ctx.newPage();
  await page.goto(`${base}/?data=/data`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("brands").waitFor({ timeout: 120_000 });
  console.log("?data= opened the tree with nothing remembered ✓");
  const stored = await page.evaluate(() => localStorage.getItem("dialogysx.settings.v1"));
  console.log(
    "   and wrote nothing to settings:",
    stored === null,
    stored ? `(got ${stored})` : "",
  );
  await ctx.close();
}

// ── 2. ?data= does not clobber a remembered tree ─────────────────────────
{
  const ctx = await browser.newContext({ locale: "en-GB" });
  const page = await ctx.newPage();
  await page.addInitScript(() =>
    localStorage.setItem(
      "dialogysx.settings.v1",
      JSON.stringify({ source: { kind: "http", url: "/remembered" } }),
    ),
  );
  await page.goto(`${base}/?data=/data`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("brands").waitFor({ timeout: 120_000 });
  const kept = await page.evaluate(
    () => JSON.parse(localStorage.getItem("dialogysx.settings.v1")).source.url,
  );
  console.log(`?data= left the remembered tree alone: ${kept === "/remembered"} (still "${kept}")`);
  await ctx.close();
}

// ── 3. a bad ?data= is ignored, not fatal ────────────────────────────────
{
  const ctx = await browser.newContext({ locale: "en-GB" });
  const page = await ctx.newPage();
  await page.goto(`${base}/?data=%3A%3Anot-a-url`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("settings").waitFor({ timeout: 30_000 });
  console.log("a mangled ?data= falls back to the settings dialog ✓");
  await ctx.close();
}

// ── 4. the shell, offline ────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ locale: "en-GB" });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, {
    timeout: 20_000,
  });
  const cached = await page.evaluate(async () => {
    const out = [];
    for (const n of await caches.keys())
      out.push(...(await (await caches.open(n)).keys()).map((q) => new URL(q.url).pathname));
    return out;
  });
  console.log(
    `\nservice worker in control, ${cached.length} entries cached, any /data: ${cached.some((c) => c.startsWith("/data"))}`,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.waitForTimeout(300);
  console.log(
    "offline chip appears on the offline event:",
    (await page.locator('[data-testid="offline"]').count()) === 1,
  );
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  console.log(
    "shell loads with no network:",
    (await page.locator("header").count()) === 1,
    `(v${await page.locator('[data-testid="version"]').textContent()})`,
  );
  await ctx.close();
}
server.close();
await browser.close();
