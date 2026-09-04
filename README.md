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

**The storage format is cracked and validated, and the app works.** `dialogysx
verify` walks every index on a real tree: **12 datasets, 576,034 keys, 0
failures** — record lengths, key ordering and pointer bounds. Across the
multi-language 7.5.6 set that is 32 datasets and 583,035 keys.

Working today:

- `@dialogysx/raf` — the storage engine, over HTTP `Range`, a local directory,
  or Node `fs`, behind one `read(pos, len)`.
- `@dialogysx/catalogue` — vehicle envelope, part-number search, drawing
  callouts, the criteria vocabulary, the date and build-number resolution, and
  the repair-documentation navigation.
- `@dialogysx/catalogue` — the **applicability condition grammar**: all 41,758
  plates parse with every byte consumed, 423,076 callouts, 762,244 part
  candidates, three-valued evaluation.
- `@dialogysx/importer` — disc classification, import planning, and a zip
  reader that works in a browser as well as in Node.
- `dialogysx` CLI — `import`, `verify`, `plates`, `organes`, `docs`,
  `datasets`, `keys`, `get`, `criteria`.
- **A browser client**: brand → model → vehicle → assembly → plate, with the
  drawing, clickable callout hotspots, part names, and the parts table filtered
  by applicability. Plus a second view for the **repair documentation** — 2,131
  English workshop manuals and technical notes, navigated by topic and filtered
  to the vehicle. No backend.
- **Import in the browser.** Mount an ISO, point at it, repeat: the wizard
  builds a tree with no Node and no command line. It shares its planner with
  the CLI, so both build the same tree from the same discs.

Measured over localhost: a 7.2 MB index preloads in 119 ms, a part-number
lookup costs 12 ms, and a depth-3 envelope query returning 18 records costs
21 ms — with the 7.2 MB data file never downloaded.

**Not yet claimed:** that any parts list is _correct_. 41,758 records prove the
grammar's shape and every date view resolves, but that does not prove "this
part fits this car". It needs one vehicle whose right answer is known
independently. See [`docs/data-format.md`](docs/data-format.md) §3.1 and §7.

**Also not verified:** the browser importer's scan-write cycle against a real
disc. Driving a native directory picker needs interaction the test harness
cannot supply, so what is checked is that the wizard opens and its worker
boots. The zip reader under it _is_ proven, CRC-verified against three real
archives.

## Why it can be client-side only

Dialogys addresses every record as `(position, longueur)` through a sorted,
binary-searchable index. That is the shape of an HTTP `Range` request and of
`Blob.slice()`, so **the data does not need converting** — a static host can
serve the vendor's own files, and the browser reads bytes out of them.

Per language: ~17 MB of index files (preloaded), ~86 MB of data files (never
fully downloaded), and repair documentation that already arrives as separate
documents, so one procedure is one fetch.

**The media stays packed.** 184,610 of the 228,515 files in a full English tree
come out of nine archives the vendor already ships — `dessins/100.zip` holds
38,488 drawings, eight `images_*.zip` hold 146,121 illustrations — and none of
them needs unpacking to be read. The importer copies them intact and the app
reads one file per `Range` request, straight out of the zip. That takes a full
import from **228,515 files to about 43,900** for the same bytes: fewer objects
to host, and a copy that finishes.

The trap, recorded because it is not obvious: the drawings ship in _two_
layouts. `100.zip` stores `1132C000.png` flat while the tree stores
`dessins/100/1132/1132C000.png`, so an archive cannot be addressed by stripping
a prefix, and the manifest declares how to name an entry. Extracted trees keep
working — the reader prefers a real file and falls back per file.

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

A disc set is five or six ISOs, and one language's data is spread across
several of them. `import` merges them, choosing between the pieces:

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
mounts ISOs itself on macOS — falling back to
`-imagekey diskimage-class=CRawDiskImage`, which is what an image whose length
is not a whole number of 2048-byte sectors needs; `hdiutil` refuses those
outright even when every file in them reads clean. It resumes by default, writes a `manifest.json`
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

### Quick start

Mount the discs, import one language into `data/` (git-ignored), and run:

```sh
pnpm install && pnpm build

# Catalogue only, English: 0.83 GB, ~4 min
node apps/cli/dist/index.js import /Volumes/dialogysDVD1 -o data -l en

pnpm dev                       # finds ./data on its own
```

Open the URL it prints. With nothing remembered the settings panel opens by
itself; enter `/data` and press **Open**. The choice is saved, so later visits
go straight to the catalogue. The language comes from the tree's
`manifest.json`, so an English-only import shows English criteria.

> **Which languages you get depends on the disc set.** The 7.5.6 set's repair
> documentation is Russian and Swedish only; the 4.55 set's is English —
> 1,152 workshop manuals, 978 technical notes and ~40,000 structured
> procedures. The parts catalogue is multi-language on either.

### Browse it

The dev server serves a tree at `/data` with `Range` support:

```sh
DIALOGYSX_DATA=$PWD/data pnpm --filter @dialogysx/web dev
```

`Range` is required — the client rejects a host that ignores it rather than
reading the wrong bytes, and it rejects an HTML response as "not a data tree"
rather than parsing a 404 page as an index. A folder works too, on browsers
with the File System Access API: it reads a mounted disc or an imported tree
directly. A folder is remembered as well, but browsers drop a directory
handle's permission on reload, so it needs one click to grant access again —
the settings panel says so.

An S3-compatible bucket works if it allows anonymous `GetObject` and sets CORS:
`Range` is not a safelisted request header, so every read is preflighted, and
`Content-Range` has to be in `ExposeHeaders`. Note that an HTTPS page cannot
read an HTTP bucket — browsers block mixed content.

### Import in the browser, with no CLI

Mount your ISOs, then use the spanner in the top bar. It asks for a target
folder — with **write** access, a different prompt from the read-only one the
catalogue uses — then for each disc in turn, showing what it found before
writing anything. Stop whenever you like: the accumulated state lives in the
tree as `.dialogysx-import.json`, so an import resumes, and a tree the CLI
started can be continued in the browser and the other way round.

The manifest is written last, deliberately: an abandoned import leaves a tree
with no manifest rather than one that looks complete.

Chromium only — the File System Access API is. And `createWritable()` stages
each file and swaps on close, so write traffic roughly doubles; the CLI is the
faster path when you have Node.

### Tests

Browser tests need both a server and a tree, so `pnpm test` alone skips them:

```sh
DIALOGYSX_DATA=$PWD/data pnpm --filter @dialogysx/web dev --port 5199
DIALOGYSX_E2E_URL=http://localhost:5199 pnpm test
```

Thirteen of them, covering identification, the drawing and its hotspots, the
parts table, criterion resolution, the documentation view and its PDF viewer,
and that a remembered tree reopens without asking.

| Script           | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `pnpm build`     | Build every package and the web app                       |
| `pnpm dev`       | Run the browser client (set `DIALOGYSX_DATA` for data)    |
| `pnpm test`      | Unit tests                                                |
| `pnpm typecheck` | Packages via `tsc`, and the Svelte app via `svelte-check` |
| `pnpm check`     | Build, typecheck and test                                 |

## Deployment

Pushing to `main` builds and publishes the app to GitHub Pages at
**[dialogysx.emdzej.pl](https://dialogysx.emdzej.pl)**. It ships **no vehicle
data** — a visitor points it at their own tree, or builds one in the browser
from their own discs, so a fresh visit lands on that panel.

`base` is decided by whether `apps/web/public/CNAME` exists, because it is
baked in at build time and a wrong one fails quietly: `index.html` still
returns 200 and every asset 404s. The workflow greps the built HTML to prove
the base took.

CI runs build, typecheck, unit tests and a formatting check on every push and
pull request. The browser suite skips itself there — it needs a data tree, and
the catalogue is Renault's and is not in this repository, so **a green CI run
says nothing about whether the interface works.**

## Layout

```
apps/
  cli        disc tooling: import, verify, inspect
  web        Svelte 5 + Vite browser client
packages/
  core       shared types for the catalogue format
  raf        the storage engine and the three read backends
  catalogue  parts domain: conditions, dates, plates, assemblies, documents
  importer   disc classification, import planning, a browser-capable zip reader
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
