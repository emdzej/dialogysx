# Using dialogysx

A parts catalogue and repair-documentation browser for Renault and Dacia
vehicles. Pick a model and a vehicle; it shows the exploded drawings with the
part numbers that fit, plus the workshop manuals that apply.

It ships **no vehicle data**. You build a data folder from discs you have, and
it reads that. Nothing is uploaded and there is no server component.

- New here? → [Getting a data folder](#1-getting-a-data-folder)
- Folder already built? → [Opening it](#3-opening-a-tree)
- Want to know why a part says _undecided_? → [Narrowing a vehicle](#5-narrowing-a-vehicle)

## 1. Getting a data folder

You need the Dialogys discs. A full English 4.55 set is five of them and
imports to **43,915 files, 15.3 GB**; the parts catalogue alone is far smaller.
The importer merges them into one folder and writes two manifests describing
it.

There are two ways to run it, and they produce the same tree. Neither uploads
anything.

|                                 | in the browser        | with the CLI  |
| ------------------------------- | --------------------- | ------------- |
| needs Node installed            | no                    | yes           |
| needs Chrome or Edge            | yes                   | no            |
| can mount `.iso` files for you  | no — mount them first | yes, on macOS |
| pick which components to import | yes                   | yes           |
| resumable                       | yes                   | yes           |

### In the browser

No command line. Chromium-only, because it needs the File System Access API to
write a folder.

1. Open dialogysx. If no tree is remembered, the settings dialog opens by
   itself; otherwise click the **gear** icon.
2. Click **Import from discs…** (or the **spanner** icon in the top bar).
3. **Mount your ISOs first** — double-click each one so it appears as a drive.
   The importer asks for them one at a time.
4. Choose an **empty target folder**. This asks for _write_ permission, which
   is a different prompt from the read-only one used for reading a tree.
5. Choose the first disc. It is identified and you get a plan: what will be
   written, what is already there, and anything it could not classify.
6. Pick the languages you want, then **Write**. Do not close the tab while it
   writes.
7. When it finishes, either **Add another disc…** or **No more data — finish**.

Stopping early loses nothing: the tree is usable for whatever was imported, and
you can come back and add discs later.

### With the CLI

```sh
pnpm install && pnpm build

# Mounted discs, or .iso files directly (macOS mounts them for you)
dialogysx import -o ./data "/Volumes/dialogysDVD1" "/Volumes/CDROM 1"

# English only, and see the plan before committing to it
dialogysx import -o ./data -l en --dry-run "/Volumes/dialogysDVD1"
```

Useful flags:

| flag                | effect                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `-l en,pl`          | only these languages — a full set is 22, most of them unwanted                                                      |
| `-c min`            | only what the catalogue needs; `-c all` for everything                                                              |
| `--list-components` | describe what is selectable, and what each omission costs                                                           |
| `-n`, `--dry-run`   | show the plan and stop                                                                                              |
| `--no-resume`       | re-copy files that already exist at the right size                                                                  |
| `--extract-images`  | unpack the illustration archives — **146,121 more files for the same bytes**; you almost certainly do not want this |

Then check it, which reads every index and verifies record lengths, key order
and pointer bounds:

```sh
dialogysx verify -d ./data
```

## 2. Which components to import

`--list-components` is authoritative. The short version:

- **Always** — `parts`. This is the catalogue.
- **Almost always** — `criteria` (without it, criteria show as raw codes like
  `MOT3` and cannot be evaluated), `part-names` (without it, parts are bare
  10-digit references), `drawings`, `exploded`, `dates`, `substitutions`,
  `repair` + `repair-pdf`.
- **Skip** — `drawings-extracted` (the same images again, 0.71 GB and 38,489
  files, when `drawings` already serves them out of the archive), `extras`
  (nothing decoded), `app` (the original jars; reverse-engineering reference
  only), `pricing` and `labour-times` (out of scope).

## 3. Opening a tree

Click the **gear** icon, or wait for the dialog on a first visit. Two ways in:

**A folder on this machine.** Chromium-only. Choose the folder you imported to,
or a mounted disc's `dialogys/data` directory. Files are read straight off
disk.

> A folder is remembered, but **browsers drop its permission on reload**, so it
> needs one click to grant access again each session. That is a browser rule,
> not a choice here.

**A static tree over HTTP.** Any host that honours `Range`: a plain file
server, or an S3 bucket with public read and CORS. Enter the URL — `/data` if
you are serving it alongside the app. A URL _is_ reopened automatically next
time.

For HTTP the tree needs `csfs-manifest.json`, because HTTP cannot list a
directory. An import writes it; for an older tree, run:

```sh
dialogysx manifest ./data
```

## 4. Finding a part

The bar across the top identifies the vehicle; everything below depends on it.

1. **Brand** — only shown when the tree has more than one.
2. **Model** — search by substring: "master" finds _Master II_.
3. **Vehicle** — the type and engine, e.g. `ED01 · G9U-632`. Applicability is
   evaluated against this, so nothing is filtered until you pick one.
4. **Assembly** — the panel on the left. Search matches the name, the domain or
   the code, so _Complete engine_ is findable by "engine", by "10" and by
   "1010A".
5. **Diagram** — numbered tabs above the drawing, when an assembly has more
   than one. Most have exactly one and it opens by itself. Hover a tab for its
   plate code and drawing number.

Then: click a callout on the drawing to highlight its row in the parts list, or
a row to highlight the callout. The two are linked both ways.

The assembly panel offers **hide N with no parts**. Two thirds of assemblies
can be empty for a given vehicle, so this is on by default — the count tells
you what is hidden rather than silently shortening the list.

## 5. Narrowing a vehicle

This is the part worth understanding, because it is where the catalogue is
unlike a normal parts list.

A part is not listed against a vehicle. It is listed against a **condition**,
and a vehicle answers only some of what conditions ask. So a part can be:

- **fits** — its condition is satisfied;
- **undecided** — its condition depends on something this vehicle has not
  answered. It is _shown, not hidden_, marked with a red icon. Click the icon
  for the exact condition.

Undecided does not mean "probably not". The original asks rather than guesses,
and hiding those parts would silently lose parts that do fit. On a Master II
identified by type alone, **251 of 304 diagrams** have at least one undecided
condition.

Three ways to narrow it, in order of how much they buy you:

### Factory and build number — by far the most effective

The two fields after **Vehicle**. Enter both: a build number cannot be compared
without a factory, because the number has to be looked up per factory.

On a Master II this alone settles the majority of undecided parts — the model
year accounts for 197 of the 251, and it is derived from these two fields
rather than asked.

Where to find them: the vehicle's plate, or a VIN report. A "vehicle
fabrication number" like `BA63711` is factory `BA` and number `63711`.

### Answering criterion questions

Below the plate, undecided parts raise questions — _Air conditioning type_,
_Steering wheel location_, _Country of legislation_ — each with the values that
this PR group actually uses. Answering one re-evaluates the plate immediately.

Only criteria that appear in an unanswered condition are asked, not all 1,216
in the vocabulary.

A criterion showing no values is marked and not offered: the group's table has
nothing for it, so there is no answer that could match.

### What the vehicle already gives you

Choosing a vehicle answers six criteria: type, equipment level, equipment code,
engine type and suffix, gearbox type. Everything else is unanswered until you
say. If you have a VIN report, its options list maps onto these criteria fairly
directly — but nothing decodes a VIN locally, because the discs contain no VIN
decoder.

## 6. Repair documentation

The **Repair documentation** tab. It needs only a **model** — no vehicle, no
assembly — because documents are indexed by vehicle _family_.

Filter by name or number ("brake", "MR-305"), pick a topic on the left to
narrow the list, then open a document. It renders in place; you can also open
it in a new tab or download it.

If a model has none, it says so and why: its name is not in
`pr/FamilleModeleAll.dat`, which maps a model to a family — so the original has
none for it either. That is different from a broken tree.

## 7. Language

Settings → **Language**. Two independent settings, and the distinction matters:

- **Interface language** — the application's own text. English or Polish, or
  _match my browser_, which keeps following the browser rather than
  remembering what it saw once.
- **Catalogue language** — which `langue/<code>/` the _data_ is read from:
  criterion names, assembly names, the menu. Only offered when your tree has
  more than one, and changing it reopens the tree.

Part descriptions come from the tariff, which ships **per country** rather than
per language. Several countries share a language and each tariff names only what
is sold there, so coverage is partial by design: `GB/en` names 37.8 % of
references. An unnamed part shows _not in this tariff_ rather than a blank.

## 8. Serving a tree to other people

Any static host that honours `Range` works — no application server.

```sh
dialogysx manifest ./data      # if the tree has no csfs-manifest.json
# then serve ./data with anything: nginx, `python3 -m http.server`, S3, …
```

For a bucket you need **public read** and **CORS** allowing your page's origin
and the `Range` request header.

Two things that will catch you:

- **A host that ignores `Range`** answers `200` with the whole file. dialogysx
  rejects that rather than trusting it, because using the body as a slice would
  return the wrong bytes silently.
- **Mixed content.** A page served over HTTPS cannot read a tree over plain
  HTTP; browsers block it. Serve both over HTTPS, or both over HTTP.

## 9. When something looks wrong

| symptom                                              | cause                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Parts show bare 10-digit numbers, no descriptions    | `part-names` was not imported                                                |
| Criteria and assemblies show codes (`MOT3`, `1010A`) | `criteria` was not imported, or the catalogue language is missing            |
| No drawing, parts list fine                          | `drawings` was not imported                                                  |
| Model list shows codes, not names                    | `pr/ListePRModele` missing — reimport `criteria`                             |
| Repair tab is empty for a model                      | that model is in no documentation family — see §6                            |
| Everything empty, no error                           | for an HTTP tree, `csfs-manifest.json` is missing — run `dialogysx manifest` |
| A remembered folder asks for permission again        | expected; browsers drop it on reload                                         |
| Nothing loads over HTTPS from an HTTP tree           | mixed content — see §8                                                       |

To check the tree itself rather than guess:

```sh
dialogysx verify -d ./data     # every dataset: record length, key order, pointers
dialogysx docs -d ./data       # sweep the documentation indexes
```

## 10. What not to rely on

The applicability rules were recovered by reading the original program, and
every plate in the catalogue parses with every byte consumed.

**That is not the same as a verified parts list.** No result here has been
checked against an independently known answer. Confirm a part number before you
buy or fit it.

The catalogue, the drawings and the repair documents are Renault/Dacia's. This
program ships no vehicle data and gives you no right to pass any on.
