/**
 * `dialogysx plates` — parse plate records and report.
 *
 * The whole-catalogue sweep is the real test of the condition grammar. Every
 * record must be consumed exactly: a wrong field width or a missed pool leaves
 * bytes unread or runs off the end, and `parsePlate` refuses both. Guessing
 * would show up here as thousands of failures, not as a plausible parts list.
 */
import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import {
  CriteriaVocabulary,
  Disc,
  findDataset,
  GroupValues,
  operatorName,
  parsePlate,
  variablesOf,
  type CondBloc,
  type Plate,
} from "@dialogysx/catalogue";
import { decodeText } from "@dialogysx/raf";
import { NodeDirectorySource } from "./node-source.js";
import { readGroupZip } from "./group-zip.js";

const DATA_OPTION = ["-d, --data <dir>", "path to a disc's dialogys/data directory"] as const;

function describeCondition(
  bloc: CondBloc,
  values?: GroupValues,
  vocab?: CriteriaVocabulary,
): string {
  return bloc.lignes
    .map((l) =>
      l.elems
        .map((e) => {
          const list = values?.valuesFor(e.variable, vocab);
          const labels = e.valueIndices.map((i) => list?.[i] ?? `#${i}`);
          const label = vocab?.get(e.variable)?.label;
          const name = label ? `${e.variable} (${label})` : e.variable;
          return `${name} ${operatorName(e.operator)} ${labels.join("|")}`;
        })
        .join(" AND "),
    )
    .map((s) => `(${s})`)
    .join(" OR ");
}

export function platesCommand(): Command<[string | undefined]> {
  return new Command("plates")
    .description("parse plate records; with no key, sweep the whole catalogue as a grammar check")
    .argument("[key]", "a plate key such as 0202N100110, or a PR-group prefix such as 1132")
    .requiredOption(...DATA_OPTION)
    .option("-l, --language <lg>", "language for criterion labels", "fr")
    .option("--limit <n>", "stop the sweep after this many records")
    .action(async (key, opts) => {
      const source = new NodeDirectorySource(opts.data);
      const disc = new Disc(source);
      const spec = findDataset("planches");
      if (!spec) throw new Error("planches dataset spec missing");
      const opened = await disc.open(spec);
      if (!opened) throw new Error("planches: not present on this tree");
      const raf = opened.raf;

      const vocabBytes = await source.readAll(`langue/${opts.language}/classicvar.utf`);
      const vocab = vocabBytes ? CriteriaVocabulary.parse(vocabBytes) : undefined;
      if (!vocab) {
        console.log(chalk.yellow(`no classicvar.utf for ${opts.language}; labels unavailable`));
      }

      // ---- one plate or a prefix -------------------------------------
      if (key !== undefined) {
        const indices = await raf.index1.findPrefix(new TextEncoder().encode(key));
        if (indices.length === 0) {
          console.log(chalk.yellow(`no plate matching ${JSON.stringify(key)}`));
          return;
        }
        for (const i of indices.slice(0, 20)) {
          const plateKey = decodeText(await raf.keyAt(i)).trim();
          const group = plateKey.slice(0, 4);
          const values = await readGroupZip(source, group).catch(() => undefined);
          for (const rec of await raf.recordsAt(i)) {
            let plate: Plate;
            try {
              plate = parsePlate(rec);
            } catch (e) {
              console.log(`${chalk.red("FAIL")} ${plateKey}: ${(e as Error).message}`);
              continue;
            }
            console.log(
              `\n${chalk.bold(plateKey)}  ${plate.reperes.length} callout(s), ` +
                `${plate.conditionPool.length} pooled condition(s), ` +
                `${plate.locals.length} local var(s)`,
            );
            for (const r of plate.reperes) {
              for (const cand of r.candidates) {
                const cond = cand.applicability
                  ? describeCondition(cand.applicability, values, vocab)
                  : chalk.dim("always");
                const marks = [
                  cand.codedSign ? chalk.yellow("choose") : "",
                  cand.replacements ? chalk.cyan(`->${cand.replacements.join(",")}`) : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                console.log(
                  `  ${String(r.repere).padStart(3)}  ${chalk.bold(cand.ref)} ${marks}  ${cond}`,
                );
              }
            }
          }
        }
        await raf.close();
        return;
      }

      // ---- whole-catalogue sweep -------------------------------------
      const limit = opts.limit ? Number(opts.limit) : raf.index1.count;
      const total = Math.min(limit, raf.index1.count);
      let ok = 0;
      let failed = 0;
      let reperes = 0;
      let candidates = 0;
      let withCondition = 0;
      let withCodedSign = 0;
      let withReplacements = 0;
      let platesWithFaults = 0;
      const faultDetails: string[] = [];
      const operators = new Map<number, number>();
      const failures: { key: string; message: string }[] = [];
      const varsSeen = new Set<string>();

      for (let i = 0; i < total; i++) {
        const plateKey = decodeText(await raf.keyAt(i)).trim();
        for (const rec of await raf.recordsAt(i)) {
          try {
            const plate = parsePlate(rec);
            ok++;
            if (plate.faults.length > 0) {
              platesWithFaults++;
              for (const f of plate.faults) {
                if (faultDetails.length < 15) {
                  faultDetails.push(
                    `${plateKey} ${f.where}: index ${f.index} of pool size ${f.poolSize}`,
                  );
                }
              }
            }
            reperes += plate.reperes.length;
            for (const r of plate.reperes) {
              for (const cand of r.candidates) {
                candidates++;
                if (cand.applicability) {
                  withCondition++;
                  for (const v of variablesOf(cand.applicability)) varsSeen.add(v);
                }
                if (cand.codedSign) withCodedSign++;
                if (cand.replacements) withReplacements++;
              }
            }
            for (const bloc of plate.conditionPool) {
              for (const l of bloc.lignes) {
                for (const e of l.elems) {
                  operators.set(e.operator, (operators.get(e.operator) ?? 0) + 1);
                }
              }
            }
          } catch (e) {
            failed++;
            if (failures.length < 15)
              failures.push({ key: plateKey, message: (e as Error).message });
          }
        }
        if (i % 4000 === 0 && i > 0) {
          console.log(chalk.dim(`  ${i}/${total} ...`));
        }
      }
      await raf.close();

      console.log(
        `\n${failed === 0 ? chalk.green("ok") : chalk.red("FAIL")}  ` +
          `${ok.toLocaleString()} plate(s) parsed, ${failed.toLocaleString()} failed`,
      );
      console.log(
        `  ${reperes.toLocaleString()} callouts, ${candidates.toLocaleString()} part candidates`,
      );
      console.log(
        `  ${withCondition.toLocaleString()} with an applicability condition, ` +
          `${withCodedSign.toLocaleString()} needing a user choice, ` +
          `${withReplacements.toLocaleString()} with supersessions`,
      );
      console.log(`  ${varsSeen.size} distinct criteria referenced`);
      if (platesWithFaults > 0) {
        console.log(
          chalk.yellow(
            `  ${platesWithFaults} plate(s) carry a dangling pool reference — a data fault, ` +
              `not a parse failure.\n  The original throws ArrayIndexOutOfBounds on these; ` +
              `we keep the plate and mark the affected part unknown.`,
          ),
        );
        for (const d of faultDetails) console.log(chalk.yellow(`    ${d}`));
      }
      console.log("  operators seen:");
      for (const [code, n] of [...operators].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${operatorName(code).padEnd(4)} ${n.toLocaleString()}`);
      }
      for (const f of failures) {
        console.log(`  ${chalk.red("FAIL")} ${f.key}: ${f.message}`);
      }
      process.exitCode = failed === 0 ? 0 : 1;
    });
}
