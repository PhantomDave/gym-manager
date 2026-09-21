// Small shared widgets. Nothing here holds state except the toast queue.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n.js";
import type { BadgeSpec, Tone } from "../types.js";

export const Badge = ({ tone = "plain", children }: { tone?: Tone; children: ComponentChildren }) => (
  <span class={`badge ${tone}`}>{children}</span>
);

export const Badges = ({ items }: { items: BadgeSpec[] }) => (
  <div class="badges">
    {items.map((b, i) => (
      <Badge key={i} tone={b.tone}>
        {b.text}
      </Badge>
    ))}
  </div>
);

export const Empty = ({ children }: { children: ComponentChildren }) => (
  <div class="empty">{children}</div>
);

export const Section = ({ title, children }: { title: string; children: ComponentChildren }) => (
  <section class="drawer-section">
    <h3>{title}</h3>
    {children}
  </section>
);

export interface FieldProps {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  full?: boolean;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email";
  autoFocus?: boolean;
}

/**
 * A labelled input. The label is always rendered and always associated: a
 * placeholder is not a label, and it vanishes the moment someone types.
 */
export const Field = ({
  id,
  label,
  value,
  onInput,
  type = "text",
  required = false,
  placeholder,
  hint,
  full = false,
  inputMode,
  autoFocus = false,
}: FieldProps) => (
  <div class={`field ${full ? "full" : ""}`}>
    <label for={id}>
      {label}
      {required && <span class="req"> ({t("form.required")})</span>}
    </label>
    <input
      id={id}
      type={type}
      inputMode={inputMode}
      value={value}
      placeholder={placeholder}
      autofocus={autoFocus}
      onInput={(e) => onInput((e.target as HTMLInputElement).value)}
    />
    {hint && <div class="hint">{hint}</div>}
  </div>
);

export interface Option {
  value: string;
  label: string;
}

export const Select = ({
  id,
  label,
  value,
  onInput,
  options,
  full = false,
}: {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  options: readonly Option[];
  full?: boolean;
}) => (
  <div class={`field ${full ? "full" : ""}`}>
    <label for={id}>{label}</label>
    <select id={id} value={value} onInput={(e) => onInput((e.target as HTMLSelectElement).value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

export interface Toast {
  id: number;
  text: string;
  tone?: "blocked";
}

/**
 * Toast host.
 *
 * `aria-live="polite"` so the message reaches a screen reader: without it the
 * only confirmation that a payment was recorded is a visual one.
 */
export function Toasts({ items, onExpire }: { items: Toast[]; onExpire: (id: number) => void }) {
  useEffect(() => {
    const first = items[0];
    if (!first) return;
    const timer = setTimeout(() => onExpire(first.id), 3600);
    return () => clearTimeout(timer);
  }, [items, onExpire]);

  return (
    <div class="toast-host" aria-live="polite" aria-atomic="true">
      {items.map((toast) => (
        <div key={toast.id} class={`toast ${toast.tone ?? ""}`}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}

/** Toast queue, owned by the app shell. */
export function useToasts() {
  const [items, setItems] = useState<Toast[]>([]);

  const push = (text: string, options: { tone?: "blocked" } = {}) =>
    setItems((list) => [...list, { id: Date.now() + Math.random(), text, ...options }]);

  const expire = (id: number) => setItems((list) => list.filter((x) => x.id !== id));

  return { items, push, expire };
}
