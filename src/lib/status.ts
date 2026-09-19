// The one status rule.
//
// The backend hands over two raw dates; every colour in the interface is
// decided here and nowhere else. A view that needs to know whether someone is
// in good standing calls this — it never compares dates itself.

import { t } from "../i18n.js";
import { daysUntil, fmtDate } from "./format.js";
import type { BadgeSpec, StatusSettings, Tone } from "../types.js";

/** Worst tone wins: one red badge makes the whole row red. */
const RANK: Record<Tone, number> = { ok: 0, plain: 0, warn: 1, bad: 2 };
const worst = (a: Tone, b: Tone): Tone => (RANK[b] > RANK[a] ? b : a);

export interface Status {
  tone: Tone;
  membership: BadgeSpec;
  certificate: BadgeSpec;
  badges: BadgeSpec[];
}

export function statusOf(
  row: { paidThrough: string | null; certThrough: string | null },
  settings: StatusSettings,
): Status {
  const membership = membershipBadge(row.paidThrough, settings);
  const certificate = certificateBadge(row.certThrough, settings);
  return {
    tone: worst(membership.tone, certificate.tone),
    membership,
    certificate,
    badges: [membership, certificate],
  };
}

function membershipBadge(
  paidThrough: string | null,
  { graceDays, warnDays }: StatusSettings,
): BadgeSpec {
  const days = daysUntil(paidThrough);

  if (days === null) return { tone: "bad", text: t("status.no_membership") };
  if (days < -graceDays) {
    return { tone: "bad", text: t("status.expired_on", { date: fmtDate(paidThrough) }) };
  }
  if (days < 0) return { tone: "warn", text: t("status.in_grace") };
  if (days === 0) return { tone: "warn", text: t("status.ends_today") };
  if (days <= warnDays) return { tone: "warn", text: t("status.days_left", { count: days }) };
  return { tone: "ok", text: t("status.paid_until", { date: fmtDate(paidThrough) }) };
}

function certificateBadge(
  certThrough: string | null,
  { certWarnDays }: StatusSettings,
): BadgeSpec {
  const days = daysUntil(certThrough);

  if (days === null) return { tone: "bad", text: t("status.cert_missing") };
  if (days < 0) return { tone: "bad", text: t("status.cert_expired") };
  if (days <= certWarnDays) return { tone: "warn", text: t("status.cert_days", { count: days }) };
  return { tone: "ok", text: t("status.cert_valid") };
}

/** Tone for a document row, from its expiry. Documents without one are neutral. */
export function documentTone(expiresOn: string | null, certWarnDays: number): Tone {
  const days = daysUntil(expiresOn);
  if (days === null) return "plain";
  if (days < 0) return "bad";
  return days <= certWarnDays ? "warn" : "ok";
}
