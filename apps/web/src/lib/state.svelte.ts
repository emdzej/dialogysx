/**
 * Application state: one open catalogue, one selected vehicle, one plate.
 *
 * Svelte 5 runes. Everything derived from the session lives here so the
 * components stay presentational — the interesting logic is all in
 * `@dialogysx/catalogue`.
 */
import {
  CatalogueSession,
  type CriteriaVocabulary,
  type FileSource,
  type OrganePlate,
  type ResolvedPlate,
  type VehicleSpec,
} from "@dialogysx/catalogue";
import type { PrGroup } from "@dialogysx/core";

export type Status =
  | { kind: "idle" }
  | { kind: "loading"; what: string }
  | { kind: "ready"; from: string }
  | { kind: "error"; message: string };

export class AppState {
  status = $state<Status>({ kind: "idle" });
  session = $state<CatalogueSession | undefined>(undefined);

  groups = $state<PrGroup[]>([]);
  group = $state<PrGroup | undefined>(undefined);

  vehicles = $state<VehicleSpec[]>([]);
  vehicle = $state<VehicleSpec | undefined>(undefined);

  assemblies = $state<string[]>([]);
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

  /** The vehicle plus whatever the user has answered. */
  get effectiveVehicle(): VehicleSpec | undefined {
    if (!this.vehicle) return undefined;
    return { ...this.vehicle, criteria: { ...this.vehicle.criteria, ...this.answers } };
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
      this.status = { kind: "loading", what: "reading PR groups" };
      this.groups = await session.prGroups();
      this.status = { kind: "ready", from: label };
      // Nothing is selected yet: a 41,758-plate catalogue should not guess.
    } catch (e) {
      this.status = { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
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
    this.assemblies = await s.assembliesOf(pr);
  }

  async selectVehicle(v: VehicleSpec): Promise<void> {
    this.vehicle = v;
    this.answers = {};
    this.plate = undefined;
    if (this.assembly) await this.selectAssembly(this.assembly);
  }

  async selectAssembly(organe: string): Promise<void> {
    const s = this.session;
    const v = this.effectiveVehicle;
    if (!s || !this.group) return;
    this.assembly = organe;
    this.plate = undefined;
    if (!v) {
      this.assemblyPlates = [];
      this.assemblyUnknown = [];
      return;
    }
    const r = await s.assemblyPlates(this.group, organe, v);
    this.assemblyPlates = r.plates;
    this.assemblyUnknown = r.unknown;
  }

  async selectPlate(p: OrganePlate): Promise<void> {
    const s = this.session;
    const v = this.effectiveVehicle;
    if (!s || !this.group || !v) return;
    this.hoveredRepere = undefined;
    this.pinnedRepere = undefined;
    this.plate = await s.plate(this.group, p.plate, v, p.drawing);
  }

  /** Answer a criterion question and re-evaluate what is showing. */
  async answer(code: string, value: string): Promise<void> {
    this.answers = { ...this.answers, [code]: value };
    if (this.assembly) await this.selectAssembly(this.assembly);
    const p = this.plate;
    if (p) {
      const s = this.session;
      const v = this.effectiveVehicle;
      if (s && this.group && v) this.plate = await s.plate(this.group, p.plate, v, p.drawing);
    }
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

  clearAnswer(code: string): void {
    const { [code]: _dropped, ...rest } = this.answers;
    this.answers = rest;
  }
}

export const app = new AppState();
