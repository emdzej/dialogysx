/**
 * Every locale carries every key, with the plural forms its language needs.
 *
 * This is a test rather than a type because i18next types resources against
 * one language by design: `i18next.d.ts` checks call sites against `en.json`
 * and can say nothing about `pl.json`. Without this, a key missing from Polish
 * falls back to English silently — the app still works, nothing fails, and the
 * gap ships.
 *
 * The plural half is the part that is easy to get wrong by hand. English needs
 * `one` and `other`; Polish needs `one`, `few`, `many` and `other`, and a
 * translator working from a two-form language will supply two and leave 5
 * through 21 reading as "1 odnośnik". `Intl.PluralRules` is asked which
 * categories each locale actually uses rather than the list being written out
 * here, so adding a locale does not mean editing this file.
 */
import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import en from "./locales/en.json";
import pl from "./locales/pl.json";

const LOCALES = { en, pl } as const;
type Locale = keyof typeof LOCALES;
const TAGS = Object.keys(LOCALES) as Locale[];

/** Every leaf key, dotted. */
function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    keysOf(v, prefix ? `${prefix}.${k}` : k),
  );
}

const SUFFIXES = ["zero", "one", "two", "few", "many", "other"] as const;

/** Split `plate.callouts_one` into `["plate.callouts", "one"]`. */
function splitPlural(key: string): { id: string; category?: string } {
  const at = key.lastIndexOf("_");
  if (at < 0) return { id: key };
  const tail = key.slice(at + 1);
  return (SUFFIXES as readonly string[]).includes(tail)
    ? { id: key.slice(0, at), category: tail }
    : { id: key };
}

/** Non-plural keys, and the base id of every plural one. */
function idsOf(locale: Locale): { singular: Set<string>; plural: Set<string> } {
  const singular = new Set<string>();
  const plural = new Set<string>();
  for (const key of keysOf(LOCALES[locale])) {
    const { id, category } = splitPlural(key);
    (category ? plural : singular).add(id);
  }
  return { singular, plural };
}

/** Which categories a locale needs, per the platform rather than per a list. */
function categoriesFor(locale: Locale): string[] {
  const rules = new Intl.PluralRules(locale);
  const seen = new Set<string>();
  // 0-200 plus a few large and fractional values: enough to reach every
  // category any of these languages defines.
  for (const n of [...Array.from({ length: 201 }, (_, i) => i), 1000, 1001, 1.5, 2.5]) {
    seen.add(rules.select(n));
  }
  return [...seen].sort();
}

describe("interface message catalogues", () => {
  it("agrees on which keys are plural", () => {
    // A key that is plural in one locale and flat in another is the failure
    // that produces "1 części": i18next finds no `_one` and falls through.
    for (const tag of TAGS) {
      const { singular, plural } = idsOf(tag);
      const overlap = [...plural].filter((id) => singular.has(id));
      expect(overlap, `${tag}: both plural and flat`).toEqual([]);
    }
    const [first, ...rest] = TAGS;
    for (const tag of rest) {
      expect([...idsOf(tag).plural].sort(), `${tag} vs ${first}`).toEqual(
        [...idsOf(first!).plural].sort(),
      );
    }
  });

  it("carries every non-plural key in every locale", () => {
    const reference = idsOf("en").singular;
    for (const tag of TAGS) {
      const mine = idsOf(tag).singular;
      expect([...reference].filter((k) => !mine.has(k)).sort(), `missing from ${tag}`).toEqual([]);
      expect([...mine].filter((k) => !reference.has(k)).sort(), `only in ${tag}`).toEqual([]);
    }
  });

  it("carries exactly the plural categories its language needs", () => {
    for (const tag of TAGS) {
      const want = categoriesFor(tag);
      const have = new Map<string, string[]>();
      for (const key of keysOf(LOCALES[tag])) {
        const { id, category } = splitPlural(key);
        if (category) have.set(id, [...(have.get(id) ?? []), category].sort());
      }
      for (const [id, categories] of have) {
        expect(categories, `${tag}: ${id}`).toEqual(want);
      }
    }
  });

  it("interpolates the same variables in every locale", () => {
    // A translation that drops `{{count}}` loses the number entirely, and one
    // that invents a name renders the placeholder as literal text.
    const vars = (s: string) => [...s.matchAll(/\{\{(\w+)/g)].map((m) => m[1]!).sort();
    const flat = (tag: Locale) => {
      const out = new Map<string, string>();
      const walk = (v: unknown, p = "") => {
        if (typeof v === "string") return void out.set(p, v);
        if (typeof v === "object" && v !== null) {
          for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
        }
      };
      walk(LOCALES[tag]);
      return out;
    };
    const reference = flat("en");
    for (const tag of TAGS) {
      for (const [key, text] of flat(tag)) {
        // Compare against the same plural id in English, whose categories may
        // differ, so fall back to any sibling form.
        const { id } = splitPlural(key);
        const base =
          reference.get(key) ?? [...reference].find(([k]) => splitPlural(k).id === id)?.[1];
        if (base === undefined) continue;
        expect(vars(text), `${tag}: ${key}`).toEqual(vars(base));
      }
    }
  });

  describe("plural selection through i18next", () => {
    beforeAll(async () => {
      await i18next.init({
        lng: "en",
        fallbackLng: "en",
        defaultNS: "app",
        resources: { en: { app: en }, pl: { app: pl } },
        interpolation: { escapeValue: false },
      });
    });

    it("agrees with Intl.PluralRules about which form each count takes", async () => {
      for (const tag of TAGS) {
        await i18next.changeLanguage(tag);
        const rules = new Intl.PluralRules(tag);
        const forms = LOCALES[tag].plate as Record<string, string | undefined>;
        for (const n of [0, 1, 2, 3, 5, 11, 21, 22, 25, 101, 112]) {
          const template = forms[`callouts_${rules.select(n)}`];
          // Not an assertion: a category with no entry is precisely the bug
          // this test is for, and it should read as a missing form rather than
          // as a crash in the test.
          expect(template, `${tag}: no form for ${rules.select(n)}`).toBeTypeOf("string");
          expect(i18next.t("plate.callouts", { count: n }), `${tag} n=${n}`).toBe(
            template?.replace("{{count}}", String(n)),
          );
        }
      }
    });

    it("puts a Polish count in the right form for 2, 5 and 22", async () => {
      // The concrete case the abstract test above is standing in for. Polish
      // takes `few` for 2-4, `many` for 5-21, and `few` again at 22.
      await i18next.changeLanguage("pl");
      expect(i18next.t("plate.callouts", { count: 1 })).toBe("1 odnośnik");
      expect(i18next.t("plate.callouts", { count: 2 })).toBe("2 odnośniki");
      expect(i18next.t("plate.callouts", { count: 5 })).toBe("5 odnośników");
      expect(i18next.t("plate.callouts", { count: 22 })).toBe("22 odnośniki");
    });
  });
});
