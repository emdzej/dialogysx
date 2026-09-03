# Dialogys data formats

Reference for the on-disc formats of Dialogys 7.5.6 (Renault/Dacia after-sales:
parts catalogue + repair documentation), reverse-engineered from the shipped
Java application and validated against the discs.

Everything here was derived from the decompiled application and then **checked
against real files** — every claim about a record layout has been round-tripped
by `re/tools/dialogys_fmt.py` over the full index of each dataset (see
[Validation](#6-validation)).

## 1. The application

`DVD-0` ships a Java application, **unobfuscated**, 1,645 classes:

| File                                     | Notes                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `Dialogys/data/java/dialogysapplet.jar`  | The client. 9.8 MB                                                        |
| `Dialogys/data/java/serveur.jar`         | **Byte-identical** to the applet jar (same MD5) — one artefact, two roles |
| `Dialogys/data/java/DialogysUpdater.jar` | Updater                                                                   |
| `Dialogys/data/java/d3k/repair.xsl`      | 68 KB XSLT — the _rendering spec_ for repair documents                    |
| `Dialogys/data/java/d3k/actis.xsl`       | Rendering for ACTIS technical notes                                       |
| `Dialogys_{32,64}bit.msi`                | ~250 MB installer; holds `chemins.properties`, the data-path map          |

Bundled third-party code (Xerces, dom4j, POI, Rhino, Symantec `itools`,
`com.btr.proxy`) is irrelevant to the formats.

The packages that matter:

| Package                            | Role                                              |
| ---------------------------------- | ------------------------------------------------- |
| `dialogys.indexingfiles`           | **The storage engine.** All formats below         |
| `dialogys.noyau.AccesPR`           | Canonical data file names                         |
| `dialogys.pr`, `dialogys.planches` | Parts plates, drawings, callouts                  |
| `dialogys.enveloppe`               | Vehicle "envelope" — type / PR / engine / gearbox |
| `dialogys.expertplaqueovale`       | VIN / oval-plate (PAPV) decoding                  |
| `dialogys.mrnt`, `dialogys.d3k`    | Repair methods (MR) and technical notes (NT)      |
| `dialogys.classicvar`              | Vehicle criteria vocabulary                       |

Out of scope for this project, documented only where it overlaps:
`dialogys.tarif`, `dialogys.estimation`, `dialogys.tarifmaker` (pricing);
`dialogys.ap2ap`, `dialogys.dossiers`, `dialogys.bondeservice`,
`dialogys.rmi.dms`, `dialogys.fax` (internal ordering / DMS integration).

## 2. The storage engine

Two container shapes, both descended from mainframe sequential extracts — the
class names still say so (`SortedCobolFile`).

### 2.1 `SortedCobolFile` — fixed-length sorted records

A flat array of fixed-length records, sorted ascending on the leading
`keyLength` bytes, located by binary search (`renault.misc.RenaultDichotomie`).
No header, no footer, no magic number: `recordCount = fileSize / recordLength`.

```
record[recordLength] = key[keyLength] || payload[recordLength - keyLength]
```

**Key comparison is signed-byte.** `Clef.compareByteArrays` subtracts Java
`byte`s, which are signed, so for keys outside ASCII it orders `0x80..0xFF`
_before_ `0x00..0x7F`.

How much this matters was measured rather than assumed: across all 11
catalogue datasets, **0 of 583,035 keys contain a byte above `0x7F`**. Signed and
unsigned comparison are therefore indistinguishable on the catalogue data, and a
reader that gets this wrong will still pass every check in §6.

It is not a dead letter, though. The MR/NT _text_ indexes are keyed by localised
labels through `CollationClefFactory` (§3, "outside scope" row) — those keys do
carry high bytes, and that is where an unsigned comparison would break. Match the
original's signed comparison, but do not expect the catalogue data to catch you
if you don't.

Short keys are NUL-padded to `keyLength` (`Clef(String, int)`), and prefix
search asks "does the stored key start with the probe" — so a 4-byte probe
against an 8-byte key field is a legitimate prefix query.

### 2.2 `IndexedRAF` — variable-length records behind an index

The payload of a `SortedCobolFile` record can be a _pointer_, making that file
an index over a separate variable-length data file. The pointer is 12 bytes,
**big-endian**:

```
pointer = position:int64be || longueur:int32be        (12 bytes)
```

so an index record is `keyLength + 12` bytes. This is the strongest structural
check available: **every index file's size divides exactly by `keyLength + 12`**
(§3).

Two depths exist.

**2-level** (`IndexedRAFFactory.newRAFIndexedByCobol`) — one key, one record:

```
key --> index (.idx)        --> data (.dat)
        fixed records           variable-length record
        key || pos || len
```

**3-level** (`newRAFIndexedByRAFIndexedByCobol`) — one key, _many_ records. The
level-1 pointer addresses a pointer _list_ in a second index file, whose name is
the stem plus `1` / `2` (`IndexedRAFFactory.indexIndexName` / `indexDataName`):

```
key --> index1        --> index2            --> data
        key || ptr        count + N x ptr       N variable-length records
```

An `index2` record is:

```
count:int32be || count x (position:int64be, longueur:int32be)
```

> **Quirk.** Two classes read `index2` and they disagree. `RAFIndex_IndexedFile`
> — the one the factory actually wires up — uses a `DataInputStream` and reads
> `count:int32` immediately followed by the entries. `MultipleRAFRecordInfoFactory`
> reads `count:int32` then jumps to offset **+8**, implying 4 bytes of padding.
> Only the former is reachable from `IndexedRAFFactory`, and it is the one that
> validates against the discs — there is no padding. Do not "fix" a reader to
> match `MultipleRAFRecordInfoFactory`.

A third variant, `RAFIndexedByHashtable`, is used only for the MR/NT chapter
indexes and stores a serialised hashtable rather than a sorted key array.

### 2.3 Text conventions

- **Encoding is per file, not global.** Measured over a disc by attempting a
  strict UTF-8 decode and counting bytes above `0x7F`:

  | File                                           | High bytes | Strict UTF-8 | Encoding             |
  | ---------------------------------------------- | ---------- | ------------ | -------------------- |
  | `langue/<lg>/classicvar.utf`                   | 8,190      | decodes      | **UTF-8**            |
  | `langue/<lg>/papv/papv`                        | 4,963      | fails        | cp1252               |
  | `pr/<group>.zip:ListeVarVal`                   | 29         | fails        | cp1252               |
  | `pr/<group>.zip:ListeItemsAbsentsMenu`         | 1          | fails        | cp1252               |
  | `typesvin`, `pr/ListePROrganes`, `refContexte` | 0          | decodes      | ASCII — either works |

  The **`.utf` suffix is the marker**: those files are UTF-8, everything else is
  cp1252. Repair XML is UTF-8 and declares it in its prolog.

  Getting this backwards does not crash. `classicvar.utf` read as cp1252 gives
  `"Air conditionnÃ© normal"` — a string that parses, renders, and is wrong.

- Records are **CR-separated** (`0x0D`, no LF) and **TAB-delimited** within a
  record. A reader that splits on `\n` sees one enormous line.
- Strings embedded in binary payloads are Java `writeUTF`:
  `length:uint16be || modified-UTF-8 bytes`.

## 3. The datasets

`keyLength` comes from the call site in the decompiled source; the record count
is arithmetic over the shipped file.

| Dataset              | Data file               | Index stem                 | Key | Depth | Index records | Key source              |
| -------------------- | ----------------------- | -------------------------- | --- | ----- | ------------- | ----------------------- |
| Parts plates         | `pr/Planches.dat`       | `pr/Planches.idx`          | 11  | 2     | 41,758        | `CompileCond` (4 + 7)   |
| Assemblies           | `pr/Organes.dat`        | `pr/Organes.idx`           | 9   | 2     | 14,899        | `CompileCond` (4 + 5)   |
| Part no. to PR group | `pr/refNumPr.dat`       | `pr/refNumPr.idx`          | 10  | 2     | 327,169       | `ModeleFromReference`   |
| Envelope, PR to type | `enveloppe/enveloppe`   | `enveloppe/prtype`         | 8   | 3     | 3,742         | `FichierEnveloppeLocal` |
| Envelope, type to PR | `enveloppe/enveloppe`   | `enveloppe/typepr`         | 8   | 3     | 3,742         | as above                |
| Envelope by engine   | `enveloppe/enveloppe`   | `enveloppe/moteur`         | 3   | 3     | 118           | as above                |
| Envelope by gearbox  | `enveloppe/enveloppe`   | `enveloppe/boite`          | 3   | 3     | 117           | as above                |
| Types and PR         | `enveloppe/typesetpr`   | `enveloppe/typesetprindex` | 8   | 3     | 3,706         | `FichierTypesEtPRLocal` |
| Applicability dates  | `Dates/Dates`           | `Dates/datesindex`         | 8   | 3     | 7,028         | `FichierDateLocal`      |
| Part substitutions   | `PR1100/prremp`         | `PR1100/prrempindex`       | 10  | 3     | 142,282       | `PR1100Local`           |
| Drawing callouts     | `dessins/TRepere.dat`   | `dessins/TRepere.idx`      | 13  | 2     | 38,474        | `TRepereFactory`        |
| Oval plate (VIN)     | `langue/<lg>/papv/papv` | `.../papvindex`            | 22  | 2     | 682           | `FichierPAPVLocal`      |

Opened through the same engine but outside scope: tariffs (key 10), part-label
search index (20), MR/NT chapter and text indexes (4 / 3 / 5 plus a collation
key), TM catalogues (4 / 20 / 7).

### 3.1 `Planches.dat` — a plate

Key is `PR(4) || plateName(7)`, e.g. `0202N100110`. The payload is a Java
`DataOutput` stream: a **condition tree** over vehicle criteria, then the parts.

```
... uint16 counts ...
  uint16 len || "MOT3"          writeUTF - a criterion code
  uint16                        operator (0x3D '=', 0x3C '<', 0x5D ']' ...)
  uint16 count, uint16 value    operand(s): indices into the criterion value list
...
  uint16 repere                 the callout number on the drawing
  8 x 0xFF                      applicability mask
  uint16 len || "6001548001"    writeUTF - the part reference
```

Criterion codes (`MOT3`, `MOTI`, `AIRC`, `TYP_`, `MILL`, `XCAR`, ...) are the
same vocabulary as `pr/<group>.zip:ListeNomVarId`, labelled in
`langue/<lg>/classicvar.utf`.

### 3.2 `Organes.dat` — an assembly

Key is `PR(4) || organe(5)`, e.g. `02021010A`. Same condition-tree prefix, then
a list of `writeUTF` entries shaped `N100411,01003160` — plate name plus a
numeric id. This is the menu layer above the plates.

### 3.3 `refNumPr` — the part-number search index

Key is a 10-character part reference; payload is a `writeUTF` list of the PR
groups containing it, e.g. `6001548001` maps to `[1090]`. 327,169 references —
this is what makes search-by-part-number work without scanning plates.

### 3.4 `TRepere.dat` — drawing hotspots

Key is `drawingNumber(8) || 5 spaces`. Payload:

```
count:uint16be || count x (repere:uint16be, x:uint16be, y:uint16be)
```

Record length is therefore `2 + 6*count`, which matches every record. Joined
with §3.1 this gives clickable callouts over the drawing PNG.

### 3.5 `enveloppe` — the vehicle envelope

Seven TAB-separated fields, matching `UtilEnveloppe`'s `INDICE_*` constants
(`NBVARS = 7`):

```
PR / TYPE / NEQT / EQPT / MOT3 / MOTI / BVI3
1104   1123   E1_    100    B1B    705    HA0
```

`PR` is the 4-digit parts-catalogue group, `TYPE` the 4-character vehicle type,
`MOT3` / `MOTI` engine code and index, `BVI3` gearbox. The four indexes in §3
are four access paths into this one file — note `moteur` (key 3) matches `MOT3`
and `boite` (key 3) matches `BVI3`, which is how those key lengths were
confirmed.

`typesvin` (630 bytes, CR/TAB) maps a vehicle type to its accepted substitutes:
`B531 / B531,B534 / B531,B53I`.

### 3.6 `papv` — the oval plate

Key is 22 bytes: PR group, type fragment, `@`, and a variant / `MOD` suffix.
Payload is `len:uint16 || '[' || key || fields`, with `{`-separated blocks of
`count / criterionCode / / value ...` — the equipment enumeration for that build.
`FichierPAPVServeur` exists alongside `FichierPAPVLocal`, so **full VIN decoding
was an online service**; the discs carry only this local subset, 682 keys per
language.

### 3.7 `classicvar.utf` — the criteria vocabulary

`langue/<lg>/classicvar.utf`, CR/TAB, **UTF-8** (see §2.3 — this one is not
cp1252, and reading it as cp1252 silently mangles every accent):

```
CODE / T / label / question / value0 / value1 / ...
ABS_ / T / Anti-blocage de roues / Anti-blocage de roues ? / Oui / Non
```

The operands in §3.1's condition trees are **indices into this value list**, so
this file is required to _evaluate_ applicability, not merely to label it.

### 3.8 Per-group criteria — `pr/<group>.zip`

165 zips, one per PR group, each holding `ListeNomVarId` (criterion codes in play
for that group), `ListeVarVal` (their values), `ListeItemsAbsentsMenu`, and
sometimes `ListeDoc`.

> **Zip quirk, precisely.** The **local file headers carry CRC-32 = 0** while the
> **central directory carries the correct CRCs**, and the data-descriptor flag
> (general-purpose bit 3) is _not_ set — so nothing tells a reader to look
> elsewhere:
>
> |                   | `ListeVarVal`                                   |
> | ----------------- | ----------------------------------------------- |
> | Local header      | `crc=0x00000000`, `csize=29973`, `flags=0x0800` |
> | Central directory | `crc=0xc779ee22`, `csize=29973`                 |
>
> This is why `unzip` reports `bad CRC ... (should be 00000000)` and exits
> non-zero while writing correct data: it validates against the local header.
> **Read the central directory instead** — `yauzl` and `fflate` both do, and both
> validate these archives cleanly with no CRC suppression needed. Do not disable
> CRC checking to work around it; use a reader that looks in the right place.

## 4. Drawings and images

Plain **PNG**, no wrapper:

| Set            | Location                                           | Count  | Bytes                          |
| -------------- | -------------------------------------------------- | ------ | ------------------------------ |
| Parts drawings | `dessins/100.zip`, also unpacked at `dessins/100/` | 39,584 | 694 MB zipped, 720 MB unpacked |
| Exploded views | `eclate/100.zip`                                   | 582    | 12 MB                          |
| Thumbnails     | `vignette/{pr,tm,visseries}/100.zip`               | —      | 632 KB                         |

Names are `PR + section + sequence`, e.g. `1132C000.png`, which is how §3.1's
plate names and §3.4's drawing numbers resolve to a file. **These need no
conversion for the web.**

## 5. Repair documentation (MR / NT)

`DVD-2..5` carry `data/mrnt/<lang>/d3k/`. One language set spans several discs:
Russian is DVD-2 (chapters) plus DVD-4 and DVD-5 (images).

**There are two parallel documentation systems, one XML and one PDF.** Counted
over the complete Russian set (DVD-2 + DVD-4 + DVD-5):

|                                            | Files     | Bytes       |
| ------------------------------------------ | --------- | ----------- |
| `.xml` — structured procedures and indexes | 23,331    | 4.28 GB     |
| `.pdf` — manuals and technical notes       | **2,584** | **1.36 GB** |
| `.zip` — illustrations                     | 9         | 5.27 GB     |

> **Measure the whole set, not one disc.** Counting DVD-2 alone gives 22,967 XML
> against 454 PDF, and the tempting conclusion "the instructions are XML, not
> PDF". DVD-5 then adds 2,130 more PDFs — the classic workshop manuals — making
> the PDF corpus five times larger than that count implied, and a real
> deliverable rather than a rounding error. A language set spans several discs;
> a census of one of them is not a census.

**System 1 — D3K/SPI XML** (`chapitres/`), 22,967 documents across 1,776 chapter
directories. Self-describing UTF-8 XML: `WA` (work area), `WF` (work function),
`DU` (documentary unit), `APPL` (applicability, as `FAMILY-REF` /
`APPL-OBJECT-REF` / `APPL-CRITERION-REF`), `STEP`, `TEXT-ITEM`,
`GRAPHICAL-LAYER`, `GRAPHICAL-MARK-OCCURENCE`. Needs a renderer; `repair.xsl`
from DVD-0 is the vendor's own.

**System 2 — PDF manuals**, which need no reverse-engineering at all:

- `1-MR/` — 1,152 workshop manuals, e.g. `MR-000-AIRBAG CEINTURES-1.pdf`.
- `1-NT/` — 978 technical notes, plus 454 more under `chapitres/NTI-<lang>/`.
- `indexation/ArboRech-MR-pdf-<family>.xml` — **the navigation tree for the
  PDFs**, one file per vehicle family (`X06`, `X09`, `X13`, ...). Trivial
  schema, and it carries applicability:

  ```xml
  <arborech>
    <element id="10" lib="front brake pads">
      <pdf numero="MR-305-TWINGO-3" titre="M.R. 305   3 CHASSIS">
        <appl><object>$TYC<criterion>C06</criterion></object></appl>
      </pdf>
    </element>
  </arborech>
  ```

  868 topics and 1,159 PDF references in the `X06` file alone. Note `$TYC`: the
  same applicability object the D3K XML uses, so both systems share one criteria
  vocabulary.

So the PDF half is a complete, navigable, applicability-filtered corpus reachable
with an XML index and a PDF viewer — much the cheaper of the two to ship, which
is why the plan does it first.

Standalone PDFs exist outside both systems too: `PRPer/PR0401.pdf`,
`langue/<lg>/outillage/Outillage.pdf`, and DVD-0's help documents.

### 5.1 Images

XML references images by filename, not by embedding:

```xml
<GRAPHICAL-LAYER LINKEND="repair-30,02,02,03-01,37-1-5-3.png">
```

`.png` and `.tif` both appear. The `images/` directory on the chapters disc is
**empty** — the images ship on a later disc of the same language set, as
`images/images_1.zip` (664 MB on DVD-5 for Russian). A tree built from only the
chapters disc will render text with every illustration missing, and nothing will
report an error.

Callout overlays are vector, positioned by attribute:

```xml
<GRAPHICAL-MARK-OCCURENCE GRAPHICAL-REPRESENTATION="CP2 2,72637795275591 0,600393700787402 …"/>
```

Note the **comma decimal separator** — French locale, inside an XML attribute.
`parseFloat` on these silently returns the integer part, so `2,726` becomes
`2`. Every coordinate needs the separator swapped before parsing.

`repair.xsl` from DVD-0 is the vendor's own rendering of this schema and is the
authority on presentation.

This half needs no format reverse-engineering — only a schema survey and a
renderer.

## 5A. Vehicle identification, and why there is no local VIN decoder

Worth stating plainly because it shapes the whole identification flow: **the
original has no offline VIN decoder.** Three separate mechanisms are easy to
mistake for one.

1. **BVM — the actual VIN lookup, and it is a remote service.**
   `dialogys.bvm.ExpertBVM` opens a **TCP/IP socket** to a host configured as
   `KEY_BVM_IP` / `KEY_BVM_PORT` / `KEY_BVM_DEALERID`, sends the VIN or
   registration number, and parses an XML reply into the vehicle's criteria plus
   its VIN, registration, and engine and gearbox indices
   (`VehiculeFromBVM.getIndiceMoteur` / `getIndiceBoite`). It needs a dealer id,
   and its error strings say what it is: `"Cannot connect to the BVM"`,
   `LIB_ERR_CONNECTION_BVM`. Nothing on the discs can substitute for it.

2. **`VIN_Expert` is not a decoder.** The whole class is 20 lines and one
   method, `premierVerifieSecond`, which asks whether one VIN prefix-matches
   another after optionally dropping the leading 4 characters. It exists to
   evaluate "applies from VIN X" constraints, not to derive anything.

3. **`saisieVIN` only checks length.** `VarTypeAPV` accepts 7 to 17 characters
   and otherwise raises `VINIncorrect`. No structural validation, no check
   digit, no decoding.

Local identification is therefore **type-first, not VIN-first**: the user
supplies the vehicle type (`TYP_`), and `VarExpert.deduitModeleNumPR` derives
the model and PR group from it — which is exactly what `typesetpr` (§3), the
envelope (§3.5) and `typesvin` are for. The oval plate (§3.6) is keyed
`noPR + type[0..3] + "@"`, so it too is reached from the type, not from a VIN.

For dialogysx this means VIN handling is honestly best-effort: accept a VIN,
use what can be derived from its type portion, and say so in the interface
rather than implying a decode that the data cannot support.

## 6. Validation

`re/tools/dialogys_fmt.py` implements §2. For each dataset in §3 it was run over
the **entire** level-1 index, asserting:

1. `fileSize % (keyLength + 12) == 0` — held for all 12 datasets.
2. Keys non-decreasing under signed-byte comparison — **0 violations** across
   every dataset (41,758 Planches keys; 327,169 refNumPr; 142,282 prremp; ...).
3. Every data pointer satisfies `0 <= position` and
   `position + longueur <= dataFileSize` — **0 out-of-range pointers**.
4. Decoded payloads are meaningful in their domain: part numbers that look like
   part numbers, dates as `yymmdd`, plate names that match PNG filenames.

Result over a mounted DVD-1: **32 datasets checked (11 catalogue + `papv` in 21
languages), 0 failed.**

Two key lengths were confirmed twice over, arithmetically and from source:
`Planches.idx` (960,434 bytes) admits only key 11 or 34, and `CompileCond`
computes `4 + 7 = 11`; `Organes.idx` admits only 9 or 35, and `CompileCond`
gives `4 + 5 = 9`.

### What the checks do _not_ catch

Established by deliberately breaking them:

- A **wrong `keyLength`** is caught loudly — key 10 on `Planches.idx` reports
  `960434 bytes is not a multiple of record length 22 (remainder 2)`.
- A **wrong depth** is _not_ caught. Declaring a 2-level dataset as 3-level makes
  the reader look for `Planches.idx1`, which does not exist, and the dataset is
  reported `absent` rather than failed. Absent datasets are legitimate (discs
  carry different subsets), so this is a genuine blind spot: a typo in a path
  reads as "not on this disc".
- **Unsigned key comparison** passes everything, for the reason given in §2.1.

## 7. What is not yet decoded

Honest list.

- **`Planches.dat` / `Organes.dat` condition trees** are read but not
  _specified_. The criterion/operator/operand encoding is understood by example;
  the grammar (nesting, the `0xFF` applicability mask, the leading `uint16`
  counts) needs `dialogys.pr.CondPlanche` / `CondRefPi` / `TCondAcces` read
  against a case whose answer is known independently. **This is the critical
  path for correct parts filtering** — a wrong evaluation shows a part that does
  not fit the vehicle.
- **`prremp`** (part substitutions): payload is `len:int32 || key || binary`; the
  binary tail is unread.
- **`Refcontexte/refContexte`** (11 MB) — untouched.
- **`Dates` semantics**: the record is a key plus a list of `yymmdd`, but what
  the dates _mean_ (production milestones? applicability windows?) is unverified.
- **`chemins.properties`**, the authoritative data-path map, is inside the 250 MB
  MSI and has not been extracted.
- **`papv` block grammar** is understood by shape, not specified.
