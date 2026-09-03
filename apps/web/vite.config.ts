import { createReadStream, existsSync, statSync } from "node:fs";
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
        if (path.endsWith(".png")) res.setHeader("Content-Type", "image/png");

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

export default defineConfig({
  plugins: [svelte(), dataTree()],
});
