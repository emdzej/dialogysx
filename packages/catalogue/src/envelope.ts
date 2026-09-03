/**
 * The vehicle envelope — `docs/data-format.md` §3.5.
 *
 * One data file, four indexes into it. The field order is fixed by
 * `UtilEnveloppe.INDICE_*` with `NBVARS = 7`.
 */
import type { EnvelopeRecord, PrGroup, VehicleType } from "@dialogysx/core";
import {
  decodeText,
  encodeKey,
  IndexedRAF,
  splitFields,
  splitRecords,
  trimPadding,
} from "@dialogysx/raf";

export function parseEnvelopeRecord(bytes: Uint8Array): EnvelopeRecord | undefined {
  // Records carry a trailing LF; take the first line and split on TAB.
  const line = splitRecords(decodeText(bytes))[0];
  if (line === undefined) return undefined;
  const f = splitFields(line).map(trimPadding);
  if (f.length < 7) return undefined;
  return {
    pr: f[0]!,
    type: f[1]!,
    neqt: f[2]!,
    eqpt: f[3]!,
    mot3: f[4]!,
    moti: f[5]!,
    bvi3: f[6]!,
  };
}

function parseAll(records: readonly Uint8Array[]): EnvelopeRecord[] {
  const out: EnvelopeRecord[] = [];
  for (const r of records) {
    const p = parseEnvelopeRecord(r);
    if (p) out.push(p);
  }
  return out;
}

/**
 * The four access paths onto `enveloppe`. Each index is optional so a caller
 * can open only what it needs — they are separate files.
 */
export class Envelope {
  constructor(
    private readonly indexes: {
      prType?: IndexedRAF;
      typePr?: IndexedRAF;
      engine?: IndexedRAF;
      gearbox?: IndexedRAF;
    },
  ) {}

  /** Every envelope row for a PR group, optionally narrowed to one type. */
  async byPr(pr: PrGroup, type?: VehicleType): Promise<EnvelopeRecord[]> {
    const idx = this.require("prType");
    const probe = encodeKey(type === undefined ? pr : pr + type);
    return parseAll(await idx.getPrefix(probe));
  }

  /** Every envelope row for a vehicle type, optionally narrowed to one PR group. */
  async byType(type: VehicleType, pr?: PrGroup): Promise<EnvelopeRecord[]> {
    const idx = this.require("typePr");
    const probe = encodeKey(pr === undefined ? type : type + pr);
    return parseAll(await idx.getPrefix(probe));
  }

  /** Rows for a 3-character engine code (the `MOT3` field). */
  async byEngine(mot3: string): Promise<EnvelopeRecord[]> {
    return parseAll(await this.require("engine").getPrefix(encodeKey(mot3)));
  }

  /** Rows for a 3-character gearbox code (the `BVI3` field). */
  async byGearbox(bvi3: string): Promise<EnvelopeRecord[]> {
    return parseAll(await this.require("gearbox").getPrefix(encodeKey(bvi3)));
  }

  private require(which: keyof Envelope["indexes"]): IndexedRAF {
    const idx = this.indexes[which];
    if (!idx) throw new Error(`envelope: the ${which} index was not opened`);
    return idx;
  }
}

/**
 * `typesvin` — vehicle type substitutions. CR-separated records of
 * TAB-separated fields, the first being the type and the rest comma-separated
 * substitute lists.
 */
export function parseTypesVin(bytes: Uint8Array): Map<VehicleType, string[][]> {
  const out = new Map<VehicleType, string[][]>();
  for (const line of splitRecords(decodeText(bytes))) {
    if (line.length === 0) continue;
    const f = splitFields(line);
    const type = f[0];
    if (type === undefined || type.length === 0) continue;
    out.set(
      type,
      f.slice(1).map((g) => g.split(",").filter((s) => s.length > 0)),
    );
  }
  return out;
}
