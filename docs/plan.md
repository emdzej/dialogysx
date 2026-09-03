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

Repair documentation is a separate ~4 GB per language, but it arrives **already
split into 22,967 XML documents** across 1,776 chapter directories, 1–5 MB each.
One document is one fetch. No import, no repacking. Its illustrations add
another 664 MB, shipped as a zip on a later disc of the same language set.

Note what that documentation _is_: **98.5 % of those bytes are XML**, and only
454 files (60 MB) are PDFs — the technical notes. So the repair half needs a
real XML renderer; a PDF viewer covers the notes and nothing else.

**Verdict: yes, purely client-side, no backend.** The largest thing the browser
must hold is ~17 MB of indexes. Everything else is fetched by the byte range or
by the file. The 720 MB of PNGs and 3.8 GB of XML live on the static host and are
never downloaded wholesale.

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

1. **Unpack** the ISOs into a static tree, honouring the zero-CRC zips (§3.8).
2. **Derive** the indexes the original never had, because the original had a
   local disk and we have a network: a part-number prefix index, a label search
   index, and a compact manifest so the app knows what exists without probing.
3. **Verify** — re-run the §6 validation over a tree and fail loudly. This is
   the regression test for the format code.

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

**Phase 3 — condition evaluation.** The critical path and the largest open
risk (§7). Specify the `Planches` / `Organes` condition grammar from
`dialogys.pr.CondPlanche`, `CondRefPi`, `TCondAcces`, then test it against
vehicles whose correct parts list is known independently. **A wrong evaluation
here shows a part that does not fit the car** — this phase does not get
signed off on plausibility.

**Phase 4 — the web client.** Plate view: PNG plus `TRepere` hotspots, parts
table filtered by criteria. Then the navigation above it — PR group, assembly,
plate — and part-number search.

**Phase 5 — repair documentation.** Two deliverables, because the source is two
things (§5 of the format doc):

- **MR, the procedures — 22,967 XML documents, 98.5 % of the bytes.** Parse
  SPI/D3K to a render model with `fast-xml-parser`, using `repair.xsl` as the
  authority on presentation. Resolve `GRAPHICAL-LAYER` image references against
  the images zip, and swap the comma decimal separator before parsing any
  callout coordinate.
- **NT, the technical notes — 454 PDFs.** Render inline with `pdf.js`, and offer
  "open in your PDF app" / download alongside it, since a native viewer beats an
  embedded one for printing and for sitting open next to a car. Same treatment
  for the standalone `Outillage.pdf` and `PR0401.pdf`.

**Phase 6 — local-disc mode.** File System Access API against a mounted disc or
an unpacked tree, through the same `Reader`. Cheap once Phase 1 is right, which
is the point of doing Phase 1 that way.

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
