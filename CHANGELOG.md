# Changelog

Notable changes, newest first. Versions are the tag on
[releases](https://github.com/emdzej/dialogysx/releases), without a `v`.

## 0.3.0

Installable, and usable with no network.

### Added

- **Installs as an application**, and the page opens with no network. A
  service worker caches the shell — the shell _only_, deliberately: the
  catalogue with every drawing is 0.85 GB across 642 files and the repair
  documentation is 14.44 GB across 43,273, so precaching a tree is not on the
  table. Caching reads as they happen was the obvious alternative and is
  worse, because it leaves the app working for whichever plates you happened
  to open and broken for the rest.
- **A copy of a tree held in the browser**, in Settings → Data. Copies from
  whichever source is open — an HTTP tree or a folder — and reads back with no
  network _and no permission prompt_, which a picked folder cannot do: the
  handle survives a reload and the permission does not. Choose the catalogue
  and drawings or everything, since the split is 0.85 GB against 15.30 GB.
  Resumable, chunked so a 945 MB archive never lands on the heap whole, and
  sized against the browser's quota before anything is written — that limit is
  routinely _smaller than a full tree_, measured at 7.52 GB granted on a
  machine with plenty of disk.
- **`?data=<url>`** opens a tree from a link, for a workshop server, a demo, or
  a bug report that names the tree it happened on. It does not persist and does
  not restore the remembered selection: following a link should not replace the
  tree a machine normally uses.
- An **offline marker** in the chrome, so a tree that needs the network says so
  rather than waiting for a read to fail obscurely.

### Fixed

- **The document count flew to the top of the window** when the repair
  documentation tab was opened. `.badge` was already that count, and the parts
  bin's corner marker restyled it as absolutely positioned.
- **The production build had been broken** since the service-worker
  registration landed — `workbox-window` is a peer dependency pnpm does not
  hoist — and turbo's cache hid it, so `pnpm build` kept reporting success
  against a `dist` that predated the module.

### Changed

- The dev server looks for a tree in `./data` and then
  `/Volumes/data/dialogysx`, and says where it looked when it finds neither.
- Update installation is a prompt, not a silent swap. This is used at a bench
  with a car in pieces, and replacing the assets mid-job to install an update
  nobody asked for is worse than saying one is ready.

### Known gaps

Still true from 0.2.0: **no result has been checked against an independently
known answer**, the part search has no interface, notes have no management
view, and `Dates` semantics are understood by shape rather than specified.

New with this release:

- A copy stored in the browser has been exercised against a real tree only at
  catalogue scale. The 43,273-file repair documentation is a different
  proposition and its timing is unmeasured.
- Nothing detects that a stored copy has gone stale against the tree it came
  from. Copying again reconciles it by size, but nobody is told they should.
- The offline marker reads `navigator.onLine`, which means "this machine has a
  network interface" and not "the tree is reachable". It explains a failure; it
  cannot predict one.

## 0.2.0

The release that made the catalogue usable rather than merely correct:
translated, navigable by diagram, and able to collect what you find.

### Added

- **Interface translation, English and Polish.** i18next, with the language
  chosen by preference rather than by a detector that caches what it once saw —
  "match my browser" keeps following the browser. Polish takes four plural
  categories where English takes two, so `Intl.PluralRules` is asked which a
  locale needs instead of the list being written out; the catalogues
  legitimately differ in size. Separate from the **catalogue** language, which
  selects which `langue/<code>/` the data is read from: a Polish user reading
  an English-only tree gets Polish buttons and English part names.
- **Numbered diagram tabs.** A plate is a diagram, and an assembly holds
  several — up to 31 in `Organes`, each with its own drawing and its own
  applicability. That choice was a combobox in the identification bar, which
  was wrong twice: it is not identification, and a plate has no name to put in
  a list. Numbered, because there is nothing else to put on a tab; the code and
  drawing number are in the tooltip. The original agrees — it pages through
  them under one title with an index and a count.
- **Parts bin.** Collect parts across plates, adjust quantities, print a pick
  list or export CSV. Keyed by reference rather than by the callout it was
  found under, so adding the same number twice means two of them and the first
  line's provenance is kept. Lines and pieces are counted separately: lines is
  what the list shows, pieces is what gets ordered. An undecided part carries
  that onto the line and into a `confirm` column, because it is a number to
  check before ordering rather than one shown to fit.
- **Part notes.** Your own words about a reference, shown wherever it appears,
  with JSON export and import. Import **merges, newest wins**; an untimestamped
  note loses to anything local, since it cannot be shown to be newer. These are
  the only state here that cannot be re-derived from the discs.
- **Copy to clipboard** — a part reference, a part name, or the diagram with
  its callout numbers painted on.
- **Part search engine** (`searchDiagrams`), finding the diagrams that show a
  reference or a description. `refNumPr` and the tariff answer most of it
  without I/O worth counting: a part in no group this vehicle uses is answered
  without opening a plate. No interface yet.
- **`dialogysx manifest <tree>`**, to describe a tree that predates the csfs
  manifest.
- **Three documents**: `resolution.md` (how the formats become "this part fits
  this car"), `tree.md` (what an importer builds), `user-guide.md` (using it).

### Changed

- **The first diagram opens on arrival** instead of prompting. 59 % of
  assemblies have exactly one, and for the rest the tabs are numbered rather
  than named — there is nothing to choose between until one is on screen.
- **Identification moved into the header**, and the header is white with a blue
  rule rather than a slab of blue. 105px of chrome down to 58px, one row to
  1024px.
- **Trees keep nine archives packed.** The importer writes `csfs-manifest.json`
  itself and declares which archive stands in for which directory: 43,915 files
  instead of 228,515, for the same bytes. It matters more than it sounds — with
  endpoint security active, file creation ran at about 5 files/second against
  58–109 MB/s streaming.
- **Reading is `@emdzej/csfs-*` 0.1.0** from npm, extracted from this project
  and published separately.
- Icon buttons lost their borders; a box around a recognisable glyph adds a
  rectangle and no information.

### Fixed

- **The browser importer could not post to its worker at all.** `$state` deep-
  proxies a plain object and a Proxy cannot be structured cloned, so choosing a
  disc failed with `#<Object> could not be cloned` — a message naming neither
  the field nor the reason.
- **The csfs engine read no archives and no languages.** `manifest.json` was
  left out of `csfs-manifest.json` as peer metadata; when csfs is the file
  system an unlisted file is simply absent, and a manifest miss answers null
  without contacting the host, so there was no 404 anywhere to point at it. The
  parts list fell back to codes, which looked like corrupt data.
- **The diagram copied without its callouts and reported success.** Reading
  `.width` off a numeric constant gave `NaN` coordinates, and `ctx.arc(NaN, …)`
  draws nothing and throws nothing.
- **A full basket was illegible** — icon and badge were both the colour of the
  bar behind them.
- **Nothing set `box-sizing`**, so every `width: 100%` element overflowed its
  container by its own padding and border.
- Mount paths are rooted, matching csfs, so the array in `manifest.json` needs
  no translation. The per-disc ordinal was comparing against the old spelling,
  which would have made every disc's archive overwrite the last.

### Documentation

- Corrected four stale claims in `data-format.md`, one actively misleading:
  §3.1.1 was titled "not implemented" while `dates.ts` had implemented it, with
  30 tests, and §7 named it the critical open path.
- The dataset table's counts are the 7.5.6 set; the English 4.55 set differs
  and now says so. Anyone validating a reader against 4.55 discs would have
  read the mismatch as their own bug.

### Known gaps

- **No result has been checked against an independently known answer.** The
  grammar is right — every plate parses with every byte consumed, and 12
  datasets validate with 576,034 keys — but "this part fits this car" is a
  different claim and is not yet made.
- The part search has no interface.
- Notes have no management view; export and import exist only in the store.
- `Dates` semantics are understood by shape, not specified.
- A tree served over plain HTTP cannot be read by a page served over HTTPS.
  Storing a copy in the browser (0.3.0) is the way round it.

## 0.1.0

First working version: the catalogue read in a browser, straight from a tree
built off the discs. Plates, drawings with cross-highlighted callouts, parts
filtered by three-valued applicability, repair documentation, and an importer —
CLI and in-browser.
