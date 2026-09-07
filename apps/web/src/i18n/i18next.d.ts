/**
 * Types every message key off `en.json`.
 *
 * `ui("app.setigns")` becomes a type error, and so does a key renamed out of
 * the catalogue — which is the guarantee that makes a large translation pass
 * safe to do at all.
 *
 * What it cannot check is whether `pl.json` has the same keys: i18next types
 * resources against a single language by design. That is why parity is a test
 * (`i18n/parity.test.ts`) and not a type.
 */
import type en from "./locales/en.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "app";
    resources: { app: typeof en };
    // Plural categories live in the key as `_one` / `_few` / `_many` /
    // `_other` suffixes: i18next v21+ behaviour, matching `Intl.PluralRules`.
    jsonFormat: "v4";
  }
}
