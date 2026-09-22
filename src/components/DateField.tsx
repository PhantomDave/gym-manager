// Date entry as three dropdowns.
//
// NOT <input type="date">. WebKitGTK does not reliably render a date picker and
// can degrade to a bare text field expecting `YYYY-MM-DD`. Asking a
// receptionist to type that is how a certificate expiry ends up wrong, and a
// wrong expiry is the one failure this feature exists to prevent.
//
// Three selects cannot be mistyped, need no locale parsing, and behave the same
// on every engine. See DECISIONS.md 11.

import { useState } from "preact/hooks";
import { t, type MessageKey } from "../i18n.js";
import { pad } from "../lib/format.js";

export interface DateFieldProps {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  required?: boolean;
  from?: number;
  to?: number;
  hint?: string;
}

/** Days in a month, so 31 February can never be selected. */
const daysIn = (year: number, month: number): number =>
  year && month ? new Date(year, month, 0).getDate() : 31;

export function DateField({
  id,
  label,
  value,
  onInput,
  required = false,
  from,
  to,
  hint,
}: DateFieldProps) {
  const thisYear = new Date().getFullYear();
  const firstYear = from ?? thisYear - 5;
  const lastYear = to ?? thisYear + 15;

  // Held locally rather than re-derived from `value` on every render: `value`
  // only carries a *complete* date (see emit below), so picking the day before
  // the month and year are set would otherwise have nothing to display and the
  // choice would appear to not register.
  const [{ y, m, d }, setParts] = useState(() => {
    const [y = 0, m = 0, d = 0] = (value || "").split("-").map((n) => parseInt(n, 10) || 0);
    return { y, m, d };
  });
  const maxDay = daysIn(y, m);

  const emit = (year: number, month: number, day: number) => {
    // Clamp rather than blank the field: switching from February to a month
    // with a 31st should keep the day the operator already chose.
    const clamped = year && month && day ? Math.min(day, daysIn(year, month)) : day;
    setParts({ y: year, m: month, d: clamped });
    if (!year || !month || !clamped) return onInput("");
    onInput(`${year}-${pad(month)}-${pad(clamped)}`);
  };

  const years: number[] = [];
  for (let year = lastYear; year >= firstYear; year--) years.push(year);

  const num = (event: Event): number =>
    parseInt((event.target as HTMLSelectElement).value, 10) || 0;

  // Always the full row: three dropdowns squeezed into half a grid column
  // truncate to "Gio"/"Anr", and the date is the field most likely to be
  // misread in the first place.
  return (
    <div class="field full">
      <label id={`${id}-label`}>
        {label}
        {required && <span class="req"> ({t("form.required")})</span>}
      </label>
      <div class="date-field" role="group" aria-labelledby={`${id}-label`}>
        <select id={id} aria-label={t("date.day")} value={d || ""} onChange={(e) => emit(y, m, num(e))}>
          <option value="">{t("date.day")}</option>
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select aria-label={t("date.month")} value={m || ""} onChange={(e) => emit(y, num(e), d)}>
          <option value="">{t("date.month")}</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {t(`month.${n}` as MessageKey)}
            </option>
          ))}
        </select>
        <select aria-label={t("date.year")} value={y || ""} onChange={(e) => emit(num(e), m, d)}>
          <option value="">{t("date.year")}</option>
          {years.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {hint && <div class="hint">{hint}</div>}
    </div>
  );
}
