// Every dialog in the app. They share one shape: local state, one confirm
// handler, and nothing rendered until the caller decides to show it.
//
// A failed confirm keeps the dialog open. The toast already carries the reason,
// and closing would make the operator retype a whole form to fix one field.

import { useRef, useState } from "preact/hooks";
import { t } from "../i18n.js";
import { FEATURES } from "../features.js";
import { api, pickDocument } from "../api.js";
import { Dialog } from "./Dialog.js";
import { DateField } from "./DateField.js";
import { Field, Select } from "./ui.js";
import { centsToEuros, eurosToCents, fmtDate, today } from "../lib/format.js";
import type {
  Discipline,
  DocumentKind,
  Member,
  MemberInput,
  PaymentMethod,
  RenewalPreview,
} from "../types.js";

/** The form's own state: every field a plain string, never null — text
 * inputs have no null state, only blank. Assignable directly to `MemberInput`
 * (whose optional fields are `string | null`) wherever it is sent to Rust. */
type MemberFormValues = { [K in keyof MemberInput]: string };

/** The association card normally lapses on 31 December of the year it was
 * issued. Only a proposal: the operator can pick any other date. It is offered
 * on a new member and whenever a card number is first entered, never written
 * over a stored NULL on edit — that would save a date nobody chose. */
const defaultCardExpiry = (): string => `${today().slice(0, 4)}-12-31`;

const emptyMember = (): MemberFormValues => ({
  firstName: "",
  lastName: "",
  nationalId: "",
  birthDate: "",
  phone: "",
  email: "",
  emergencyContact: "",
  emergencyPhone: "",
  notes: "",
  teachers: "",
  cardNumber: "",
  cardExpiresOn: defaultCardExpiry(),
});

/** SQLite gives NULL; form inputs want "". */
function toInput(member: Member): MemberFormValues {
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
    teachers: member.teachers ?? "",
    cardNumber: member.cardNumber ?? "",
    cardExpiresOn: member.cardExpiresOn ?? "",
  };
}

/** One discipline row on the new-member form. */
interface DisciplineEntry {
  key: number;
  name: string;
  /** "" means it follows the membership. */
  expiresOn: string;
  /** Some of the date's selects are set but not all; see DateField. */
  partial: boolean;
  nameError?: string;
  dateError?: string;
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
  const [form, setForm] = useState<MemberFormValues>(() =>
    editing ? toInput(member) : emptyMember(),
  );
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string }>({});
  // Each entry carries a stable key: a DateField keeps its own half-picked
  // selects, and index keys would hand them to the next row on removal.
  const [disciplines, setDisciplines] = useState<DisciplineEntry[]>([]);
  const nextKey = useRef(0);
  const editDiscipline = (key: number, patch: Partial<DisciplineEntry>) =>
    setDisciplines((ds) =>
      ds.map((d) =>
        d.key === key ? { ...d, ...patch, nameError: undefined, dateError: undefined } : d,
      ),
    );
  const [busy, setBusy] = useState(false);

  const set =
    <K extends keyof MemberFormValues>(key: K) =>
    (value: string) => {
      setForm((f) => {
        const next = { ...f, [key]: value };
        // A card number typed into a blank field brings the usual expiry with
        // it, unless one is already there.
        if (key === "cardNumber" && !f.cardNumber.trim() && value.trim() && !f.cardExpiresOn) {
          next.cardExpiresOn = defaultCardExpiry();
        }
        return next;
      });
      if (key === "firstName" || key === "lastName") {
        setErrors((e) => ({ ...e, [key]: undefined }));
      }
    };

  const confirm = async () => {
    const nextErrors: typeof errors = {};
    if (!form.firstName.trim()) nextErrors.firstName = t("form.field_required");
    if (!form.lastName.trim()) nextErrors.lastName = t("form.field_required");
    // A half-picked date would reach Rust as "" and silently mean "follows
    // the membership"; a date with no name is a half-filled row. Neither is
    // dropped in silence.
    const checked = disciplines.map((d) => ({
      ...d,
      nameError:
        !d.name.trim() && (d.expiresOn || d.partial) ? t("form.field_required") : undefined,
      dateError: d.partial ? t("form.date_incomplete") : undefined,
    }));
    const disciplineError = checked.some((d) => d.nameError || d.dateError);
    if (disciplineError) setDisciplines(checked);
    if (nextErrors.firstName || nextErrors.lastName || disciplineError) {
      setErrors(nextErrors);
      return;
    }

    setBusy(true);
    try {
      if (editing) {
        await api.memberUpdate(member.id, form);
        onDone(member.id, t("form.saved"));
      } else {
        const chosen = disciplines
          .filter((d) => d.name.trim())
          .map((d) => ({ name: d.name, expiresOn: d.expiresOn || null }));
        onDone(await api.memberCreate(form, chosen), t("form.created"));
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
          value={form.firstName} onInput={set("firstName")} error={errors.firstName} />
        <Field id="f-last" label={t("field.last_name")} required
          value={form.lastName} onInput={set("lastName")} error={errors.lastName} />
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
        <Field id="f-teachers" label={t("field.teachers")}
          value={form.teachers} onInput={set("teachers")} />
        <Field id="f-card" label={t("field.card_number")}
          value={form.cardNumber} onInput={set("cardNumber")} />
        <DateField id="f-card-expiry" label={t("field.card_expires_on")}
          value={form.cardExpiresOn} onInput={set("cardExpiresOn")}
          hint={t("form.card_expiry_hint")} />
        <Field id="f-notes" label={t("field.notes")} full
          value={form.notes} onInput={set("notes")} />
      </div>

      {!editing && (
        <fieldset class="form-block">
          <legend class="field-label">{t("member.disciplines")}</legend>
          {disciplines.map((d, i) => (
            <div key={d.key} class="discipline-entry">
              <div class="inline-entry">
                <Field id={`f-disc-${d.key}`} label={`${t("discipline.name")} ${i + 1}`}
                  placeholder={t("discipline.name_placeholder")} value={d.name} error={d.nameError}
                  onInput={(v) => editDiscipline(d.key, { name: v })} />
                <button type="button" class="btn btn-ghost btn-icon btn-danger"
                  aria-label={t("discipline.remove")}
                  onClick={() => setDisciplines((ds) => ds.filter((x) => x.key !== d.key))}>
                  ✕
                </button>
              </div>
              <DateField id={`f-disc-exp-${d.key}`} label={t("discipline.expires_on")}
                value={d.expiresOn} hint={t("discipline.expires_hint")} error={d.dateError}
                onInput={(v) => editDiscipline(d.key, { expiresOn: v })}
                onPartial={(partial) => editDiscipline(d.key, { partial })}
                from={thisYear - 1} to={thisYear + 5} />
            </div>
          ))}
          <button type="button" class="btn"
            onClick={() => {
              const key = nextKey.current++;
              setDisciplines((ds) => [...ds, { key, name: "", expiresOn: "", partial: false }]);
            }}>
            {t("discipline.add")}
          </button>
          <div class="hint">{t("discipline.form_hint")}</div>
        </fieldset>
      )}
    </Dialog>
  );
}

/** Sell a period. The start comes from the backend and is never editable (it
 * carries the stacking rule); the end is the backend's one-month proposal,
 * which the operator may change. */
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
  // null when the payment-method feature is off: the column is nullable, so the
  // renewal is recorded with no method rather than a guessed one.
  const [method, setMethod] = useState<PaymentMethod | null>(
    FEATURES.payments && FEATURES.paymentMethod ? "cash" : null,
  );
  const [note, setNote] = useState("");
  const [endsOn, setEndsOn] = useState(preview.endsOn);
  // The end can only fall in the start's year or the next: a slip on a wider
  // year list would record a membership that runs for a decade, and years
  // before the start would only be refused by the backend.
  const startYear = parseInt(preview.startsOn.slice(0, 4), 10);
  const [endError, setEndError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!endsOn) {
      setEndError(t("form.field_required"));
      return;
    }
    setBusy(true);
    try {
      await api.membershipRenew({
        memberId,
        // With payments off nothing about money is asked, so nothing is
        // claimed: zero, not the default fee — see src/features.ts.
        priceCents: FEATURES.payments ? eurosToCents(price) : 0,
        paidCents: FEATURES.payments ? eurosToCents(paid) : 0,
        paymentMethod: method,
        note,
        // Untouched, the backend recomputes the end itself rather than trusting
        // a date that could be stale by the time this is sent.
        endsOn: endsOn === preview.endsOn ? null : endsOn,
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
      confirmText={FEATURES.payments ? t("pay.take") : t("pay.take_renewal")}
      onConfirm={confirm}
      onCancel={onClose}
      busy={busy}
    >
      <div class="period-summary">
        <div>
          <span class="k">{t("pay.from")}</span>
          {fmtDate(preview.startsOn)}
        </div>
      </div>
      <div class="form-grid">
        <DateField id="p-ends" label={t("pay.to")} required value={endsOn}
          onInput={(v) => {
            setEndsOn(v);
            setEndError(undefined);
          }}
          hint={t("pay.end_hint", { date: fmtDate(preview.endsOn) })} error={endError}
          from={startYear} to={startYear + 1} />
        {FEATURES.payments && (
          <>
            <Field id="p-price" label={`${t("field.price")} (${currency})`} inputMode="decimal"
              autoFocus value={price} onInput={setPrice} />
            <Field id="p-paid" label={`${t("field.paid")} (${currency})`} inputMode="decimal"
              value={paid} onInput={setPaid} />
          </>
        )}
        {FEATURES.payments && FEATURES.paymentMethod && (
          <Select id="p-method" label={t("field.method")} value={method ?? "cash"}
            onInput={(v) => setMethod(v as PaymentMethod)}
            options={[
              { value: "cash", label: t("pay.cash") },
              { value: "card", label: t("pay.card") },
              { value: "transfer", label: t("pay.transfer") },
            ]} />
        )}
        <Field id="p-note" label={t("field.note")} full={!FEATURES.payments} value={note}
          onInput={setNote} />
      </div>
    </Dialog>
  );
}

/**
 * Add a discipline, or edit one. An empty expiry means it follows the
 * membership; the button under a set date clears it back to that.
 */
export function DisciplineDialog({
  memberId,
  discipline,
  onClose,
  onDone,
}: {
  memberId: number;
  discipline?: Discipline;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const editing = discipline !== undefined;
  const [name, setName] = useState(discipline?.name ?? "");
  const [expiresOn, setExpiresOn] = useState(discipline?.expiresOn ?? "");
  const [partial, setPartial] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [dateError, setDateError] = useState<string | undefined>(undefined);
  // Remounting the DateField is the one way to clear selects that are only
  // half set: their value is already "", so setting "" again changes nothing.
  const [dateKey, setDateKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const followMembership = () => {
    setExpiresOn("");
    setPartial(false);
    setDateError(undefined);
    setDateKey((k) => k + 1);
  };

  const confirm = async () => {
    if (!name.trim()) setNameError(t("form.field_required"));
    if (partial) setDateError(t("form.date_incomplete"));
    if (!name.trim() || partial) return;
    setBusy(true);
    const input = { name, expiresOn: expiresOn || null };
    try {
      if (editing) {
        await api.disciplineUpdate(discipline.id, input);
        onDone(t("discipline.saved"));
      } else {
        await api.disciplineAdd(memberId, input);
        onDone(t("discipline.added"));
      }
    } catch {
      setBusy(false);
    }
  };

  const thisYear = new Date().getFullYear();
  // An expiry already on file keeps its own year selectable, however old.
  const fromYear = Math.min(thisYear - 1, Number(discipline?.expiresOn?.slice(0, 4)) || thisYear);

  return (
    <Dialog
      title={editing ? t("discipline.title_edit", { name: discipline.name }) : t("discipline.title_add")}
      confirmText={editing ? t("form.save") : t("discipline.add")}
      onConfirm={confirm}
      onCancel={onClose}
      busy={busy}
    >
      <div class="form-grid">
        <Field id="disc-name" label={t("discipline.name")} required full autoFocus
          placeholder={t("discipline.name_placeholder")} value={name} error={nameError}
          onInput={(v) => { setName(v); setNameError(undefined); }} />
        <DateField key={dateKey} id="disc-expires" label={t("discipline.expires_on")}
          value={expiresOn} hint={t("discipline.expires_hint")} error={dateError}
          onInput={(v) => { setExpiresOn(v); setDateError(undefined); }}
          onPartial={setPartial} from={fromYear} to={thisYear + 5} />
        {(expiresOn || partial) && (
          <div class="full">
            <button type="button" class="btn btn-sm" onClick={followMembership}>
              {t("discipline.follow_membership")}
            </button>
          </div>
        )}
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
  const [expiresError, setExpiresError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const chooseIssued = (value: string) => {
    setIssuedOn(value);
    if (isCert && value && !expiresOn) {
      const d = new Date(`${value}T00:00:00`);
      d.setFullYear(d.getFullYear() + 1);
      setExpiresOn(d.toISOString().slice(0, 10));
    }
  };

  const chooseExpires = (value: string) => {
    setExpiresOn(value);
    setExpiresError(undefined);
  };

  // The file itself is optional — a document can be registered before its
  // scan reaches the desk and attached later — but a certificate is useless
  // without the date that drives every expiry warning in the app.
  const confirm = async () => {
    if (isCert && !expiresOn) {
      setExpiresError(t("form.field_required"));
      return;
    }
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
          onInput={chooseExpires} required={isCert} error={expiresError}
          from={thisYear - 1} to={thisYear + 15} />
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
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(t("form.field_required"));
      return;
    }
    setBusy(true);
    try {
      await onConfirm(trimmed);
    } catch {
      setBusy(false);
    }
  };

  return (
    <Dialog title={title} hint={hint} confirmText={confirmText} onConfirm={confirm}
      onCancel={onClose} busy={busy}>
      <Field id="reason" label={label} full value={reason}
        onInput={(v) => { setReason(v); setError(undefined); }}
        placeholder={placeholder} error={error} autoFocus />
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
