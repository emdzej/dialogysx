/**
 * An `Organes.dat` record — the assembly layer, and the join that tells you
 * which **drawing** a plate is drawn on.
 *
 * Transcribed from `PRFactory.newCondOrgVign` and `newTCondAcces`. Note this is
 * a *different envelope* from a plate record even though the `CondBloc` grammar
 * inside is shared: `addDialoguesVignettes` in place of the second locals
 * block, then a discarded short and an id, then a flat access list.
 *
 * Each access reference is `plateName,drawingNumber`, e.g.
 * `N100411,01003160`. That second field is what `Planche(id, imageId, prId)`
 * calls `imageId`, what `TRepereFactory.newTRepere(numDessin)` is keyed by, and
 * what names the PNG — `dessins/100/0100/01003160.png`. Without Organes there
 * is no way to get from a plate to its picture.
 */
import type { PrGroup } from "@dialogysx/core";
import { DataCursor } from "@dialogysx/raf";
import { evalCondBloc, readCondBlocPool, type CondBloc, type ConditionContext } from "./conditions.js";
import type { LocalVariable } from "./plate.js";

/** One plate shown under an assembly, with the drawing it appears on. */
export interface OrganePlate {
  plate: string;
  /** 8-character drawing number, or `undefined` if the reference lacks one. */
  drawing?: string;
  /** The raw reference, kept because a few do not split as expected. */
  raw: string;
  applicability?: CondBloc;
}

/** A vignette: a named sub-view with its own local variables. */
export interface Vignette {
  name: string;
  locals: LocalVariable[];
}

export interface Organe {
  /** The short code the record carries, e.g. `"10A"`. */
  id: string;
  locals: LocalVariable[];
  vignettes: Vignette[];
  conditionPool: CondBloc[];
  plates: OrganePlate[];
}

function readLocals(c: DataCursor): LocalVariable[] {
  const n = c.i16();
  const out: LocalVariable[] = [];
  for (let i = 0; i < n; i++) {
    const name = c.utf();
    const k = c.i16();
    const indices: number[] = [];
    for (let j = 0; j < k; j++) indices.push(c.i16());
    out.push({ name, indices });
  }
  return out;
}

/** `PRFactory.addDialoguesVignettes`. */
function readVignettes(c: DataCursor): Vignette[] {
  const n = c.i16();
  const out: Vignette[] = [];
  for (let i = 0; i < n; i++) {
    const name = c.utf();
    out.push({ name, locals: readLocals(c) });
  }
  return out;
}

/**
 * Parse one `Organes.dat` record.
 *
 * Like `parsePlate`, this asserts the record is fully consumed — the envelope
 * differs from a plate's and the only way to know it is right is that every
 * byte lands.
 */
export function parseOrgane(bytes: Uint8Array): Organe {
  const c = new DataCursor(bytes);
  const locals = readLocals(c);
  const vignettes = readVignettes(c);
  const conditionPool = readCondBlocPool(c);

  // `newCondOrgVign` reads a short and throws it away, then the id.
  c.i16();
  const id = c.utf();

  const nbAcces = c.i16();
  const plates: OrganePlate[] = [];
  for (let i = 0; i < nbAcces; i++) {
    const condIdx = c.i16();
    const raw = c.utf();
    const comma = raw.indexOf(",");
    plates.push({
      plate: comma < 0 ? raw : raw.slice(0, comma),
      drawing: comma < 0 ? undefined : raw.slice(comma + 1),
      raw,
      applicability: condIdx < 0 ? undefined : conditionPool[condIdx],
    });
  }

  if (c.remaining !== 0) {
    throw new Error(
      `organe record: ${c.remaining} of ${bytes.length} bytes left unread — ` +
        `the grammar does not match this record`,
    );
  }
  return { id, locals, vignettes, conditionPool, plates };
}

/**
 * The plates an assembly shows for a vehicle.
 *
 * `CondOrgVign.analyseVignette` filters by condition, so the plate *list*
 * itself is vehicle-dependent. Undecided entries are returned separately
 * rather than dropped, for the same reason as parts: hiding them would silently
 * narrow the catalogue.
 */
export function evaluateOrgane(
  organe: Organe,
  ctx: ConditionContext,
): { plates: OrganePlate[]; unknown: OrganePlate[] } {
  const plates: OrganePlate[] = [];
  const unknown: OrganePlate[] = [];
  for (const p of organe.plates) {
    const verdict = p.applicability === undefined ? true : evalCondBloc(p.applicability, ctx);
    if (verdict === true) plates.push(p);
    else if (verdict === "unknown") unknown.push(p);
  }
  return { plates, unknown };
}

/**
 * Where a drawing's PNG lives in an imported tree.
 *
 * The bucket is the first four characters of the name, which holds for all
 * 39,584 drawings on the disc.
 */
export function drawingPath(drawing: string): string {
  return `dessins/100/${drawing.slice(0, 4)}/${drawing}.png`;
}

/** `Organes.dat` key: `PR(4) || organe(5)`. */
export function organeKey(pr: PrGroup, organe: string): string {
  return pr + organe;
}
