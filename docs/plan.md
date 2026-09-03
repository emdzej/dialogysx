# Plan

Why dialogysx is shaped the way it is: what the discs actually contain, the
architectural consequence of the storage format, and the order of work.

Read [`data-format.md`](data-format.md) first — the plan follows from the format.

## 1. The decisive finding

Dialogys stores its catalogue as **variable-length records addressed by
`(position, longueur)` through a sorted, binary-searchable index** (§2.2 of the
format doc). That is byte-for-byte the shape of an **HTTP `Range` request**, and
also the shape of `File.slice()` in a browser.

So the reader interface is one method:

```ts
read(pos: number, len: number): Promise<Uint8Array>
```

with three backends — HTTP `Range` against static hosting, `File.slice()` from a
local directory the user picked, and `fs.read()` in the CLI. **The same
`SortedCobolFile` / `IndexedRAF` code runs over all three.** This is the same
"three sources behind one `read(path)`" pattern ddtx settled on, and here it is
not a convenience: it is what makes the client-side-only design work.

The consequence: **the data does not need converting.** A static host can serve
the vendor's own files.

## 2. Sizing — is client-side-only feasible?

Measured, per language, for the parts catalogue:

|                                                      | Bytes      | How it is used                                     |
| ---------------------------------------------------- | ---------- | -------------------------------------------------- |
| Index files (`*.idx`, `*index1`, `*index2`)          | **~17 MB** | Preloaded once, gzipped over the wire              |
| Data files (`*.dat`, `enveloppe`, `Dates`, `prremp`) | ~86 MB     | **Never fully downloaded** — range-read per record |
| Drawings, 39,584 PNGs                                | 720 MB     | Served individually, one per plate view            |
| Criteria / language / misc                           | ~50 MB     | Small files, loaded on demand                      |

Repair documentation is a separate ~11 GB per language, and it is **two parallel
systems** (§5 of the format doc):

|                        | Files  | Bytes   | What it needs                 |
| ---------------------- | ------ | ------- | ----------------------------- |
| D3K/SPI XML procedures | 23,331 | 4.28 GB | a renderer                    |
| PDF manuals and notes  | 2,584  | 1.36 GB | a PDF viewer and an XML index |
| Illustrations (zipped) | 9      | 5.27 GB | unzipping once, at import     |

Both arrive already split per document, so one procedure is one fetch — no
repacking. The illustrations are the only part that must be unpacked, because a
client cannot range-read into a zip's deflate stream.

> An earlier version of this plan said "98.5 % XML, 454 PDFs, so a PDF viewer
> covers the notes and nothing else." That was a census of **one disc**. The
> Russian set spans three, and DVD-5 adds 2,130 more PDFs — the classic workshop
> manuals — plus `ArboRech-MR-pdf-*.xml`, a per-family navigation tree that makes
> them browsable and applicability-filtered. The PDF half is a real deliverable,
> and the cheaper one, which is why Phase 5 now does it first.

**Verdict: yes, purely client-side, no backend.** The largest thing the browser
must hold is ~17 MB of indexes. Everything else is fetched by the byte range or
by the file. The 720 MB of parts drawings and the ~11 GB of repair documentation
live on the static host and are never downloaded wholesale.

The one thing the browser cannot do is decode a VIN, and neither could the
original — see §5A of the format doc. VIN lookup was **BVM, a remote TCP service
requiring a dealer id**; `VIN_Expert` is a 20-line prefix comparator, not a
decoder; and `saisieVIN` validates only length. Identification on the discs is
**type-first**: the type yields the model and PR group via `typesetpr` and the
envelope.

So dialogysx accepts a VIN, uses what its type portion supports, and says so —
rather than implying a decode the data cannot deliver. A BVM client is not
planned: it needs credentials we do not have and a service that may no longer
answer.

## 3. Architecture

Two top-level homes only: `apps/` for the things you run, `packages/` for
everything they share. No `tools/` — the disc-unpacking that would live there is
a CLI command instead, because it needs the same readers as everything else.

```
apps/
  web        Svelte 5 + Vite browser client (the app)
  cli        unpack discs, build a static tree, build search indexes, verify
packages/
  core       shared types: PR group, type, criterion, plate, part reference
  raf        the storage engine: SortedCobolFile, IndexedRAF, the read() backends
  catalogue  parts domain: envelope, organes, planches, criteria evaluation
  repair     MR/NT: SPI/D3K XML parse and render model          (not yet built)
  search     part-number and label search over derived indexes  (not yet built)
  i18n       interface strings + the disc's own language files   (not yet built)
docs/
```

`core`, `raf`, `catalogue` and both apps exist today; the three marked packages
are planned, and the read path currently lives in `catalogue`.

Mirroring ddtx's stack and conventions: pnpm workspaces, turbo, TypeScript
project references with `strict` + `noUncheckedIndexedAccess`, Svelte 5, Vite 6,
vitest (node environment), `playwright-core` driven from vitest for the few
browser tests, prettier with `printWidth: 100`.

> **Licensing constraint.** dialogysx is **PolyForm Noncommercial 1.0.0**; ddtx
> is **GPL-3.0-or-later** (because DDT4All is). GPL-licensed code cannot be
> imported into or copied from a PolyForm project. So dialogysx may mirror
> ddtx's _conventions_ — layout, tooling, tsconfig, test shape — but must not
> take its source. Nothing here is derived from ddtx code.

### The read boundary

`packages/raf` exposes `SortedCobolFile` and `IndexedRAF` over a `Reader`
interface, plus the three backends. Two rules it must not get wrong:

- **No padding in `index2`** (§2.2). The unused `MultipleRAFRecordInfoFactory`
  in the original suggests 4 bytes of padding; the reachable path has none. This
  one _is_ caught by the validator.
- **Signed-byte key comparison** (§2.1) — match the original, but know that no
  catalogue dataset exercises it (0 of 583,035 keys have a high byte) so no test
  over disc data will catch getting it wrong. It bites on the MR/NT text
  indexes, which are keyed by localised labels.

### What the CLI is actually for

Not a database conversion. Three jobs:

1. **Import** — merge the six discs into one data folder. Built; see below.
2. **Derive** the indexes the original never had, because the original had a
   local disk and we have a network: a part-number prefix index, a label search
   index, and a compact manifest so the app knows what exists without probing.
   Only the manifest exists so far.
3. **Verify** — re-run the §6 validation over a tree and fail loudly. This is
   the regression test for the format code.

### `dialogysx import` — why it is not `cp -r`

The set does not merge by union, and three separate traps make a naive copy lose
data silently.

- **Two discs, one path, different content.** For the Russian set, DVD-4 and
  DVD-5 both carry `mrnt/ru/d3k/images/images_1.zip` — 945 MB and 696 MB. A
  plain copy keeps whichever ran last and loses ~12,000 illustrations with no
  error. They share **0 of 36,374 entry names**, so the importer _extracts_ them
  instead, merging contents rather than filenames, and reports any entry that
  genuinely overlaps.
- **The same drawings ship twice.** `dessins/100.zip` (39,584 PNGs) and
  `dessins/100/` (the same files unpacked into `NNNN/` buckets) are byte-size
  identical for all 39,584 entries. Importing both wastes 694 MB, so the
  archive is a separate, off-by-default component. The bucket rule is
  `dessins/100/<name[0..4]>/<name>` — the first four characters of the filename,
  which holds for all 39,584 (the three exceptions are `Thumbs.db` and one
  zero-length `.png`).
- **Version stamps disagree.** Every disc has `update/VersionData` and they
  differ: catalogue `versmpf=4.5.6`, repair discs `versmpf=4.56.20160921`,
  application disc `versmpfappli =V7.5.6`. Merging them into one path means
  picking a winner, so they are recorded in the manifest and not copied.

Path collisions that are _byte-identical_ are deduplicated silently. Anything
else aborts the import rather than guessing.

**Selection matters, because the full set is 15.8 GB.** Discs are classified by
marker paths (the set is not self-describing), and both `--components` and
`--languages` narrow what lands:

| Component                              | Files  | Size     | Default                     |
| -------------------------------------- | ------ | -------- | --------------------------- |
| `parts`                                | 279    | 0.08 GB  | always — the catalogue      |
| `criteria` (`langue/`, all 21)         | 125    | 0.04 GB  | on                          |
| `drawings`                             | 39,583 | 0.71 GB  | on                          |
| `drawings-archive`                     | 1      | 0.69 GB  | off — duplicates `drawings` |
| `exploded`, `dates`, `substitutions`   | 14     | 0.05 GB  | on                          |
| `repair-pdf`                           | 2,494  | 1.63 GB  | on                          |
| `repair-xml`                           | 38,752 | 13.29 GB | on                          |
| `extras` (incl. REACH)                 | 47     | 0.04 GB  | off — nothing decoded       |
| `labour-times` (`TM.zip`, 99,056 XMLs) | 1      | 0.07 GB  | off — quoting input         |
| `pricing` (`tarif.zip`)                | 1      | 0.21 GB  | off — out of scope          |
| `app` (jars, `repair.xsl`, help)       | 190    | 0.17 GB  | off — RE reference          |

Measured, not declared: the planner walks the discs and prints this table, so it
cannot go stale. **Every file on all six discs maps to a named component** —
`--dry-run` reports anything unclaimed, and that list is currently empty, which
is how `TM.zip`, `tarif.zip` and `REACH.zip` were found in the first place.

One repair language plus the catalogue is ~12.7 GB; `-c min -l fr` is 0.08 GB.

## 4. Order of work

Sequenced so each step is verifiable on its own.

**Phase 1 — the engine.** `packages/raf` in TypeScript, ported from
`re/tools/dialogys_fmt.py`, with the Python reader kept as the differential
oracle: both must return identical bytes for the same key across all 12 datasets.
Ship `cli verify` in the same phase — it _is_ the test.

**Phase 2 — the catalogue read path, no UI.** Envelope, `typesetpr`, `Organes`,
`Planches`, `refNumPr`, `TRepere`, `classicvar`. Expose it through
`cli show <pr> <plate>` so the whole chain is exercised from a terminal before
any pixels exist.

**Phase 3 — condition evaluation.** Grammar **done**; evaluation partly done.

The grammar is transcribed from `PRFactory.newCondPlanche` and `CondFactory`,
and all **41,758 plates parse with every byte consumed** — 423,076 callouts and
762,244 part candidates. Kleene three-valued logic, OR of lines over AND of
clauses, with `unknown` meaning "ask the user" rather than "exclude".

What is left is **Phase 3b: date and build-number comparison.** The ordered
operators (`< > [ ]`) belong to eight date/build-number variables, `MILL` above
all, and resolving them means porting `VarDate.resolveDate` — three "vues",
the `UtilDate` helpers, and the `Dates` dataset. Measured:

| Part candidates               | Share      |
| ----------------------------- | ---------- |
| No condition — always fit     | 37.5 %     |
| Decidable from criteria alone | 33.7 %     |
| Need date resolution          | **28.7 %** |
| **Decidable today**           | **71.3 %** |

**And the phase is still not signed off**, because a parts list has never been
checked against an independently known answer. The 41,758 records prove the
_shape_ is right; they do not prove "this part fits this car". That needs one
vehicle whose correct parts list is known from outside this data.

**Phase 4 — the web client.** Plate view: PNG plus `TRepere` hotspots, parts
table filtered by criteria. Then the navigation above it — PR group, assembly,
plate — and part-number search.

**Phase 5 — repair documentation.** Two deliverables, because the source is two
things (§5 of the format doc):

- **NT and MR PDFs — 2,584 documents, 1.36 GB. Do these first.** They need no
  format work: render inline with `pdf.js` and offer "open in your PDF app" or
  download alongside it, since a native viewer beats an embedded one for
  printing and for sitting open next to a car. Navigation comes from
  `indexation/ArboRech-MR-pdf-<family>.xml`, whose `<element>` / `<pdf>` /
  `<appl>` shape is trivial and already carries applicability. Same treatment
  for the standalone `Outillage.pdf` and `PR0401.pdf`.
- **The D3K/SPI XML procedures — 22,967 documents.** Parse
  SPI/D3K to a render model with `fast-xml-parser`, using `repair.xsl` as the
  authority on presentation. Resolve `GRAPHICAL-LAYER` image references against
  the extracted images tree (`import` unpacks the archives, so this is a plain
  filename lookup), and swap the comma decimal separator before parsing any
  callout coordinate.

**Phase 6 — local and offline data.** Three sources, all behind the same
`Reader`, which is why Phase 1 was shaped that way:

- **A picked directory** (File System Access API) against a mounted disc or an
  imported tree. Implemented.
- **A static tree over HTTP `Range`.** Implemented.
- **OPFS — import once, then work offline.** Planned, not built. The origin
  private filesystem is the natural home for an imported tree: reads come from
  `getFile()` plus `Blob.slice()`, which is the same `read(pos, len)` the engine
  already has, so it is another backend rather than a new design. It suits a
  tiered split — the ~90 MB of structured catalogue data into OPFS for genuine
  offline use, with the multi-GB drawings and PDFs still fetched over HTTP on
  demand. Worth checking real quota behaviour and per-browser support before
  promising it in the interface.

## 5. Ranked risks

1. **Condition-tree semantics** (Phase 3). Understood by example, not specified.
   Failure mode is quiet and wrong. Mitigation: known-answer tests, and treat an
   unparseable condition as _exclude with a warning_ rather than _include_.
2. **`Range`-request latency.** ~~A plate view is several small reads. If they
   serialise, the UI feels slow.~~ **Measured, over localhost:**

   | Operation                                                                    | Time                |
   | ---------------------------------------------------------------------------- | ------------------- |
   | Preload `refNumPr.idx` — 327,169 keys, 7.2 MB                                | 119 ms              |
   | One part-number lookup (binary search in RAM + 1 range read)                 | 12 ms               |
   | 10 lookups, sequential                                                       | 54 ms (5.4 ms each) |
   | 10 lookups, parallel                                                         | 37 ms               |
   | Depth-3 envelope, PR 1104 → 18 records (index2 read + 18 batched data reads) | 21 ms               |

   The 7.2 MB data file was never downloaded. These are **localhost** numbers,
   so they measure the engine and not the network: add one RTT per read on a
   real host, which is exactly why `readMany` parallelises and why index files
   are preloaded rather than binary-searched over the wire. The original batched
   too — `getTabOfRecords(positions[], lengths[])`. Re-measure against real
   hosting before claiming the UI is fast.

   A host that ignores `Range` and returns 200 with the whole body would read
   the wrong bytes silently, so `HttpRangeReader` rejects any non-206 response
   with a message that names the cause.

3. **Static-host cost and cold cache** for 720 MB of PNGs plus per-language XML.
   Mitigation: images are immutable and cache forever; consider serving them
   from the original zip via range reads if per-file hosting is a problem.
4. **`chemins.properties` unextracted.** Path layout is currently inferred from
   `AccesPR` and the observed tree. Extract the MSI to confirm before hard-coding.
5. **Licensing and redistribution.** The data is Renault's and is not ours to
   ship. See below.

## 6. Data is not redistributable

The catalogue, the drawings and the repair documentation are Renault/Dacia
material. `data/` is git-ignored, and so are `re/extract/` and `re/decompiled/`.

- No fixture in the repository may be derived from the discs.
- No VIN in a commit, test, or doc.
- The app ships **without** data, like ddtx: the user supplies a disc or points
  at their own static tree.

## 7. Deliberately out of scope

The user's call, recorded so nobody re-adds it: **pricing** (`dialogys.tarif`,
`estimation`, `tarifmaker`) and **internal ordering / DMS** (`dialogys.ap2ap`,
`dossiers`, `bondeservice`, `rmi.dms`, `fax`). Their formats may be documented
where they share the storage engine, but no feature is built on them.
