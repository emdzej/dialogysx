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
- `dialogysx` CLI — `verify`, `datasets`, `keys`, `get`, `criteria`.
- A browser harness that opens a tree and queries it. 21 kB gzipped.

Measured over localhost: a 7.2 MB index preloads in 119 ms, a part-number
lookup costs 12 ms, and a depth-3 envelope query returning 18 records costs
21 ms — with the 7.2 MB data file never downloaded.

**Not working yet:** the plate condition grammar, which decides _which parts fit
which vehicle_. It is read but not specified, so there is no parts-by-vehicle
view and won't be until it is verified against known-good answers. See
[`docs/plan.md`](docs/plan.md) Phase 3 and [`docs/data-format.md`](docs/data-format.md) §7.

## Why it can be client-side only

Dialogys addresses every record as `(position, longueur)` through a sorted,
binary-searchable index. That is the shape of an HTTP `Range` request and of
`Blob.slice()`, so **the data does not need converting** — a static host can
serve the vendor's own files, and the browser reads bytes out of them.

Per language: ~17 MB of index files (preloaded), ~86 MB of data files (never
fully downloaded), 720 MB of drawings as plain PNGs served individually, and
repair documentation that already arrives as 22,967 separate XML documents —
one procedure is one fetch.

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

Then point the CLI at a mounted disc's `dialogys/data` directory:

```sh
# Validate every dataset on the disc — the regression test for the engine
node apps/cli/dist/index.js verify -d /Volumes/dialogysDVD1/dialogys/data

# What datasets exist, and where their key lengths come from
node apps/cli/dist/index.js datasets

# Look things up
node apps/cli/dist/index.js get ref-num-pr 6001548001 --exact -d "$DATA"
node apps/cli/dist/index.js get envelope-pr-type 1104 -d "$DATA"
node apps/cli/dist/index.js get trepere 1132C000 -d "$DATA"
node apps/cli/dist/index.js criteria AIRC -d "$DATA"
```

The browser harness needs the tree served over HTTP with `Range` support (it
rejects a host that ignores `Range` rather than reading the wrong bytes), or a
Chromium browser for the local-folder path:

```sh
pnpm dev
```

| Script           | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `pnpm build`     | Build every package and the web app                       |
| `pnpm dev`       | Run the browser client                                    |
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
  catalogue  parts domain: envelope, criteria, callouts, part search
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
