// The member card, shown as a side drawer.
//
// Everything about one person in one place: who they are, whether the
// certificate is valid, what they have paid, what is on file. The five buttons
// at the top are the five things the desk actually does.

import { useEffect, useState } from "preact/hooks";
import { t, type MessageKey } from "../i18n.js";
import { api } from "../api.js";
import { Badges, Empty, Section } from "../components/ui.js";
import {
  ConfirmDialog,
  DocumentDialog,
  MemberFormDialog,
  ReasonDialog,
  RenewDialog,
} from "../components/dialogs.js";
import { documentTone, statusOf } from "../lib/status.js";
import { daysUntil, fmtBytes, fmtDate, fmtMoney } from "../lib/format.js";
import type { Doc, MemberDetail, RenewalPreview, StatusSettings } from "../types.js";

type DialogState =
  | { kind: "edit" }
  | { kind: "renew"; preview: RenewalPreview }
  | { kind: "cert" }
  | { kind: "doc" }
  | { kind: "void"; id: number }
  | { kind: "archive" }
  | null;

export function MemberDrawer({
  memberId,
  settings,
  currency,
  onClose,
  onToast,
  onChanged,
}: {
  memberId: number;
  settings: StatusSettings;
  currency: string;
  onClose: () => void;
  onToast: (message: string) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const reload = async () => setDetail(await api.memberGet(memberId));

  useEffect(() => {
    setDetail(null);
    void reload();
  }, [memberId]);

  // Escape closes the drawer, matching what the dialogs already do. A dialog on
  // top handles its own Escape, so the drawer stands down while one is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dialog === null) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialog, onClose]);

  if (!detail) {
    return (
      <aside class="drawer">
        <div class="drawer-body" />
      </aside>
    );
  }

  const { member, memberships, documents } = detail;
  const certificates = documents.filter((d) => d.kind === "health_cert");
  const others = documents.filter((d) => d.kind !== "health_cert");

  const after = (message: string) => {
    setDialog(null);
    onToast(message);
    void reload();
    onChanged();
  };

  const openRenew = async () =>
    setDialog({ kind: "renew", preview: await api.membershipPreview(memberId) });

  const fullName = `${member.firstName} ${member.lastName}`;

  return (
    <aside class="drawer" role="dialog" aria-label={fullName}>
      <div class="drawer-head">
        <div>
          <h2>{fullName}</h2>
          <Badges items={statusOf(detail, settings).badges} />
        </div>
        <button class="btn btn-ghost btn-icon" aria-label={t("form.cancel")} onClick={onClose}>
          ✕
        </button>
      </div>

      <div class="drawer-body">
        <div class="drawer-actions">
          <button class="btn btn-primary" onClick={() => void openRenew()}>
            {t("member.renew")}
          </button>
          <button class="btn" onClick={() => setDialog({ kind: "cert" })}>
            {t("member.add_cert")}
          </button>
          <button class="btn" onClick={() => setDialog({ kind: "doc" })}>
            {t("member.add_doc")}
          </button>
          <button class="btn" onClick={() => setDialog({ kind: "edit" })}>
            {t("member.edit")}
          </button>
          <button class="btn btn-ghost btn-danger" onClick={() => setDialog({ kind: "archive" })}>
            {t("member.archive")}
          </button>
        </div>

        <Section title={t("member.certificate")}>
          {certificates.length > 0 ? (
            <DocumentList docs={certificates} settings={settings} onChanged={after} />
          ) : (
            <div class="callout bad">{t("member.no_certificate")}</div>
          )}
        </Section>

        <Section title={t("member.details")}>
          <dl class="kv">
            <dt>{t("field.national_id")}</dt>
            <dd>{member.nationalId ?? "—"}</dd>
            <dt>{t("field.birth_date")}</dt>
            <dd>{fmtDate(member.birthDate)}</dd>
            <dt>{t("field.phone")}</dt>
            <dd>{member.phone ?? "—"}</dd>
            <dt>{t("field.email")}</dt>
            <dd>{member.email ?? "—"}</dd>
            <dt>{t("field.emergency_contact")}</dt>
            <dd>
              {[member.emergencyContact, member.emergencyPhone].filter(Boolean).join(" · ") || "—"}
            </dd>
            <dt>{t("field.joined_on")}</dt>
            <dd>{fmtDate(member.joinedOn)}</dd>
            {member.notes && (
              <>
                <dt>{t("field.notes")}</dt>
                <dd>{member.notes}</dd>
              </>
            )}
          </dl>
        </Section>

        <Section title={t("member.history")}>
          {memberships.length > 0 ? (
            <div class="list">
              {memberships.map((s) => (
                <div key={s.id} class="row">
                  <div class="grow">
                    <div class={`name ${s.voidedAt ? "struck" : ""}`}>
                      {fmtDate(s.startsOn)} → {fmtDate(s.endsOn)}
                    </div>
                    <div class="sub">
                      {fmtMoney(s.paidCents)}
                      {s.paymentMethod && ` · ${t(`pay.${s.paymentMethod}` as MessageKey)}`}
                      {s.paidCents < s.priceCents &&
                        ` · ${t("pay.owes", { amount: fmtMoney(s.priceCents - s.paidCents) })}`}
                    </div>
                  </div>
                  {s.voidedAt ? (
                    <span class="badge plain">{t("pay.cancelled")}</span>
                  ) : (
                    <button
                      class="btn btn-ghost btn-sm"
                      onClick={() => setDialog({ kind: "void", id: s.id })}
                    >
                      {t("pay.cancel")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty>{t("member.no_history")}</Empty>
          )}
        </Section>

        <Section title={t("member.documents")}>
          {others.length > 0 ? (
            <DocumentList docs={others} settings={settings} onChanged={after} />
          ) : (
            <Empty>{t("member.no_documents")}</Empty>
          )}
        </Section>
      </div>

      {dialog?.kind === "edit" && (
        <MemberFormDialog
          member={member}
          onClose={() => setDialog(null)}
          onDone={(_id, message) => after(message)}
        />
      )}

      {dialog?.kind === "renew" && (
        <RenewDialog
          memberId={memberId}
          preview={dialog.preview}
          currency={currency}
          onClose={() => setDialog(null)}
          onDone={after}
        />
      )}

      {(dialog?.kind === "cert" || dialog?.kind === "doc") && (
        <DocumentDialog
          memberId={memberId}
          isCert={dialog.kind === "cert"}
          onClose={() => setDialog(null)}
          onDone={after}
        />
      )}

      {dialog?.kind === "void" && (
        <ReasonDialog
          title={t("pay.cancel_title")}
          label={t("pay.cancel_why")}
          placeholder={t("pay.cancel_placeholder")}
          hint={t("pay.cancel_hint")}
          confirmText={t("pay.cancel")}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await api.membershipVoid(dialog.id, reason);
            after(t("pay.cancelled_ok"));
          }}
        />
      )}

      {dialog?.kind === "archive" && (
        <ConfirmDialog
          title={t("archive.title", { name: fullName })}
          hint={t("archive.hint")}
          confirmText={t("archive.confirm")}
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.memberArchive(memberId);
            onToast(t("archive.done"));
            onChanged();
            onClose();
          }}
        />
      )}
    </aside>
  );
}

function DocumentList({
  docs,
  settings,
  onChanged,
}: {
  docs: Doc[];
  settings: StatusSettings;
  onChanged: (message: string) => void;
}) {
  return (
    <div class="list">
      {docs.map((d) => {
        const tone = documentTone(d.expiresOn, settings.certWarnDays);
        const left = daysUntil(d.expiresOn);
        return (
          <div key={d.id} class="row">
            <div class="grow">
              <div class="name">
                {d.title ?? d.originalName ?? t(`doc.${d.kind}` as MessageKey)}
              </div>
              <div class="sub">
                {d.expiresOn
                  ? t("doc.expires_on_short", { date: fmtDate(d.expiresOn) })
                  : t("doc.added_on", { date: fmtDate(d.addedAt.slice(0, 10)) })}
                {d.issuer && ` · ${d.issuer}`} · {fmtBytes(d.bytes)}
              </div>
            </div>
            {left !== null && (
              <span class={`badge ${tone}`}>
                {left < 0 ? t("status.cert_expired") : t("status.days_left", { count: left })}
              </span>
            )}
            <button class="btn btn-sm" onClick={() => void api.documentOpen(d.id)}>
              {t("doc.open")}
            </button>
            <button
              class="btn btn-ghost btn-sm btn-danger"
              aria-label={t("doc.remove")}
              onClick={async () => {
                await api.documentDelete(d.id);
                onChanged(t("doc.removed"));
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
