/**
 * Repair documentation: the PDF manuals and technical notes, and how to find
 * the ones that apply to a vehicle.
 *
 * This is a **separate world from the parts catalogue** and much simpler. The
 * parts side uses a three-valued grammar with operators, date views and joker
 * tables (`conditions.ts`); documents use flat equality over a handful of
 * variables, and — the important difference — a variable the vehicle cannot
 * answer is *skipped* rather than turned into a question. Transcribed from
 * `AbstractApplicability.isApplicable`:
 *
 * ```java
 * String valeurContext = vehicule.getValueInContext(varApplicabilite.getName());
 * if (!valeurContext.equals("")) {          // unknown -> variable ignored
 *   for (Criterion critere : criteres) {
 *     if (valeurContext.equals(critere.getValue())) break;   // OR over values
 *     if (j == criteres.size() - 1) return false;            // AND over vars
 *   }
 * }
 * ```
 *
 * Three files make the navigation work, and none of them is guessed:
 *
 * | What | Where | Read by |
 * | --- | --- | --- |
 * | model name -> family code | `pr/FamilleModeleAll.dat` | `FamilyModels.init` |
 * | family -> document tree | `mrnt/<lg>/d3k/indexation/ArboRech-<MR\|NT>[-pdf]-<FAMILY>.xml` | `DAOArboRechercheXml.getArboRecherche` |
 * | the document itself | `mrnt/<lg>/d3k/1-<MR\|NT>/<numero>.pdf` | `ArboRechercheSaxHandler` line 114 |
 */
import { decodeText, decodeUtf8 } from "@dialogysx/raf";
import type { CriteriaVocabulary } from "./criteria.js";

// --------------------------------------------------------------------------
// model -> family
// --------------------------------------------------------------------------

/**
 * `pr/FamilleModeleAll.dat` — which family code a model belongs to.
 *
 * Colon-separated, one family per line, values are indices into `classicvar`'s
 * `MOD_` list:
 *
 * ```
 * X84:35,36
 * X06:4
 * ```
 *
 * The indices are **1-based**. `FamilyModels.init` reads
 * `valueToModel[Integer.parseInt(modelsTab[i]) - 1]`, while `ListePRModele` and
 * the brand files index the same list from 0. Getting this wrong does not throw
 * — it silently returns the neighbouring model, so Clio's manuals would appear
 * under Captur.
 */
export class FamilyModels {
  private constructor(
    /** family code -> model names */
    private readonly byFamily: Map<string, string[]>,
    /** model name (lower-cased) -> family code */
    private readonly byModel: Map<string, string>,
  ) {}

  static parse(bytes: Uint8Array, vocabulary: CriteriaVocabulary | undefined): FamilyModels {
    const models = vocabulary?.get("MOD_")?.values ?? [];
    const byFamily = new Map<string, string[]>();
    const byModel = new Map<string, string>();

    for (const raw of decodeText(bytes).split(/\r\n|\r|\n/)) {
      const line = raw.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const family = line.slice(0, colon).trim();
      const names: string[] = [];
      for (const part of line.slice(colon + 1).split(",")) {
        const n = Number.parseInt(part.trim(), 10);
        if (!Number.isInteger(n)) continue;
        const name = models[n - 1];
        if (name === undefined || name.length === 0) continue;
        names.push(name);
        // First family wins: a model listed twice would otherwise resolve to
        // whichever line came last, which is not what the original's linear
        // `getFamily` scan returns.
        if (!byModel.has(name.toLowerCase())) byModel.set(name.toLowerCase(), family);
      }
      if (names.length > 0) byFamily.set(family, names);
    }
    return new FamilyModels(byFamily, byModel);
  }

  /** The family a model name belongs to, or `undefined` if it has no documents. */
  familyOf(modelName: string): string | undefined {
    return this.byModel.get(modelName.trim().toLowerCase());
  }

  modelsOf(family: string): readonly string[] {
    return this.byFamily.get(family) ?? [];
  }

  get families(): string[] {
    return [...this.byFamily.keys()];
  }

  get size(): number {
    return this.byModel.size;
  }
}

// --------------------------------------------------------------------------
// the document tree
// --------------------------------------------------------------------------

/** `MR` = repair methods, `NT` = technical notes. */
export type DocKind = "MR" | "NT";

/** One `<appl>` block: a conjunction of variables, each with allowed values. */
export interface DocApplicability {
  clauses: { variable: string; values: string[] }[];
}

/** A document as the index lists it. */
export interface DocRef {
  /**
   * The document's identifier.
   *
   * For a PDF that is `numero`, which is also the file's base name. For a D3K
   * procedure there is no `numero`; the id is the `chapitre` code and the file
   * is named by `chemin`.
   */
  numero: string;
  /** `titre`, e.g. `M.R. 305   3 CHASSIS`. */
  title: string;
  kind: DocKind;
  /**
   * `dir/file` under `chapitres/`, for a D3K procedure — absent for a PDF.
   *
   * The two-segment shape is not incidental: `new D3KXML(chemin)` splits on
   * `/` and throws unless it gets exactly two parts.
   */
  chemin?: string;
  /** `chapitre`, e.g. `6016A`. Only the XML indexes carry it. */
  chapter?: string;
  /** The operation this document sits under, when the index groups them. */
  operation?: { id: number; label: string };
  /** OR'd; an empty list means "applies to everything". */
  applicability: DocApplicability[];
}

/** An `<element>`: a named thing you might want to work on. */
export interface DocElement {
  id: number;
  /** `lib`, e.g. `front brake pads`. */
  label: string;
  docs: DocRef[];
}

/** Is this a PDF document or a D3K procedure? */
export function isPdfDoc(doc: DocRef): boolean {
  return doc.chemin === undefined;
}

/**
 * One `ArboRech-*.xml` file, parsed.
 *
 * Read with a regex sweep rather than a DOM parser. The shape is machine-
 * generated and shallow — `element > pdf > appl > object > criterion` — the
 * files run to a few hundred KB, and this has to work identically in Node and
 * in a browser without pulling in a parser. The variable name is the *text
 * before* the first child of `<object>` (`$TYC<criterion>C06</criterion>`),
 * which is awkward for a DOM walk and trivial for a match.
 */
export class DocIndex {
  private constructor(
    readonly kind: DocKind,
    readonly family: string,
    readonly elements: DocElement[],
  ) {}

  static parse(bytes: Uint8Array, kind: DocKind, family: string): DocIndex {
    // These files declare `encoding="UTF-8"` and the labels are English prose;
    // decoding as cp1252 would leave "Ã©" in every accented part name.
    const text = decodeUtf8(bytes);
    const elements: DocElement[] = [];

    const elementRe = /<element\b([^>]*)>([\s\S]*?)<\/element>/g;
    for (const el of text.matchAll(elementRe)) {
      const attrs = el[1] ?? "";
      const body = el[2] ?? "";
      const id = Number.parseInt(attr(attrs, "id") ?? "", 10);
      const label = decodeEntities(attr(attrs, "lib") ?? attr(attrs, "libelle") ?? "");
      const docs: DocRef[] = [];

      // The two flavours differ in three ways, all of them easy to miss:
      //
      // - the PDF indexes use `<pdf numero titre>`; the XML ones use
      //   `<UI chapitre chemin titre>` — **upper case**, so a case-sensitive
      //   match silently finds nothing and reports an index full of elements
      //   with no documents in them.
      // - only the PDF flavour has a `numero`; a procedure is addressed by
      //   `chemin`.
      // - the XML flavour groups documents under `<operation id libelle>`,
      //   which the PDF flavour omits.
      //
      // `ArboRechercheSaxHandler` handles both in one branch, keyed on which
      // attributes are present, so this does too.
      for (const op of splitOperations(body)) {
        const docRe = /<(pdf|ui)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/gi;
        for (const d of op.body.matchAll(docRe)) {
          const dattrs = d[2] ?? "";
          const dbody = d[4] ?? "";
          const numero = attr(dattrs, "numero");
          const chemin = attr(dattrs, "chemin");
          const chapter = attr(dattrs, "chapitre");
          const key = numero ?? chapter ?? chemin;
          if (key === undefined) continue;
          docs.push({
            numero: key,
            title: decodeEntities(attr(dattrs, "titre") ?? key),
            kind,
            ...(chemin !== undefined ? { chemin } : {}),
            ...(chapter !== undefined ? { chapter } : {}),
            ...(op.operation ? { operation: op.operation } : {}),
            applicability: parseApplicabilities(dbody),
          });
        }
      }
      if (Number.isInteger(id)) elements.push({ id, label, docs });
    }
    return new DocIndex(kind, family, elements);
  }

  /**
   * True when the file is an empty `<arborech/>` rather than one this parser
   * failed on.
   *
   * 41 of the 161 English chapter indexes are literally 49 bytes:
   * `<?xml version="1.0" encoding="UTF-8"?><arborech/>`. Without this a sweep
   * cannot tell "nothing to show" from "the parser broke", and I reported the
   * second when it was the first.
   */
  static isEmptyByDesign(bytes: Uint8Array): boolean {
    return !/<element\b/i.test(decodeUtf8(bytes));
  }

  /**
   * Distinct documents across every element.
   *
   * Keyed on `chemin` when there is one: in the XML indexes a single
   * `chapitre` code such as `6016A` covers dozens of procedures, so keying on
   * the id alone collapses them into one row.
   */
  documents(): DocRef[] {
    const seen = new Map<string, DocRef>();
    for (const el of this.elements) {
      for (const d of el.docs) {
        const key = d.chemin ?? d.numero;
        if (!seen.has(key)) seen.set(key, d);
      }
    }
    return [...seen.values()];
  }
}

/**
 * Split an element's body into operation groups.
 *
 * The PDF indexes have no `<operation>` layer, so the whole body is returned as
 * one anonymous group; the XML ones nest every document under one.
 */
function splitOperations(
  body: string,
): { operation?: { id: number; label: string }; body: string }[] {
  const out: { operation?: { id: number; label: string }; body: string }[] = [];
  for (const m of body.matchAll(/<operation\b([^>]*)>([\s\S]*?)<\/operation>/gi)) {
    const id = Number.parseInt(attr(m[1] ?? "", "id") ?? "", 10);
    const label = decodeEntities(attr(m[1] ?? "", "libelle") ?? attr(m[1] ?? "", "lib") ?? "");
    out.push({
      ...(Number.isInteger(id) ? { operation: { id, label } } : {}),
      body: m[2] ?? "",
    });
  }
  // Documents sitting directly under the element, outside any operation.
  const loose = body.replace(/<operation\b[^>]*>[\s\S]*?<\/operation>/gi, "");
  if (/<(pdf|ui)\b/i.test(loose)) out.push({ body: loose });
  return out;
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m?.[1];
}

/** The five XML predefined entities. The files use no others. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseApplicabilities(body: string): DocApplicability[] {
  const out: DocApplicability[] = [];
  for (const a of body.matchAll(/<appl\b[^>]*>([\s\S]*?)<\/appl>/g)) {
    const clauses: { variable: string; values: string[] }[] = [];
    for (const o of (a[1] ?? "").matchAll(/<object\b[^>]*>([\s\S]*?)<\/object>/g)) {
      const inner = o[1] ?? "";
      // The variable name is the text before the first tag: `$TYC<criterion>`.
      const variable = (inner.split("<")[0] ?? "").trim();
      const values = [...inner.matchAll(/<criterion\b[^>]*>([\s\S]*?)<\/criterion>/g)]
        .map((c) => (c[1] ?? "").trim())
        .filter((v) => v.length > 0);
      if (variable.length > 0 && values.length > 0) clauses.push({ variable, values });
    }
    // An `<appl>` with nothing usable in it would otherwise read as "matches
    // anything" and let every document through.
    if (clauses.length > 0) out.push({ clauses });
  }
  return out;
}

// --------------------------------------------------------------------------
// applicability
// --------------------------------------------------------------------------

/**
 * What a vehicle answers for a documentation variable.
 *
 * Return `undefined` (or an empty string) for anything unknown: that is not
 * "no match", it means the clause is skipped. `getValueInContext` returns `""`
 * for a missing key and `AbstractApplicability` tests `!valeurContext.equals("")`
 * before comparing.
 *
 * **The `$`-prefixed variables are never answerable here, by design.** Measured
 * over the 114 English PDF indexes, the applicability clauses use six
 * variables: `MOT3` (680,323 clauses), `BVI3` (494,448), `$TYC` (344,531),
 * `MOTI` (57,176), `$PHD` (56,520) and `BVII` (5,114). The first, second,
 * fourth and sixth are engine and gearbox codes the vehicle already carries.
 * The `$` ones are what `DialogysVariable.setVariableSecondaire` marks, and the
 * original does not derive them from the vehicle either — `VehiculeContext`
 * has no entry for them, so its own navigation skips them exactly as this does.
 * They are asked as a dialog *later*, when a document is opened, by
 * `AskVariablePane.askForVariableByInternalApplicability`, and only for that
 * document's internal applicability. So a document restricted only by `$TYC`
 * is offered for every vehicle — in the original as much as here.
 */
export type DocContext = (variable: string) => string | undefined;

/** One `<appl>` block: AND over variables, OR over each variable's values. */
export function applicabilityMatches(appl: DocApplicability, ctx: DocContext): boolean {
  for (const clause of appl.clauses) {
    const value = ctx(clause.variable);
    if (value === undefined || value.length === 0) continue;
    if (!clause.values.includes(value)) return false;
  }
  return true;
}

/**
 * Does this document apply?
 *
 * OR over the blocks, and **no applicability at all means yes** — `UI.isApplicable`
 * returns `true` when `hasApplicability()` is false. Defaulting the other way
 * would hide the general manuals, which are exactly the ones with no
 * restrictions.
 */
export function documentApplies(doc: DocRef, ctx: DocContext): boolean {
  if (doc.applicability.length === 0) return true;
  return doc.applicability.some((a) => applicabilityMatches(a, ctx));
}

// --------------------------------------------------------------------------
// paths
// --------------------------------------------------------------------------

/** `mrnt/<lg>/d3k/indexation/ArboRech-<kind>[-pdf]-<family>.xml`. */
export function docIndexPath(language: string, kind: DocKind, family: string, pdf = true): string {
  return `mrnt/${language}/d3k/indexation/ArboRech-${kind}${pdf ? "-pdf" : ""}-${family}.xml`;
}

/**
 * `mrnt/<lg>/d3k/1-<kind>/<numero>.pdf`.
 *
 * From `ArboRechercheSaxHandler`: `CHEMIN_MRNT + CHEMIN_D3K_MRNT_XML + "1-" +
 * typeDocument + "/" + numero + ".pdf"`.
 */
export function docPdfPath(language: string, kind: DocKind, numero: string): string {
  return `mrnt/${language}/d3k/1-${kind}/${numero}.pdf`;
}
