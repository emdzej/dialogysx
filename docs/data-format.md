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
`DataOutput` stream, transcribed below from
`dialogys.pr.PRFactory.newCondPlanche` and `dialogys.conditions.CondFactory`.

**Conditions are pooled once per record and referenced by index.** That is the
thing to know: a record opens with several small counts that look like flags but
are pool sizes, and a _negative_ index means "no condition"
(`PRFactory.getCondBloc` returns null for `< 0`). Every `readShort` here is
**signed** — read them unsigned and `-1` becomes 65535.

```
plate record:
  locals        = nbVar:i16, nbVar × { name:utf, nbInd:i16, nbInd × ind:i16 }
  localsInfo    = same again; these names take an "info" suffix
  condPool      = nbBloc:i16, nbBloc × CondBloc
  consPool      = nbCons:i16, nbCons × { nbLign:i16, nbLign × {
                      condIdx:i16, nbRefQte:i16, nbRefQte × { ref:utf, qte:i16 } } }
  replPool      = nbList:i16, nbList × { nbRef:i16, nbRef × ref:utf }
  nbRepere:i16
  nbRepere × {                          -- one entry per callout, 1-based
    nbCandidate:i16
    nbCandidate × {
      condBlocRV:i16      -- applicability: does this part fit?
      condBlocSC:i16      -- "signe codé": ask the user to choose
      refRplIdx:i16       -- supersessions, index into replPool
      consAEP:i16
      consPPS:i16
      refPiece:utf        -- the part number
    }
  }

CondBloc = nbLign:i16, nbLign × CondLign        -- OR   (extends Ou)
CondLign = nbElem:i16, nbElem × CondElem        -- AND  (extends Et)
CondElem = variable:utf, operator:char, nbVal:i16, nbVal × valueIndex:i16
```

#### Operators

`operator` is a Java `char` — unsigned 16-bit — from
`dialogys.util.Constantes.CODE_OPER_*`. Counted over all 41,758 plates:

| Code              | Meaning                       | Occurrences |
| ----------------- | ----------------------------- | ----------- |
| `=` (0x3D)        | equal                         | 1,381,623   |
| `]` (0x5D)        | greater or equal              | 155,282     |
| `<` (0x3C)        | less                          | 146,130     |
| `[` (0x5B)        | less or equal                 | 14,697      |
| **U+2260** (8800) | **not equal**                 | 13,731      |
| `§` (167)         | informational, _not_ a filter | 8,240       |
| `>` (0x3E)        | greater                       | 2           |

**`CODE_OPER_DIFFERENT` is 8800, not a byte** — it is `≠` U+2260 as a Java
`char`. Read the operator as one byte and every "not equal" clause becomes
unrecognised, which `CondElem`'s `default:` turns into _unknown_ rather than an
error.

#### Evaluation

Three-valued Kleene logic (`dialogys.conditionsfp.Troolean`): a bloc is an OR of
lines, a line an AND of clauses. An empty line is **true**
(`CondLign.newCondLignVraie`); an empty bloc is **false**.

`CondElem` compares the vehicle's value against
`PR.getTValeur(language, variable)[valueIndex]`, and **handles only `=` and
`≠`**; the ordered operators belong to date variables and otherwise fall through
to unknown.

> **Unknown is not "exclude".** `Condition.isTrue` raises `DontKnowException`,
> which the interface turns into a question for the user. Mapping unknown to
> false silently hides parts that do fit.

Two conditions per candidate, and they are not interchangeable:

- **`condBlocRV`** decides whether the part fits.
- **`condBlocSC`** ("signe codé") does **not** filter. When several candidates
  survive and any carries one, `CondPlanche.askSignCod` asks the user to choose
  between them. Treating it as a filter drops legitimate variants.

#### A worked example

`1132N100110`, five callouts and eight pooled conditions, rendered by
`dialogysx plates`:

```
  1  6000007551              (TYP_ = D500 AND EQPT ≠ 123)
  2  6000007551              (TYP_ = D500 AND EQPT = 123)
  3  6000007614 ->6000007770 (TYP_ = D501 AND EQPT ≠ 123 AND EQPT ≠ 121)
  3  6000007770              (TYP_ = D501 AND EQPT ≠ 123 AND EQPT ≠ 121)
  4  6000007673 ->6000007771 (TYP_ = D501 AND EQPT = 121|123) OR (TYP_ = D502)
  4  6000007771              (TYP_ = D501 AND EQPT = 121|123) OR (TYP_ = D502)
  5  6000008647 ->6000008997 (UVEH = K AND TYP_ = D503
                              AND NFAB ≥ 0000001 AND NFAB ≤ 0000723)
  5  6000008997              (TYP_ = D503)
```

Everything in the grammar shows up here: conjunction within a line, disjunction
between lines (callout 4), several alternatives for one clause (`121|123`),
`≠` decoding correctly as U+2260, and supersessions (`->`).

Callout 5 is the shape §3.1.1 is about: part `6000008647` applies to factory `K`
up to build number 723 and is superseded by `6000008997`, which applies to the
type generally. Without date and build-number comparison that first line cannot
be decided — so the honest answer for that part today is _unknown_, not "fits"
and not "does not fit".

Note also `UVEH` (the factory): `CondFactory` routes it to the plain `CondElem`
even though it is in `S_VUES_DATE`, so it compares by equality like any other
criterion.

#### Measured over the whole catalogue

41,758 plates parse with every byte consumed, yielding 423,076 callouts and
762,244 part candidates:

|                                                           | Candidates  | Share      |
| --------------------------------------------------------- | ----------- | ---------- |
| No condition — always fit                                 | 285,961     | 37.5 %     |
| Decidable from criteria alone                             | 257,219     | 33.7 %     |
| Contain an ordered clause — need date resolution (§3.1.1) | 219,064     | 28.7 %     |
| **Decidable without date support**                        | **543,180** | **71.3 %** |

Also: 131,306 candidates carry a `condBlocSC` (a user choice), 133,567 carry
supersessions, and 553 distinct criteria appear across all conditions.

**Nine plates carry a dangling pool reference** — an index one past the end of
its pool. All nine are in `consPool`, never in a candidate's applicability, and
the records are otherwise intact (they parse to the byte, with coherent parts).
The original is less forgiving: `getCondBloc` indexes the array directly, so
Java throws `ArrayIndexOutOfBoundsException` and **Dialogys itself cannot load
these nine plates**:

```
1230N114750  1236N114655  1240N114320  1240N156322  1242N114320
1242N156322  1270N156369  1274N156369  1703N199300
```

#### 3.1.1 Date and build-number comparison — not implemented

The ordered operators are used by exactly **eight** variables, all of them views
onto a build date or a build number
(`VarFactory.S_VUES_DATE = "NFAB|MILL|UVEH|MFAB|NFMO|D_MO|UFMO|NFBV|D_BV|UFBV"`):

| Variable | Meaning                | Occurrences |
| -------- | ---------------------- | ----------- |
| `MILL`   | model year (millésime) | 257,930     |
| `D_MO`   | engine date            | 20,889      |
| `NFAB`   | build number           | 19,733      |
| `NFMO`   | engine build number    | 5,849       |
| `D_BV`   | gearbox date           | 5,130       |
| `MFAB`   | build month            | 5,031       |
| `NFBV`   | gearbox build number   | 1,542       |
| `NFPO`   | —                      | 7           |

Only **29 clauses** use an ordered operator on a variable outside that set, so
the set is effectively complete.

Resolving them is a subsystem of its own, `VarDate.resolveDate`, with three
"vues" — 0 build number, 1 event/date, 2 factory — and helpers
`UtilDate.compareNFab`, `succDateEvt`, `getNFabWithoutUsi`,
`getUsiWithoutNFab`, `resolveDatesSpeciales`, `resolveDateEvt`,
`resolveDateApprox`, plus `getBlocDate(vue).getNFabFromEvt(...)` which reads the
**`Dates` dataset** (§3). It needs the vehicle's build number and factory, not
just its criteria. Until it exists, those 28.7 % of candidates evaluate to
unknown — which the interface should present as a question, not as an exclusion.

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

### 3.7.1 Brands — `pr/ListeDoc<Brand>`

The marque is not a field on anything. It is a **list of model indices**, one
Java properties file per brand, read by `GlobalesG.setListDocUsed`:

```
pr/ListeDocRenault    modele = 14-11-4-20-26-12-56-30-0-25-9-...   (76 indices)
pr/ListeDocDacia      modele = 38-39-40
```

Those numbers index the `MOD_` criterion's value list — the same index space
`ListePRModele` stores — so Dacia is `38, 39, 40` = **Solenza, SupeRNova,
Pick-up**. The original hard-codes the two filenames, prefers
`ListeDocDacia2` over `ListeDocDacia` when both exist, and maps them to the
`pr/renault` and `pr/dacia` directories, which hold the logos. Motrio is a
parts brand handled elsewhere, not a vehicle marque.

### 3.7.2 Model, assembly and part names

Nothing in the catalogue stores a name next to the thing it names. Four
separate sources, four formats:

| What                 | Where                                        | Shape                                                                    |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Model of a PR group  | `pr/ListePRModele`                           | `count:i16` then `numPR:utf, code:utf, index:i16`, the index into `MOD_` |
| Assembly and domain  | `langue/<lg>/<lg>.zip:menu`                  | CR-separated, TAB-indented `id,label` tree                               |
| Part description     | `tarif/d3k/<CC>/<lg>/libellePieces-<lg>.txt` | `ref TAB description`                                                    |
| Criterion and values | `langue/<lg>/classicvar.utf`                 | §3.7                                                                     |

The `menu` tree is **exactly three levels** — 3 sections, 77 domains, 346
assemblies — matching the original's three side-by-side lists. `M1010A` is
"Complete engine" under `M10` "10 Engine" under `M` "Manual". A **plate has no
name at all**: `Planche.getLabel()` composes `PR/section/domain/rest`, e.g.
`1256/M/10/0812`, and that is what the original's title bar shows.

Part descriptions are the awkward one. They ship **inside `tarif.zip`**,
bundled with the price data, on the _country_ discs rather than the
multi-language catalogue disc — 42 country/language datasets, of which
`libelles`/`libelles.idx` and `libellePieces-<lg>.txt` are names and
`tarif`/`tarif.idx`/`CBareme` are prices. Coverage is partial by design, since a
tariff lists only what that market sells:

| Set                        | Names   | Coverage of the 327,169 references |
| -------------------------- | ------- | ---------------------------------- |
| `GB/en`                    | 145,788 | 37.8 %                             |
| every English set combined | 165,343 | 42.6 %                             |

`libelles` is the same data indexed **by description** (key length 20, collation
key) for searching parts by name; `libellePieces-<lg>.txt` is the plain
reference-to-name direction.

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

### 5.0A How the navigation actually resolves

Implemented in `packages/catalogue/src/repair.ts`, transcribed from
`DAOArboRechercheXml`, `ArboRechercheSaxHandler`, `AbstractApplicability`,
`UI.isApplicable` and `FamilyModels`. Three lookups, none of them guessable from
the data alone:

| Step                     | File                                                            | Java                                   |
| ------------------------ | --------------------------------------------------------------- | -------------------------------------- |
| model name → family code | `pr/FamilleModeleAll.dat`                                       | `FamilyModels.init`                    |
| family → document tree   | `mrnt/<lg>/d3k/indexation/ArboRech-<MR\|NT>[-pdf]-<FAMILY>.xml` | `DAOArboRechercheXml.getArboRecherche` |
| document → file          | `mrnt/<lg>/d3k/1-<MR\|NT>/<numero>.pdf`                         | `ArboRechercheSaxHandler` line 114     |

`FamilleModeleAll.dat` is a properties file with a **colon** separator and
**1-based** indices into `classicvar`'s `MOD_` list — `FamilyModels.init` reads
`valueToModel[parseInt(n) - 1]`, while `ListePRModele` and the brand files index
the same list from 0. An off-by-one does not throw; it returns the neighbouring
model, so Clio's manuals would file under Captur. Checked against reality: 75
families covering 97 models, `X06` → Twingo, `X84` → Mégane II + Scénic II,
`X65` → Clio II + Clio RS V6, `X61` → Kangoo II. Those are the real Renault
project codes, which is independent confirmation the indexing is right.

**Applicability here is not the parts grammar.** No operators, no date views, no
joker tables — flat equality, AND across variables inside an `<appl>`, OR across
a variable's `<criterion>` values, OR across `<appl>` blocks, and no `<appl>` at
all means "every vehicle" (`UI.isApplicable` returns `true` when
`hasApplicability()` is false). The load-bearing difference from the parts side:

```java
String valeurContext = vehicule.getValueInContext(varApplicabilite.getName());
if (!valeurContext.equals("")) { ... }        // unknown -> variable ignored
```

A variable the vehicle cannot answer is **skipped**, not turned into a question.
Defaulting the other way hides exactly the general manuals, which are the ones
with no restrictions.

**The `$`-prefixed variables are never answerable during navigation, by design.**
Measured over the 114 English PDF indexes of the 4.55 set — 87,152 topics,
195,368 document references, 2,131 distinct documents, 904,506 applicability
blocks:

| Variable | Clauses | Answerable from the vehicle? |
| -------- | ------- | ---------------------------- |
| `MOT3`   | 680,323 | yes — engine code            |
| `BVI3`   | 494,448 | yes — gearbox code           |
| `$TYC`   | 344,531 | **no**                       |
| `MOTI`   | 57,176  | yes — engine index           |
| `$PHD`   | 56,520  | **no**                       |
| `BVII`   | 5,114   | yes — gearbox index          |

`DialogysVariable.setVariableSecondaire` marks the `$` ones, and
`VehiculeContext` has no entry for them, so the original's own navigation skips
them too. They are asked as a dialog _later_, when a document is opened, by
`AskVariablePane.askForVariableByInternalApplicability`, and only for that
document's internal applicability. A document restricted solely by `$TYC` is
therefore offered for every vehicle — in the original as much as here.

17.1% of references carry no applicability at all. Filtering a Master II
(`TYP_=ED01`, `MOT3=G9U`, `BVI3=PF6`) against family `X70` takes its documents
from 154 to 121: the `MOT3=S8U|S9W` manuals (`MR-323-MASTER-*`) drop out, the
rest stay.

### 5.0B The two index flavours differ in ways that fail silently

`ArboRech-*-pdf-*.xml` and `ArboRech-*-*.xml` are the same schema in outline and
not in detail. Three differences, each of which produces a plausible-looking
empty result rather than an error:

1. The PDF flavour names documents `<pdf numero titre>`; the chapter flavour
   uses **`<UI chapitre chemin titre>`** — upper case. A case-sensitive match
   reports 27,924 topics containing zero documents, which reads as "no
   documentation for this vehicle".
2. Only the PDF flavour has a `numero`. A procedure is addressed by `chemin`, a
   `dir/file` pair under `chapitres/` — and `new D3KXML(chemin)` throws unless
   it splits into exactly two parts.
3. The chapter flavour nests documents under `<operation id libelle>`; the PDF
   flavour has no such layer.

Also: one `chapitre` code covers dozens of procedures, so deduplicating on the
id collapses 37,695 procedures into their few hundred chapter codes.

**Empty is not broken.** 41 of the 161 English chapter indexes are 49 bytes —
`<?xml version="1.0" encoding="UTF-8"?><arborech/>`. A sweep has to say which
of the two it found, or it reports a parser fault about files with nothing in
them. `dialogysx docs` distinguishes them.

The `ORGANE` pseudo-family is a fourth source the original merges into every
vehicle's tree (`getAllElementsArborech(family, useMR, useNT, useOrgane, ...)`),
holding the engine and gearbox documentation. Two notes: the file on disc is
`ArboRech-NT-organe.xml`, **lower case**, while the code asks for `ORGANE` — it
only resolves on a case-insensitive filesystem, i.e. the Windows it shipped for.
And `AbstractExpertD3K` assigns `arboRechercheOrganeNTPDF` from
`getArboRechercheMRPdfByVehiculeType` — the MR getter, twice — so
`ArboRech-NT-pdf-ORGANE.xml` is never loaded by the original at all. Moot on
this data: only the chapter-flavour `organe` index ships.

### 5.0C Census of the English 4.55 set

Five discs, `mrnt/` containing only `en`:

| Disc  | Contents                                                                 |
| ----- | ------------------------------------------------------------------------ |
| DVD-1 | catalogue: `pr/` (160 groups), `langue/` (22 languages), drawings, dates |
| DVD-2 | 24,732 chapter XML + 720 `NTI-EN` PDFs, 1,879 chapter directories        |
| DVD-3 | 15,322 chapter XML, 1,418 directories, 2 illustration archives           |
| DVD-4 | 5 illustration archives only                                             |
| DVD-5 | **1,152 `1-MR` manuals + 978 `1-NT` notes** + 361 `indexation/` files    |

Illustrations total 146,121 files, 6.39 GB uncompressed, across eight archives
on three discs — and **three of them are named `images_1.zip`**, so the
extract-don't-copy rule matters more here than on the Russian set.

PDF text layers, sampled ~40 per tree: `1-MR` 42/42 carry text, `NTI-EN` 40/40,
`1-NT` **32/41** — roughly a fifth of the technical notes are image-only scans
and would need OCR to be searchable. (Three files sampled by hand suggested all
of `1-NT` was scans. It is not; sample before generalising.)

One data fault: `ArboRech-MR-pdf-X65.xml` references `MR432X6517B050`, and only
`MR432X6517B000.pdf` ships — 1 of 2,131.

Two of the five ISOs (`DVD-1`, `DVD-4`) end one byte short of a 2048-byte sector
boundary, the signature of an interrupted transfer. `hdiutil attach` refuses a
file whose length is not a whole number of sectors; `-imagekey
diskimage-class=CRawDiskImage` skips that check and both mount clean, with every
file extent readable. `apps/cli/src/import/iso.ts` falls back to it
automatically.

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

## 7. What is decoded, and what is not

**Specified and validated** — the plate condition grammar (§3.1). Transcribed
from `PRFactory.newCondPlanche` and `CondFactory`, and every one of the 41,758
plates parses with all bytes consumed. My earlier note here claimed the leading
shorts were "counts" and that there was an "`0xFF` applicability mask": both
were wrong, read off a hexdump. The shorts are pool sizes and the "mask" was a
run of `-1` sentinels meaning "no condition". The lesson stands on its own: the
application is unobfuscated, so read the parser instead of the bytes.

Honest list of what remains.

- **Date and build-number comparison** (§3.1.1). The ordered operators are
  parsed but not evaluated, which leaves **28.7 % of part candidates** resolving
  to unknown. This is now the critical path for parts filtering, and it needs
  `VarDate.resolveDate`, the `UtilDate` helpers, and the `Dates` dataset.
- **`Dates` semantics**: the record is a key plus a list of `yymmdd`, but what
  the dates _mean_ is unverified — and §3.1.1 depends on it.
- **`Organes.dat` conditions** are almost certainly the same grammar
  (`CompileCond` treats plates and assemblies identically, and `newCondOrgVign`
  reuses `newTCondBloc`), but that has not been swept and asserted the way §3.1
  was. Do not assume it until it is.
- **`prremp`** (part substitutions): payload is `len:int32 || key || binary`; the
  binary tail is unread.
- **`Refcontexte/refContexte`** (11 MB) — untouched.
- **`chemins.properties`**, the authoritative data-path map, is inside the 250 MB
  MSI and has not been extracted.
- **`papv` block grammar** is understood by shape, not specified.
- **Nothing has been checked against a known-good parts list.** The grammar is
  right — 41,758 records prove the _shape_ — but "this part fits this car" has
  not been confirmed against an independent answer for a single vehicle. That is
  a different claim, and it is not yet made.
