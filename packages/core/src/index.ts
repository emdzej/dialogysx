/**
 * Shared types for the Dialogys catalogue format.
 *
 * Terminology follows the original application, which is French, because the
 * data uses those names as keys and renaming them here would only add a
 * translation layer to get wrong. See `docs/data-format.md`.
 */

/** 4-digit parts-catalogue group, e.g. `"1132"`. The original calls this `numPR`. */
export type PrGroup = string;

/** 4-character vehicle type, e.g. `"U75B"`, `"L48E"`. */
export type VehicleType = string;

/** 10-character part reference, e.g. `"6001548001"`. */
export type PartRef = string;

/** `PR(4) + plateName(7)`, e.g. `"0202N100110"` — the `Planches.dat` key. */
export type PlateKey = string;

/** `PR(4) + organe(5)`, e.g. `"02021010A"` — the `Organes.dat` key. */
export type OrganeKey = string;

/**
 * A criterion code from the vehicle-criteria vocabulary: `MOT3`, `AIRC`,
 * `TYP_`, `MILL`, `XCAR`, ... Always 4 characters, space- or underscore-padded
 * in the data.
 */
export type CriterionCode = string;

/**
 * One entry of `langue/<lg>/classicvar.utf`.
 *
 * `values` is positional and load-bearing: the operands in plate condition
 * trees are **indices into this array**, not labels. See `data-format.md` §3.7.
 */
export interface Criterion {
  code: CriterionCode;
  /** The single-letter kind field. Observed values: `T`. */
  kind: string;
  /** Display label, e.g. "Anti-blocage de roues". */
  label: string;
  /** The label phrased as a question, used when prompting the user. */
  question: string;
  /** Enumerated values, in the order the data indexes them. */
  values: string[];
}

/**
 * One `enveloppe` record: the seven TAB-separated fields whose order is fixed
 * by `UtilEnveloppe.INDICE_*` (`NBVARS = 7`).
 */
export interface EnvelopeRecord {
  pr: PrGroup;
  type: VehicleType;
  /** `NEQT` — equipment level. NUL-padded in the data. */
  neqt: string;
  /** `EQPT` — equipment code. */
  eqpt: string;
  /** `MOT3` — 3-character engine code, e.g. `"B1B"`. */
  mot3: string;
  /** `MOTI` — engine index, e.g. `"705"`. */
  moti: string;
  /** `BVI3` — 3-character gearbox code, e.g. `"HA0"`. */
  bvi3: string;
}

/** A callout on a drawing: `TRepere.dat` maps a drawing to a list of these. */
export interface Repere {
  /** The number printed on the drawing next to the part. */
  repere: number;
  x: number;
  y: number;
}

/**
 * A part as listed on a plate: the callout number plus the reference, with the
 * applicability condition that governs whether it is shown for a given vehicle.
 */
export interface PlatePart {
  repere: number;
  ref: PartRef;
  /**
   * The 8-byte applicability mask that precedes the reference. Carried through
   * verbatim: its semantics are **not yet specified** (`data-format.md` §7), so
   * it is deliberately not interpreted here.
   */
  mask: Uint8Array;
}

/** The vehicle attributes a condition tree is evaluated against. */
export type VehicleCriteria = Readonly<Record<CriterionCode, string>>;
