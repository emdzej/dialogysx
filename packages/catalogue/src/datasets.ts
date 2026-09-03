/**
 * The dataset registry: which files exist, their key length, and their index
 * depth. Every entry's `keySource` records where the key length came from in
 * the decompiled original, because that is the one parameter the data itself
 * does not carry.
 *
 * See `docs/data-format.md` §3.
 */
import type { Depth } from "@dialogysx/raf";

export interface DatasetSpec {
  /** Stable id, used on the CLI and as a cache key. */
  id: string;
  /** Human label. */
  label: string;
  /** Data file, relative to a disc's `dialogys/data` directory. */
  data: string;
  /**
   * Index stem. At depth 3 the real files are `${index}1` and `${index}2`; at
   * depth 2 this is the index file itself.
   */
  index: string;
  keyLength: number;
  depth: Depth;
  /** Where `keyLength` is established in the original application. */
  keySource: string;
  /**
   * Set when the dataset lives under `langue/<lg>/`, in which case `data` and
   * `index` are relative to that directory.
   */
  perLanguage?: true;
}

/** Datasets that sit directly under `dialogys/data`. */
export const DATASETS: readonly DatasetSpec[] = [
  {
    id: "planches",
    label: "Parts plates",
    data: "pr/Planches.dat",
    index: "pr/Planches.idx",
    keyLength: 11,
    depth: 2,
    keySource: "CompileCond.newCompileCondIndex: numPR(4) + condition name(7)",
  },
  {
    id: "organes",
    label: "Assemblies",
    data: "pr/Organes.dat",
    index: "pr/Organes.idx",
    keyLength: 9,
    depth: 2,
    keySource: "CompileCond.newCompileCondIndex: numPR(4) + organe(5)",
  },
  {
    id: "ref-num-pr",
    label: "Part number to PR group",
    data: "pr/refNumPr.dat",
    index: "pr/refNumPr.idx",
    keyLength: 10,
    depth: 2,
    keySource: "ModeleFromReference (path_data_refToNumPR, keyLength 10)",
  },
  {
    id: "envelope-pr-type",
    label: "Envelope by PR then type",
    data: "enveloppe/enveloppe",
    index: "enveloppe/prtype",
    keyLength: 8,
    depth: 3,
    keySource: "FichierEnveloppeLocal: LENGTH_CLEF_PR(4) + LENGTH_CLEF_TYPE(4)",
  },
  {
    id: "envelope-type-pr",
    label: "Envelope by type then PR",
    data: "enveloppe/enveloppe",
    index: "enveloppe/typepr",
    keyLength: 8,
    depth: 3,
    keySource: "FichierEnveloppeLocal: LENGTH_CLEF_TYPE(4) + LENGTH_CLEF_PR(4)",
  },
  {
    id: "envelope-engine",
    label: "Envelope by engine",
    data: "enveloppe/enveloppe",
    index: "enveloppe/moteur",
    keyLength: 3,
    depth: 3,
    keySource: "FichierEnveloppeLocal: LENGTH_CLEF_MOTEUR(3), matches the MOT3 field",
  },
  {
    id: "envelope-gearbox",
    label: "Envelope by gearbox",
    data: "enveloppe/enveloppe",
    index: "enveloppe/boite",
    keyLength: 3,
    depth: 3,
    keySource: "FichierEnveloppeLocal: LENGTH_CLEF_BOITE(3), matches the BVI3 field",
  },
  {
    id: "types-et-pr",
    label: "Types and PR groups",
    data: "enveloppe/typesetpr",
    index: "enveloppe/typesetprindex",
    keyLength: 8,
    depth: 3,
    keySource: "FichierTypesEtPRLocal",
  },
  {
    id: "dates",
    label: "Applicability dates",
    data: "Dates/Dates",
    index: "Dates/datesindex",
    keyLength: 8,
    depth: 3,
    keySource: "FichierDateLocal",
  },
  {
    id: "prremp",
    label: "Part substitutions",
    data: "PR1100/prremp",
    index: "PR1100/prrempindex",
    keyLength: 10,
    depth: 3,
    keySource: "PR1100Local",
  },
  {
    id: "trepere",
    label: "Drawing callouts",
    data: "dessins/TRepere.dat",
    index: "dessins/TRepere.idx",
    keyLength: 13,
    depth: 2,
    keySource: "TRepereFactory: drawing number(8) + 5 spaces",
  },
];

/** Datasets under `langue/<lg>/`. */
export const LANGUAGE_DATASETS: readonly DatasetSpec[] = [
  {
    id: "papv",
    label: "Oval plate",
    data: "papv/papv",
    index: "papv/papvindex",
    keyLength: 22,
    depth: 2,
    keySource: "FichierPAPVLocal",
    perLanguage: true,
  },
];

export function findDataset(id: string): DatasetSpec | undefined {
  return [...DATASETS, ...LANGUAGE_DATASETS].find((d) => d.id === id);
}
