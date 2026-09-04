/**
 * `dialogysx import` — merge the discs into one data folder.
 */
import { mkdir, stat } from "node:fs/promises";
import { extname } from "node:path";
import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { COMPONENTS, resolveComponents } from "@dialogysx/importer";
import { identify, type DiscSource } from "@dialogysx/importer";
import { NodeSourceFs } from "./node-fs.js";
import { canMountIso, mountIso, type Mounted } from "./iso.js";
import { buildPlan } from "./plan.js";
import { execute, type Progress } from "./execute.js";
import { buildManifest, writeManifest } from "./manifest.js";
import { writeCsfsManifest, CSFS_MANIFEST_FILE } from "./csfs-manifest.js";

const gb = (n: number) => `${(n / 1e9).toFixed(2)} GB`;

function bar(p: Progress): string {
  const pct = p.bytesTotal === 0 ? 1 : p.bytesDone / p.bytesTotal;
  const width = 24;
  const filled = Math.round(pct * width);
  return (
    `[${"#".repeat(filled)}${".".repeat(width - filled)}] ` +
    `${(pct * 100).toFixed(1)}%  ${gb(p.bytesDone)}/${gb(p.bytesTotal)}  ` +
    p.current.slice(-52)
  );
}

export function importCommand(): Command<[string[]]> {
  return new Command("import")
    .description("merge Dialogys discs (ISO files or mount points) into one data folder")
    .argument("<sources...>", "ISO files, or directories where discs are already mounted")
    .requiredOption("-o, --out <dir>", "output data folder")
    .option(
      "-l, --languages <codes>",
      "comma-separated language codes for both langue/ and mrnt/ (default: all present)",
    )
    .option(
      "-c, --components <ids>",
      'comma-separated component ids, or "all" / "min". See --list-components',
    )
    .option("--list-components", "describe the selectable components and stop", false)
    .option(
      "--extract-images",
      "unpack the illustration archives instead of reading them in place — " +
        "146,121 more files for the same bytes",
      false,
    )
    .option("--extract-drawings", "also unpack dessins/100.zip and eclate/100.zip", false)
    .option("-n, --dry-run", "show the plan and stop", false)
    .option("--no-resume", "re-copy files that already exist at the right size")
    .option("--no-verify", "skip the format validation pass at the end")
    .action(async (sources, opts) => {
      const languages = opts.languages
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (opts.listComponents) {
        console.log("Selectable components. Default set is marked *.\n");
        for (const c of COMPONENTS) {
          const mark = c.required ? chalk.red("!") : c.defaultOn ? chalk.green("*") : " ";
          console.log(`${mark} ${chalk.bold(c.id)}`);
          console.log(`    ${c.what}`);
          console.log(`    ${chalk.dim("without it: " + c.withoutIt)}`);
        }
        console.log(
          chalk.dim(
            "\n! = always included (the catalogue cannot be read without it)\n" +
              '"all" selects everything, "min" selects only what the catalogue needs.\n' +
              "Run with --dry-run to see measured sizes for your discs.",
          ),
        );
        return;
      }

      let components: string[];
      try {
        components = resolveComponents(opts.components);
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
        return;
      }

      // --- resolve sources, mounting ISOs as needed -----------------------
      const sourceFs = new NodeSourceFs();
      const mounted: Mounted[] = [];
      const discs: DiscSource[] = [];
      try {
        for (const src of sources) {
          let root = src;
          const isIso = extname(src).toLowerCase() === ".iso";
          if (isIso) {
            if (!canMountIso()) {
              console.error(
                chalk.red(
                  `${src}: mounting ISO images is only implemented on macOS. ` +
                    `Mount it yourself and pass the mount point.`,
                ),
              );
              process.exitCode = 1;
              return;
            }
            process.stdout.write(chalk.dim(`mounting ${src} ... `));
            const m = await mountIso(src);
            mounted.push(m);
            root = m.path;
            console.log(chalk.dim(root));
          } else if (!(await stat(src).catch(() => undefined))?.isDirectory()) {
            console.error(chalk.red(`${src}: not a directory or an .iso file`));
            process.exitCode = 1;
            return;
          }

          const disc = await identify(sourceFs, root);
          if (!disc) {
            console.log(`  ${chalk.yellow("??")} ${src}: nothing recognisable — skipped`);
            continue;
          }
          console.log(`  ${chalk.green("ok")} ${src}: ${chalk.bold(disc.kind)} — ${disc.label}`);
          discs.push(disc);
        }

        if (discs.length === 0) {
          console.error(chalk.red("No Dialogys discs identified. Nothing to import."));
          process.exitCode = 1;
          return;
        }

        // --- plan ---------------------------------------------------------
        console.log(chalk.dim("\nplanning ..."));
        const plan = await buildPlan(discs, {
          components,
          languages,
          extractImages: opts.extractImages,
          extractDrawings: opts.extractDrawings,
        });

        const copies = plan.actions.filter((a) => a.type === "copy").length;
        const extracts = plan.actions.filter((a) => a.type === "extract").length;
        console.log(
          `  ${plan.actions.length.toLocaleString()} actions: ` +
            `${copies.toLocaleString()} copies, ${extracts} archive extraction(s), ` +
            `${gb(plan.totalBytes)} to read`,
        );
        if (plan.duplicatesDropped > 0) {
          console.log(
            chalk.dim(
              `  ${plan.duplicatesDropped} byte-identical duplicate(s) across discs — one copy kept`,
            ),
          );
        }
        console.log("");
        for (const row of plan.byComponent) {
          if (row.files === 0) continue;
          const mark = row.included ? chalk.green("+") : chalk.dim("-");
          const size = gb(row.bytes).padStart(9);
          const files = row.files.toLocaleString().padStart(8);
          const line = `  ${mark} ${row.component.id.padEnd(17)} ${files} files ${size}`;
          console.log(row.included ? line : chalk.dim(line));
        }
        const excluded = plan.byComponent
          .filter((r) => !r.included && r.files > 0)
          .reduce((n, r) => n + r.bytes, 0);
        if (excluded > 0) {
          console.log(chalk.dim(`  ${gb(excluded)} excluded by --components`));
        }
        if (plan.unclaimed.length > 0) {
          console.log(
            chalk.yellow(`  ${plan.unclaimed.length} file(s) matched no component — skipped:`),
          );
          for (const u of plan.unclaimed.slice(0, 12)) {
            console.log(chalk.yellow(`      ${gb(u.bytes).padStart(9)}  ${u.dest}`));
          }
          if (plan.unclaimed.length > 12) {
            console.log(chalk.dim(`      ... and ${plan.unclaimed.length - 12} more`));
          }
        }
        console.log("");

        if (plan.catalogueLanguages.length > 0) {
          console.log(`  catalogue languages: ${plan.catalogueLanguages.join(" ")}`);
        }
        if (plan.mrntLanguages.length > 0) {
          console.log(`  repair languages:    ${plan.mrntLanguages.join(" ")}`);
        }

        if (!opts.extractImages) {
          console.log(
            chalk.dim(
              "\n  Illustration and drawing archives are kept packed and read in place " +
                "(one\n  Range request per file). That is 184,610 fewer files for the same " +
                "bytes.\n  Pass --extract-images to unpack them instead.",
            ),
          );
        }

        // --- collisions ---------------------------------------------------
        if (plan.collisions.length > 0) {
          console.log(
            chalk.red(`\n  ${plan.collisions.length} path collision(s) — two discs, one path:`),
          );
          for (const c of plan.collisions.slice(0, 10)) {
            console.log(`    ${chalk.bold(c.to)}`);
            for (const a of c.actions) {
              console.log(`      ${gb(a.bytes).padStart(9)}  ${a.from}`);
            }
          }
          if (plan.collisions.length > 10) {
            console.log(chalk.dim(`    ... and ${plan.collisions.length - 10} more`));
          }
          console.log(
            chalk.red(
              "\n  Refusing to import: one of each pair would be silently lost.\n" +
                "  Import the discs separately, or narrow --languages / --only.",
            ),
          );
          process.exitCode = 1;
          return;
        }

        if (opts.dryRun) {
          console.log(chalk.dim("\n--dry-run: stopping before writing anything."));
          return;
        }

        // --- execute ------------------------------------------------------
        await mkdir(opts.out, { recursive: true });
        console.log("");
        // Redrawing a bar with \r is only sane on a terminal. Piped to a file or
        // a CI log it produces one line per update — the first run of this
        // command wrote 161 KB of progress bar into a task log.
        const tty = process.stdout.isTTY === true;
        let lastDraw = 0;
        let lastPercent = -1;
        const result = await execute(plan, opts.out, {
          resume: opts.resume,
          onProgress: (p) => {
            if (tty) {
              const now = Date.now();
              if (now - lastDraw < 120 && p.done < p.total) return;
              lastDraw = now;
              process.stdout.write(`\r${bar(p)}\x1b[K`);
              return;
            }
            // Off a terminal: one line per 5%, so the log stays readable.
            const pct = Math.floor((p.bytesDone / Math.max(1, p.bytesTotal)) * 20) * 5;
            if (pct === lastPercent) return;
            lastPercent = pct;
            console.log(`  ${String(pct).padStart(3)}%  ${gb(p.bytesDone)}/${gb(p.bytesTotal)}`);
          },
        });
        if (tty) process.stdout.write("\r\x1b[K");

        console.log(
          `${chalk.green("imported")} ${result.copied.toLocaleString()} file(s), ` +
            `${result.extractedEntries.toLocaleString()} entries from ` +
            `${result.extractedArchives} archive(s), ${gb(result.bytesWritten)} written` +
            (result.skipped > 0
              ? chalk.dim(` (${result.skipped.toLocaleString()} already current)`)
              : ""),
        );

        if (result.entryCollisions.length > 0) {
          // Expected to be empty: the Russian image archives share 0 of 36,374
          // entry names. A non-empty list means that assumption has broken.
          console.log(
            chalk.yellow(
              `\n  ${result.entryCollisions.length} archive entr(ies) already existed and were ` +
                `left alone —\n  extraction assumed image archives do not overlap. Worth a look:`,
            ),
          );
          for (const c of result.entryCollisions.slice(0, 5)) {
            console.log(`    ${c.path}  (first written by ${c.from})`);
          }
        }

        // --- manifest -----------------------------------------------------
        const builtAt = new Date().toISOString();
        const manifest = await buildManifest(opts.out, {
          builtAt,
          sources: discs.map((d) => ({
            kind: d.kind,
            label: d.label,
            root: d.root,
            versions: d.versions,
          })),
          repairLanguages: plan.mrntLanguages,
          counts: {
            files: result.copied + result.skipped,
            extractedEntries: result.extractedEntries,
            bytes: result.bytesWritten,
          },
          archives: plan.archives,
        });
        await writeManifest(opts.out, manifest);
        console.log(
          `${chalk.green("manifest")} ${manifest.datasets.length} dataset(s) present, ` +
            `catalogue languages ${manifest.catalogueLanguages.join(" ") || "(none)"}`,
        );

        // The tree is not servable over HTTP until this exists — a static host
        // cannot list a directory, so a reader has no other way to know what is
        // here or how big it is. Written last, alongside the manifest it
        // complements, and from the *same* archive array so the two cannot
        // disagree about what is packed.
        const csfs = await writeCsfsManifest(opts.out, {
          archives: plan.archives,
          label: `dialogysx ${manifest.sources.map((s) => s.label).join(" + ")}`,
          builtAt,
          onProgress: (found) => {
            // Only to a terminal: a `\r` means nothing in a redirected log, so a
            // progress line there just buries the summary in spaces.
            if (process.stderr.isTTY && found % 10_000 === 0) {
              process.stderr.write(
                `\r  ${chalk.dim(`describing ${found.toLocaleString()} files`)}`,
              );
            }
          },
        });
        if (process.stderr.isTTY) process.stderr.write("\r".padEnd(48) + "\r");
        console.log(
          `${chalk.green(CSFS_MANIFEST_FILE)} ${csfs.files.toLocaleString()} files, ` +
            `${(csfs.bytes / 1e9).toFixed(2)} GB described, ` +
            `${(csfs.jsonBytes / 1e6).toFixed(2)} MB of JSON`,
        );

        if (opts.verify) {
          console.log(chalk.dim(`\nNow validate it:\n  dialogysx verify -d ${opts.out}`));
        }
      } finally {
        for (const m of mounted) await m.detach?.();
      }
    });
}
