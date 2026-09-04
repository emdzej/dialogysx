/**
 * `dialogysx manifest` — describe a tree that already exists.
 *
 * An import writes both manifests itself, so this is for the cases where that
 * did not happen: a tree built before the csfs manifest existed, a tree copied
 * somewhere by hand, or one whose description has gone stale. Without
 * `csfs-manifest.json` a tree is unreadable over HTTP — a static host cannot
 * list a directory, so a reader has no way to learn what is present.
 *
 * It re-describes rather than repairs: the file list comes from walking what is
 * on disk, so a partial tree is described accurately instead of optimistically.
 * The one thing it cannot recover is `archives`, which records a decision made
 * during the import; that is read back out of `manifest.json`.
 */
import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import type { ArchiveMount } from "@dialogysx/catalogue";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeCsfsManifest, CSFS_MANIFEST_FILE } from "./csfs-manifest.js";

/** `/`-rooted, the form both manifests now use. */
function rooted(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

// The argument and option types are spelled out rather than left as `Command`:
// the bare type erases them, which is the whole reason extra-typings is here.
export function manifestCommand(): Command<[string], { label?: string }> {
  return new Command("manifest")
    .description(`describe an existing tree, writing ${CSFS_MANIFEST_FILE}`)
    .argument("<tree>", "a built data tree")
    .option("--label <text>", "a name for this tree, for a reader to display")
    .action(async (tree, opts) => {
      let own: { archives?: ArchiveMount[]; sources?: { label: string }[] } = {};
      try {
        own = JSON.parse(await readFile(join(tree, "manifest.json"), "utf8"));
      } catch {
        // Not fatal. A tree with no manifest.json is still worth describing —
        // it just has no archives to declare, so anything kept packed will be
        // a plain file rather than standing in for a directory.
        console.log(
          chalk.yellow("no manifest.json") +
            " — describing the tree anyway, with no archives declared",
        );
      }

      // Canonicalised on the way through: trees built before mounts were
      // rooted carry the relative spelling. Readers tolerate both, but there is
      // no reason to keep writing the old one.
      const archives = (own.archives ?? []).map((a) => ({
        ...a,
        archive: rooted(a.archive),
        serves: rooted(a.serves),
      }));

      if (archives.length > 0) {
        console.log(`${chalk.bold(String(archives.length))} archive(s) declared:`);
        for (const a of archives) {
          console.log(`  ${chalk.cyan(a.archive)} ${chalk.dim("→")} ${a.serves} (${a.entry})`);
        }
        if (own.archives?.some((a) => !a.archive.startsWith("/"))) {
          await writeFile(
            join(tree, "manifest.json"),
            JSON.stringify({ ...own, archives }, null, 2) + "\n",
          );
          console.log(chalk.dim("  rewrote manifest.json with rooted mount paths"));
        }
      }

      const label =
        opts.label ?? `dialogysx ${(own.sources ?? []).map((s) => s.label).join(" + ")}`.trim();

      const result = await writeCsfsManifest(tree, {
        archives,
        label,
        builtAt: new Date().toISOString(),
        onProgress: (found) => {
          // Only to a terminal: a `\r` means nothing in a redirected log, so a
          // progress line there just buries the summary in spaces.
          if (process.stderr.isTTY && found % 5_000 === 0) {
            process.stderr.write(`\r  ${chalk.dim(`walked ${found.toLocaleString()} files`)}`);
          }
        },
      });
      if (process.stderr.isTTY) process.stderr.write("\r".padEnd(48) + "\r");

      console.log(
        `${chalk.green(CSFS_MANIFEST_FILE)} ${result.files.toLocaleString()} files, ` +
          `${(result.bytes / 1e9).toFixed(2)} GB described, ` +
          `${(result.jsonBytes / 1e6).toFixed(2)} MB of JSON ` +
          chalk.dim(`(paid once, when a reader opens the tree)`),
      );
    });
}
