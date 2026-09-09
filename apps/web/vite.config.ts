import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, normalize, resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig, type Plugin } from "vite";

/**
 * Serve a Dialogys data tree at `/data`, with `Range` support.
 *
 * Set `DIALOGYSX_DATA` to an imported tree. Vite's own static handling would
 * work for the drawings, but the catalogue is read by byte range and
 * `HttpRangeReader` rejects any response that is not a 206 — deliberately, so a
 * host that ignores `Range` fails loudly instead of returning the wrong bytes.
 * That means dev needs a handler that really honours it.
 */
/**
 * Content type by extension.
 *
 * Only `.png` used to be typed, and a PDF then arrived with no type at all —
 * which a browser downloads rather than renders, so the document viewer showed
 * an empty frame with no error anywhere. The catalogue's own data files are
 * deliberately `application/octet-stream`: `HttpRangeReader` rejects a
 * `text/html` response as "not a data tree", and Node's default sniffing would
 * happily label an extensionless index file as HTML.
 */
function contentType(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "pdf":
      return "application/pdf";
    case "xml":
      return "application/xml";
    case "json":
      return "application/json";
    case "txt":
    case "utf":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function dataTree(): Plugin {
  /*
   * Where the tree is.
   *
   * `DIALOGYSX_DATA` first, then a couple of conventional places, so `pnpm
   * dev` works without an environment variable wherever the tree happens to
   * live. Each candidate is confirmed by the presence of `pr/` rather than by
   * the directory existing: an empty `data/` left behind by a cancelled import
   * would otherwise be served as a tree and read as one with no datasets.
   */
  const candidates = [
    process.env.DIALOGYSX_DATA,
    resolve(process.cwd(), "..", "..", "data"),
    "/Volumes/data/dialogysx",
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  const root = candidates.find((p) => existsSync(join(p, "pr")));
  return {
    name: "dialogysx-data-tree",
    configureServer(server) {
      if (!root) {
        server.config.logger.warn(
          "[dialogysx] No data tree found. Build one with `dialogysx import -o <dir>`, " +
            `or set DIALOGYSX_DATA. Looked in: ${candidates.join(", ")}`,
        );
        return;
      }
      const base = resolve(root);
      server.config.logger.info(`[dialogysx] serving ${base} at /data`);

      server.middlewares.use("/data", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/").replace(/^\/+/, "");
        // Reject traversal rather than clamping it: a path that tries to
        // escape is a bug or an attack, not something to quietly fix up.
        const path = normalize(join(base, rel));
        if (!path.startsWith(base)) {
          res.statusCode = 403;
          res.end();
          return;
        }

        let size: number;
        try {
          const st = statSync(path);
          if (!st.isFile()) return next();
          size = st.size;
        } catch {
          res.statusCode = 404;
          res.end();
          return;
        }

        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Type", contentType(path));

        // HEAD must not carry a body. `HttpRangeReader.size()` asks for one
        // per file, and piping the payload into a HEAD response stalls the
        // request — which showed up as the browser suite hanging on startup
        // rather than as an error.
        if (req.method === "HEAD") {
          res.setHeader("Content-Length", String(size));
          res.end();
          return;
        }

        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
        if (!range) {
          res.setHeader("Content-Length", String(size));
          createReadStream(path).pipe(res);
          return;
        }
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start >= size || end < start) {
          res.statusCode = 416;
          res.setHeader("Content-Range", `bytes */${size}`);
          res.end();
          return;
        }
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        res.setHeader("Content-Length", String(end - start + 1));
        createReadStream(path, { start, end }).pipe(res);
      });
    },
  };
}

/**
 * The manifest, read at build time.
 *
 * Injected with `define` so the bundle carries string literals rather than
 * importing `package.json` at runtime: the manifest stays out of the browser,
 * and the version shown cannot drift from the one in the repository.
 */
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string; repository?: { url?: string } };

export default defineConfig({
  /*
   * Where the site is served from.
   *
   * A custom domain serves at the root; `<user>.github.io/<repo>/` serves under
   * a prefix. `base` is baked into the built HTML and a build cannot be
   * relocated afterwards, so the deploy workflow decides this from whether
   * `public/CNAME` exists and passes it in. Getting it wrong is nasty rather
   * than obvious: `index.html` still returns 200 and every asset 404s.
   */
  base: process.env.BASE_PATH ?? "/",
  plugins: [
    svelte(),
    dataTree(),
    /*
     * Installable, and the shell starts with no network.
     *
     * The *shell* only, deliberately. A data tree is between 0.85 GB for the
     * catalogue and 15.30 GB with the repair manuals, so precaching one is not
     * on the table, and caching reads as they happen would leave the app
     * offline for the plates you happened to visit and broken for the rest.
     * The honest offline route is a folder on this machine, which needs no
     * network at all — the service worker is what makes the page itself
     * available to open it with.
     */
    VitePWA({
      // `prompt`, not `autoUpdate`. This is used at a bench with a car in
      // pieces; swapping the assets underneath someone mid-job to install an
      // update they did not ask for is worse than telling them one is ready.
      registerType: "prompt",
      includeAssets: ["favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        name: "dialogysx — Renault/Dacia parts catalogue",
        short_name: "dialogysx",
        description:
          "Parts catalogue and repair-documentation browser for Renault and Dacia vehicles. Reads a data tree you build yourself; ships no vehicle data.",
        theme_color: "#000091",
        background_color: "#ffffff",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // The shell is small; the tree is not, and none of it belongs here.
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        // A tree served from the same origin sits under `/data`. Without this
        // the navigate fallback answers a data request with `index.html`, and
        // `HttpRangeReader` then reports a tree full of HTML documents.
        navigateFallbackDenylist: [/^\/data\//],
        // 3 MB: the bundle is ~180 KB and a drawing is ~35 KB, so anything
        // approaching this means the tree has leaked into the precache.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // Off in dev. A service worker caching a dev bundle is a recipe for
        // debugging something that was fixed twenty minutes ago.
        enabled: false,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(manifest.version),
    __REPO_URL__: JSON.stringify(manifest.repository?.url ?? "https://github.com/emdzej/dialogysx"),
  },
  server: {
    watch: {
      /**
       * Never watch the data tree.
       *
       * `dialogysx import` is documented to write `<repo>/data`, so the tree
       * sits inside the project root — 228,515 files and 15 GB for the full
       * English 4.55 set. `dataTree()` reads it from disk per request, so
       * nothing here needs to know when it changes, and there is no reason to
       * spend descriptors and startup work indexing it.
       *
       * A precaution, not a fix for anything observed: Vite starts in under a
       * second with the full tree in place. I first added this believing it
       * explained a dev server that never bound its port; that turned out to be
       * the process being killed from outside.
       */
      ignored: ["**/data/**"],
    },
  },
});
