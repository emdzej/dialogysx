# Working on dialogysx

Notes for anyone — human or agent — changing this repository. Conventions only,
and mostly ones learned by getting them wrong. For how the format works read
[`docs/data-format.md`](docs/data-format.md); for why the project is shaped this
way read [`docs/plan.md`](docs/plan.md).

This is a parts catalogue. A wrong applicability decision puts a part on a
vehicle it does not fit, and nothing in a green test run will tell you.

## Before you finish

```sh
pnpm typecheck    # NOT just `turbo run typecheck` — see below
pnpm test
node apps/cli/dist/index.js verify -d <a mounted disc>/dialogys/data
```

`pnpm typecheck` is two things: `turbo run typecheck` over the packages via
`tsc`, **and** `apps/web` separately, because the web app type-checks through
`svelte-check` against its own tsconfig. The package pass does not see the
`.svelte` files at all. Do not substitute one for the other.

`verify` is not optional if you touched `packages/raf`. The unit tests use
synthetic fixtures; only a real disc has 583,035 keys.

## The format code

**`docs/data-format.md` is the specification and it is kept honest.** If you
learn something new about a layout, update the doc in the same change. If you
find the doc overstating a claim, weaken it — that has already happened twice
here, and both times the wrong version was the more confident one.

Two rules the engine must not get wrong:

- **No padding in the `index2` pointer list.** The original's
  `MultipleRAFRecordInfoFactory` skips to offset +8, implying 4 bytes of
  padding. That class is unreachable from `IndexedRAFFactory`, and the padded
  reading does not validate. There is a test pinning the exact pointers.
- **Signed-byte key comparison**, matching `Clef.compareByteArrays`. Know what
  this buys you: **0 of 583,035 catalogue keys contain a byte above `0x7F`**, so
  no amount of disc data will catch getting it wrong. It has a unit test for
  that reason, and it bites on the MR/NT text indexes.

## Measure, do not estimate

Sizes and timings in this repo are measured numbers and the docs quote them.
Index preload cost, per-lookup latency, dataset key counts — run it and read the
number. "It should be fast enough" is not a claim this repo makes.

The counts in the docs (41,758 plates; 327,169 part references; 39,584
drawings) all came from a disc, not from arithmetic on a guess.

## Verify a test by breaking it

A test that has never failed has not been shown to work. Change the code so the
bug it describes is present, watch it fail with a message that names the
problem, then restore.

Both format rules above were verified this way: introducing the phantom +8
padding failed three tests, and switching to unsigned comparison failed the
signed-comparison test. Two traps found while doing it:

- **The `cd` in a compound shell command persists.** A break-then-restore run
  here `cd`-ed into the source directory, so the restore path was wrong, the
  broken code stayed on disk, and the follow-up run "still failed" for a reason
  that had nothing to do with the test. Use absolute paths, or check the restore.
- **Encoding bugs pass tests.** `classicvar.utf` read as cp1252 yields
  `"Air conditionnÃ© normal"` — a string that parses and renders. Assert on
  content, not on absence of an exception.

## Things that are the way they are on purpose

- **Encoding is per file.** The `.utf` suffix means UTF-8; everything else is
  cp1252. `decodeText` is cp1252 because that is most of the tree.
- **Records are CR-separated, not LF.** Splitting on `\n` yields one line.
- **`unzip` reports bad CRCs on `pr/*.zip` and exits non-zero.** Every CRC field
  in those archives is zero. The data is fine; an importer must ignore it.
- **A missing dataset is `absent`, not a failure.** Discs carry different
  subsets. The cost is that a _typo_ in a path also reads as absent — the one
  blind spot in `verify`, and it is written down in the format doc.
- **French names are kept** (`Planches`, `Organes`, `enveloppe`, `repere`). The
  data uses them as keys; translating them would add a layer to get wrong.
- **CLI options are chained inline, not through a helper.** A helper taking and
  returning a `Command` erases the accumulated types, which is the whole reason
  `@commander-js/extra-typings` is a dependency.
- **`readMany` exists because the original had it.**
  `getTabOfRecords(positions[], lengths[])` — a plate view was never meant to be
  N round trips.

## Use libraries, but not reflexively

Prefer an existing library over hand-rolling. Two decisions worth knowing:

- **cp1252 uses `TextDecoder`, not `iconv-lite`.** `TextDecoder` _is_ the
  library — the WHATWG Encoding Standard, built into Node and every browser,
  with a normative mapping. A dependency here would be Node-only and worse.
- **`@types/commander` is not installed.** It is a deprecated stub; commander
  ships its own types. `@commander-js/extra-typings` is the package that adds
  inference.

Java modified UTF-8 is hand-written (~15 lines against a spec) because no
maintained JS library covers it. That is the exception, and it is commented.

## Repository facts

- **PolyForm Noncommercial 1.0.0.** It therefore **cannot import or copy** GPL
  code — including its sibling [ddtx](https://github.com/emdzej/ddtx), which is
  GPL-3.0. Mirror ddtx's conventions; never take its source.
- **The catalogue data is not ours and is not committed.** `data/`,
  `re/extract/` and `re/decompiled/` are git-ignored. Never add a fixture
  derived from a disc, and never put a VIN in a commit, test, or doc.
- **Out of scope by decision:** pricing (`tarif`, `estimation`, `tarifmaker`)
  and internal ordering / DMS (`ap2ap`, `dossiers`, `bondeservice`, `rmi.dms`,
  `fax`). Document their formats if they share the engine; build no features.

## Known gaps

Honest list, so nobody reports these as discoveries:

- **Plate condition grammar is unspecified.** Understood by example only. This
  is the critical path: it decides which parts fit which vehicle, and it has no
  known-answer tests yet. Until it does, there is no parts-by-vehicle view.
- **`prremp` payloads, `refContexte`, and `Dates` semantics are undecoded.**
- **`chemins.properties` has not been extracted** from the 250 MB MSI, so the
  path layout is inferred from `AccesPR` and the observed tree.
- **The web app is a harness, not a product.** No plates, no drawings, no repair
  documentation yet.
- **No lint.** No eslint or prettier check runs in CI, because there is no CI.
  `pnpm format` exists and is manual.
- **No browser tests.** The e2e shape ddtx uses is not set up here.

## Commit messages

Say what changed and _why_, including the mistake that motivated it, in prose.
If a number justified the change, quote it. If a claim in the docs turned out to
be too strong, say what the measurement was — that is the most useful kind of
commit message this repository has.
