/**
 * A Dialogys data tree, wherever it lives.
 *
 * `FileSource` is the one thing that differs between a mounted disc, an
 * unpacked static tree behind HTTP, and a directory the user picked in the
 * browser. Everything above this line is source-agnostic.
 */
import { IndexedRAF, type Reader } from "@dialogysx/raf";
import { DATASETS, LANGUAGE_DATASETS, type DatasetSpec } from "./datasets.js";

export interface FileSource {
  /** A reader for a path relative to `dialogys/data`, or `undefined` if absent. */
  open(relativePath: string): Promise<Reader | undefined>;
  /** Whole-file read, for the small text files (criteria, typesvin, ...). */
  readAll(relativePath: string): Promise<Uint8Array | undefined>;
  /** Immediate subdirectory names of a relative path. Used to list languages. */
  listDirs(relativePath: string): Promise<string[]>;
  /**
   * A URL the browser can load directly — a drawing in an `<img>`, a manual in
   * an `<iframe>`.
   *
   * Optional because it is the one thing the backends cannot express
   * identically: HTTP has a real URL, a picked directory has to mint a blob,
   * and Node has neither. Returns `undefined` when the file is absent.
   *
   * Named for the path rather than the element: it started as `imageUrl` for
   * the drawings, and `imageUrl("mrnt/en/d3k/1-MR/MR-305-TWINGO-3.pdf")` reads
   * like a mistake at every call site.
   */
  fileUrl?(relativePath: string): Promise<string | undefined>;
}

/** A dataset resolved against a source, ready to query. */
export interface OpenDataset {
  spec: DatasetSpec;
  /** The language, for `perLanguage` datasets. */
  language?: string;
  raf: IndexedRAF;
}

export class Disc {
  constructor(readonly source: FileSource) {}

  /** Language codes present under `langue/`. */
  async languages(): Promise<string[]> {
    return (await this.source.listDirs("langue")).sort();
  }

  /**
   * Open one dataset. Returns `undefined` when its files are not on this tree —
   * discs legitimately carry different subsets, so absence is not an error.
   *
   * Note the asymmetry worth knowing about: because a missing file is reported
   * as absence, a *typo* in a path also reads as "not on this disc". That is
   * the one blind spot in the validation (see `docs/data-format.md` §6).
   */
  async open(spec: DatasetSpec, language?: string): Promise<OpenDataset | undefined> {
    const base = spec.perLanguage ? `langue/${language}/` : "";
    if (spec.perLanguage && language === undefined) {
      throw new Error(`${spec.id}: this dataset is per-language, so a language is required`);
    }

    const dataPath = base + spec.data;
    const index1Path = base + spec.index + (spec.depth === 3 ? "1" : "");
    const index2Path = base + spec.index + "2";

    const data = await this.source.open(dataPath);
    const index1 = await this.source.open(index1Path);
    if (!data || !index1) return undefined;
    const index2 = spec.depth === 3 ? await this.source.open(index2Path) : undefined;
    if (spec.depth === 3 && !index2) return undefined;

    const raf = await IndexedRAF.open({
      data,
      index1,
      index2,
      keyLength: spec.keyLength,
      depth: spec.depth,
      name: spec.id + (language ? ` [${language}]` : ""),
    });
    return { spec, language, raf };
  }

  /**
   * Every dataset the tree actually carries, language-scoped ones once per
   * language present.
   */
  async openAll(): Promise<OpenDataset[]> {
    const out: OpenDataset[] = [];
    for (const spec of DATASETS) {
      const d = await this.open(spec);
      if (d) out.push(d);
    }
    const langs = await this.languages();
    for (const spec of LANGUAGE_DATASETS) {
      for (const lg of langs) {
        const d = await this.open(spec, lg);
        if (d) out.push(d);
      }
    }
    return out;
  }
}
