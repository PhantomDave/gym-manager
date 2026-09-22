// Settings.
//
// The table stores `default_price_cents`; the operator is shown a fee in euros.
// Nobody should ever be asked to type 3500 to mean thirty-five euros.

import { useEffect, useState } from "preact/hooks";
import { LANGUAGES, t } from "../i18n.js";
import { api, checkForUpdate, installUpdate, type UpdateInfo } from "../api.js";
import { Field, Select } from "../components/ui.js";
import { centsToEuros, eurosToCents } from "../lib/format.js";
import type { Settings } from "../types.js";

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "installing" }
  | { kind: "failed"; message: string };

export function SettingsView({
  settings,
  currency,
  onSaved,
  onToast,
}: {
  settings: Settings;
  currency: string;
  onSaved: () => void;
  onToast: (message: string) => void;
}) {
  const [values, setValues] = useState<Settings>(settings);
  const [update, setUpdate] = useState<UpdateState>({ kind: "idle" });

  useEffect(() => setValues(settings), [settings]);

  const runUpdateCheck = async () => {
    setUpdate({ kind: "checking" });
    try {
      const info = await checkForUpdate();
      setUpdate(info ? { kind: "available", info } : { kind: "none" });
    } catch (err) {
      setUpdate({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const runInstall = async () => {
    setUpdate({ kind: "installing" });
    try {
      await installUpdate();
      // The app relaunches into the new version; nothing after this runs.
    } catch (err) {
      setUpdate({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const save = async (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    await api.settingsSet(key, value);
    onSaved();
  };

  const wholeNumber = (key: string, label: string) => (
    <Field
      id={`s-${key}`}
      label={label}
      inputMode="numeric"
      value={values[key] ?? ""}
      onInput={(v) => void save(key, v.replace(/\D/g, ""))}
    />
  );

  return (
    <section class="view">
      <header class="view-head">
        <h1>{t("settings.title")}</h1>
      </header>

      <div class="panel">
        <div class="form-grid">
          <Select
            id="s-language"
            label={t("field.language")}
            value={values.language ?? "it"}
            onInput={(v) => void save("language", v)}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          />
          <Field
            id="s-gym"
            label={t("settings.gym_name")}
            value={values.gym_name ?? ""}
            onInput={(v) => void save("gym_name", v)}
          />
          <Field
            id="s-price"
            label={`${t("settings.default_price")} (${currency})`}
            inputMode="decimal"
            value={centsToEuros(Number(values.default_price_cents ?? 0))}
            onInput={(v) => void save("default_price_cents", String(eurosToCents(v)))}
          />
          <Select
            id="s-currency"
            label={t("settings.currency")}
            value={values.currency ?? "EUR"}
            onInput={(v) => void save("currency", v)}
            options={[
              { value: "EUR", label: "EUR €" },
              { value: "CHF", label: "CHF" },
              { value: "GBP", label: "GBP £" },
              { value: "USD", label: "USD $" },
            ]}
          />
          {wholeNumber("grace_days", t("settings.grace_days"))}
          {wholeNumber("expiry_warning_days", t("settings.expiry_warning_days"))}
          {wholeNumber("cert_warning_days", t("settings.cert_warning_days"))}
        </div>
      </div>

      <div class="panel">
        <h2>{t("settings.backup")}</h2>
        <p class="muted">{t("settings.backup_hint")}</p>
        <button
          class="btn btn-primary"
          onClick={async () => onToast(t("settings.backup_done", { path: await api.backupNow() }))}
        >
          {t("settings.backup_now")}
        </button>
      </div>

      <div class="panel">
        <h2>{t("settings.updates")}</h2>
        <p class="muted">{t("settings.updates_hint")}</p>
        {update.kind === "available" ? (
          <>
            <p>{t("settings.update_available", { version: update.info.version })}</p>
            <button class="btn btn-primary" onClick={() => void runInstall()}>
              {t("settings.update_install")}
            </button>
          </>
        ) : (
          <button
            class="btn btn-primary"
            disabled={update.kind === "checking" || update.kind === "installing"}
            onClick={() => void runUpdateCheck()}
          >
            {t("settings.update_check")}
          </button>
        )}
        {update.kind === "checking" && <p class="muted">{t("settings.update_checking")}</p>}
        {update.kind === "installing" && <p class="muted">{t("settings.update_installing")}</p>}
        {update.kind === "none" && <p class="muted">{t("settings.update_none")}</p>}
        {update.kind === "failed" && (
          <p class="muted">{t("settings.update_failed", { message: update.message })}</p>
        )}
      </div>
    </section>
  );
}
