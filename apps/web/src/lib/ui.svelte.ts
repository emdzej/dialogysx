/**
 * The interface language.
 *
 * Distinct from `settings.language`, and the distinction matters: that one
 * selects which `langue/<code>/` the *catalogue* is read from — criterion
 * names, assembly names, the menu — and is constrained by what the discs
 * shipped. This one is the language of the application's own chrome, and is
 * constrained only by what has been translated here. A Polish user reading an
 * English-only tree wants Polish buttons and English part names, so conflating
 * the two would make that unreachable.
 *
 * i18next does the work that is genuinely hard: interpolation, and choosing a
 * plural form through `Intl.PluralRules`. Polish has four categories where
 * English has two, and getting that right by hand is how you end up with
 * "1 części".
 *
 * What is deliberately *not* i18next's job here is deciding which language to
 * use. `i18next-browser-languagedetector` exists for it, but it caches what it
 * detected as though the user had chosen it — which breaks "follow my browser":
 * change your system language, or travel, and the app keeps the language it
 * first saw. Storing the *preference* and resolving it on every load is a
 * couple of dozen lines and does not have that bug.
 */
import i18next, { type ParseKeys } from "i18next";
import en from "../i18n/locales/en.json";
import pl from "../i18n/locales/pl.json";

/** Every interface locale, each labelled in its own language. */
export const UI_LOCALES = [
  { tag: "en", label: "English" },
  { tag: "pl", label: "Polski" },
] as const;

export type UiLocale = (typeof UI_LOCALES)[number]["tag"];

/** `"system"` follows the browser; anything else is an explicit choice. */
export type UiPreference = "system" | UiLocale;

const KEY = "dialogysx.uiLocale";
const TAGS: readonly string[] = UI_LOCALES.map((l) => l.tag);
const FALLBACK: UiLocale = "en";

function isLocale(tag: string): tag is UiLocale {
  return TAGS.includes(tag);
}

/**
 * Pick the best available locale from a list of preferences.
 *
 * `navigator.languages` is in the user's own order and may carry regions
 * (`pl-PL`, `en-GB`), so each entry is tried whole and then by its base tag
 * before moving on to the next one. Trying every entry's base tag only after
 * exhausting all the whole tags would be wrong: from `["pl-PL", "en-US"]` a
 * Polish speaker must get Polish, and a loop ordered the other way gives them
 * English if `pl-PL` is not listed verbatim.
 */
export function negotiateLocale(
  preferred: readonly string[],
  available: readonly string[],
  fallback: string,
): string {
  for (const want of preferred) {
    const tag = want.toLowerCase();
    if (available.includes(tag)) return tag;
    const base = tag.split("-")[0]!;
    if (available.includes(base)) return base;
  }
  return fallback;
}

function readPreference(): UiPreference {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "system") return "system";
    if (stored && isLocale(stored)) return stored;
  } catch {
    // Private browsing can refuse localStorage outright. Following the browser
    // is the right default when we cannot remember a choice.
  }
  return "system";
}

/** What the browser asks for, most-preferred first. */
function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean);
}

function resolve(preference: UiPreference): UiLocale {
  if (preference !== "system") return preference;
  const tag = negotiateLocale(browserLanguages(), TAGS, FALLBACK);
  return isLocale(tag) ? tag : FALLBACK;
}

const state = $state({
  preference: readPreference(),
  resolved: FALLBACK as UiLocale,
});
state.resolved = resolve(state.preference);

void i18next.init({
  lng: state.resolved,
  // English is the source catalogue, so a key missing from another locale reads
  // as English rather than as its own key — a gap looks untranslated instead of
  // looking broken. `parity.test.ts` is what stops the gap shipping.
  fallbackLng: FALLBACK,
  defaultNS: "app",
  resources: { en: { app: en }, pl: { app: pl } },
  interpolation: {
    // Svelte escapes on the way into the DOM already, and doing it twice turns
    // an apostrophe in a French part name into `&#39;`.
    escapeValue: false,
  },
});

syncDocumentLanguage();

/**
 * Tell the document what language it is in.
 *
 * Not decoration: it is what a screen reader uses to choose a voice, and what
 * `:lang()` and hyphenation rules key off.
 */
function syncDocumentLanguage(): void {
  if (typeof document !== "undefined") document.documentElement.lang = state.resolved;
}

/** The preference as stored — `"system"` or an explicit tag. */
export function uiPreference(): UiPreference {
  return state.preference;
}

/** The locale actually in use, for `Intl` formatting elsewhere. */
export function uiLocale(): UiLocale {
  return state.resolved;
}

/** Choose a language, or `"system"` to follow the browser from now on. */
export function setUiPreference(preference: UiPreference): void {
  state.preference = preference;
  state.resolved = resolve(preference);
  try {
    localStorage.setItem(KEY, preference);
  } catch {
    // A choice that cannot be remembered still applies for this visit.
  }
  void i18next.changeLanguage(state.resolved);
  syncDocumentLanguage();
}

/**
 * A number, grouped for the interface locale.
 *
 * `toLocaleString()` with no argument formats for the *system* locale, which
 * is a different thing: a Polish interface on an English machine would group
 * as `1,234` where it wants `1 234`. Passing the resolved locale is the whole
 * fix, and reading the rune keeps it reactive like `ui()`.
 *
 * Counts are interpolated as a separate `n` variable rather than through
 * `{{count}}`, because i18next uses `count` to pick the plural form and
 * substitutes it unformatted.
 */
export function num(value: number): string {
  void state.resolved;
  return value.toLocaleString(state.resolved);
}

/** A message key, checked against `en.json` — see `i18n/i18next.d.ts`. */
export type MessageId = ParseKeys<"app">;

/**
 * Translate an interface string.
 *
 * Reads `state.resolved` before delegating so that every call site registers a
 * dependency on it. i18next is not reactive, so without that line a language
 * change would update nothing already on screen.
 */
export function ui(id: MessageId, vars?: Record<string, string | number>): string {
  void state.resolved;
  return i18next.t(id, vars ?? {});
}
