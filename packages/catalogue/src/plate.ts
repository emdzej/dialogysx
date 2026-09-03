/**
 * A `Planches.dat` record: the parts on one plate, each with its applicability.
 *
 * Transcribed from `dialogys.pr.PRFactory.newCondPlanche` and its helpers
 * (`addDansHVarLocales`, `newTCondBloc`, `newTConsBloc`, `newVTRefRpl`).
 * See `docs/data-format.md` §3.1.
 *
 * The shape that matters: conditions are **pooled once per record** and every
 * part refers to them by index, with a negative index meaning "no condition".
 * That is why a record starts with several zero shorts — they are pool sizes,
 * not flags.
 */
import type { PartRef } from "@dialogysx/core";
import { DataCursor } from "@dialogysx/raf";
import {
  evalCondBloc,
  readCondBlocPool,
  type CondBloc,
  type ConditionContext,
  type Troolean,
} from "./conditions.js";

/** A reference with a quantity, from a `ConsLign` (`RefQte`). */
export interface RefQte {
  ref: PartRef;
  /** Stored as a `readShort`, used as a float by the original. */
  quantity: number;
}

/** One line of a "consigne" block: a condition and the references it selects. */
export interface ConsLign {
  /** Index into the condition pool, or `undefined` when negative. */
  condition?: CondBloc;
  refs: RefQte[];
}

export interface ConsBloc {
  lignes: ConsLign[];
}

/**
 * A local variable declared by the record: a name plus the subset of the PR
 * group's value indices it can take (`addDansHVarLocales`).
 */
export interface LocalVariable {
  name: string;
  indices: number[];
}

/**
 * One candidate part for one callout.
 *
 * `CondRefPi` in the original. Two conditions, and they mean different things:
 *
 * - `applicability` (`noCondBlocRV`) decides whether the part fits at all.
 * - `codedSign` (`noCondBlocSC`) does **not** filter. When several candidates
 *   survive and any has one, `CondPlanche.askSignCod` asks the user to choose
 *   between them. Treating it as a filter would drop legitimate variants.
 */
export interface PlateCandidate {
  ref: PartRef;
  applicability?: CondBloc;
  codedSign?: CondBloc;
  /** Superseding references (`tRefRpl`), if any. */
  replacements?: PartRef[];
  consAEP?: ConsBloc;
  consPPS?: ConsBloc;
  /**
   * Set when this candidate's applicability index pointed outside the pool.
   *
   * It is deliberately **not** treated as "no condition". An absent condition
   * means "always fits"; a *broken* one means we do not know, so evaluation
   * returns unknown and the interface asks rather than asserting a fit.
   */
  applicabilityUnresolved?: true;
}

/** All candidates for one callout number on the drawing. */
export interface PlateRepere {
  /**
   * 1-based callout number, matching `TRepere`'s `repere` field.
   *
   * The original indexes `_TTCondAcces` from 0 and reports
   * `"Numéro de repére inconnu (" + (n + 1) + ")"`, so the printed number is
   * the array position plus one.
   */
  repere: number;
  candidates: PlateCandidate[];
}

export interface Plate {
  /** Variables local to this plate. */
  locals: LocalVariable[];
  /** Same, for informational conditions — names get an `info` suffix. */
  localsInfo: LocalVariable[];
  conditionPool: CondBloc[];
  consBlocPool: ConsBloc[];
  replacementPool: PartRef[][];
  reperes: PlateRepere[];
  /** Dangling pool references found while parsing. Normally empty. */
  faults: PlateFault[];
}

/** `addDansHVarLocales`. */
function readLocalVariables(c: DataCursor): LocalVariable[] {
  const nbVar = c.i16();
  const out: LocalVariable[] = [];
  for (let i = 0; i < nbVar; i++) {
    const name = c.utf();
    const nbInd = c.i16();
    const indices: number[] = [];
    for (let j = 0; j < nbInd; j++) indices.push(c.i16());
    out.push({ name, indices });
  }
  return out;
}

/** `newTConsBloc`. */
function readConsBlocPool(
  c: DataCursor,
  conditionPool: CondBloc[],
  faults: PlateFault[],
): ConsBloc[] {
  const nbConsBloc = c.i16();
  const out: ConsBloc[] = [];
  for (let i = 0; i < nbConsBloc; i++) {
    const nbConsLign = c.i16();
    const lignes: ConsLign[] = [];
    for (let j = 0; j < nbConsLign; j++) {
      const condIdx = c.i16();
      const nbRefQte = c.i16();
      const refs: RefQte[] = [];
      for (let k = 0; k < nbRefQte; k++) {
        const ref = c.utf();
        const quantity = c.i16();
        refs.push({ ref, quantity });
      }
      lignes.push({
        condition: poolAt(conditionPool, condIdx, `consBloc[${i}].ligne[${j}]`, faults),
        refs,
      });
    }
    out.push({ lignes });
  }
  return out;
}

/** `newVTRefRpl`. */
function readReplacementPool(c: DataCursor): PartRef[][] {
  const nbTRefRpl = c.i16();
  const out: PartRef[][] = [];
  for (let i = 0; i < nbTRefRpl; i++) {
    const nbRefRpl = c.i16();
    const refs: PartRef[] = [];
    for (let j = 0; j < nbRefRpl; j++) refs.push(c.utf());
    out.push(refs);
  }
  return out;
}

/**
 * A reference in the record that points outside its pool.
 *
 * These exist in the shipped data: 9 of 41,758 plates carry one. The records
 * are otherwise intact — they parse to the byte and their parts and callouts
 * are coherent — so the fault is recorded and the rest of the plate is kept.
 *
 * The original is less forgiving: `getCondBloc` indexes the array directly, so
 * Java throws `ArrayIndexOutOfBoundsException` and Dialogys cannot load these
 * nine plates at all.
 */
export interface PlateFault {
  where: string;
  index: number;
  poolSize: number;
}

/** `getCondBloc` / `getConsBloc`: a negative index means "none". */
function poolAt<T>(pool: T[], index: number, where: string, faults: PlateFault[]): T | undefined {
  if (index < 0) return undefined;
  const v = pool[index];
  if (v === undefined) {
    faults.push({ where, index, poolSize: pool.length });
    return undefined;
  }
  return v;
}

/**
 * Parse one `Planches.dat` record.
 *
 * Asserts the whole record was consumed. A short read means the grammar is
 * wrong somewhere, and the failure mode without this check is a plausible
 * parts list built from misaligned bytes.
 */
export function parsePlate(bytes: Uint8Array): Plate {
  const c = new DataCursor(bytes);

  const faults: PlateFault[] = [];
  const locals = readLocalVariables(c);
  const localsInfo = readLocalVariables(c);
  const conditionPool = readCondBlocPool(c);
  const consBlocPool = readConsBlocPool(c, conditionPool, faults);
  const replacementPool = readReplacementPool(c);

  const nbRepere = c.i16();
  const reperes: PlateRepere[] = [];
  for (let r = 0; r < nbRepere; r++) {
    const nbCandidates = c.i16();
    const candidates: PlateCandidate[] = [];
    for (let k = 0; k < nbCandidates; k++) {
      const rv = c.i16();
      const sc = c.i16();
      const refRpl = c.i16();
      const consAEP = c.i16();
      const consPPS = c.i16();
      const ref = c.utf();
      const before = faults.length;
      const applicability = poolAt(conditionPool, rv, `repere[${r + 1}].applicability`, faults);
      const applicabilityBroken = faults.length > before;
      candidates.push({
        ref,
        applicability,
        ...(applicabilityBroken ? { applicabilityUnresolved: true as const } : {}),
        codedSign: poolAt(conditionPool, sc, `repere[${r + 1}].codedSign`, faults),
        replacements: poolAt(replacementPool, refRpl, `repere[${r + 1}].replacements`, faults),
        consAEP: poolAt(consBlocPool, consAEP, `repere[${r + 1}].consAEP`, faults),
        consPPS: poolAt(consBlocPool, consPPS, `repere[${r + 1}].consPPS`, faults),
      });
    }
    reperes.push({ repere: r + 1, candidates });
  }

  if (c.remaining !== 0) {
    throw new Error(
      `plate record: ${c.remaining} of ${bytes.length} bytes left unread — ` +
        `the grammar does not match this record`,
    );
  }

  return { locals, localsInfo, conditionPool, consBlocPool, replacementPool, reperes, faults };
}

/** A candidate paired with the verdict for a given vehicle. */
export interface EvaluatedCandidate extends PlateCandidate {
  applies: Troolean;
  /** True when the user must choose between surviving variants. */
  needsChoice: boolean;
}

/**
 * Filter a callout's candidates for a vehicle.
 *
 * `unknown` is kept and flagged, not dropped. The original raises
 * `DontKnowException` and asks the user; dropping instead would hide parts that
 * do fit, which is the failure mode this whole module exists to avoid.
 */
export function evaluateRepere(
  repere: PlateRepere,
  ctx: ConditionContext,
): { applies: EvaluatedCandidate[]; unknown: EvaluatedCandidate[] } {
  const evaluated: EvaluatedCandidate[] = repere.candidates.map((cand) => ({
    ...cand,
    // No applicability condition means it always applies: `getCondBloc`
    // returns null for a negative index and `analyseRepere` treats that as OK.
    applies: cand.applicabilityUnresolved
      ? ("unknown" as const)
      : cand.applicability === undefined
        ? true
        : evalCondBloc(cand.applicability, ctx),
    needsChoice: cand.codedSign !== undefined,
  }));
  return {
    applies: evaluated.filter((e) => e.applies === true),
    unknown: evaluated.filter((e) => e.applies === "unknown"),
  };
}
