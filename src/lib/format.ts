// Date and money formatting.
//
// Every Intl call takes the chosen locale explicitly. Passing `undefined` reads
// the operating system's locale, which on a machine installed in English would
// show an Italian interface with American dates.

import { locale, t } from "../i18n.js";

let currency = "EUR";
export const setCurrency = (code: string | null | undefined): void => {
  currency = code || "EUR";
};

export const pad = (n: number): string => String(n).padStart(2, "0");

/** Today as `YYYY-MM-DD` in local time, matching what the backend stores. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days from today to an ISO date. Negative once it has passed. */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms =
    new Date(`${iso}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime();
  return Math.round(ms / 86_400_000);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return t("date.unset");
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export const fmtTime = (timestamp: string | null | undefined): string =>
  timestamp ? timestamp.slice(11, 16) : "";

export function fmtMoney(cents: number | null | undefined): string {
  return new Intl.NumberFormat(locale(), { style: "currency", currency }).format(
    (cents ?? 0) / 100,
  );
}

/**
 * Money is entered in euros and stored in cents.
 *
 * A comma is accepted as the decimal separator: an Italian operator types
 * `35,50`, and `parseFloat` would read that as 35 and silently lose fifty cents.
 */
export function eurosToCents(value: string | number): number {
  const n = parseFloat(String(value).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export const centsToEuros = (cents: number | null | undefined): string =>
  ((cents ?? 0) / 100).toFixed(2);

export const fmtBytes = (bytes: number | null | undefined): string =>
  `${Math.round((bytes ?? 0) / 1024)} KB`;
