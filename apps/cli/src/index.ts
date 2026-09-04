#!/usr/bin/env node
/**
 * dialogysx CLI.
 *
 * `verify` is the important one: it re-runs the format validation from
 * `docs/data-format.md` §6 over a real tree. It is the regression test for
 * `@dialogysx/raf`, which is why it ships in the same phase as the engine.
 *
 * Options are chained inline rather than through a shared helper. A helper that
 * takes and returns a `Command` erases the accumulated option and argument
 * types, which is the entire reason `@commander-js/extra-typings` is here.
 */
import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import {
  CriteriaVocabulary,
  DATASETS,
  Disc,
  findDataset,
  LANGUAGE_DATASETS,
  parseEnvelopeRecord,
  parsePrGroupList,
  parseReperes,
} from "@dialogysx/catalogue";
import { decodeText, encodeKey } from "@dialogysx/raf";
import { importCommand } from "./import/command.js";
import { docsCommand } from "./docs.js";
import { NodeDirectorySource } from "./node-source.js";
import { organesCommand } from "./organes.js";
import { platesCommand } from "./plates.js";

const DATA_OPTION = ["-d, --data <dir>", "path to a disc's dialogys/data directory"] as const;

const program = new Command()
  .name("dialogysx")
  .description("Inspect and validate Dialogys catalogue data")
  .version("0.1.0");

program.addCommand(importCommand());
program.addCommand(platesCommand());
program.addCommand(organesCommand());
program.addCommand(docsCommand());

program
  .command("datasets")
  .description("list the known datasets and where their key lengths come from")
  .action(() => {
    for (const s of [...DATASETS, ...LANGUAGE_DATASETS]) {
      console.log(
        `${chalk.bold(s.id.padEnd(18))} key=${String(s.keyLength).padStart(2)} ` +
          `depth=${s.depth}  ${chalk.dim(s.label)}`,
      );
      console.log(`${" ".repeat(19)}${chalk.dim(s.keySource)}`);
    }
  });

program
  .command("verify")
  .description("validate every dataset on a tree: record length, key order, pointer bounds")
  .requiredOption(...DATA_OPTION)
  .action(async (opts) => {
    const disc = new Disc(new NodeDirectorySource(opts.data));
    let checked = 0;
    let failed = 0;

    const jobs: { spec: (typeof DATASETS)[number]; language?: string }[] = [
      ...DATASETS.map((spec) => ({ spec })),
      ...(await disc.languages()).flatMap((language) =>
        LANGUAGE_DATASETS.map((spec) => ({ spec, language })),
      ),
    ];

    for (const { spec, language } of jobs) {
      const label = spec.id + (language ? ` [${language}]` : "");
      let opened;
      try {
        opened = await disc.open(spec, language);
      } catch (e) {
        // A record-length mismatch lands here, which means keyLength is wrong.
        console.log(`  ${chalk.red("FAIL")} ${label.padEnd(24)} ${(e as Error).message}`);
        failed++;
        continue;
      }
      if (!opened) {
        console.log(`  ${chalk.dim("--  ")} ${chalk.dim(label.padEnd(24) + "absent")}`);
        continue;
      }
      checked++;
      const r = await opened.raf.validate();
      await opened.raf.close();
      const ok = r.unsorted === 0 && r.badPointers === 0;
      if (!ok) failed++;
      console.log(
        `  ${ok ? chalk.green("ok  ") : chalk.red("FAIL")} ${label.padEnd(24)} ` +
          `key=${spec.keyLength} depth=${spec.depth} keys=${String(r.keys).padStart(7)} ` +
          `unsorted=${r.unsorted} bad_ptrs=${r.badPointers}`,
      );
    }

    console.log(
      `\n${checked} dataset(s) checked, ` +
        (failed === 0 ? chalk.green("0 failed") : chalk.red(`${failed} failed`)),
    );
    process.exitCode = failed === 0 ? 0 : 1;
  });

program
  .command("keys")
  .description("print the first keys of a dataset, to see what it is indexed by")
  .argument("<dataset>", "dataset id, from `dialogysx datasets`")
  .requiredOption(...DATA_OPTION)
  .option("-n, --count <n>", "how many keys", "10")
  .option("-l, --language <lg>", "language, for per-language datasets")
  .action(async (id, opts) => {
    const spec = findDataset(id);
    if (!spec) throw new Error(`unknown dataset ${JSON.stringify(id)}`);
    const disc = new Disc(new NodeDirectorySource(opts.data));
    const opened = await disc.open(spec, opts.language);
    if (!opened) throw new Error(`${id}: not present on this tree`);

    console.log(chalk.dim(`${opened.raf.index1.count} keys, data ${opened.raf.dataLength} bytes`));
    const n = Math.min(Number(opts.count), opened.raf.index1.count);
    for (let i = 0; i < n; i++) {
      const key = decodeText(await opened.raf.keyAt(i));
      const ptrs = await opened.raf.pointersAt(i);
      console.log(`${chalk.bold(JSON.stringify(key))} -> ${ptrs.length} record(s)`);
    }
  });

program
  .command("get")
  .description("look a key up in a dataset and print the records")
  .argument("<dataset>", "dataset id")
  .argument("<key>", "the key, or a prefix of it")
  .requiredOption(...DATA_OPTION)
  .option("-l, --language <lg>", "language, for per-language datasets")
  .option("--exact", "exact match instead of prefix", false)
  .action(async (id, key, opts) => {
    const spec = findDataset(id);
    if (!spec) throw new Error(`unknown dataset ${JSON.stringify(id)}`);
    const disc = new Disc(new NodeDirectorySource(opts.data));
    const opened = await disc.open(spec, opts.language);
    if (!opened) throw new Error(`${id}: not present on this tree`);

    const probe = encodeKey(key);
    const records = opts.exact
      ? ((await opened.raf.get(probe)) ?? [])
      : await opened.raf.getPrefix(probe);
    if (records.length === 0) {
      console.log(chalk.yellow(`no records for ${JSON.stringify(key)}`));
      return;
    }
    console.log(chalk.dim(`${records.length} record(s)`));
    for (const rec of records) {
      // Domain-aware rendering where the format is specified; raw text otherwise.
      if (id.startsWith("envelope")) {
        const e = parseEnvelopeRecord(rec);
        console.log(e ? JSON.stringify(e) : chalk.yellow("unparseable envelope record"));
      } else if (id === "trepere") {
        console.log(JSON.stringify(parseReperes(rec)));
      } else if (id === "ref-num-pr") {
        console.log(parsePrGroupList(rec).join(", "));
      } else {
        console.log(JSON.stringify(decodeText(rec).slice(0, 400)));
      }
    }
  });

program
  .command("criteria")
  .description("show the vehicle-criteria vocabulary from classicvar.utf")
  .argument("[code]", "a criterion code; omit to list all")
  .requiredOption(...DATA_OPTION)
  .option("-l, --language <lg>", "language directory", "fr")
  .action(async (code, opts) => {
    const source = new NodeDirectorySource(opts.data);
    const bytes = await source.readAll(`langue/${opts.language}/classicvar.utf`);
    if (!bytes) throw new Error(`no classicvar.utf for language ${JSON.stringify(opts.language)}`);
    const vocab = CriteriaVocabulary.parse(bytes);

    if (code === undefined) {
      console.log(chalk.dim(`${vocab.size} criteria`));
      for (const c of vocab.codes()) console.log(`${chalk.bold(c)}  ${vocab.get(c)?.label ?? ""}`);
      return;
    }
    const c = vocab.get(code);
    if (!c) throw new Error(`unknown criterion ${JSON.stringify(code)}`);
    console.log(`${chalk.bold(c.code)}  ${c.label}`);
    console.log(chalk.dim(c.question));
    c.values.forEach((v, i) => console.log(`  ${String(i).padStart(3)}  ${v}`));
  });

program.parseAsync().catch((e: unknown) => {
  console.error(chalk.red(e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
});
