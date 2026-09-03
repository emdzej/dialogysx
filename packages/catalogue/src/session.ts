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
import { DateBlock, type DateGroup } from "./dates.js";
import { findDataset } from "./datasets.js";
import { Disc, type FileSource } from "./disc.js";
import { Envelope, parseEnvelopeRecord } from "./envelope.js";
import { PartSearch } from "./part-search.js";
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
import { GroupValues } from "./values.js";
import { datesKey, VehicleContext, type VehicleSpec } from "./vehicle.js";

/** One callout, ready to render: its position on the drawing and its parts. */
/** An evaluated candidate plus its condition rendered into words. */
export interface DescribedCandidate extends EvaluatedCandidate {
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
  /** Criteria the undecided conditions depend on — what to ask the user. */
  questions: CriterionCode[];
  raw: Plate;
}

export interface SessionOptions {
  /** Language directory under `langue/`. */
  language?: string;
}

export class CatalogueSession {
  private readonly disc: Disc;
  private readonly groupValues = new Map<PrGroup, GroupValues | undefined>();
  private readonly dateBlocks = new Map<string, DateBlock | undefined>();
  private vocabulary?: CriteriaVocabulary;

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
    const s = new CatalogueSession(source, opts.language ?? "fr");
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

    const vocabBytes = await source.readAll(`langue/${s.language}/classicvar.utf`);
    if (vocabBytes) s.vocabulary = CriteriaVocabulary.parse(vocabBytes);
    return s;
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

    return {
      key,
      pr,
      plate,
      drawing,
      drawingPath: drawing ? drawingPath(drawing) : undefined,
      reperes,
      questions: [...questions],
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
