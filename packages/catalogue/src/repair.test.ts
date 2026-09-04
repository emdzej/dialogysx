import { describe, expect, it } from "vitest";
import {
  DocIndex,
  FamilyModels,
  applicabilityMatches,
  docIndexPath,
  docPdfPath,
  documentApplies,
  type DocRef,
} from "./repair.js";
import type { CriteriaVocabulary } from "./criteria.js";

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Just enough vocabulary to resolve `MOD_` indices. */
function vocabulary(models: string[]): CriteriaVocabulary {
  return {
    get: (code: string) =>
      code === "MOD_" ? { code, label: "Model", values: models } : undefined,
  } as unknown as CriteriaVocabulary;
}

describe("FamilyModels", () => {
  // The real file's syntax: colon, comma-separated 1-based MOD_ indices.
  const dat = utf8("X84:35,36\nX06:4\nXRQ:10\n");
  const models = Array.from({ length: 40 }, (_, i) => `model${i}`);

  it("resolves indices 1-based, as FamilyModels.init does", () => {
    const fm = FamilyModels.parse(dat, vocabulary(models));
    // index 4 -> models[3], not models[4]. Off by one here does not throw; it
    // silently returns the neighbouring model.
    expect(fm.modelsOf("X06")).toEqual(["model3"]);
    expect(fm.familyOf("model3")).toBe("X06");
    expect(fm.modelsOf("X84")).toEqual(["model34", "model35"]);
  });

  it("matches a model name case-insensitively and ignores surrounding space", () => {
    const fm = FamilyModels.parse(dat, vocabulary(models));
    expect(fm.familyOf("  MODEL3 ")).toBe("X06");
  });

  it("drops indices past the end of the MOD_ list rather than inventing a name", () => {
    const fm = FamilyModels.parse(dat, vocabulary(["only"]));
    expect(fm.modelsOf("X06")).toEqual([]);
    expect(fm.families).toEqual([]);
  });

  it("has no families at all without the vocabulary", () => {
    // The file holds indices, not names, so it is unreadable on its own. Saying
    // so beats returning families whose models are all "undefined".
    expect(FamilyModels.parse(dat, undefined).size).toBe(0);
  });
});

describe("DocIndex", () => {
  const xml = utf8(`<?xml version="1.0" encoding="UTF-8"?>
<arborech>
    <element id="10" lib="front brake pads">
        <pdf numero="MR-305-TWINGO-3" titre="M.R. 305   3 CHASSIS">
            <appl><object>$TYC<criterion>C06</criterion></object></appl>
            <appl><object>$TYC<criterion>S06</criterion></object></appl>
        </pdf>
        <pdf numero="MR-999-GENERAL" titre="General"/>
    </element>
    <element id="11" lib="brake fluid &amp; bleeding">
        <pdf numero="MR-305-TWINGO-3" titre="M.R. 305   3 CHASSIS"/>
    </element>
</arborech>`);

  it("reads elements, documents and applicability", () => {
    const idx = DocIndex.parse(xml, "MR", "X06");
    expect(idx.elements).toHaveLength(2);
    const brakes = idx.elements[0]!;
    expect(brakes.id).toBe(10);
    expect(brakes.label).toBe("front brake pads");
    expect(brakes.docs.map((d) => d.numero)).toEqual(["MR-305-TWINGO-3", "MR-999-GENERAL"]);
    // Two `<appl>` blocks, each one variable with one value.
    expect(brakes.docs[0]!.applicability).toEqual([
      { clauses: [{ variable: "$TYC", values: ["C06"] }] },
      { clauses: [{ variable: "$TYC", values: ["S06"] }] },
    ]);
    // A self-closing `<pdf/>` with no applicability is not a parse failure.
    expect(brakes.docs[1]!.applicability).toEqual([]);
  });

  it("decodes entities in labels", () => {
    const idx = DocIndex.parse(xml, "MR", "X06");
    expect(idx.elements[1]!.label).toBe("brake fluid & bleeding");
  });

  it("deduplicates documents listed under several elements", () => {
    const idx = DocIndex.parse(xml, "MR", "X06");
    expect(idx.documents().map((d) => d.numero)).toEqual(["MR-305-TWINGO-3", "MR-999-GENERAL"]);
  });
});

describe("DocIndex, the chapitres flavour", () => {
  // The XML indexes differ in three ways that each fail silently: `<UI>` is
  // upper case, there is no `numero`, and documents nest under `<operation>`.
  const xml = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?><arborech>
    <element id="1018" lib="gearbox assembly"><operation id="2" libelle="rep precautions"><UI chapitre="6016A" chemin="SPI-NTm-6016A-1000234-EN/REPAIR-12,01-02,16-1-3-extr-utf8.xml" titre="Gearbox assembly : Precautions for the repair">
        <appl><object>BVI3<criterion>ZF6</criterion><criterion>ZF5</criterion></object></appl>
      </UI></operation><operation id="29" libelle="maintenance"><UI chapitre="6016A" chemin="SPI-NTm-6016A-1000234-EN/REPAIR-12,01-02,31-2-11-extr-utf8.xml" titre="Gearbox assembly : Maintenance"/></operation></element>
</arborech>`);

  it("reads upper-case UI elements addressed by chemin", () => {
    const idx = DocIndex.parse(xml, "NT", "organe");
    const el = idx.elements[0]!;
    expect(el.label).toBe("gearbox assembly");
    expect(el.docs).toHaveLength(2);
    expect(el.docs[0]!.chemin).toBe(
      "SPI-NTm-6016A-1000234-EN/REPAIR-12,01-02,16-1-3-extr-utf8.xml",
    );
    expect(el.docs[0]!.chapter).toBe("6016A");
    // No `numero`, so the chapter code stands in as the id.
    expect(el.docs[0]!.numero).toBe("6016A");
    expect(el.docs[0]!.operation).toEqual({ id: 2, label: "rep precautions" });
    expect(el.docs[0]!.applicability).toEqual([
      { clauses: [{ variable: "BVI3", values: ["ZF6", "ZF5"] }] },
    ]);
  });

  it("keeps procedures that share a chapter code apart", () => {
    // Keying on the id alone collapsed 37,695 procedures into their few
    // hundred chapter codes.
    const idx = DocIndex.parse(xml, "NT", "organe");
    expect(idx.documents()).toHaveLength(2);
  });

  it("tells an empty index apart from one it could not read", () => {
    const bare = new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?><arborech/>');
    expect(DocIndex.isEmptyByDesign(bare)).toBe(true);
    expect(DocIndex.isEmptyByDesign(xml)).toBe(false);
    expect(DocIndex.parse(bare, "MR", "X05").elements).toEqual([]);
  });
});

describe("applicability", () => {
  const doc: DocRef = {
    numero: "MR-1",
    title: "one",
    kind: "MR",
    applicability: [{ clauses: [{ variable: "$TYC", values: ["C06", "S06"] }] }],
  };

  it("matches when the vehicle's value is listed", () => {
    expect(documentApplies(doc, (v) => (v === "$TYC" ? "C06" : undefined))).toBe(true);
  });

  it("rejects when the vehicle's value is not listed", () => {
    expect(documentApplies(doc, (v) => (v === "$TYC" ? "B99" : undefined))).toBe(false);
  });

  it("skips a variable the vehicle cannot answer instead of excluding the document", () => {
    // The opposite of the parts catalogue, where unknown means "ask". Here
    // `AbstractApplicability` tests `!valeurContext.equals("")` first, so an
    // unanswered variable imposes no constraint at all.
    expect(documentApplies(doc, () => undefined)).toBe(true);
    expect(documentApplies(doc, () => "")).toBe(true);
  });

  it("treats no applicability as applying to everything", () => {
    // `UI.isApplicable` returns true when `hasApplicability()` is false. The
    // general manuals are exactly the unrestricted ones.
    const general: DocRef = { ...doc, applicability: [] };
    expect(documentApplies(general, () => "anything")).toBe(true);
  });

  it("ANDs the variables within one block", () => {
    const both = {
      clauses: [
        { variable: "$TYC", values: ["C06"] },
        { variable: "MOT3", values: ["G9U"] },
      ],
    };
    const ctx = (v: string) => ({ $TYC: "C06", MOT3: "K9K" })[v];
    expect(applicabilityMatches(both, ctx)).toBe(false);
    expect(applicabilityMatches(both, (v) => ({ $TYC: "C06", MOT3: "G9U" })[v])).toBe(true);
  });

  it("ORs the blocks", () => {
    const two: DocRef = {
      ...doc,
      applicability: [
        { clauses: [{ variable: "$TYC", values: ["C06"] }] },
        { clauses: [{ variable: "$TYC", values: ["X99"] }] },
      ],
    };
    expect(documentApplies(two, () => "X99")).toBe(true);
  });
});

describe("paths", () => {
  it("builds the index and document paths the original uses", () => {
    expect(docIndexPath("en", "MR", "X06")).toBe(
      "mrnt/en/d3k/indexation/ArboRech-MR-pdf-X06.xml",
    );
    expect(docIndexPath("en", "NT", "X06", false)).toBe(
      "mrnt/en/d3k/indexation/ArboRech-NT-X06.xml",
    );
    expect(docPdfPath("en", "MR", "MR-305-TWINGO-3")).toBe(
      "mrnt/en/d3k/1-MR/MR-305-TWINGO-3.pdf",
    );
  });
});
