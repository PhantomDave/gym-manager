// The one status rule.
//
// The backend hands over two raw dates and whether an ID document is on file;
// every colour in the interface is
// decided here and nowhere else. A view that needs to know whether someone is
// in good standing calls this — it never compares dates itself.

import { t } from "../i18n.js";
import { daysUntil, fmtDate } from "./format.js";
import type { BadgeSpec, StatusSettings, Tone } from "../types.js";

/** Worst tone wins: one red badge makes the whole row red. */
const RANK: Record<Tone, number> = { ok: 0, plain: 0, warn: 1, blocked: 2 };
const worst = (a: Tone, b: Tone): Tone => (RANK[b] > RANK[a] ? b : a);

export interface Status {
  tone: Tone;
  membership: BadgeSpec;
  certificate: BadgeSpec;
  /** Membership and certificate, then the ID document only when it is missing. */
  badges: BadgeSpec[];
}

export function statusOf(
  row: { paidThrough: string | null; certThrough: string | null; hasIdDocument: boolean },
  settings: StatusSettings,
): Status {
  const membership = membershipBadge(row.paidThrough, settings);
  const certificate = certificateBadge(row.certThrough, settings);
  // Amber, not red: a missing ID is paperwork to chase, not a reason to turn
  // someone away at the door the way a missing certificate is. A member who
  // has one gets no badge for it, so the rows stay as short as they were.
  const idDocument: BadgeSpec | null = row.hasIdDocument
    ? null
    : { tone: "warn", text: t("status.id_doc_missing") };
  const badges = [membership, certificate, ...(idDocument ? [idDocument] : [])];
  return {
    tone: badges.reduce<Tone>((acc, b) => worst(acc, b.tone), "ok"),
    membership,
    certificate,
    badges,
  };
}

function membershipBadge(
  paidThrough: string | null,
  { graceDays, warnDays }: StatusSettings,
): BadgeSpec {
  const days = daysUntil(paidThrough);

  if (days === null) return { tone: "blocked", text: t("status.no_membership") };
  if (days < -graceDays) {
    return { tone: "blocked", text: t("status.expired_on", { date: fmtDate(paidThrough) }) };
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

  if (days === null) return { tone: "blocked", text: t("status.cert_missing") };
  if (days < 0) return { tone: "blocked", text: t("status.cert_expired") };
  if (days <= certWarnDays) return { tone: "warn", text: t("status.cert_days", { count: days }) };
  return { tone: "ok", text: t("status.cert_valid") };
}

/**
 * Badge for a discipline, from the expiry that applies to it. The same rule as
 * the membership — grace and warning days included — because a discipline is
 * covered time, not a certificate. `null` means it follows a membership that
 * does not exist yet, which is not the same as "never enrolled".
 */
export const disciplineBadge = (through: string | null, settings: StatusSettings): BadgeSpec =>
  through === null
    ? { tone: "blocked", text: t("discipline.no_membership") }
    : membershipBadge(through, settings);

/** Tone for a document row, from its expiry. Documents without one are neutral. */
export function documentTone(expiresOn: string | null, certWarnDays: number): Tone {
  const days = daysUntil(expiresOn);
  if (days === null) return "plain";
  if (days < 0) return "blocked";
  return days <= certWarnDays ? "warn" : "ok";
}
