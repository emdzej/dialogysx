# dialogysx

Renault/Dacia after-sales — parts catalogue and repair documentation — in the
browser, reading the original Dialogys data client-side with no backend.

A reimplementation of **Dialogys 7.5.6**, reverse-engineered from the shipped
Java application. It ships **without data**: bring a disc or point it at your
own static tree.

> **No warranty.** The catalogue data is Renault/Dacia's, is not redistributed
> here, and nothing in this repository is derived from it. Part applicability is
> reconstructed and **not yet verified** — see [Status](#status) before trusting
> a parts list against a real vehicle.

## Status

**The storage format is cracked and validated.** The engine reads every
catalogue dataset off a real disc: **32 datasets checked, 0 failures** — record
lengths, key ordering and pointer bounds over all 583,035 index keys.

Working today:

- `@dialogysx/raf` — the storage engine, over HTTP `Range`, a local directory,
  or Node `fs`, behind one `read(pos, len)`.
- `@dialogysx/catalogue` — vehicle envelope, part-number search, drawing
  callouts, the criteria vocabulary.
- `@dialogysx/catalogue` — the **applicability condition grammar**: all 41,758
  plates parse with every byte consumed, 423,076 callouts, 762,244 part
  candidates, three-valued evaluation.
- `dialogysx` CLI — `import`, `verify`, `plates`, `organes`, `datasets`, `keys`,
  `get`, `criteria`.
- **A working browser client**: PR group → vehicle → assembly → plate, with the
  drawing, clickable callout hotspots, and the parts table filtered by
  applicability. 29 kB gzipped, no backend.

Measured over localhost: a 7.2 MB index preloads in 119 ms, a part-number
lookup costs 12 ms, and a depth-3 envelope query returning 18 records costs
21 ms — with the 7.2 MB data file never downloaded.

The `import` CLI merges the six discs into one folder, with per-component and
per-language selection — the full set is 15.8 GB, the parts catalogue in one
language is 0.08 GB.

**Partly working:** parts-by-vehicle filtering. The condition grammar is done and
swept over the whole catalogue, and **71.3 % of part candidates are decidable
today**. The other 28.7 % contain a date or build-number comparison
(`MILL`, `NFAB`, ...) which needs `VarDate.resolveDate` and the `Dates`
dataset — until then they evaluate to _unknown_, which the interface should
present as a question rather than an exclusion.

**Not yet claimed:** that any parts list is _correct_. 41,758 records prove the
grammar's shape; they do not prove "this part fits this car". That needs one
vehicle whose right answer is known independently. See
[`docs/data-format.md`](docs/data-format.md) §3.1 and §7.

## Why it can be client-side only

Dialogys addresses every record as `(position, longueur)` through a sorted,
binary-searchable index. That is the shape of an HTTP `Range` request and of
`Blob.slice()`, so **the data does not need converting** — a static host can
serve the vendor's own files, and the browser reads bytes out of them.

Per language: ~17 MB of index files (preloaded), ~86 MB of data files (never
fully downloaded), 720 MB of drawings as plain PNGs served individually, and
repair documentation that already arrives as separate documents — 22,967
structured XML procedures and 2,584 PDF manuals, so one procedure is one fetch.

Full reasoning in [`docs/plan.md`](docs/plan.md).

## Documentation

- [`docs/data-format.md`](docs/data-format.md) — **the format reference.** The
  storage engine, all 12 datasets with their key lengths and where each one is
  established in the original, the drawings, the repair XML, how it was
  validated, and an honest list of what is still undecoded. No such reference
  exists anywhere else.
- [`docs/plan.md`](docs/plan.md) — why the project is shaped this way: sizing,
  architecture, phase order, ranked risks.

## Running it

```sh
pnpm install
pnpm build
```

### Import the discs into one folder

The set is six ISOs, and one language's data is spread across several of them.
`import` merges them, choosing between the pieces:

```sh
cli=apps/cli/dist/index.js

# What you can choose to import, and what breaks without each piece
node $cli import --list-components -o x x

# See the plan, with sizes measured off your actual discs. Writes nothing.
node $cli import *.iso -o data --dry-run

# The lot: 15.8 GB, both repair languages
node $cli import *.iso -o data

# Just the parts catalogue in French: 0.08 GB
node $cli import DVD-0*.iso DVD-1*.iso -o data -c min -l fr

# Catalogue, drawings and the PDF repair manuals, Russian only
node $cli import *.iso -o data -c parts,criteria,drawings,repair-pdf -l ru
```

It takes mount points as well as ISO files (`import /Volumes/... `), and only
mounts ISOs itself on macOS. It resumes by default, writes a `manifest.json`
describing what landed, and **refuses to run** rather than let one disc silently
overwrite another — which the Russian image archives really do. See
[`docs/plan.md`](docs/plan.md#dialogysx-import--why-it-is-not-cp--r) for the
three traps that motivated it.

### Read a tree

Point the CLI at an imported folder, or straight at a mounted disc's
`dialogys/data`:

```sh
DATA=data   # or /Volumes/dialogysDVD1/dialogys/data

# Validate every dataset — the regression test for the engine
node $cli verify -d "$DATA"

# What datasets exist, and where their key lengths come from
node $cli datasets

# Look things up
node $cli get ref-num-pr 6001548001 --exact -d "$DATA"
node $cli get envelope-pr-type 1104 -d "$DATA"
node $cli get trepere 1132C000 -d "$DATA"
node $cli criteria AIRC -d "$DATA"

# Applicability: one plate, or sweep the catalogue as a grammar check
node $cli plates 0202N100110 -d "$DATA"
node $cli plates -d "$DATA"
```

### Browse it

The dev server serves a tree at `/data` with `Range` support:

```sh
DIALOGYSX_DATA=$PWD/data pnpm --filter @dialogysx/web dev
```

Then "Open URL". `Range` is required — the client rejects a host that ignores it
rather than reading the wrong bytes. "Open folder" reads a mounted disc or an
imported tree directly, on browsers with the File System Access API.

Browser tests need both a server and a tree, so `pnpm test` alone skips them:

```sh
DIALOGYSX_DATA=$PWD/data pnpm --filter @dialogysx/web dev --port 5199
DIALOGYSX_E2E_URL=http://localhost:5199 pnpm test
```

| Script           | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `pnpm build`     | Build every package and the web app                       |
| `pnpm dev`       | Run the browser client (set `DIALOGYSX_DATA` for data)    |
| `pnpm test`      | Unit tests                                                |
| `pnpm typecheck` | Packages via `tsc`, and the Svelte app via `svelte-check` |
| `pnpm check`     | Build, typecheck and test                                 |

## Layout

```
apps/
  cli        disc tooling: verify, inspect, and (later) build a static tree
  web        Svelte 5 + Vite browser client
packages/
  core       shared types for the catalogue format
  raf        the storage engine and the three read backends
  catalogue  parts domain: conditions, dates, plates, assemblies, session
docs/
re/tools/    reverse-engineering scratch (the Python differential oracle)
```

## Licence

**PolyForm Noncommercial 1.0.0** — see [`LICENSE.md`](LICENSE.md).

Note the constraint this creates: PolyForm-licensed code cannot import or copy
GPL code, so dialogysx mirrors the _conventions_ of its GPL sibling
[ddtx](https://github.com/emdzej/ddtx) without taking any of its source.

The Dialogys data is **not** covered by this licence, is not ours, and is not
redistributed. `data/` and the reverse-engineering working directories are
git-ignored.
