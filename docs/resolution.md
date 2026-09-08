# How a vehicle becomes a parts list

`data-format.md` says what the bytes mean. This says how they are turned into
answers: pick a model, pick a vehicle, and get the diagrams and the part
numbers that fit it.

The split is deliberate. The formats are facts about Renault's data and will
not change. Everything here is an _algorithm_, transcribed from the original
applet, and it is the half you cannot recover from a hexdump — reading
`Planches.dat` correctly still leaves you with no idea which of the parts on a
plate belong to the car in front of you.

Section numbers in `§n` form refer to `data-format.md`.

## 1. The shape of the problem

The catalogue is not a list of parts per vehicle. It is a list of parts per
_plate_, each carrying a condition, and a vehicle is a set of criterion values
that a condition is evaluated against. Nothing is precomputed:

```
brand ─▶ model ─▶ PR group(s) ─▶ vehicle (envelope row)
                                    │
                       assembly ◀───┤ 154 offered, 134 with plates
                          │
                       diagram (plate)
                          │
                       callout ─▶ candidate parts ─▶ evaluate ─▶ fits / undecided
```

Four things make this harder than it looks, and each drove a decision below.

- **A condition can be unknown**, not just true or false, and unknown must not
  mean "exclude" (§2).
- **Ten of the variables are not criteria at all** but views onto build
  records, needing a second dataset and the vehicle's build number (§4).
- **The join is four-way**: a condition names a variable, whose values live in
  the PR group's table, whose entries translate through `classicvar.utf`, whose
  ordered comparisons need `Dates` (§3).
- **Almost everything is optional.** A tree imported with `-c min` has no
  names, no drawings and no documentation, and the parts list must still work.

## 2. Three-valued logic

The whole engine rests on this. `dialogys.conditionsfp.Troolean` is Kleene
logic — `true`, `false`, `unknown` — and in the original an unknown clause
raises `DontKnowException`, which the interface turns into a **question for the
user** rather than a filter.

```
OR    true ∨ anything = true      unknown otherwise unless both false
AND   false ∧ anything = false    unknown otherwise unless both true
```

Getting this wrong is the single most expensive mistake available, and it fails
silently: treat unknown as false and the app looks like it works while quietly
hiding parts that do fit. Measured on the real catalogue, **28.7 % of part
candidates contain an ordered clause**, so a two-valued engine would misreport
roughly a quarter of the catalogue with no error anywhere.

A condition is a `CondBloc`: lines OR'd together, elements within a line AND'd
(§3.1). So a part applies if _any_ line holds, and a line holds if _every_
element does.

## 3. The condition context

`VehicleContext` (`vehicle.ts`) is the four-way join, so that no caller has to
assemble it:

| it supplies                    | from                                    | why                                                       |
| ------------------------------ | --------------------------------------- | --------------------------------------------------------- |
| the vehicle's criterion values | the envelope row, plus user answers     | the left side of every comparison                         |
| the PR group's value table     | `pr/<group>.zip` → `ListeVarVal` (§3.8) | a condition's value is an _index_ into this, not a string |
| the criteria vocabulary        | `langue/<lg>/classicvar.utf` (§3.7)     | resolves the table to words                               |
| the three `Dates` records      | `Dates/Dates` (§3)                      | the ordered operators (§4)                                |

Two details that are easy to miss:

- **`TYP_` and `EQPT` match with `-` as a wildcard** —
  `VarFactory.S_AVEC_JOKE = "TYP_|EQPT"`, exactly two variables. A condition
  value of `ED-1` matches `ED01`.
- **A criterion the vehicle does not answer is `undefined`, not empty.** Empty
  is a value; absent is a question. Conflating them turns "not known yet" into
  "known to be blank".

### The vehicle

An envelope row (§3.5) yields exactly **six** criteria, and that is all
identification alone gives you:

| code   | example         | meaning         |
| ------ | --------------- | --------------- |
| `TYP_` | `FD01`          | vehicle type    |
| `NEQT` | `E1`            | equipment level |
| `EQPT` | _(often empty)_ | equipment code  |
| `MOT3` | `G9U`           | engine type     |
| `MOTI` | `632`           | engine suffix   |
| `BVI3` | `PF6`           | gearbox type    |

Everything else a condition might ask about — country of legislation, roof
type, air conditioning, steering side — is unanswered until the user says. On
a Master II (`FD01`, PR 1256) that leaves **251 of 304 plates** carrying at
least one unanswered condition, spanning 73 distinct criteria. The interface's
job is to ask about the ones that matter, not all 1,216.

## 4. The ordered operators

§3.1.1 of the format doc describes these as unimplemented. They are
implemented, in `dates.ts`, and this is how.

Ten variables are not criteria but **views onto three build records** — the
vehicle's, the engine's and the gearbox's. `VarFactory.newVarVueSurDate`
assigns each a group and a _vue_, and the vue decides what the comparison even
means:

| vue | question                          | needs                             |
| --- | --------------------------------- | --------------------------------- |
| 0   | build **number** comparison       | the vehicle's build number        |
| 1   | build **date** / event comparison | the `Dates` dataset as well       |
| 2   | which **factory**                 | the build number's leading letter |

```
dveh: NFAB=0  MILL=1  MFAB=1  UVEH=2
dmot: NFMO=0  D_MO=1  UFMO=2
dbvi: NFBV=0  D_BV=1  UFBV=2
```

The vehicle branch of the original reads
`else if (!nomVar.equals("MILL") && nomVar.equals("UVEH")) vue = 2;` — the
first test is redundant, since a string equal to `UVEH` cannot equal `MILL`.
The behaviour is unambiguous even so, and worth recording because a
transcription that "fixes" it changes nothing.

**This is why the interface asks for a factory _and_ a build number.** A build
number alone cannot be compared: vue 0 strips the factory letter from both
sides, and vue 1 has to look the number up in `Dates` to get an event, which is
keyed by factory. One without the other decides nothing — which is why the two
fields are presented together and why a build number with no factory produces a
prompt rather than a result.

`MILL` alone gates **197 of those 251** undecided plates on a Master II, so in
practice entering factory + build number settles the large majority in one
step. That is the highest-value input in the whole interface, and it is not a
criterion the user picks from a list.

Two implementation notes worth keeping:

- **`[` and `>` are rewritten onto the successor event**, so only `<` and `]`
  need real handling. The original recurses for exactly this reason
  (`succDateEvt`), and following it keeps the four operators consistent instead
  of four near-copies.
- **Date views are deliberately not offered as value pickers.** Their "values"
  are hundreds of raw event labels — `NFAB` alone lists over 400, things like
  `000119` and `MOD0311` — which are meaningless to a user. They are settled by
  the build number or not at all.

## 5. Opening a session

`CatalogueSession.open` reads what is present and leaves the rest undefined.
Order matters only where something depends on something else; the reason each
is optional is that a tree may legitimately not have it.

```
wrapArchives(source)          ← manifest may say drawings live inside .zip (§tree.md)
  ├─ planches, organes        ← the parts layer; without these there is no catalogue
  ├─ ref-num-pr               ← part-number search
  ├─ trepere                  ← callout positions; without it, no hotspots
  ├─ dates                    ← the ordered operators; without it they stay unknown
  ├─ envelope (prType/typePr) ← the vehicle list
  ├─ classicvar.utf           ← criterion and value names; falls back to codes
  ├─ pr/ListePRModele         ← model names; falls back to codes
  ├─ langue/<lg>/menu         ← assembly names and the menu tree
  ├─ tarif/…/libellePieces    ← part descriptions, per *country* not language
  ├─ pr/ListeDoc<Brand>       ← brands
  └─ pr/FamilleModeleAll.dat  ← documentation families; absent without repair-pdf
```

`wrapArchives` comes first and wraps the source itself, so nothing downstream
ever needs to know whether a file was extracted or is being read out of a zip
by byte range.

**Part names are per country, not per language.** Several countries share a
language and each tariff names only what is sold there, so coverage is partial
by design — `GB/en` covers 37.8 % of 327,169 references and all English sets
together 42.6 %. An unnamed part is not an error, and the interface says so
rather than leaving the cell blank.

## 6. Resolving a plate

`session.plate(pr, plate, spec, drawing)`:

1. **Read** `planches` at `PR(4) || plate(7)` and parse it (§3.1).
2. **Build the context** for the vehicle (§3), including its three `Dates`
   records.
3. **Read callout positions** from `trepere`, keyed by the **drawing** number,
   not the plate name. The two are unrelated strings and the drawing comes from
   the _assembly_ record, so a plate resolved without one has parts but no
   hotspots.
4. **Evaluate every callout**: each candidate's condition against the context,
   splitting into `fits` and `unknown`.
5. **Collect the questions**: for every unknown candidate, every variable in
   its condition that the vehicle has not answered. Variables it _has_ answered
   are not asked again, and date views are excluded (§4).
6. **Describe** each candidate — its name from the tariff, and its condition
   rendered as words through the group's value table (§7).

The result carries `fits`, `unknown` and the questions, which is what lets the
interface show a part as _undecided_ with a reason rather than dropping it.

## 7. Rendering a condition as words

`describe.ts` turns a `CondBloc` into lines of text: the variable's label from
the vocabulary, the operator, and the value resolved through the PR group's
table. This exists because a condition is otherwise unreadable — indices into a
table the user cannot see — and because the honest answer to "why is this part
undecided?" is the condition itself.

One candidate on an engine plate has twenty OR'd alternatives, each naming a
dozen criterion values. Rendered inline it made a single table row taller than
the drawing beside it, which is why the interface shows the _count_ and puts
the text behind a click.

## 8. Assemblies and availability

An assembly record (§3.2) carries its own condition pool and a list of plate
references, each with its own applicability. `evaluateOrgane` splits them the
same way a plate's callouts are split: plates that fit, and plates that are
undecided.

- **`assemblyPlates(pr, assembly, spec)`** — the diagrams of one assembly, for
  this vehicle. This is what the diagram tabs show, ordered ascending by plate
  code with fitting and undecided interleaved.
- **`assemblyAvailability(pr, spec)`** — the same evaluation across _every_
  assembly, giving a plate count each. It is what lets the assembly panel hide
  the empty ones and say how many it hid.

Availability is expensive: it evaluates all 154 assemblies of a PR group. It is
worth it because two thirds of them can be empty for a given vehicle, and
silently offering 154 entries where 134 have anything looks like missing data.

Measured on a Master II: 134 assemblies with plates, of which 59 % yield
exactly one diagram, 28 % two or three, 11 % four to six, and one yields 12.
That distribution is why a single diagram opens automatically and why the tab
strip appears only above one.

## 9. Searching for a part

Two indexes do most of the work; one gap has to be scanned.

- **`refNumPr`** maps a reference to the PR groups holding it (§3.3) — 327,169
  references, one lookup.
- **the tariff** maps descriptions to references, in memory.

What no index gives is **which plate draws a reference**. `trepere` goes the
other way, drawing to callouts. So the last step is a scan of the plates in the
surviving groups, and the value of the two indexes is how much of it they
remove: a part in no group this vehicle uses is answered without opening a
single plate — 0 ms against 34 ms and 304 plates for one that is present.

"Belongs to another model" and "no such part" are reported as different
answers, because only one of them means the user mistyped.

Keys are zero-padded to ten and nobody types the padding, so a query is tried
both as a prefix and padded: `1484` has to find `0000001484`, which a prefix
query misses entirely. Four digits is the floor for reading a query as a number
at all — "300" is more likely part of a word, and as a prefix it matches
thousands.

## 10. Repair documentation

Independent of everything above. Documents are indexed by vehicle **family**,
never by assembly, so they need a model and nothing else — no vehicle, no
assembly, no plate. `pr/FamilleModeleAll.dat` maps a model to a family
(1-based indices into the `MOD_` vocabulary), and the family names the index
files. See §5, §5.0A and §5.0B, which cover the navigation and the two index
flavours that differ in ways that fail silently.

## 11. What this does not establish

The applicability grammar is right in the sense that every plate parses with
every byte consumed — 41,758 on the 7.5.6 set, 40,910 on the English 4.55 set —
and that 12 datasets validate with 576,034 keys, 0 unsorted and 0 bad pointers.

(The two plate counts are different discs, not a discrepancy. Figures in this
document are from the English 4.55 set unless they say otherwise; the format
reference documents 7.5.6.)

**That is not the same as a verified parts list.** No result has been checked
against an independently known answer for a single vehicle. "This part fits
this car" is a different claim from "these bytes were read correctly", and only
the second one is currently supported.
