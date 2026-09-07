/**
 * Part search, against a session stubbed just enough to answer.
 *
 * The interesting behaviour is not the scan — it is what the two indexes let
 * it *skip*, and the arithmetic that turns a plate into a tab number. Both are
 * testable without a disc, and both are where a mistake would be quiet: a
 * wrong tab number navigates to the wrong diagram, and a lost early exit turns
 * a free answer into 304 plate reads.
 */
import { describe, expect, it, vi } from "vitest";
import { inTabOrder, searchDiagrams } from "./diagram-search.js";
import type { CatalogueSession } from "./session.js";

/** A part on a plate, in the shape `reperes` carries. */
const part = (ref: string, name?: string) => ({ ref, name, conditionLines: undefined });

interface FakePlate {
  plate: string;
  drawing?: string;
  undecided?: boolean;
  /** Callout number -> the parts hanging off it. */
  reperes: { repere: number; fits: string[]; unknown?: string[] }[];
}

/**
 * A session over declared data.
 *
 * `refNumPr` is derived from the plates rather than declared separately, so a
 * fixture cannot claim a part is in a group whose plates do not contain it —
 * which is exactly the inconsistency the early exit would then hide.
 */
function fakeSession(
  groups: Record<string, { assembly: string; label: string; plates: FakePlate[] }[]>,
  names: Record<string, string> = {},
  refGroups?: Record<string, string[]>,
) {
  const plateOf = new Map<string, FakePlate>();
  const derived: Record<string, Set<string>> = {};
  for (const [pr, assemblies] of Object.entries(groups)) {
    for (const a of assemblies) {
      for (const p of a.plates) {
        plateOf.set(`${pr}/${p.plate}`, p);
        for (const r of p.reperes) {
          for (const ref of [...r.fits, ...(r.unknown ?? [])]) {
            (derived[ref] ??= new Set()).add(pr);
          }
        }
      }
    }
  }
  const groupsFor = vi.fn(async (ref: string) => {
    const declared = refGroups?.[ref.trim()];
    if (declared) return declared;
    const d = derived[ref.trim()];
    return d ? [...d] : undefined;
  });

  const session = {
    partSearch: {
      groupsFor,
      byPrefix: vi.fn(async (prefix: string, limit: number) => {
        const all = Object.keys(derived).concat(Object.keys(refGroups ?? {}));
        const hit = [...new Set(all)].filter((r) => r.startsWith(prefix));
        return {
          results: await Promise.all(
            hit.slice(0, limit).map(async (ref) => ({ ref, groups: (await groupsFor(ref)) ?? [] })),
          ),
          truncated: hit.length > limit,
        };
      }),
    },
    partNamesIndex: {
      size: Object.keys(names).length,
      get: (ref: string) => names[ref.trim()],
      searchByName: (text: string, limit: number) =>
        Object.entries(names)
          .filter(([, n]) => n.toLowerCase().includes(text.toLowerCase()))
          .slice(0, limit)
          .map(([ref]) => ref),
    },
    assemblyList: vi.fn(async (pr: string) =>
      (groups[pr] ?? []).map((a) => ({ code: a.assembly, label: a.label })),
    ),
    assemblyPlates: vi.fn(async (pr: string, assembly: string) => {
      const a = (groups[pr] ?? []).find((x) => x.assembly === assembly);
      return {
        plates: (a?.plates ?? [])
          .filter((p) => !p.undecided)
          .map((p) => ({ plate: p.plate, drawing: p.drawing })),
        unknown: (a?.plates ?? [])
          .filter((p) => p.undecided)
          .map((p) => ({ plate: p.plate, drawing: p.drawing })),
      };
    }),
    plate: vi.fn(async (pr: string, plate: string) => {
      const p = plateOf.get(`${pr}/${plate}`);
      if (!p) return undefined;
      return {
        plate,
        reperes: p.reperes.map((r) => ({
          repere: r.repere,
          fits: r.fits.map((ref) => part(ref, names[ref])),
          unknown: (r.unknown ?? []).map((ref) => part(ref, names[ref])),
        })),
      };
    }),
  };
  return session as unknown as CatalogueSession & typeof session;
}

const VEHICLE = { type: "T1", criteria: {} } as never;

const TREE = {
  "1256": [
    {
      assembly: "3737A",
      label: "Pedal assembly",
      // Declared out of order, so the tab numbering has to sort.
      plates: [
        { plate: "N373110", reperes: [{ repere: 7, fits: ["7700000003"] }] },
        { plate: "N372510", reperes: [{ repere: 1, fits: ["7700000001"] }] },
        {
          plate: "N373010",
          undecided: true,
          reperes: [{ repere: 4, fits: [], unknown: ["7700000002"] }],
        },
      ],
    },
    {
      assembly: "1010A",
      label: "Complete engine",
      plates: [{ plate: "N100812", reperes: [{ repere: 1, fits: ["7700000001"] }] }],
    },
  ],
};
const NAMES = {
  "7700000001": "BRAKE PEDAL",
  "7700000002": "PEDAL RUBBER",
  "7700000003": "CLUTCH CABLE",
};

describe("searchDiagrams", () => {
  it("finds the diagrams a reference appears on", async () => {
    const s = fakeSession(TREE, NAMES);
    const r = await searchDiagrams(s, "7700000001", { groups: ["1256"], vehicle: VEHICLE });
    expect(r.kind).toBe("reference");
    expect(r.hits.map((h) => [h.assembly, h.plate])).toEqual([
      ["3737A", "N372510"],
      ["1010A", "N100812"],
    ]);
    expect(r.hits[0]!.matches[0]).toMatchObject({ ref: "7700000001", repere: 1, undecided: false });
  });

  it("numbers a hit by its position among the assembly's diagrams", async () => {
    // The whole point of the index: it is the tab number. `N372510` is
    // declared last in the fixture and sorts first, so a hit that reported
    // declaration order would say 2 and open the wrong diagram.
    const s = fakeSession(TREE, NAMES);
    const r = await searchDiagrams(s, "7700000001", { groups: ["1256"], vehicle: VEHICLE });
    const pedal = r.hits.find((h) => h.assembly === "3737A")!;
    expect(pedal.index).toBe(1);
    expect(pedal.total).toBe(3);
    // And a single-diagram assembly reads "1 of 1".
    const engine = r.hits.find((h) => h.assembly === "1010A")!;
    expect([engine.index, engine.total]).toEqual([1, 1]);
  });

  it("counts undecided diagrams in the numbering, and marks them", async () => {
    const s = fakeSession(TREE, NAMES);
    const r = await searchDiagrams(s, "7700000002", { groups: ["1256"], vehicle: VEHICLE });
    expect(r.hits).toHaveLength(1);
    // `N373010` is undecided and sorts second of three. Excluding it from the
    // numbering would make every later tab number wrong.
    expect(r.hits[0]).toMatchObject({
      plate: "N373010",
      index: 2,
      total: 3,
      diagramUndecided: true,
    });
    expect(r.hits[0]!.matches[0]!.undecided).toBe(true);
  });

  it("answers a part in no relevant group without opening a plate", async () => {
    // The reason `refNumPr` is consulted first. A part that exists but belongs
    // to another model is a free answer, not a 304-plate scan.
    const s = fakeSession(TREE, NAMES, { "7709999999": ["1132"] });
    const r = await searchDiagrams(s, "7709999999", { groups: ["1256"], vehicle: VEHICLE });
    expect(r.outOfScope).toBe(true);
    expect(r.scanned).toBe(0);
    expect(r.hits).toEqual([]);
    // And it is distinct from "no such part": the reference is reported.
    expect(r.refs.map((x) => x.ref)).toEqual(["7709999999"]);
    expect(s.plate).not.toHaveBeenCalled();
  });

  it("distinguishes an unknown reference from an out-of-scope one", async () => {
    const s = fakeSession(TREE, NAMES);
    const r = await searchDiagrams(s, "1234567890", { groups: ["1256"], vehicle: VEHICLE });
    expect(r.outOfScope).toBe(false);
    expect(r.refs).toEqual([]);
    expect(s.plate).not.toHaveBeenCalled();
  });

  it("searches descriptions when the query is not a number", async () => {
    const s = fakeSession(TREE, NAMES);
    const r = await searchDiagrams(s, "pedal", { groups: ["1256"], vehicle: VEHICLE });
    expect(r.kind).toBe("name");
    // Both pedal parts, not the clutch cable.
    expect(r.refs.map((x) => x.ref).sort()).toEqual(["7700000001", "7700000002"]);
    expect(r.hits.map((h) => h.plate).sort()).toEqual(["N100812", "N372510", "N373010"].sort());
  });

  it("reads a short query as a description, not a reference", async () => {
    // "300" is three digits: likelier part of a word than a part number, and
    // as a prefix it would match thousands.
    const s = fakeSession(TREE, NAMES);
    expect((await searchDiagrams(s, "300", { groups: ["1256"], vehicle: VEHICLE })).kind).toBe(
      "name",
    );
    expect((await searchDiagrams(s, "3000", { groups: ["1256"], vehicle: VEHICLE })).kind).toBe(
      "reference",
    );
  });

  it("finds a zero-padded reference from what is stamped on the part", async () => {
    // Stored as `0000001484`; nobody types the padding, and a prefix query
    // for `1484` would miss it.
    const s = fakeSession({
      "1256": [
        {
          assembly: "1010A",
          label: "Complete engine",
          plates: [{ plate: "N100812", reperes: [{ repere: 1, fits: ["0000001484"] }] }],
        },
      ],
    });
    const r = await searchDiagrams(s, "1484", { groups: ["1256"], vehicle: VEHICLE });
    expect(r.hits.map((h) => h.plate)).toEqual(["N100812"]);
  });

  it("stops when told to, and says it stopped early", async () => {
    const s = fakeSession(TREE, NAMES);
    const controller = new AbortController();
    controller.abort();
    const r = await searchDiagrams(s, "7700000001", {
      groups: ["1256"],
      vehicle: VEHICLE,
      signal: controller.signal,
    });
    expect(r.truncated).toBe(true);
    expect(r.hits).toEqual([]);
  });

  it("reports progress against a total known before the scan", async () => {
    const s = fakeSession(TREE, NAMES);
    const seen: [number, number][] = [];
    const r = await searchDiagrams(s, "7700000001", {
      groups: ["1256"],
      vehicle: VEHICLE,
      onProgress: (scanned, total) => seen.push([scanned, total]),
    });
    // Four plates across the two assemblies, counted before any is opened, so
    // a progress bar has a denominator from the first tick.
    expect(seen.map(([, total]) => total)).toEqual([4, 4, 4, 4]);
    expect(seen.map(([scanned]) => scanned)).toEqual([1, 2, 3, 4]);
    expect(r.scanned).toBe(4);
  });

  it("caps the diagrams returned and says so", async () => {
    const s = fakeSession(TREE, NAMES);
    const r = await searchDiagrams(s, "7700000001", {
      groups: ["1256"],
      vehicle: VEHICLE,
      limit: 1,
    });
    expect(r.hits).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });

  it("returns nothing for an empty query without touching the indexes", async () => {
    const s = fakeSession(TREE, NAMES);
    const r = await searchDiagrams(s, "   ", { groups: ["1256"], vehicle: VEHICLE });
    expect(r.hits).toEqual([]);
    expect(s.assemblyList).not.toHaveBeenCalled();
  });
});

describe("inTabOrder", () => {
  it("orders ascending by plate code, the way the tab strip numbers", () => {
    const order = inTabOrder([
      { plate: "N373110" },
      { plate: "N372510" },
      { plate: "N373010" },
    ]).map((x) => x.plate);
    expect(order).toEqual(["N372510", "N373010", "N373110"]);
  });
});
