import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, normalize, resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
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
  // Default to `<repo>/data`, which is where `dialogysx import` is documented
  // to put things, so `pnpm dev` works with no environment variable.
  const fallback = resolve(process.cwd(), "..", "..", "data");
  const root =
    process.env.DIALOGYSX_DATA ?? (existsSync(join(fallback, "pr")) ? fallback : undefined);
  return {
    name: "dialogysx-data-tree",
    configureServer(server) {
      if (!root) {
        server.config.logger.warn(
          "[dialogysx] No data tree found. Build one with `dialogysx import -o data`, " +
            "or set DIALOGYSX_DATA to point elsewhere.",
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
  plugins: [svelte(), dataTree()],
  define: {
    __APP_VERSION__: JSON.stringify(manifest.version),
    __REPO_URL__: JSON.stringify(
      manifest.repository?.url ?? "https://github.com/emdzej/dialogysx",
    ),
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
