// Translation.
//
// Two rules hold this together:
//   * No user-facing sentence is built in Rust. The backend sends codes; this
//     module turns them into prose.
//   * Every Intl call takes the CHOSEN locale, never `undefined`. Reading the
//     system locale would pair an Italian interface with American dates.

import it, { type CatalogueKey } from "./locales/it.js";
import en from "./locales/en.js";
import type { AppError, Reason } from "./types.js";

const CATALOGUES = { it, en } as const;

export type Language = keyof typeof CATALOGUES;

export const LANGUAGES: ReadonlyArray<{ code: Language; label: string }> = [
  { code: "it", label: "Italiano" },
  { code: "en", label: "English" },
];

/** BCP-47 tags for Intl, which will not accept a bare language everywhere. */
const LOCALES: Record<Language, string> = { it: "it-IT", en: "en-GB" };

/**
 * Keys callers may pass: every literal key, plus the base of each plural pair.
 * `status.days_left_one` exists in the catalogue but nobody writes it — they
 * write `status.days_left` and pass a count.
 */
type PluralBase<K> = K extends `${infer Base}_one` ? Base : never;
export type MessageKey = CatalogueKey | PluralBase<CatalogueKey>;

export type Params = Record<string, string | number>;

let current: Language = "it";
let plural = new Intl.PluralRules(LOCALES.it);

export function setLanguage(code: string): Language {
  current = code in CATALOGUES ? (code as Language) : "it";
  plural = new Intl.PluralRules(LOCALES[current]);
  document.documentElement.lang = current;
  return current;
}

export const language = (): Language => current;
export const locale = (): string => LOCALES[current];

/**
 * Look up `key` and interpolate `{placeholders}`.
 *
 * With `params.count`, the catalogue's `_one`/`_other` variant is chosen by
 * Intl.PluralRules. Hardcoding `n === 1` would be a guess that breaks on the
 * first language with a third form.
 *
 * A missing key returns the key itself, on purpose: a visible `member.renew` on
 * screen gets reported and fixed, a silent empty string does not.
 */
export function t(key: MessageKey, params: Params = {}): string {
  const catalogue: Record<string, string> = CATALOGUES[current];
  let template: string | undefined = catalogue[key];

  if (params.count !== undefined) {
    const form = plural.select(Number(params.count));
    template = catalogue[`${key}_${form}`] ?? catalogue[`${key}_other`] ?? template;
  }

  // Fall back to Italian before giving up, so a gap still reads as a sentence.
  if (template === undefined) {
    const fallback: Record<string, string> = CATALOGUES.it;
    template = fallback[key] ?? fallback[`${key}_other`];
  }
  if (template === undefined) return key;

  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * Translate a `{ code, params }` pair from the backend.
 *
 * `prefix` separates the two namespaces Rust sends: `err.` for failures, and
 * nothing for entry-check reasons.
 */
export function translateCode(payload: Reason | AppError | null, prefix = ""): string {
  if (!payload) return t("err.unknown");

  const key = `${prefix}${payload.code}` as MessageKey;
  const out = t(key, numeric(payload.params ?? {}));

  // An unmapped code comes back as the key itself; show the backend's English
  // rather than a dotted identifier the operator cannot act on.
  if (out !== key) return out;
  return "message" in payload && payload.message ? payload.message : t("err.unknown");
}

/**
 * Params cross the IPC boundary as strings, because Rust serialises them from a
 * BTreeMap<&str, String>. Plural selection needs a real number.
 */
function numeric(params: Record<string, string>): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = /^-?\d+$/.test(value) ? Number(value) : value;
  }
  if (out.days !== undefined) out.count = out.days;
  return out;
}
