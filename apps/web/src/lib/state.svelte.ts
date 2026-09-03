/**
 * Application state: one open catalogue, one selected vehicle, one plate.
 *
 * Svelte 5 runes. Everything derived from the session lives here so the
 * components stay presentational — the interesting logic is all in
 * `@dialogysx/catalogue`.
 */
import {
  CatalogueSession,
  type AssemblyEntry,
  type Brand,
  type CriteriaVocabulary,
  type FileSource,
  type ModelEntry,
  type OrganePlate,
  type ResolvedPlate,
  type VehicleSpec,
} from "@dialogysx/catalogue";
import type { PrGroup } from "@dialogysx/core";
import { Generations } from "./generation.js";

export type Status =
  | { kind: "idle" }
  | { kind: "loading"; what: string }
  | { kind: "ready"; from: string }
  | { kind: "error"; message: string };

export class AppState {
  status = $state<Status>({ kind: "idle" });
  session = $state<CatalogueSession | undefined>(undefined);

  /**
   * Identification is model-first, like the original's Identite screen.
   *
   * 147 numeric PR groups is not a vehicle list; "Twingo" and "Master I" are.
   * A model maps to one or more PR groups, and picking a vehicle picks the
   * group with it.
   */
  /**
   * Brand comes before model, as in the original.
   *
   * A brand is a set of `MOD_` indices read from `pr/ListeDoc<Brand>`: Renault
   * lists 76 models, Dacia 3. Without it the model list mixes both marques.
   */
  brands = $state<readonly Brand[]>([]);
  brand = $state<Brand | undefined>(undefined);

  models = $state<ModelEntry[]>([]);
  model = $state<ModelEntry | undefined>(undefined);

  groups = $state<PrGroup[]>([]);
  group = $state<PrGroup | undefined>(undefined);

  vehicles = $state<VehicleSpec[]>([]);
  vehicle = $state<VehicleSpec | undefined>(undefined);

  assemblies = $state<AssemblyEntry[]>([]);
  /** Per assembly: how many plates it yields for the selected vehicle. */
  availability = $state<Map<string, { plates: number; unknown: number }>>(new Map());
  /** Hide assemblies with nothing for this vehicle. On by default. */
  onlyAvailable = $state(true);
  assembly = $state<string | undefined>(undefined);

  assemblyPlates = $state<OrganePlate[]>([]);
  assemblyUnknown = $state<OrganePlate[]>([]);

  plate = $state<ResolvedPlate | undefined>(undefined);

  /**
   * Hover and pin are separate, and conflating them is a bug I shipped once.
   *
   * With one field, `onmouseenter` set it and the following `click` compared
   * against the value hover had just written, so clicking a hotspot toggled it
   * straight back off. Hover is transient highlight; a click pins so the mouse
   * can leave.
   */
  hoveredRepere = $state<number | undefined>(undefined);
  pinnedRepere = $state<number | undefined>(undefined);

  /** Criterion answers the user has supplied on top of the envelope row. */
  answers = $state<Record<string, string>>({});

  /**
   * Which request is allowed to write to `plate` — see `generation.ts` for the
   * failure it prevents.
   *
   * Each action claims a generation on entry and only commits while it is still
   * the newest. Nested calls are passed the caller's generation rather than
   * claiming their own, or the outer call would invalidate itself.
   */
  private generations = new Generations();

  private claim(): number {
    return this.generations.claim();
  }

  private stale(gen: number): boolean {
    return this.generations.stale(gen);
  }

  /**
   * Factory and build number — the original's own way of narrowing a catalogue.
   *
   * Not decoration. Roughly 28.7 % of part candidates hang on an ordered
   * comparison against a build date or number (`MILL`, `NFAB`, ...), and
   * without these every one of them resolves to *undecided*. Supplying a build
   * number is what turns "cannot tell" into an answer.
   */
  factory = $state<string>("");
  buildNumber = $state<string>("");
  /** Factories the Dates record lists for the selected vehicle. */
  factories = $state<string[]>([]);

  /** What is highlighted: a pin wins over a hover. */
  get activeRepere(): number | undefined {
    return this.pinnedRepere ?? this.hoveredRepere;
  }

  hover(repere: number | undefined): void {
    this.hoveredRepere = repere;
  }

  /** Click: pin it, or unpin if it was already pinned. */
  pin(repere: number): void {
    this.pinnedRepere = this.pinnedRepere === repere ? undefined : repere;
  }

  get vocabulary(): CriteriaVocabulary | undefined {
    return this.session?.criteria;
  }

  /**
   * The vehicle plus everything the user has supplied.
   *
   * Factory and build number go in twice on purpose: as criteria, because
   * `UVEH` and `NFAB` are compared like any other criterion, and as
   * `buildNumbers.dveh`, because `VarDate.resolveDate` needs the factory letter
   * and the number together (`"K0000412"`) to compare against the `Dates` table.
   */
  get effectiveVehicle(): VehicleSpec | undefined {
    if (!this.vehicle) return undefined;
    const criteria: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.vehicle.criteria)) {
      if (v !== undefined) criteria[k] = v;
    }
    Object.assign(criteria, this.answers);
    const nfab = this.buildNumber.trim();
    const usine = this.factory.trim();
    if (usine) criteria.UVEH = usine;
    if (nfab) criteria.NFAB = nfab;
    const buildNumbers =
      usine && nfab
        ? { ...this.vehicle.buildNumbers, dveh: usine + nfab }
        : this.vehicle.buildNumbers;
    return { ...this.vehicle, criteria, buildNumbers };
  }

  /** Languages the tree carries, from its manifest. */
  languages = $state<string[]>([]);
  language = $state<string>("fr");

  /**
   * Pick a language the tree actually has.
   *
   * `manifest.json` lists them because HTTP cannot list a directory. Defaulting
   * blindly to `fr` against an English-only import finds no `classicvar.utf`,
   * and every criterion then renders as a bare code — which looks like a
   * parsing bug rather than a missing file.
   */
  private async pickLanguage(source: FileSource, wanted?: string): Promise<string> {
    const bytes = await source.readAll("manifest.json").catch(() => undefined);
    let available: string[] = [];
    if (bytes) {
      try {
        const m = JSON.parse(new TextDecoder().decode(bytes)) as {
          catalogueLanguages?: string[];
        };
        available = m.catalogueLanguages ?? [];
      } catch {
        // A malformed manifest is not fatal; fall through to the default.
      }
    }
    this.languages = available;
    if (wanted && available.includes(wanted)) return wanted;
    const browser = navigator.language.slice(0, 2).toLowerCase();
    if (available.includes(browser)) return browser;
    return available[0] ?? wanted ?? "fr";
  }

  async open(source: FileSource, label: string, wanted?: string): Promise<void> {
    this.status = { kind: "loading", what: `opening ${label}` };
    try {
      const language = await this.pickLanguage(source, wanted);
      this.language = language;
      const session = await CatalogueSession.open(source, { language });
      if (!session.hasPlates) {
        this.status = {
          kind: "error",
          message:
            `No parts catalogue at ${label}. Point this at the directory that ` +
            `contains pr/, enveloppe/ and dessins/.`,
        };
        return;
      }
      this.session = session;
      this.status = { kind: "loading", what: "reading models" };
      this.groups = await session.prGroups();
      this.brands = session.brands;
      // With one brand there is nothing to choose, so choose it.
      this.brand = this.brands.length === 1 ? this.brands[0] : undefined;
      this.models = await session.modelList(this.brand?.id);
      this.status = { kind: "ready", from: label };
      // Nothing is selected yet: a 41,758-plate catalogue should not guess.
    } catch (e) {
      this.status = { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Pick a brand: narrow the model list to its `MOD_` indices. */
  async selectBrand(b: Brand): Promise<void> {
    const s = this.session;
    if (!s) return;
    this.brand = b;
    this.model = undefined;
    this.vehicle = undefined;
    this.group = undefined;
    this.assembly = undefined;
    this.plate = undefined;
    this.vehicles = [];
    this.assemblies = [];
    this.assemblyPlates = [];
    this.assemblyUnknown = [];
    this.availability = new Map();
    this.answers = {};
    this.models = await s.modelList(b.id);
  }

  /** Pick a model: load every vehicle across all its PR groups. */
  async selectModel(m: ModelEntry): Promise<void> {
    const s = this.session;
    if (!s) return;
    this.model = m;
    this.group = undefined;
    this.vehicle = undefined;
    this.assembly = undefined;
    this.plate = undefined;
    this.answers = {};
    this.assemblies = [];
    this.assemblyPlates = [];
    // Deduplicate on the full envelope key. Rows are distinct within one PR
    // group, but a model spans several and the same specification recurs —
    // Clio came to 6,753 entries with visible repeats before this.
    const seen = new Set<string>();
    const all: VehicleSpec[] = [];
    for (const pr of m.prGroups) {
      for (const v of await s.vehiclesOf(pr)) {
        const c = v.criteria;
        const key = [v.pr, c.TYP_, c.NEQT, c.EQPT, c.MOT3, c.MOTI, c.BVI3].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(v);
      }
    }
    this.vehicles = all;
  }

  async selectGroup(pr: PrGroup): Promise<void> {
    const s = this.session;
    if (!s) return;
    this.group = pr;
    this.vehicle = undefined;
    this.assembly = undefined;
    this.plate = undefined;
    this.answers = {};
    this.assemblyPlates = [];
    this.vehicles = await s.vehiclesOf(pr);
    this.assemblies = await s.assemblyList(pr);
  }

  /**
   * Pick a vehicle. Its PR group comes with it, which is what makes the
   * model-first flow work: the group is a consequence of the vehicle, not a
   * separate choice the user has to understand.
   */
  async selectVehicle(v: VehicleSpec): Promise<void> {
    const s = this.session;
    const gen = this.claim();
    this.vehicle = v;
    this.answers = {};
    this.plate = undefined;
    // Offer only the factories this vehicle was actually built at.
    const block = await s?.datesFor("dveh", v);
    this.factories = block?.factories ?? [];
    // Default to the only factory when there is one. A build number is
    // useless without it — `resolveDate` compares `factory + number` against
    // the Dates table — and leaving it on "any" made an entered build number
    // look ignored.
    this.factory = this.factories.length === 1 ? (this.factories[0] ?? "") : "";
    this.buildNumber = "";
    if (s && v.pr !== this.group) {
      this.group = v.pr;
      this.assembly = undefined;
      this.assemblies = await s.assemblyList(v.pr);
      this.assemblyPlates = [];
      this.assemblyUnknown = [];
      this.availability =
        (await s?.assemblyAvailability(v.pr, this.effectiveVehicle ?? v)) ?? new Map();
      return;
    }
    this.availability =
      (await s?.assemblyAvailability(v.pr, this.effectiveVehicle ?? v)) ?? new Map();
    if (this.assembly) await this.applyAssembly(this.assembly, gen);
  }

  /** Assemblies grouped by domain, for a navigable list. */
  /** Label of the selected assembly, for the plate heading. */
  get assemblyLabel(): string | undefined {
    if (!this.assembly) return undefined;
    const a = this.assemblies.find((x) => x.code === this.assembly);
    return a?.label;
  }

  /**
   * Assemblies that have something for the selected vehicle.
   *
   * The original's `categorieVersTabOfNumPlanche` returns nothing for an
   * assembly that does not apply, so offering it is misleading. For a Master II
   * (`ED01`) only 89 of 154 assemblies yield a plate — "Complete engine" is one
   * of the 65 that do not, because its plates list sibling variants. Without
   * this you hunt blind through a menu two thirds of which is empty.
   */
  get visibleAssemblies(): AssemblyEntry[] {
    if (!this.onlyAvailable || this.availability.size === 0) return this.assemblies;
    return this.assemblies.filter((a) => {
      const av = this.availability.get(a.code);
      return av === undefined || av.plates > 0 || av.unknown > 0;
    });
  }

  get hiddenAssemblyCount(): number {
    return this.assemblies.length - this.visibleAssemblies.length;
  }

  get assembliesByDomain(): { domain: string; label: string; items: AssemblyEntry[] }[] {
    const out = new Map<string, { domain: string; label: string; items: AssemblyEntry[] }>();
    for (const a of this.visibleAssemblies) {
      const key = a.domain ?? "?";
      const entry = out.get(key) ?? { domain: key, label: a.domainLabel ?? key, items: [] };
      entry.items.push(a);
      out.set(key, entry);
    }
    return [...out.values()];
  }

  async selectAssembly(organe: string): Promise<void> {
    await this.applyAssembly(organe, this.claim());
  }

  /**
   * @param keepOpen re-evaluating the assembly already on screen, so the plate
   * stays visible while it is recomputed. Clearing it unconditionally blanked
   * the drawing, the parts table and the criterion questions for as long as the
   * lookup took — and anyone answering a question in that gap was clicking on
   * controls that had just been removed.
   */
  private async applyAssembly(organe: string, gen: number, keepOpen = false): Promise<void> {
    const s = this.session;
    const v = this.effectiveVehicle;
    if (!s || !this.group) return;
    this.assembly = organe;
    if (!keepOpen) this.plate = undefined;
    if (!v) {
      this.assemblyPlates = [];
      this.assemblyUnknown = [];
      return;
    }
    const r = await s.assemblyPlates(this.group, organe, v);
    if (this.stale(gen)) return;
    this.assemblyPlates = r.plates;
    this.assemblyUnknown = r.unknown;
    // Narrowing can drop the open plate from the assembly entirely; then it is
    // no longer showing anything true and has to go.
    const open = this.plate;
    if (open && ![...r.plates, ...r.unknown].some((x) => x.plate === open.plate)) {
      this.plate = undefined;
    }

    // Auto-open when there is exactly one plate, which is the common case:
    // measured against a real vehicle, 67 % of assemblies in PR 1132 resolve
    // to a single plate (38 % in PR 1260). That is why the original appears to
    // have no plate step — there is usually nothing to choose.
    //
    // Counting *undecided* plates too, not just the ones that fit. An assembly
    // whose only plate is undecided was otherwise unreachable: nothing opened,
    // and the plate combobox hides itself below two entries.
    const all = [...r.plates, ...r.unknown];
    const only = all.length === 1 ? all[0] : undefined;
    if (only && only.plate !== this.plate?.plate) await this.applyPlate(only, gen);
  }

  async selectPlate(p: OrganePlate): Promise<void> {
    await this.applyPlate(p, this.claim());
  }

  private async applyPlate(p: OrganePlate, gen: number): Promise<void> {
    const s = this.session;
    const v = this.effectiveVehicle;
    if (!s || !this.group || !v) return;
    this.hoveredRepere = undefined;
    this.pinnedRepere = undefined;
    const resolved = await s.plate(this.group, p.plate, v, p.drawing);
    if (this.stale(gen)) return;
    this.plate = resolved;
  }

  /** Answer a criterion question and re-evaluate what is showing. */
  async answer(code: string, value: string): Promise<void> {
    this.answers = { ...this.answers, [code]: value };
    await this.reevaluate(this.claim());
  }

  /** Reopen the same source in another language. */
  async reopen(language: string): Promise<void> {
    const source = this.session?.source;
    const label = this.status.kind === "ready" ? this.status.from : "tree";
    if (!source) return;
    const group = this.group;
    await this.open(source, label, language);
    if (group) await this.selectGroup(group);
  }

  /** How many part candidates on the open plate could be decided. */
  get decidedCount(): number {
    return (this.plate?.reperes ?? []).reduce((n, r) => n + r.fits.length, 0);
  }

  /**
   * How many could not.
   *
   * Surfaced in the chrome because it is the honest measure of how well the
   * vehicle is identified: it falls as the factory, build number and criteria
   * are supplied.
   */
  get undecidedCount(): number {
    return (this.plate?.reperes ?? []).reduce((n, r) => n + r.unknown.length, 0);
  }

  /** Re-evaluate after the factory or build number changes. */
  async refine(): Promise<void> {
    await this.reevaluate(this.claim());
  }

  /**
   * Re-run the open assembly and plate against the current specification.
   *
   * Reads `effectiveVehicle` *after* `applyAssembly`, not before: the plate has
   * to be resolved against the same specification the assembly was, and the
   * earlier version captured it up front while the nested call re-read it.
   */
  private async reevaluate(gen: number): Promise<void> {
    const s = this.session;
    if (!s || !this.group) return;
    if (this.assembly) await this.applyAssembly(this.assembly, gen, true);
    if (this.stale(gen)) return;
    const p = this.plate;
    const v = this.effectiveVehicle;
    if (!p || !v) return;
    const resolved = await s.plate(this.group, p.plate, v, p.drawing);
    if (this.stale(gen)) return;
    this.plate = resolved;
  }

  clearAnswer(code: string): void {
    const { [code]: _dropped, ...rest } = this.answers;
    this.answers = rest;
  }
}

export const app = new AppState();
