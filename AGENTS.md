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
- **A flag that silently drops work.** `-c min,labour-times` used to
  short-circuit on `min` and discard `labour-times`, then report a successful
  import that skipped 99,056 files. Check the _output_, not the exit code.
- **Do not run two long imports at once.** Two background runs against one
  output directory raced, and the second `rm -rf` deleted files the first was
  still writing — which then looked like an extraction bug.

## Importing discs

`dialogysx import` merges a disc set — five or six ISOs. It is not `cp -r`, and
the reasons are all cases where a copy loses data **without an error**:

- Two discs write `mrnt/ru/d3k/images/images_1.zip` with different content, so
  image archives are extracted, not copied. Their entries do not overlap
  (0 of 36,374), and the importer reports it if that ever changes.
- The parts drawings ship twice — `dessins/100.zip` and `dessins/100/` — so the
  archive is an off-by-default component. Do not "fix" the 694 MB gap.
- `update/VersionData` differs per disc, so it goes in the manifest rather than
  the tree.

- `images_1.zip` on the English DVD-5 contains `bkp.tar.gz` (52 MB) and a
  `bkp/` tree beside its illustrations — somebody left a backup inside a
  shipped archive — so image archives keep only illustrations.

- **Illustration and drawing archives are copied, not extracted, by default.**
  They are read in place through `ArchiveSource`, and each is copied into a
  per-disc subdirectory because the names collide — `images_1.zip` exists on
  three English discs with different contents. Every one of them must reach
  `manifest.json`'s `archives`, or its illustrations become unreachable.

**Every file on every disc must map to a named component.** `--dry-run`
prints anything unclaimed, and that list is how `TM.zip` (99,056 labour-time
XMLs), `tarif.zip` and `REACH.zip` were found. If you add a disc and something
is unclaimed, name it — including things that are out of scope, so the omission
reads as deliberate.

The manifest exists because **HTTP cannot list a directory**: `HttpTreeSource`
has to be told which languages a tree carries.

## Applicability conditions

This is the part that decides which parts fit which vehicle, so it gets the
strictest treatment in the repo.

- **Read the parser, not the bytes.** The application is unobfuscated.
  `PRFactory.newCondPlanche` and `CondFactory` _are_ the specification. An
  earlier version of the format doc described the leading shorts as "counts" and
  invented an "`0xFF` applicability mask" from a hexdump; both were wrong. The
  shorts are pool sizes and the "mask" was a run of `-1` sentinels.
- **`readShort` is signed.** `-1` means "no condition". Unsigned gives 65535 and
  a pool lookup off the end.
- **The not-equal operator is 8800 (U+2260), not a byte.** Read it as one byte
  and every `≠` clause becomes unrecognised — and `CondElem`'s `default:` maps
  that to _unknown_, so it fails quietly rather than loudly.
- **`unknown` means "ask the user", not "exclude".** The original raises
  `DontKnowException` and prompts. Mapping it to false hides parts that do fit.
- **`condBlocSC` is not a filter.** It triggers `askSignCod`, a choice between
  surviving variants. Filtering on it drops legitimate parts.
- **`parsePlate` asserts the record is fully consumed.** Keep that. It is what
  turns a grammar mistake into a loud failure instead of a plausible parts list
  assembled from misaligned bytes.

`dialogysx plates` with no key sweeps all 41,758 plates. Run it after any change
here: it must report 0 failures and 9 data faults, no more and no fewer.

**What is not established:** that any parts list is _correct_. The sweep proves
the shape. Nobody has yet compared output against a vehicle whose right answer
is known independently, so do not describe filtering as verified.

## The browser client

`apps/web` is Svelte 5 runes. The interesting logic is all in
`@dialogysx/catalogue`; the components are presentational on purpose.

- **Navigation follows the data**: brand -> model -> vehicle -> assembly ->
  plate. Not a design preference — the drawing number lives only on the assembly
  record, so a plate cannot be rendered without walking through one. The PR
  group is a _consequence_ of the vehicle, not a separate choice.
- **The assembly belongs to the parts view, not to identification.** The repair
  documents are indexed by vehicle _family_ and `documentsFor` never sees an
  assembly, so it has no bearing on them. It is a panel with a search box
  rather than a dropdown, because the menu is 346 entries in three levels.
- **A vehicle must be picked before plates appear.** Applicability is evaluated
  against it, so the plate list is genuinely vehicle-dependent.
- **Hover and pin are separate fields.** With one, `onmouseenter` set it and the
  following click compared against what hover had just written, so clicking a
  hotspot toggled the highlight straight back off. `activeRepere` is
  `pinned ?? hovered`.
- **Hotspots are positioned in percentages of the image's _measured_ natural
  size**, not of 1000x820. Some drawings are a different size, and a hard-coded
  denominator puts every hotspot in the wrong place on those.
- **Condition text is precomputed in the session**, which holds the PR group's
  value table. The interface cannot resolve operand indices, and a first cut
  that rendered only names and operators produced
  `"Type moteur = or NFMO = and ..."` — readable-looking nonsense.

- **Long applicability text is on demand.** One engine-block candidate has
  twenty OR'd alternatives, each naming a dozen values; rendered in its cell it
  made one row taller than the drawing beside it. The column is an icon that
  opens the text, red when the row is undecided.
- **Async results need a generation guard.** Every action awaits data read over
  `Range`, so two overlapping ones finish in network order and the _older_ one
  wrote last: typing a build number and immediately answering a criterion put
  back a plate resolved before the answer, and the count sat at "6 undecided"
  with the answer visibly accepted. `Generations` in `apps/web/src/lib` exists
  for this; nested calls inherit the caller's generation rather than claiming
  their own.

### Three bugs that only appear in a browser

All three passed every server-side test:

- **`fetch` must be bound.** `private readonly fetchImpl: typeof fetch = fetch`
  makes `this.fetchImpl(...)` a _method_ call, so the browser's `fetch` gets the
  reader as its `this` and throws "Illegal invocation". Node tolerates it. It
  presented as the catalogue silently appearing absent, because `open()` treats
  a throwing `size()` as "file not there".
- **The dev server must answer `HEAD` without a body.** `HttpRangeReader.size()`
  sends one per file; piping the payload into a HEAD response stalls the
  request, which looked like the browser suite hanging on startup.
- **An SPA answers any unknown path with its own HTML and a 200**, so a
  mistyped base URL looks like a file that exists, and parsing that as an index
  gives "Offset is outside the bounds of the DataView". `NotDataError` is a
  distinct type from a 404 on purpose: a 404 means _this file_ is absent, which
  is normal, while HTML means the whole tree is somewhere else.

A fourth, in the same family: **the dev server must set `Content-Type`.** It
typed only `.png`, so a PDF arrived typeless — which a browser downloads rather
than renders, leaving the document viewer an empty frame with no error
anywhere.

### Boot effects must not track what they write

`restore()` reads `app.models`, `app.vehicles` and `app.assemblies` — all
`$state` — while putting a remembered selection back, so an unguarded `$effect`
tracks them and writing them re-runs it: open, restore, write, re-run, forever.
The guard is a plain `let booted`, not `$state`, so testing it is not a tracked
read either.

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

- **No parts list has been checked against a known-good answer.** The grammar
  parses all 41,758 plates with every byte consumed and every date view
  resolves, but that proves shape, not correctness. It needs one vehicle whose
  right answer is known independently. This is the one claim to keep making
  carefully.
- **The browser importer's write cycle is untested against a real disc.**
  Driving a native directory picker needs interaction Playwright cannot supply,
  so what is covered is that the wizard opens and its worker boots. The zip
  reader beneath it _is_ CRC-verified against three real archives, and the
  planner is the CLI's.
- **`prremp` payloads and `refContexte` are undecoded.** `Dates` is decoded —
  see `dates.ts` — and the three date views resolve.
- **`chemins.properties` has not been extracted** from the MSI, so the path
  layout comes from the decompiled readers and the observed tree rather than
  from the vendor's own constants. Every path in `repair.ts` cites the class
  that builds it.
- **The D3K/SPI XML procedures have no renderer.** The _indexes_ are read —
  37,695 procedures across 161 files — but turning one into a page is not built.
  `repair.xsl` from DVD-0 is the authority on presentation.
- **No eslint.** `prettier --check` runs in CI; there is no linter beyond
  `tsc` and `svelte-check`.
- **The browser tests never run in CI.** They need a dev server _and_ a data
  tree, and the catalogue is Renault's and is not in this repository, so
  `pnpm test` alone skips all fourteen — **a green CI run says nothing about
  whether the interface works.** Running them:

  ```sh
  DIALOGYSX_DATA=/path/to/tree pnpm --filter @dialogysx/web dev --port 5199
  DIALOGYSX_E2E_URL=http://localhost:5199 pnpm test
  ```

  Assertions are **vitest's** `expect` plus Playwright's `waitFor`. The matchers
  from `@playwright/test` (`toBeVisible`, `toHaveCount`) do not exist here and
  fail with "Invalid Chai property", which is how the first run of that file
  went.

- **Only macOS can mount ISOs.** `import` shells out to `hdiutil`, falling back
  to `-imagekey diskimage-class=CRawDiskImage` for an image whose length is not
  a whole number of 2048-byte sectors — `hdiutil` refuses those outright even
  when every file in them reads clean. Elsewhere it asks for mount points,
  which it accepts on any platform.
- **`import` has no unit test for its copy/extract loop.** The component
  routing, the path mapping and the archive predicates are tested; the file walk
  is only covered by running it.
- **A deployed HTTPS page cannot read an HTTP data tree.** Browsers block mixed
  content, so `dialogysx.emdzej.pl` cannot reach a plain-HTTP bucket. Nothing in
  the code can fix that.

## Where the shared code lives

`@dialogysx/importer` holds everything the CLI and the browser importer must
agree on: disc identification, component routing, the path mapping, the archive
predicates, and per-disc planning. Both sides provide a `SourceFs`/`TargetFs`
adapter and nothing else. **Do not reimplement any of it on one side** — a
second copy of "is this an image archive" diverges on the first disc nobody
tested with.

Two things that follow:

- `node:fs` appears in exactly one importer file, `apps/cli/src/import/node-fs.ts`.
- The zip reader is ours rather than a library's, for two measured reasons: these
  archives put **CRC-32 = 0 in every local file header** while the central
  directory holds the truth, so a reader must take sizes from the central
  directory or truncate every entry to nothing; and `fflate.unzip`, which does
  read the central directory, wants the whole archive in memory when
  `images_1.zip` is 945 MB.

## Reading archives in place

`ArchiveSource` decorates a `FileSource` so packed archives answer for the
directory they stand in for. Three things about it are load-bearing:

- **A mount declares how to name an entry.** The drawings ship in two layouts —
  `100.zip` flat, and a `dessins/100/` tree bucketed by the first four
  characters — so stripping a prefix gives the wrong name. `entry: "basename"`
  is a fact about that archive, not a default.
- **Several archives can serve one directory**, because `images_1.zip` exists
  three times with different contents. A lookup tries each; their entry names
  do not overlap.
- **`fileUrl` prefers the archive, `readAll` prefers the extracted file.** The
  asymmetry is deliberate: `HttpTreeSource.fileUrl` returns a URL without
  checking anything, so asking it first yielded a URL for every drawing, each
  of which 404'd, and the archive was never consulted — an `<img>` that never
  loaded, with no error anywhere.

## Persisted state in the browser

Three stores, and which one to use is not a preference:

- **`localStorage`** — the source choice, the language, and the current
  selection. Small JSON.
- **IndexedDB** — the picked `FileSystemDirectoryHandle`. `JSON.stringify`
  turns a handle into `{}` without throwing, so `localStorage` would silently
  stop remembering the folder.
- **The target tree itself** — `.dialogysx-import.json`, so an import resumes
  across tabs and machines, and a tree the CLI started can be continued in the
  browser.

A handle's **permission does not survive a reload**: `queryPermission` returns
`"prompt"` even for one granted yesterday, and `requestPermission` only works
inside a user gesture. So a remembered folder needs a click; a URL does not.
Say this in the interface rather than letting it be discovered.

## Commit messages

Say what changed and _why_, including the mistake that motivated it, in prose.
If a number justified the change, quote it. If a claim in the docs turned out to
be too strong, say what the measurement was — that is the most useful kind of
commit message this repository has.
