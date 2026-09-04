/**
 * `dialogysx docs` — sweep the repair-documentation indexes and report.
 *
 * The point is the sweep. `repair.ts` was written from the decompiled
 * `ArboRechercheSaxHandler` and `AbstractApplicability`, and unit tests prove
 * it does what those say; only walking every `ArboRech-*.xml` on a real disc
 * proves the files agree. It reports what it could not resolve — an index with
 * no family, a document with no PDF on disk — rather than counting them as
 * successes.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import {
  CriteriaVocabulary,
  DocIndex,
  FamilyModels,
  docPdfPath,
  type DocKind,
} from "@dialogysx/catalogue";
import { NodeDirectorySource } from "./node-source.js";

/** `ArboRech-MR-pdf-X06.xml` -> kind, whether it is the PDF index, family. */
function parseIndexName(
  name: string,
): { kind: DocKind; pdf: boolean; family: string } | undefined {
  const m = /^ArboRech-(MR|NT)(-pdf)?-(.+)\.xml$/.exec(name);
  if (!m) return undefined;
  return { kind: m[1] as DocKind, pdf: m[2] !== undefined, family: m[3]! };
}

export function docsCommand(): Command<[string | undefined]> {
  return new Command("docs")
    .description("sweep the repair-documentation indexes; with a family, list its documents")
    .argument("[family]", "a family code such as X06, or a model name such as Twingo")
    .requiredOption("-d, --data <dir>", "path to an imported data tree")
    .option("-l, --language <code>", "documentation language", "en")
    .option("--xml", "read the chapitres indexes instead of the -pdf ones", false)
    .action(async (family, opts) => {
      const source = new NodeDirectorySource(opts.data);
      const lang = opts.language;

      const vocabBytes = await source.readAll(`langue/${lang}/classicvar.utf`);
      const vocabulary = vocabBytes ? CriteriaVocabulary.parse(vocabBytes) : undefined;
      if (!vocabulary) {
        console.log(
          chalk.yellow(
            `no langue/${lang}/classicvar.utf — families cannot be named without it, ` +
              `since FamilleModeleAll.dat holds MOD_ indices rather than names`,
          ),
        );
      }
      const famBytes = await source.readAll("pr/FamilleModeleAll.dat");
      const families = famBytes ? FamilyModels.parse(famBytes, vocabulary) : undefined;
      if (families) {
        console.log(
          `${chalk.bold(families.families.length)} families covering ` +
            `${chalk.bold(families.size)} models`,
        );
      }

      const indexDir = join(opts.data, "mrnt", lang, "d3k", "indexation");
      const names = (await readdir(indexDir).catch(() => [] as string[])).sort();
      if (names.length === 0) {
        console.error(
          chalk.red(
            `${indexDir}: no indexes. Import with the "repair-pdf" component to get them.`,
          ),
        );
        process.exitCode = 1;
        return;
      }

      // ---- one family: list what it offers ------------------------------
      if (family !== undefined) {
        const code = families?.familyOf(family) ?? family;
        let shown = 0;
        for (const kind of ["MR", "NT"] as DocKind[]) {
          const name = `ArboRech-${kind}${opts.xml ? "" : "-pdf"}-${code}.xml`;
          const bytes = await source.readAll(`mrnt/${lang}/d3k/indexation/${name}`);
          if (!bytes) {
            console.log(chalk.dim(`  ${name}: not present`));
            continue;
          }
          const idx = DocIndex.parse(bytes, kind, code);
          const docs = idx.documents();
          console.log(
            `\n${chalk.bold(name)}: ${idx.elements.length} elements, ${docs.length} documents`,
          );
          for (const d of docs.slice(0, 40)) {
            const rel = docPdfPath(lang, kind, d.numero);
            const there = await stat(join(opts.data, rel))
              .then(() => true)
              .catch(() => false);
            const mark = opts.xml ? chalk.dim("xml") : there ? chalk.green("pdf") : chalk.red("??");
            const appl =
              d.applicability.length === 0
                ? chalk.dim("all vehicles")
                : d.applicability
                    .map((a) =>
                      a.clauses.map((c) => `${c.variable}=${c.values.join("|")}`).join(" and "),
                    )
                    .join(" or ");
            console.log(`  ${mark} ${chalk.bold(d.numero)}  ${d.title}  ${chalk.dim(appl)}`);
          }
          if (docs.length > 40) console.log(chalk.dim(`  ... and ${docs.length - 40} more`));
          shown++;
        }
        if (shown === 0) {
          console.log(
            chalk.yellow(
              `no indexes for ${JSON.stringify(family)}` +
                (code === family ? "" : ` (family ${code})`),
            ),
          );
        }
        return;
      }

      // ---- the sweep -----------------------------------------------------
      let files = 0;
      let elements = 0;
      let docRefs = 0;
      let applBlocks = 0;
      let unconditional = 0;
      const variables = new Map<string, number>();
      const distinctDocs = new Map<string, DocKind>();
      const unnamedFamilies: string[] = [];
      const unparsed: string[] = [];
      const empty: string[] = [];
      const docless: string[] = [];

      for (const name of names) {
        const parsed = parseIndexName(name);
        if (!parsed) continue;
        if (parsed.pdf === opts.xml) continue;
        const bytes = await source.readAll(`mrnt/${lang}/d3k/indexation/${name}`);
        if (!bytes) continue;
        const idx = DocIndex.parse(bytes, parsed.kind, parsed.family);
        // Distinguish the two reasons an index can yield nothing. 41 of the 161
        // English chapter indexes are a bare `<arborech/>`; the rest yielding
        // nothing would be a parser fault. Reporting them together said
        // "41 indexes parsed to zero elements" about files with nothing in them.
        if (idx.elements.length === 0) {
          if (DocIndex.isEmptyByDesign(bytes)) empty.push(name);
          else unparsed.push(name);
        }
        // Elements with no documents are the other silent failure: the XML
        // indexes name their documents `<UI>`, and a case-sensitive match found
        // 27,924 elements and zero documents in them.
        if (idx.elements.length > 0 && idx.elements.every((el) => el.docs.length === 0)) {
          docless.push(name);
        }
        if (families && families.modelsOf(parsed.family).length === 0) {
          unnamedFamilies.push(parsed.family);
        }
        files++;
        elements += idx.elements.length;
        for (const el of idx.elements) {
          for (const d of el.docs) {
            docRefs++;
            distinctDocs.set(`${d.kind}/${d.numero}`, d.kind);
            if (d.applicability.length === 0) unconditional++;
            applBlocks += d.applicability.length;
            for (const a of d.applicability) {
              for (const c of a.clauses) {
                variables.set(c.variable, (variables.get(c.variable) ?? 0) + 1);
              }
            }
          }
        }
      }

      console.log(
        `\n${chalk.bold(files)} ${opts.xml ? "chapitres" : "pdf"} indexes: ` +
          `${elements.toLocaleString()} elements, ${docRefs.toLocaleString()} document refs, ` +
          `${distinctDocs.size.toLocaleString()} distinct documents`,
      );
      console.log(
        `  ${applBlocks.toLocaleString()} applicability blocks; ` +
          `${unconditional.toLocaleString()} refs apply to every vehicle ` +
          chalk.dim(`(${((unconditional / Math.max(docRefs, 1)) * 100).toFixed(1)}%)`),
      );
      // Capped: the chapter indexes use 130 variables, and printing all of
      // them buries the six that matter in a wall of `$`-prefixed ones the
      // vehicle cannot answer anyway.
      const byVar = [...variables.entries()].sort((a, b) => b[1] - a[1]);
      const top = byVar.slice(0, 12);
      const secondary = byVar.filter(([v]) => v.startsWith("$")).length;
      console.log(
        "  variables used: " +
          (byVar.length === 0
            ? chalk.dim("none")
            : top.map(([v, n]) => `${chalk.bold(v)}×${n.toLocaleString()}`).join(", ")) +
          (byVar.length > top.length
            ? chalk.dim(` … ${byVar.length - top.length} more`)
            : ""),
      );
      if (secondary > 0) {
        console.log(
          chalk.dim(
            `  ${secondary} of ${byVar.length} are $-prefixed — asked when a document ` +
              `is opened, not derived from the vehicle, so navigation skips them`,
          ),
        );
      }

      // ---- do the documents exist? ---------------------------------------
      if (!opts.xml) {
        let present = 0;
        const missing: string[] = [];
        for (const [key, kind] of distinctDocs) {
          const numero = key.slice(key.indexOf("/") + 1);
          const rel = docPdfPath(lang, kind, numero);
          const there = await stat(join(opts.data, rel))
            .then(() => true)
            .catch(() => false);
          if (there) present++;
          else missing.push(rel);
        }
        // Never round up to "100.0%" while something is missing: 2,130 of
        // 2,131 is 99.95%, and a report that says 100% next to a list of
        // absent files is the kind of summary people believe over the detail.
        const ratio = present / Math.max(distinctDocs.size, 1);
        const pct = missing.length === 0 ? "100" : Math.min(99.9, ratio * 100).toFixed(1);
        console.log(
          `  ${present.toLocaleString()} of ${distinctDocs.size.toLocaleString()} PDFs on disk ` +
            chalk.dim(`(${pct}%)`),
        );
        if (missing.length > 0) {
          // Not necessarily a fault: a multi-disc set indexes documents that
          // ship on a disc you did not import. Named so the difference between
          // "missing" and "not imported" stays visible.
          console.log(chalk.yellow(`  ${missing.length} indexed but absent, e.g.:`));
          for (const m of missing.slice(0, 5)) console.log(chalk.dim(`    ${m}`));
        }
      }

      if (unnamedFamilies.length > 0) {
        const uniq = [...new Set(unnamedFamilies)];
        console.log(
          chalk.yellow(
            `  ${uniq.length} families have an index but no models in FamilleModeleAll.dat: ` +
              uniq.slice(0, 12).join(", ") +
              (uniq.length > 12 ? ", ..." : ""),
          ),
        );
      }
      if (empty.length > 0) {
        console.log(chalk.dim(`  ${empty.length} indexes are an empty <arborech/> — nothing to read`));
      }
      let broken = false;
      if (unparsed.length > 0) {
        broken = true;
        console.log(chalk.red(`  ${unparsed.length} non-empty indexes parsed to zero elements:`));
        for (const u of unparsed.slice(0, 8)) console.log(chalk.dim(`    ${u}`));
      }
      if (docless.length > 0) {
        broken = true;
        console.log(chalk.red(`  ${docless.length} indexes yielded elements but no documents:`));
        for (const u of docless.slice(0, 8)) console.log(chalk.dim(`    ${u}`));
      }
      if (broken) process.exitCode = 1;
      else console.log(chalk.green("  every non-empty index yielded elements and documents"));
    });
}
