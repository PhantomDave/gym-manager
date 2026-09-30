// The call list.
//
// Memberships, certificates and custom discipline expiries arrive as one stream sorted by date, split into
// what has already lapsed and what is coming. Overdue leads, because that is
// the actual work; upcoming is only the warning.

import { useEffect, useState } from "preact/hooks";
import { t, type MessageKey } from "../i18n.js";
import { api } from "../api.js";
import { Empty } from "../components/ui.js";
import { fmtDate } from "../lib/format.js";
import type { Expiry, Tone } from "../types.js";

const WINDOWS = [7, 30, 90] as const;

/** Every kind but `discipline`, whose label carries the discipline's name. */
const KIND_LABEL: Record<Exclude<Expiry["kind"], "discipline">, MessageKey> = {
  membership: "expiries.memberships",
  certificate: "expiries.certificates",
  certificate_missing: "expiries.certificates",
  id_document_missing: "doc.id_card",
};

export function ExpiriesView({
  refreshKey,
  onOpenMember,
}: {
  refreshKey: number;
  onOpenMember: (id: number) => void;
}) {
  const [days, setDays] = useState<number>(30);
  const [rows, setRows] = useState<Expiry[]>([]);
  const [missing, setMissing] = useState<Expiry[]>([]);
  const [noIdDoc, setNoIdDoc] = useState<Expiry[]>([]);

  useEffect(() => {
    void (async () => setRows(await api.expiriesList(days, 60)))();
  }, [days, refreshKey]);

  // The dateless lists do not depend on the window, so switching 7/30/90 days
  // does not re-read them.
  useEffect(() => {
    void (async () => {
      const [none, noId] = await Promise.all([api.certificatesMissing(), api.idDocumentsMissing()]);
      setMissing(none);
      setNoIdDoc(noId);
    })();
  }, [refreshKey]);

  const overdue = rows.filter((r) => r.daysLeft < 0);
  const upcoming = rows.filter((r) => r.daysLeft >= 0);

  return (
    <section class="view">
      <header class="view-head">
        <div>
          <h1>{t("expiries.title")}</h1>
          <div class="muted">{t("expiries.subtitle")}</div>
        </div>
      </header>

      <div class="toolbar">
        <span class="field-label">{t("expiries.window")}</span>
        <div class="chips" role="group">
          {WINDOWS.map((w) => (
            <button
              key={w}
              class={`chip ${w === days ? "is-active" : ""}`}
              aria-pressed={w === days}
              onClick={() => setDays(w)}
            >
              {t(`expiries.window_${w}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>

      <Group title={t("expiries.overdue")} rows={overdue} tone="blocked" onOpenMember={onOpenMember} />

      {missing.length > 0 && (
        <Group
          title={t("status.cert_missing")}
          rows={missing}
          tone="blocked"
          dateless
          onOpenMember={onOpenMember}
        />
      )}

      {noIdDoc.length > 0 && (
        <Group
          title={t("status.id_doc_missing")}
          rows={noIdDoc}
          tone="warn"
          dateless
          onOpenMember={onOpenMember}
        />
      )}

      <Group title={t("expiries.upcoming")} rows={upcoming} tone="warn" onOpenMember={onOpenMember} />
    </section>
  );
}

function kindLabel(r: Expiry): string {
  return r.kind === "discipline"
    ? t("expiries.discipline", { name: r.label ?? "" })
    : t(KIND_LABEL[r.kind]);
}

function Group({
  title,
  rows,
  tone,
  onOpenMember,
  dateless = false,
}: {
  title: string;
  rows: Expiry[];
  tone: Tone;
  onOpenMember: (id: number) => void;
  dateless?: boolean;
}) {
  return (
    <div class="panel">
      <h2>
        {title} {rows.length > 0 && <span class="count">{rows.length}</span>}
      </h2>
      {rows.length > 0 ? (
        <div class="list">
          {rows.map((r) => (
            <button
              key={`${r.kind}-${r.memberId}-${r.label ?? ""}`}
              class="row row-button"
              onClick={() => onOpenMember(r.memberId)}
            >
              <div class="grow">
                <div class="name">
                  {r.lastName}, {r.firstName}
                </div>
                <div class="sub">
                  {kindLabel(r)}
                  {!dateless && ` · ${fmtDate(r.date)}`}
                </div>
              </div>
              {r.phone && <span class="phone">{r.phone}</span>}
              {!dateless && (
                <span class={`badge ${tone}`}>
                  {t("status.days_left", { count: Math.abs(r.daysLeft) })}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <Empty>{t("expiries.none")}</Empty>
      )}
    </div>
  );
}
