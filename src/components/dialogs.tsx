// Every dialog in the app. They share one shape: local state, one confirm
// handler, and nothing rendered until the caller decides to show it.
//
// A failed confirm keeps the dialog open. The toast already carries the reason,
// and closing would make the operator retype a whole form to fix one field.

import { useState } from "preact/hooks";
import { t } from "../i18n.js";
import { api, pickDocument } from "../api.js";
import { Dialog } from "./Dialog.js";
import { DateField } from "./DateField.js";
import { Field, Select } from "./ui.js";
import { centsToEuros, eurosToCents, fmtDate } from "../lib/format.js";
import type {
  DocumentKind,
  Member,
  MemberInput,
  PaymentMethod,
  RenewalPreview,
} from "../types.js";

const EMPTY_MEMBER: MemberInput = {
  firstName: "",
  lastName: "",
  nationalId: "",
  birthDate: "",
  phone: "",
  email: "",
  emergencyContact: "",
  emergencyPhone: "",
  notes: "",
};

/** SQLite gives NULL; form inputs want "". */
function toInput(member: Member): MemberInput {
  return {
    firstName: member.firstName,
    lastName: member.lastName,
    nationalId: member.nationalId ?? "",
    birthDate: member.birthDate ?? "",
    phone: member.phone ?? "",
    email: member.email ?? "",
    emergencyContact: member.emergencyContact ?? "",
    emergencyPhone: member.emergencyPhone ?? "",
    notes: member.notes ?? "",
  };
}

/** Create or edit a member. One form for both — only the verb changes. */
export function MemberFormDialog({
  member,
  onClose,
  onDone,
}: {
  member?: Member;
  onClose: () => void;
  onDone: (id: number, message: string) => void;
}) {
  const editing = member !== undefined;
  const [form, setForm] = useState<MemberInput>(editing ? toInput(member) : EMPTY_MEMBER);
  const [busy, setBusy] = useState(false);

  const set =
    <K extends keyof MemberInput>(key: K) =>
    (value: string) =>
      setForm((f) => ({ ...f, [key]: value }));

  const confirm = async () => {
    setBusy(true);
    try {
      if (editing) {
        await api.memberUpdate(member.id, form);
        onDone(member.id, t("form.saved"));
      } else {
        onDone(await api.memberCreate(form), t("form.created"));
      }
    } catch {
      setBusy(false);
    }
  };

  const thisYear = new Date().getFullYear();

  return (
    <Dialog
      title={
        editing
          ? t("form.edit_member", { name: `${member.firstName} ${member.lastName}` })
          : t("form.new_member")
      }
      confirmText={editing ? t("form.save") : t("form.create")}
      onConfirm={confirm}
      onCancel={onClose}
      busy={busy}
    >
      <div class="form-grid">
        <Field id="f-first" label={t("field.first_name")} required autoFocus
          value={form.firstName} onInput={set("firstName")} />
        <Field id="f-last" label={t("field.last_name")} required
          value={form.lastName} onInput={set("lastName")} />
        <Field id="f-nid" label={t("field.national_id")}
          value={form.nationalId} onInput={set("nationalId")} />
        <DateField id="f-birth" label={t("field.birth_date")} value={form.birthDate}
          onInput={set("birthDate")} from={1920} to={thisYear} />
        <Field id="f-phone" label={t("field.phone")} type="tel" inputMode="tel"
          value={form.phone} onInput={set("phone")} />
        <Field id="f-email" label={t("field.email")} type="email" inputMode="email"
          value={form.email} onInput={set("email")} />
        <Field id="f-ec" label={t("field.emergency_contact")}
          value={form.emergencyContact} onInput={set("emergencyContact")} />
        <Field id="f-ep" label={t("field.emergency_phone")} type="tel" inputMode="tel"
          value={form.emergencyPhone} onInput={set("emergencyPhone")} />
        <Field id="f-notes" label={t("field.notes")} full
          value={form.notes} onInput={set("notes")} />
      </div>
    </Dialog>
  );
}

/** Sell one month. The dates come from the backend and are never editable. */
export function RenewDialog({
  memberId,
  preview,
  currency,
  onClose,
  onDone,
}: {
  memberId: number;
  preview: RenewalPreview;
  currency: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [price, setPrice] = useState(centsToEuros(preview.priceCents));
  const [paid, setPaid] = useState(centsToEuros(preview.priceCents));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await api.membershipRenew({
        memberId,
        priceCents: eurosToCents(price),
        paidCents: eurosToCents(paid),
        paymentMethod: method,
        note,
      });
      onDone(t("pay.done"));
    } catch {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("pay.title")}
      hint={preview.stacks ? t("pay.stacks") : t("pay.fresh")}
      confirmText={t("pay.take")}
      onConfirm={confirm}
      onCancel={onClose}
      busy={busy}
    >
      <div class="period-summary">
        <div>
          <span class="k">{t("pay.from")}</span>
          {fmtDate(preview.startsOn)}
        </div>
        <div>
          <span class="k">{t("pay.to")}</span>
          {fmtDate(preview.endsOn)}
        </div>
      </div>
      <div class="form-grid">
        <Field id="p-price" label={`${t("field.price")} (${currency})`} inputMode="decimal"
          autoFocus value={price} onInput={setPrice} />
        <Field id="p-paid" label={`${t("field.paid")} (${currency})`} inputMode="decimal"
          value={paid} onInput={setPaid} />
        <Select id="p-method" label={t("field.method")} value={method}
          onInput={(v) => setMethod(v as PaymentMethod)}
          options={[
            { value: "cash", label: t("pay.cash") },
            { value: "card", label: t("pay.card") },
            { value: "transfer", label: t("pay.transfer") },
          ]} />
        <Field id="p-note" label={t("field.note")} value={note} onInput={setNote} />
      </div>
    </Dialog>
  );
}

const OTHER_KINDS: DocumentKind[] = ["id_card", "waiver", "contract", "photo", "receipt", "other"];

/**
 * Attach a document. With `isCert` it becomes the certificate flow: the expiry
 * is required and prefilled a year from the issue date, because a year is what
 * a certificate almost always runs for and counting months by hand invites a
 * mistake in the one field that matters.
 */
export function DocumentDialog({
  memberId,
  isCert,
  onClose,
  onDone,
}: {
  memberId: number;
  isCert: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [path, setPath] = useState<string | null>(null);
  const [kind, setKind] = useState<DocumentKind>(isCert ? "health_cert" : "id_card");
  const [title, setTitle] = useState("");
  const [issuer, setIssuer] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);

  const chooseIssued = (value: string) => {
    setIssuedOn(value);
    if (isCert && value && !expiresOn) {
      const d = new Date(`${value}T00:00:00`);
      d.setFullYear(d.getFullYear() + 1);
      setExpiresOn(d.toISOString().slice(0, 10));
    }
  };

  const confirm = async () => {
    if (!path) return;
    setBusy(true);
    try {
      await api.documentAdd({
        memberId,
        kind,
        sourcePath: path,
        title,
        issuer: issuer || null,
        issuedOn,
        expiresOn,
      });
      onDone(t("doc.added"));
    } catch {
      setBusy(false);
    }
  };

  const thisYear = new Date().getFullYear();

  return (
    <Dialog
      title={isCert ? t("doc.title_cert") : t("doc.title_other")}
      confirmText={t("doc.register")}
      onConfirm={confirm}
      onCancel={onClose}
      busy={busy}
    >
      <div class="field full">
        <label>{t("doc.choose_file")}</label>
        <button
          type="button"
          class="btn btn-block"
          onClick={async () => {
            const chosen = await pickDocument();
            if (chosen) setPath(chosen);
          }}
        >
          {path ? (path.split("/").pop() ?? path) : t("doc.choose_file")}
        </button>
        {!path && <div class="hint">{t("doc.nothing_selected")}</div>}
      </div>

      <div class="form-grid">
        {!isCert && (
          <Select id="d-kind" label={t("field.kind")} value={kind}
            onInput={(v) => setKind(v as DocumentKind)}
            options={OTHER_KINDS.map((k) => ({ value: k, label: t(`doc.${k}`) }))} />
        )}
        <Field id="d-title" label={t("field.title")} value={title} onInput={setTitle} />
        <DateField id="d-issued" label={t("field.issued_on")} value={issuedOn}
          onInput={chooseIssued} from={thisYear - 10} to={thisYear} />
        <DateField id="d-expires" label={t("field.expires_on")} value={expiresOn}
          onInput={setExpiresOn} required={isCert} from={thisYear - 1} to={thisYear + 15} />
        {isCert && (
          <Field id="d-issuer" label={t("field.issuer")} full value={issuer} onInput={setIssuer} />
        )}
      </div>
    </Dialog>
  );
}

/** Anything that needs a typed reason before it happens. */
export function ReasonDialog({
  title,
  label,
  placeholder,
  hint,
  confirmText,
  onClose,
  onConfirm,
}: {
  title: string;
  label: string;
  placeholder: string;
  hint: string;
  confirmText: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } catch {
      setBusy(false);
    }
  };

  return (
    <Dialog title={title} hint={hint} confirmText={confirmText} onConfirm={confirm}
      onCancel={onClose} busy={busy}>
      <Field id="reason" label={label} full value={reason} onInput={setReason}
        placeholder={placeholder} autoFocus />
    </Dialog>
  );
}

export function ConfirmDialog({
  title,
  hint,
  confirmText,
  danger = false,
  onClose,
  onConfirm,
}: {
  title: string;
  hint: string;
  confirmText: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={title}
      hint={hint}
      confirmText={confirmText}
      danger={danger}
      busy={busy}
      onCancel={onClose}
      onConfirm={async () => {
        setBusy(true);
        try {
          await onConfirm();
        } catch {
          setBusy(false);
        }
      }}
    />
  );
}
