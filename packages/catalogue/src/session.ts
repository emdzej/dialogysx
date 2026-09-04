/**
 * `CatalogueSession` — everything the interface needs, over one `FileSource`.
 *
 * The wiring is fiddly and identical for the CLI and the browser, so it lives
 * here once: open the datasets, cache each PR group's value table, fetch the
 * right `Dates` record per build group, evaluate a plate for a vehicle.
 *
 * Caches are per-session and unbounded on purpose — a group's value table is a
 * few hundred KB and the working set while browsing one vehicle is small.
 */
import type { CriterionCode, PartRef, PrGroup, Repere, VehicleType } from "@dialogysx/core";
import { decodeText, encodeKey, type IndexedRAF } from "@dialogysx/raf";
import { CriteriaVocabulary } from "./criteria.js";
import { describeBloc } from "./describe.js";
import { DateBlock, isDateVariable, type DateGroup } from "./dates.js";
import { findDataset } from "./datasets.js";
import { Disc, type FileSource } from "./disc.js";
import { Envelope, parseEnvelopeRecord } from "./envelope.js";
import { ArchiveSource, type ArchiveManifest } from "./archive-source.js";
import { PartSearch } from "./part-search.js";
import {
  DocIndex,
  FamilyModels,
  docIndexPath,
  docPdfPath,
  documentApplies,
  type DocContext,
  type DocElement,
  type DocKind,
  type DocRef,
} from "./repair.js";
import {
  drawingPath,
  evaluateOrgane,
  organeKey,
  parseOrgane,
  type Organe,
  type OrganePlate,
} from "./organe.js";
import { evaluateRepere, parsePlate, type EvaluatedCandidate, type Plate } from "./plate.js";
import { parseReperes, repereKey } from "./repere.js";
import { BRAND_SOURCES, Menu, parseBrandModels, PartNames, PrModels, type Brand } from "./names.js";
import { GroupValues } from "./values.js";
import { datesKey, VehicleContext, type VehicleSpec } from "./vehicle.js";

/**
 * Countries to try per language for part descriptions, best coverage first.
 *
 * Measured: `GB/en` has 145,788 names against `IE/en`'s 17,797, so the order
 * is not cosmetic.
 */
const PART_NAME_COUNTRIES: Readonly<Record<string, string[]>> = {
  en: ["GB", "IN", "IR", "ZA", "DK", "IE"],
  fr: ["FR", "BE", "CH", "LU"],
  de: ["DE", "AT", "CH", "BE", "LU"],
  es: ["ES", "MX", "AR", "CO"],
  it: ["IT", "CH"],
  nl: ["NL", "BE"],
  pt: ["PT", "BR"],
  sv: ["SE", "NO", "DK"],
  cs: ["CZ", "SK"],
  ru: ["RU", "UA"],
  pl: ["PL"],
  ro: ["RO"],
  hu: ["HU"],
  fi: ["FI"],
  el: ["GR"],
  hr: ["HR"],
  sl: ["SI"],
  tr: ["TR"],
  ja: ["JP"],
  ko: ["KR"],
};

/** One callout, ready to render: its position on the drawing and its parts. */
/** An evaluated candidate plus its condition rendered into words. */
export interface DescribedCandidate extends EvaluatedCandidate {
  /**
   * The part's description, when the loaded tariff names it.
   *
   * Often absent: a tariff names only what is sold in that market, so `GB/en`
   * covers 37.8 % of the 327,169 references and all English sets together
   * 42.6 %. An unnamed part is not an error.
   */
  name?: string;
  /**
   * One string per OR'd alternative, resolved through the group's value table.
   *
   * Precomputed here because the interface does not hold the value table, and
   * without it the operands render as bare indices.
   */
  conditionLines: string[];
}

export interface ResolvedRepere {
  repere: number;
  /** Position on the drawing, when `TRepere` has one for it. */
  position?: { x: number; y: number };
  fits: DescribedCandidate[];
  unknown: DescribedCandidate[];
}

export interface ResolvedPlate {
  key: string;
  pr: PrGroup;
  /** The 7-character plate name, e.g. `N100110`. */
  plate: string;
  /**
   * The 8-character drawing number, which is **not** derivable from the plate
   * name — it comes from the assembly record (`Organes`). Absent when the
   * caller did not supply one.
   */
  drawing?: string;
  /** URL path of the drawing PNG in an imported tree. */
  drawingPath?: string;
  reperes: ResolvedRepere[];
  /**
   * Criteria the undecided conditions depend on, with the values they could
   * take — what the original would prompt for.
   *
   * The values come from the PR group's table, not the whole vocabulary: a
   * group only uses a subset, and offering the rest would invite answers that
   * cannot match anything.
   */
  questions: CriterionCode[];
  questionOptions: { code: CriterionCode; label: string; values: string[] }[];
  /** Open criteria that a factory and build number would settle. */
  dateQuestions: CriterionCode[];
  raw: Plate;
}

export interface SessionOptions {
  /** Language directory under `langue/`. */
  language?: string;
  /**
   * Country code for part descriptions, e.g. `"GB"`.
   *
   * They live per country as well as per language (`tarif/d3k/<CC>/<lg>/`)
   * because a tariff names only the parts sold in that market. When omitted,
   * the first country present for the language is used.
   */
  country?: string;
}

/** A model, and the PR groups that make it up. */
export interface ModelEntry {
  name: string;
  code: string;
  prGroups: PrGroup[];
}

/** An assembly with its label and the domain it sits under. */
export interface AssemblyEntry {
  code: string;
  label?: string;
  domain?: string;
  domainLabel?: string;
  /** Section the domain belongs to: `M`, `C` or `I`. */
  section?: string;
  sectionLabel?: string;
}

/**
 * The assembly menu as the original presents it: **three cascading levels**.
 *
 * Its PR dialog is three side-by-side lists — section, domain, assembly — plus
 * a search-by-name box. Measured over `menu`: 3 sections, 77 domains, 346
 * assemblies. Flattening domain and assembly into one list loses a level the
 * user is used to navigating.
 */
export interface AssemblySection {
  code: string;
  label: string;
  domains: { code: string; label: string; assemblies: AssemblyEntry[] }[];
}

/**
 * Wrap a source so packed archives are read in place.
 *
 * Reads `manifest.json` for the archive list. A tree with no manifest, or one
 * that declares none, is returned untouched — the extracted layout still works
 * and always did, which is what makes this safe to turn on for existing trees.
 */
async function wrapArchives(source: FileSource): Promise<FileSource> {
  try {
    const bytes = await source.readAll("manifest.json");
    if (!bytes) return source;
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as ArchiveManifest;
    const mounts = manifest.archives;
    if (!mounts || mounts.length === 0) return source;
    return new ArchiveSource(source, mounts);
  } catch {
    // A malformed manifest is not worth refusing to open a tree over; the
    // extracted paths, if present, still resolve.
    return source;
  }
}

export class CatalogueSession {
  private readonly disc: Disc;
  private readonly groupValues = new Map<PrGroup, GroupValues | undefined>();
  private readonly dateBlocks = new Map<string, DateBlock | undefined>();
  private vocabulary?: CriteriaVocabulary;
  private models?: PrModels;
  private menu?: Menu;
  private families?: FamilyModels;
  private readonly docIndexes = new Map<string, DocIndex | null>();
  private partNames?: PartNames;
  /** Country whose part descriptions were loaded, if any. */
  partNameCountry?: string;
  private brandList: Brand[] = [];

  private planches?: IndexedRAF;
  private organes?: IndexedRAF;
  private refNumPr?: IndexedRAF;
  private trepere?: IndexedRAF;
  private datesRaf?: IndexedRAF;
  private envelope?: Envelope;

  private constructor(
    readonly source: FileSource,
    readonly language: string,
  ) {
    this.disc = new Disc(source);
  }

  /**
   * Open what is present. Missing datasets are left undefined rather than
   * fatal — a tree imported with `-c min` has no drawings, and the parts list
   * should still work.
   */
  static async open(source: FileSource, opts: SessionOptions = {}): Promise<CatalogueSession> {
    // A tree may keep its drawings and illustrations packed, in which case the
    // manifest says which archives stand in for which directories. Wrapping
    // here rather than at every call site means nothing downstream has to know
    // whether a file was extracted.
    const wrapped = await wrapArchives(source);
    const s = new CatalogueSession(wrapped, opts.language ?? "fr");
    const get = async (id: string) => {
      const spec = findDataset(id);
      if (!spec) return undefined;
      return (await s.disc.open(spec))?.raf;
    };
    s.planches = await get("planches");
    s.organes = await get("organes");
    s.refNumPr = await get("ref-num-pr");
    s.trepere = await get("trepere");
    s.datesRaf = await get("dates");
    s.envelope = new Envelope({
      prType: await get("envelope-pr-type"),
      typePr: await get("envelope-type-pr"),
    });

    const vocabBytes = await wrapped.readAll(`langue/${s.language}/classicvar.utf`);
    if (vocabBytes) s.vocabulary = CriteriaVocabulary.parse(vocabBytes);

    // Names are all optional: a `-c min` tree has none, and the interface
    // falls back to codes rather than failing.
    const modelBytes = await wrapped.readAll("pr/ListePRModele");
    if (modelBytes) s.models = PrModels.parse(modelBytes);
    const menuBytes = await wrapped.readAll(`langue/${s.language}/menu`);
    if (menuBytes) s.menu = Menu.parse(menuBytes);
    await s.loadPartNames(opts.country);
    await s.loadBrands();
    // Documentation is optional too: a tree imported without `repair-pdf` has
    // no `indexation/`, and the interface then offers no documents rather than
    // reporting a broken tree.
    const familyBytes = await wrapped.readAll("pr/FamilleModeleAll.dat");
    if (familyBytes) s.families = FamilyModels.parse(familyBytes, s.vocabulary);
    return s;
  }

  /** Read the brand files. Absent ones are simply not offered. */
  private async loadBrands(): Promise<void> {
    const out: Brand[] = [];
    for (const src of BRAND_SOURCES) {
      for (const file of src.files) {
        const bytes = await this.source.readAll(file);
        if (!bytes) continue;
        const modelIndices = parseBrandModels(bytes);
        if (modelIndices.length > 0) {
          out.push({ id: src.id, label: src.label, modelIndices });
        }
        break;
      }
    }
    this.brandList = out;
  }

  get brands(): readonly Brand[] {
    return this.brandList;
  }

  /**
   * Load part descriptions for a country.
   *
   * Tries the requested country, then likely ones for the language, then gives
   * up quietly — HTTP cannot list a directory, so there is no enumerating what
   * is present.
   */
  private async loadPartNames(country?: string): Promise<void> {
    const candidates = country
      ? [country]
      : (PART_NAME_COUNTRIES[this.language] ?? [this.language.toUpperCase()]);
    for (const cc of candidates) {
      const bytes = await this.source.readAll(
        `tarif/d3k/${cc}/${this.language}/libellePieces-${this.language}.txt`,
      );
      if (bytes) {
        this.partNames = PartNames.parse(bytes);
        this.partNameCountry = cc;
        return;
      }
    }
  }

  /** Model-to-family map for the documentation indexes, when present. */
  get familyModels(): FamilyModels | undefined {
    return this.families;
  }

  /**
   * The document families for a model, and the documents that apply.
   *
   * Both kinds are offered: `MR` repair methods and `NT` technical notes, from
   * the `-pdf` indexes. The XML (`chapitres`) indexes exist under the same
   * naming without `-pdf` and parse the same way — see `docIndexPath` — but
   * rendering a D3K procedure is a different job from opening a PDF, so this
   * stops at the PDFs.
   */
  async documentsFor(
    modelName: string,
    spec?: VehicleSpec,
  ): Promise<{ family: string; elements: DocElement[]; total: number } | undefined> {
    const family = this.families?.familyOf(modelName);
    if (family === undefined) return undefined;

    const merged = new Map<number, DocElement>();
    for (const kind of ["MR", "NT"] as DocKind[]) {
      const index = await this.docIndex(kind, family);
      if (!index) continue;
      for (const el of index.elements) {
        const into = merged.get(el.id) ?? { id: el.id, label: el.label, docs: [] };
        // An element appears in both indexes and a document can be listed under
        // it more than once. The key includes the kind: an MR and an NT that
        // happen to share a number are different documents.
        const seen = new Set(into.docs.map((d) => `${d.kind}/${d.numero}`));
        for (const d of el.docs) {
          if (seen.has(`${d.kind}/${d.numero}`)) continue;
          if (spec && !documentApplies(d, this.docContextFor(spec))) continue;
          into.docs.push(d);
          seen.add(`${d.kind}/${d.numero}`);
        }
        if (into.label.length === 0 && el.label.length > 0) into.label = el.label;
        if (into.docs.length > 0) merged.set(el.id, into);
      }
    }
    const elements = [...merged.values()].sort(
      (a, b) => a.label.localeCompare(b.label) || a.id - b.id,
    );
    const total = elements.reduce((n, el) => n + el.docs.length, 0);
    return { family, elements, total };
  }

  /** Parsed index files, cached: each is a few hundred KB of XML. */
  private async docIndex(kind: DocKind, family: string): Promise<DocIndex | undefined> {
    const key = `${kind}/${family}`;
    const hit = this.docIndexes.get(key);
    if (hit !== undefined) return hit ?? undefined;
    const bytes = await this.source.readAll(docIndexPath(this.language, kind, family));
    const parsed = bytes ? DocIndex.parse(bytes, kind, family) : null;
    this.docIndexes.set(key, parsed);
    return parsed ?? undefined;
  }

  /**
   * What a vehicle answers for a documentation variable.
   *
   * The documentation prefixes its secondary variables with `$` (`$TYC`), which
   * the catalogue side does not, so both spellings are tried. Anything the
   * vehicle has not pinned down returns `undefined`, which `documentApplies`
   * reads as "no constraint" rather than "no match".
   */
  private docContextFor(spec: VehicleSpec): DocContext {
    return (variable: string) => {
      const bare = variable.startsWith("$") ? variable.slice(1) : variable;
      return spec.criteria[variable] ?? spec.criteria[bare] ?? undefined;
    };
  }

  /** Where a document's PDF lives, relative to the tree. */
  documentPath(doc: DocRef): string {
    return docPdfPath(this.language, doc.kind, doc.numero);
  }

  get names(): PartNames | undefined {
    return this.partNames;
  }

  get menuTree(): Menu | undefined {
    return this.menu;
  }

  nameOfPart(ref: PartRef): string | undefined {
    return this.partNames?.get(ref);
  }

  modelOf(pr: PrGroup): string | undefined {
    return this.models?.nameOf(pr, this.vocabulary);
  }

  /**
   * Models with their PR groups — the top of the original's identification
   * flow, and a far shorter list than 147 numeric groups.
   */
  async modelList(brandId?: string): Promise<ModelEntry[]> {
    const present = new Set(await this.prGroups());
    // A brand is a set of `MOD_` indices, so filtering happens on the index
    // rather than the name — the same index `ListePRModele` stores.
    const allowed = brandId
      ? new Set(this.brandList.find((b) => b.id === brandId)?.modelIndices ?? [])
      : undefined;
    const byName = new Map<string, ModelEntry>();
    for (const m of this.models?.all ?? []) {
      if (!present.has(m.pr)) continue;
      if (allowed && !allowed.has(m.modelIndex)) continue;
      const name = this.models?.nameOf(m.pr, this.vocabulary) ?? m.code;
      const entry = byName.get(name) ?? { name, code: m.code, prGroups: [] };
      entry.prGroups.push(m.pr);
      byName.set(name, entry);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Which assemblies actually yield plates for a vehicle.
   *
   * The original's `categorieVersTabOfNumPlanche` returns an empty list for an
   * assembly that does not apply, so the interface should not offer it as if it
   * did. For a Master II (`ED01`) only 89 of 154 assemblies have any plate —
   * "Complete engine" is one of the 65 that do not, because its plates list
   * sibling variants instead. Without this the user hunts blind through a menu
   * two thirds of which is empty.
   */
  async assemblyAvailability(
    pr: PrGroup,
    spec: VehicleSpec,
  ): Promise<Map<string, { plates: number; unknown: number }>> {
    const out = new Map<string, { plates: number; unknown: number }>();
    const ctx = await this.contextFor(spec);
    for (const code of await this.assembliesOf(pr)) {
      const a = await this.assembly(pr, code);
      if (!a) continue;
      const r = evaluateOrgane(a, ctx);
      out.set(code, { plates: r.plates.length, unknown: r.unknown.length });
    }
    return out;
  }

  /** Assemblies of a PR group, with labels and their place in the menu. */
  async assemblyList(pr: PrGroup): Promise<AssemblyEntry[]> {
    const codes = await this.assembliesOf(pr);
    return codes.map((code) => {
      const domain = this.menu?.domainOf(code);
      const section = this.menu?.sectionOf(code);
      return {
        code,
        label: this.menu?.labelOf(code),
        domain: domain?.code,
        domainLabel: domain?.label,
        section: section?.code,
        sectionLabel: section?.label,
      };
    });
  }

  /**
   * The three-level menu, restricted to assemblies this PR group actually has.
   *
   * Order follows the `menu` file rather than the codes, because that is the
   * order the original's lists are in.
   */
  async assemblyTree(pr: PrGroup): Promise<AssemblySection[]> {
    const have = new Map((await this.assemblyList(pr)).map((a) => [a.code, a]));
    const out: AssemblySection[] = [];
    for (const section of this.menu?.roots ?? []) {
      const domains: AssemblySection["domains"] = [];
      for (const domain of section.children) {
        const assemblies = domain.children
          .map((n) => have.get(n.code))
          .filter((a): a is AssemblyEntry => a !== undefined);
        if (assemblies.length > 0) {
          domains.push({ code: domain.code, label: domain.label, assemblies });
        }
      }
      if (domains.length > 0) out.push({ code: section.code, label: section.label, domains });
    }
    return out;
  }

  get criteria(): CriteriaVocabulary | undefined {
    return this.vocabulary;
  }

  get hasPlates(): boolean {
    return this.planches !== undefined;
  }

  get partSearch(): PartSearch | undefined {
    return this.refNumPr ? new PartSearch(this.refNumPr) : undefined;
  }

  get vehicles(): Envelope | undefined {
    return this.envelope;
  }

  /** Distinct PR groups that have plates. Derived from the index keys. */
  async prGroups(): Promise<PrGroup[]> {
    if (!this.planches) return [];
    const out = new Set<PrGroup>();
    for (let i = 0; i < this.planches.index1.count; i++) {
      out.add(decodeText(await this.planches.keyAt(i)).slice(0, 4));
    }
    return [...out].sort();
  }

  /** Plate names within a PR group. */
  async platesOf(pr: PrGroup): Promise<string[]> {
    if (!this.planches) return [];
    const out: string[] = [];
    for (const i of await this.planches.index1.findPrefix(encodeKey(pr))) {
      out.push(
        decodeText(await this.planches.keyAt(i))
          .trim()
          .slice(4),
      );
    }
    return out;
  }

  /** A PR group's value table, cached. `undefined` when the group has none. */
  async valuesFor(pr: PrGroup): Promise<GroupValues | undefined> {
    if (this.groupValues.has(pr)) return this.groupValues.get(pr);
    let parsed: GroupValues | undefined;
    // The importer leaves group data as `pr/<group>.zip`; a caller that has
    // already unpacked it can also expose `pr/<group>/ListeVarVal`.
    const loose = await this.source.readAll(`pr/${pr}/ListeVarVal`);
    if (loose) parsed = GroupValues.parse(loose);
    this.groupValues.set(pr, parsed);
    return parsed;
  }

  /** Seed a group's value table from outside — used when it comes from a zip. */
  setGroupValues(pr: PrGroup, values: GroupValues | undefined): void {
    this.groupValues.set(pr, values);
  }

  /** The `Dates` record for one build group of a vehicle, cached. */
  async datesFor(group: DateGroup, spec: VehicleSpec): Promise<DateBlock | undefined> {
    const key = datesKey(group, spec);
    if (key === undefined || !this.datesRaf) return undefined;
    if (this.dateBlocks.has(key)) return this.dateBlocks.get(key);
    let block: DateBlock | undefined;
    const recs = await this.datesRaf.get(encodeKey(key));
    const first = recs?.[0];
    if (first) block = DateBlock.parse(first);
    this.dateBlocks.set(key, block);
    return block;
  }

  /** Build the evaluation context for a vehicle, loading what it needs. */
  async contextFor(spec: VehicleSpec): Promise<VehicleContext> {
    const dates: Partial<Record<DateGroup, DateBlock>> = {};
    for (const group of ["dveh", "dmot", "dbvi"] as const) {
      const b = await this.datesFor(group, spec);
      if (b) dates[group] = b;
    }
    return new VehicleContext(spec, {
      values: await this.valuesFor(spec.pr),
      vocabulary: this.vocabulary,
      dates,
    });
  }

  /** Callout positions for a drawing, when `TRepere` is present. */
  async reperePositions(drawing: string): Promise<Map<number, Repere>> {
    const out = new Map<number, Repere>();
    if (!this.trepere) return out;
    const recs = await this.trepere.get(repereKey(drawing));
    const first = recs?.[0];
    if (!first) return out;
    for (const r of parseReperes(first)) out.set(r.repere, r);
    return out;
  }

  /**
   * A plate resolved for a vehicle: which parts fit, which are undecided, and
   * what would have to be answered to decide them.
   */
  async plate(
    pr: PrGroup,
    plate: string,
    spec: VehicleSpec,
    drawing?: string,
  ): Promise<ResolvedPlate | undefined> {
    if (!this.planches) return undefined;
    const key = pr + plate;
    const recs = await this.planches.get(encodeKey(key));
    const first = recs?.[0];
    if (!first) return undefined;

    const parsed = parsePlate(first);
    const ctx = await this.contextFor(spec);
    // Callout positions are keyed by the *drawing* number, not the plate name.
    const positions = drawing ? await this.reperePositions(drawing) : new Map<number, Repere>();

    const values = await this.valuesFor(pr);
    const describeOpts = { values, vocabulary: this.vocabulary };
    const describe = (c: EvaluatedCandidate): DescribedCandidate => ({
      ...c,
      name: this.partNames?.get(c.ref),
      conditionLines: c.applicability ? describeBloc(c.applicability, describeOpts).lines : [],
    });

    const questions = new Set<CriterionCode>();
    const reperes: ResolvedRepere[] = parsed.reperes.map((r) => {
      const { applies, unknown } = evaluateRepere(r, ctx);
      for (const cand of unknown) {
        if (!cand.applicability) continue;
        for (const l of cand.applicability.lignes) {
          for (const e of l.elems) {
            // Only ask about criteria the vehicle has not answered.
            if (spec.criteria[e.variable] === undefined) questions.add(e.variable);
          }
        }
      }
      const pos = positions.get(r.repere);
      return {
        repere: r.repere,
        position: pos ? { x: pos.x, y: pos.y } : undefined,
        fits: applies.map(describe),
        unknown: unknown.map(describe),
      };
    });

    // Date and build-number views are deliberately *not* offered as value
    // pickers. Their "values" are hundreds of raw event labels
    // (`000119`, `MOD0311`, ...) — `NFAB` alone lists over 400 — and the
    // original does not ask you to choose one either: it asks for a factory
    // and a build number, which is what the interface's own two controls are
    // for. Offering the list invites an answer that means nothing.
    const questionOptions = [...questions]
      .filter((code) => !isDateVariable(code))
      .map((code) => ({
        code,
        label: this.vocabulary?.get(code)?.label || code,
        values: [...(values?.valuesFor(code, this.vocabulary) ?? [])].filter((v) => v.length > 0),
      }));

    /** Date criteria that are still open, for the "enter a build number" nudge. */
    const dateQuestions = [...questions].filter((code) => isDateVariable(code));

    return {
      key,
      pr,
      plate,
      drawing,
      drawingPath: drawing ? drawingPath(drawing) : undefined,
      reperes,
      questions: [...questions],
      questionOptions,
      dateQuestions,
      raw: parsed,
    };
  }

  // ---- assemblies --------------------------------------------------------

  /** Assembly codes in a PR group, from the `Organes` index keys. */
  async assembliesOf(pr: PrGroup): Promise<string[]> {
    if (!this.organes) return [];
    const out: string[] = [];
    for (const i of await this.organes.index1.findPrefix(encodeKey(pr))) {
      out.push(
        decodeText(await this.organes.keyAt(i))
          .trim()
          .slice(4),
      );
    }
    return out;
  }

  async assembly(pr: PrGroup, organe: string): Promise<Organe | undefined> {
    if (!this.organes) return undefined;
    const recs = await this.organes.get(encodeKey(organeKey(pr, organe)));
    const first = recs?.[0];
    return first ? parseOrgane(first) : undefined;
  }

  /**
   * The plates an assembly shows for a vehicle, each with its drawing number.
   *
   * This is the navigation step that makes a plate renderable: without it there
   * is no drawing number and so no image and no callout positions.
   */
  async assemblyPlates(
    pr: PrGroup,
    organe: string,
    spec: VehicleSpec,
  ): Promise<{ plates: OrganePlate[]; unknown: OrganePlate[] }> {
    const a = await this.assembly(pr, organe);
    if (!a) return { plates: [], unknown: [] };
    return evaluateOrgane(a, await this.contextFor(spec));
  }

  /** Vehicles (envelope rows) for a PR group. */
  async vehiclesOf(pr: PrGroup): Promise<VehicleSpec[]> {
    const rows = (await this.envelope?.byPr(pr)) ?? [];
    return rows.map((e) => ({
      pr: e.pr,
      type: e.type,
      criteria: {
        TYP_: e.type,
        NEQT: e.neqt,
        EQPT: e.eqpt,
        MOT3: e.mot3,
        MOTI: e.moti,
        BVI3: e.bvi3,
      },
    }));
  }

  /** PR groups containing a part reference. */
  async groupsForPart(ref: PartRef): Promise<PrGroup[] | undefined> {
    return this.partSearch?.groupsFor(ref);
  }

  async close(): Promise<void> {
    await Promise.all(
      [this.planches, this.organes, this.refNumPr, this.trepere, this.datesRaf].map((r) =>
        r?.close(),
      ),
    );
  }
}

export type { VehicleSpec, VehicleType };
