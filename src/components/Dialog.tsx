// Modal dialog, built on the native <dialog> element.
//
// showModal() supplies the focus trap, Escape handling, the backdrop and
// returning focus to whatever was focused before — four behaviours a
// hand-rolled div gets wrong, and that matter to anyone not using a mouse.

import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { t } from "../i18n.js";

export interface DialogProps {
  title: string;
  hint?: string | undefined;
  children?: ComponentChildren;
  confirmText: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
}

export function Dialog({
  title,
  hint,
  children,
  confirmText,
  onConfirm,
  onCancel,
  busy = false,
  danger = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  // Escape fires `cancel`; route it through the same path as the button so a
  // dialog can never be dismissed by a route that skips cleanup.
  const handleCancel = (event: Event) => {
    event.preventDefault();
    if (!busy) onCancel();
  };

  const submit = (event: Event) => {
    event.preventDefault();
    if (!busy) onConfirm();
  };

  return (
    <dialog ref={ref} class="dialog" onCancel={handleCancel}>
      <form method="dialog" class="dialog-card" onSubmit={submit}>
        <h2>{title}</h2>
        {hint && <p class="hint">{hint}</p>}
        <div class="dialog-body">{children}</div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {t("form.cancel")}
          </button>
          <button
            type="submit"
            class={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`}
            disabled={busy}
          >
            {confirmText}
          </button>
        </div>
      </form>
    </dialog>
  );
}
