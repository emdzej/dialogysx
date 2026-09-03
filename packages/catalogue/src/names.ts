/**
 * Human names for the things the catalogue identifies by code.
 *
 * Four separate sources, none of them obvious, and each in a different format:
 *
 * | What | Where | Shape |
 * | --- | --- | --- |
 * | Model of a PR group | `pr/ListePRModele` + `classicvar`'s `MOD_` values | binary, index into a criterion |
 * | Assembly and domain | `langue/<lg>/<lg>.zip:menu` | TAB-indented tree, CR-separated |
 * | Part description | `tarif/d3k/<CC>/<lg>/libellePieces-<lg>.txt` | `ref TAB name` |
 * | Criterion and its values | `langue/<lg>/classicvar.utf` | see `criteria.ts` |
 *
 * The part descriptions are the awkward one: they ship inside `tarif.zip`,
 * bundled with the price data, on the *country* discs rather than the
 * multi-language catalogue disc. Names and prices being in one archive is why
 * they were initially missed as "pricing, out of scope".
 */
import type { CriterionCode, PartRef, PrGroup } from "@dialogysx/core";
import { decodeText, DataCursor, splitFields, splitRecords } from "@dialogysx/raf";
import type { CriteriaVocabulary } from "./criteria.js";

// --------------------------------------------------------------------------
// PR group -> model
// --------------------------------------------------------------------------

export interface PrModel {
  pr: PrGroup;
  /** The model's own code, e.g. `"X06"`. */
  code: string;
  /** Index into the `MOD_` criterion's value list. */
  modelIndex: number;
}

/**
 * `pr/ListePRModele`, from `PRModele.newTPRModele`:
 *
 *     count:int16 || count x { numPR:writeUTF, codeModele:writeUTF, index:int16 }
 *
 * The third field is **not** a name — it indexes `classicvar`'s `MOD_` value
 * list, so the model name is only available with the vocabulary loaded.
 */
export class PrModels {
  private constructor(
    private readonly byPr: Map<PrGroup, PrModel>,
    readonly all: PrModel[],
  ) {}

  static parse(bytes: Uint8Array): PrModels {
    const c = new DataCursor(bytes);
    const count = c.i16();
    const all: PrModel[] = [];
    for (let i = 0; i < count; i++) {
      const pr = c.utf();
      const code = c.utf();
      const modelIndex = c.i16();
      all.push({ pr, code, modelIndex });
    }
    return new PrModels(new Map(all.map((m) => [m.pr, m])), all);
  }

  get(pr: PrGroup): PrModel | undefined {
    return this.byPr.get(pr);
  }

  /** The model name for a PR group, resolved through `MOD_`. */
  nameOf(pr: PrGroup, vocabulary: CriteriaVocabulary | undefined): string | undefined {
    const m = this.byPr.get(pr);
    if (!m || !vocabulary) return undefined;
    return vocabulary.get("MOD_")?.values[m.modelIndex];
  }
}

// --------------------------------------------------------------------------
// Assembly and domain names
// --------------------------------------------------------------------------

export interface MenuNode {
  /** Menu id as stored, e.g. `"M1010A"`. */
  id: string;
  /** The code without the leading section letter, e.g. `"1010A"`. */
  code: string;
  label: string;
  /** Nesting depth, from the leading TABs. */
  depth: number;
  children: MenuNode[];
}

/**
 * `langue/<lg>/<lg>.zip:menu` — the catalogue's own navigation labels.
 *
 * CR-separated, one node per line, nesting by leading TABs, `id,label`:
 *
 * ```
 * M,Manual
 * →M10,10 Engine
 * →→M1010A,Complete engine
 * →→M1010E,Cylinder block
 * ```
 *
 * The leading letter is the section (`M` for the manual tree), so an assembly
 * code like `1010A` is found as `M1010A`. A label may itself contain a comma,
 * so only the **first** one separates.
 */
export class Menu {
  private constructor(
    readonly roots: MenuNode[],
    private readonly byCode: Map<string, MenuNode>,
  ) {}

  static parse(bytes: Uint8Array): Menu {
    const roots: MenuNode[] = [];
    const byCode = new Map<string, MenuNode>();
    // One open node per depth, so a child attaches to the last node above it.
    const stack: MenuNode[] = [];

    for (const raw of splitRecords(decodeText(bytes))) {
      if (raw.length === 0) continue;
      let depth = 0;
      while (depth < raw.length && raw[depth] === "\t") depth++;
      const rest = raw.slice(depth);
      const comma = rest.indexOf(",");
      if (comma < 0) continue;
      const id = rest.slice(0, comma);
      const label = rest.slice(comma + 1).trim();
      const node: MenuNode = { id, code: id.slice(1), label, depth, children: [] };

      stack.length = depth;
      const parent = stack[depth - 1];
      if (parent) parent.children.push(node);
      else roots.push(node);
      stack[depth] = node;

      // Later duplicates do not overwrite: the first occurrence in the file is
      // the one the original's tree would show.
      if (!byCode.has(node.code)) byCode.set(node.code, node);
    }
    return new Menu(roots, byCode);
  }

  /** Label for an assembly or domain code, e.g. `"1010A"` or `"10"`. */
  labelOf(code: string): string | undefined {
    return this.byCode.get(code)?.label;
  }

  /**
   * The domain an assembly belongs to.
   *
   * `Planche.getLabel` takes `id.substring(1, 3)` as the domain, i.e. the first
   * two digits of the assembly code.
   */
  domainOf(code: string): MenuNode | undefined {
    return this.byCode.get(code.slice(0, 2));
  }

  /**
   * The section a code sits under — the top of the original's three lists.
   *
   * Walked from the roots rather than derived from `organeSection`, so the two
   * cannot disagree: the file is the authority on which domain belongs where.
   */
  sectionOf(code: string): MenuNode | undefined {
    for (const section of this.roots) {
      for (const domain of section.children) {
        if (domain.code === code) return section;
        if (domain.children.some((n) => n.code === code)) return section;
      }
    }
    return undefined;
  }

  get size(): number {
    return this.byCode.size;
  }
}

// --------------------------------------------------------------------------
// Part descriptions
// --------------------------------------------------------------------------

/**
 * `libellePieces-<lg>.txt` — `partRef TAB description`, one per line.
 *
 * 146,533 entries for English, ~4 MB. There is also an indexed `libelles` /
 * `libelles.idx` pair keyed by the *description* (key length 20, collation
 * key), which is what the original uses to search parts by name; this reads the
 * plain text because the direction needed here is reference to name.
 */
export class PartNames {
  private constructor(private readonly byRef: Map<PartRef, string>) {}

  static parse(bytes: Uint8Array): PartNames {
    const byRef = new Map<PartRef, string>();
    for (const line of splitRecords(decodeText(bytes))) {
      if (line.length === 0) continue;
      const f = splitFields(line);
      const ref = f[0]?.trim();
      const name = f[1]?.trim();
      if (ref && name) byRef.set(ref, name);
    }
    return new PartNames(byRef);
  }

  get(ref: PartRef): string | undefined {
    return this.byRef.get(ref) ?? this.byRef.get(ref.trim());
  }

  get size(): number {
    return this.byRef.size;
  }

  refs(): IterableIterator<PartRef> {
    return this.byRef.keys();
  }
}

/**
 * `PRUtil.organe2domaine` — the section letter an assembly belongs to.
 *
 * The three sections are the `menu` tree's roots: `M` manual/mechanical,
 * `C` bodywork, `I` upholstery and electrics.
 */
export function organeSection(organeCode: string): string {
  const n = Number.parseInt(organeCode.slice(0, 2), 10);
  if (Number.isNaN(n)) return "";
  if (n < 39) return "M";
  if (n < 57) return "C";
  if (n < 90) return "I";
  if (n === 90) return "M";
  if (n === 91) return "I";
  return "M";
}

/**
 * A plate's label, the way the original builds it.
 *
 * **A plate has no name**, in this data or in Dialogys. `Planche.getLabel()`
 * composes a path instead — `PR / section / organe / rest` — and the prose name
 * belongs to the *assembly* (`1010A` is "Complete engine"). A plate is only
 * which drawing within that assembly, so `1132` + `N104010` reads `1132/M/10/4010`.
 */
export function plateLabel(pr: PrGroup, plate: string): string {
  const organe = plate.slice(1, 3);
  return [pr, organeSection(organe), organe, plate.slice(3)].join("/");
}

/** Criterion label, falling back to the code. */
export function criterionLabel(
  code: CriterionCode,
  vocabulary: CriteriaVocabulary | undefined,
): string {
  const label = vocabulary?.get(code)?.label;
  return label && label.length > 0 ? label : code;
}
