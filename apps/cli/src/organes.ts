/**
 * `dialogysx organes` — parse assembly records and report.
 *
 * A separate sweep from `plates` because the record *envelope* differs even
 * though the condition grammar inside is shared. The two were only assumed to
 * match until this existed.
 */
import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { Disc, findDataset, parseOrgane } from "@dialogysx/catalogue";
import { decodeText, encodeKey } from "@dialogysx/raf";
import { NodeDirectorySource } from "./node-source.js";

export function organesCommand(): Command<[string | undefined]> {
  return new Command("organes")
    .description("parse assembly records; with no key, sweep them all as a grammar check")
    .argument("[key]", "an assembly key such as 02021010A, or a PR-group prefix")
    .requiredOption("-d, --data <dir>", "path to a disc's dialogys/data directory")
    .action(async (key, opts) => {
      const disc = new Disc(new NodeDirectorySource(opts.data));
      const spec = findDataset("organes");
      if (!spec) throw new Error("organes dataset spec missing");
      const opened = await disc.open(spec);
      if (!opened) throw new Error("organes: not present on this tree");
      const raf = opened.raf;

      if (key !== undefined) {
        for (const i of (await raf.index1.findPrefix(encodeKey(key))).slice(0, 10)) {
          const k = decodeText(await raf.keyAt(i)).trim();
          for (const rec of await raf.recordsAt(i)) {
            const o = parseOrgane(rec);
            console.log(
              `\n${chalk.bold(k)} id=${JSON.stringify(o.id)} ` +
                `${o.plates.length} plate(s), ${o.conditionPool.length} condition(s), ` +
                `${o.vignettes.length} vignette(s)`,
            );
            for (const p of o.plates) {
              const cond = p.applicability ? chalk.dim("conditional") : chalk.dim("always");
              console.log(
                `  plate ${chalk.bold(p.plate)}  drawing ${p.drawing ?? chalk.red("(none)")}  ${cond}`,
              );
            }
          }
        }
        await raf.close();
        return;
      }

      let ok = 0;
      let failed = 0;
      let plates = 0;
      let withDrawing = 0;
      let conditional = 0;
      let vignettes = 0;
      const failures: string[] = [];
      for (let i = 0; i < raf.index1.count; i++) {
        const k = decodeText(await raf.keyAt(i)).trim();
        for (const rec of await raf.recordsAt(i)) {
          try {
            const o = parseOrgane(rec);
            ok++;
            plates += o.plates.length;
            vignettes += o.vignettes.length;
            for (const p of o.plates) {
              if (p.drawing) withDrawing++;
              if (p.applicability) conditional++;
            }
          } catch (e) {
            failed++;
            if (failures.length < 10) failures.push(`${k}: ${(e as Error).message}`);
          }
        }
        if (i % 4000 === 0 && i > 0) console.log(chalk.dim(`  ${i}/${raf.index1.count} ...`));
      }
      await raf.close();

      console.log(
        `\n${failed === 0 ? chalk.green("ok") : chalk.red("FAIL")}  ` +
          `${ok.toLocaleString()} assembly record(s) parsed, ${failed.toLocaleString()} failed`,
      );
      console.log(
        `  ${plates.toLocaleString()} plate references, ` +
          `${withDrawing.toLocaleString()} with a drawing number, ` +
          `${conditional.toLocaleString()} condition-filtered`,
      );
      console.log(`  ${vignettes.toLocaleString()} vignettes`);
      for (const f of failures) console.log(`  ${chalk.red("FAIL")} ${f}`);
      process.exitCode = failed === 0 ? 0 : 1;
    });
}
