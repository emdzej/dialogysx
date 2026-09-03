import { describe, expect, it } from "vitest";
import {
  COMPONENTS,
  componentFor,
  DEFAULT_COMPONENTS,
  isJunk,
  resolveComponents,
} from "./components.js";

describe("component routing", () => {
  it.each([
    ["pr/Planches.dat", "parts"],
    ["pr/1132.zip", "parts"],
    ["enveloppe/prtype1", "parts"],
    ["typesvin", "parts"],
    ["dessins/TRepere.idx", "parts"],
    ["langue/fr/classicvar.utf", "criteria"],
    ["langue/fr/papv/papv", "criteria"],
    ["dessins/100/1173/1173M06A.png", "drawings"],
    ["dessins/100.zip", "drawings-archive"],
    ["eclate/100.zip", "exploded"],
    ["vignette/pr/100.zip", "exploded"],
    ["Dates/Dates", "dates"],
    ["PR1100/prremp", "substitutions"],
    ["Refcontexte/refContexte", "extras"],
    ["REACH.zip", "extras"],
    ["mrnt/ru/d3k/1-MR/MR-000-AIR COND-1.pdf", "repair-pdf"],
    ["mrnt/ru/d3k/1-NT/0048A.pdf", "repair-pdf"],
    ["mrnt/ru/d3k/indexation/ArboRech-MR-pdf-X06.xml", "repair-pdf"],
    ["mrnt/ru/d3k/chapitres/NTI-RU/0544A.pdf", "repair-xml"],
    ["mrnt/ru/d3k/images/images_1.zip", "repair-xml"],
    ["TM.zip", "labour-times"],
    ["tarif.zip", "pricing"],
    ["app/java/dialogysapplet.jar", "app"],
  ])("routes %s to %s", (dest, expected) => {
    expect(componentFor(dest)?.id).toBe(expected);
  });

  it("has a home for the drawings and their duplicate archive, separately", () => {
    // The discs ship the same 39,584 PNGs twice — unpacked under dessins/100/
    // and again as dessins/100.zip. They must not land in one component, or
    // there is no way to skip the redundant 694 MB.
    expect(componentFor("dessins/100/0000/00000436.png")?.id).toBe("drawings");
    expect(componentFor("dessins/100.zip")?.id).toBe("drawings-archive");
    expect(DEFAULT_COMPONENTS).toContain("drawings");
    expect(DEFAULT_COMPONENTS).not.toContain("drawings-archive");
  });

  it("leaves pricing and labour times off by default", () => {
    // Both are out of scope by decision, not by accident.
    expect(DEFAULT_COMPONENTS).not.toContain("pricing");
    expect(DEFAULT_COMPONENTS).not.toContain("labour-times");
  });

  it("skips Windows detritus that is actually on the discs", () => {
    expect(isJunk("dessins/100/0003/Thumbs.db")).toBe(true);
    expect(isJunk("dessins/100/.png")).toBe(true);
    expect(isJunk("dessins/100/0003/00031234.png")).toBe(false);
  });
});

describe("resolveComponents", () => {
  it("defaults to the defaultOn set", () => {
    expect(resolveComponents(undefined)).toEqual(DEFAULT_COMPONENTS);
  });

  it("expands all", () => {
    expect(resolveComponents("all")).toEqual(COMPONENTS.map((c) => c.id));
  });

  it("min keeps only what the catalogue cannot work without", () => {
    expect(resolveComponents("min").sort()).toEqual(["criteria", "parts"]);
  });

  it("adds required components back even when not asked for", () => {
    // Deselecting `parts` would produce a tree that cannot be read at all.
    expect(resolveComponents("drawings")).toContain("parts");
  });

  it("rejects an unknown name instead of silently importing nothing", () => {
    expect(() => resolveComponents("drawings,drawinsg")).toThrow(
      /unknown component\(s\): drawinsg/,
    );
  });

  it("treats min as additive, not exclusive", () => {
    // Regression: `-c min,labour-times` used to short-circuit on "min" and drop
    // labour-times entirely, with no message. The import then looked like it
    // had succeeded while skipping 99,056 files.
    const ids = resolveComponents("min,labour-times");
    expect(ids).toContain("labour-times");
    expect(ids).toContain("parts");
    expect(ids).toContain("criteria");
    expect(ids).not.toContain("min");
  });

  it("de-duplicates a repeated name", () => {
    const ids = resolveComponents("drawings,drawings");
    expect(ids.filter((i) => i === "drawings")).toHaveLength(1);
  });
});
