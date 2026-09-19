// Application shell: language, settings, which screen is showing, toasts.
//
// No router. A sidebar and one `view` state variable is the whole navigation
// model, and it stays adequate well past the six screens this app will have.

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { setLanguage, t, type MessageKey } from "./i18n.js";
import { api, setErrorHandler } from "./api.js";
import { setCurrency } from "./lib/format.js";
import { Toasts, useToasts } from "./components/ui.js";
import { MemberFormDialog } from "./components/dialogs.js";
import { TodayView } from "./views/today.js";
import { MembersView } from "./views/members.js";
import { MemberDrawer } from "./views/member.js";
import { ExpiriesView } from "./views/expiries.js";
import { SettingsView } from "./views/settings.js";
import type { Filter, Settings, StatusSettings } from "./types.js";

const NAV = ["today", "members", "expiries", "settings"] as const;
type ViewName = (typeof NAV)[number];

function App() {
  const [ready, setReady] = useState(false);
  const [raw, setRaw] = useState<Settings>({});
  const [view, setView] = useState<ViewName>("today");
  const [filter, setFilter] = useState<Filter>("all");
  const [openMember, setOpenMember] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  // Bumped whenever data changes, so every mounted view reloads without any of
  // them having to know about the others.
  const [refreshKey, setRefreshKey] = useState(0);
  const toasts = useToasts();

  const loadSettings = async () => {
    const s = await api.settingsAll();
    setRaw(s);
    setLanguage(s.language ?? "it");
    setCurrency(s.currency);
    setReady(true);
  };

  useEffect(() => {
    setErrorHandler((err) => toasts.push(err.message, { tone: "bad" }));
    void loadSettings();
  }, []);

  if (!ready) return <div class="booting" />;

  // Parsed once here rather than in every badge.
  const settings: StatusSettings = {
    graceDays: Number(raw.grace_days ?? 0),
    warnDays: Number(raw.expiry_warning_days ?? 7),
    certWarnDays: Number(raw.cert_warning_days ?? 30),
  };
  const currency = raw.currency ?? "EUR";
  const changed = () => setRefreshKey((n) => n + 1);
  const toast = (message: string) => toasts.push(message);

  const goToFilter = (next: Filter) => {
    setFilter(next);
    setView("members");
  };

  return (
    <>
      <nav class="sidebar">
        <div class="brand">
          <span class="brand-mark" />
          <span>{raw.gym_name || t("app.name")}</span>
        </div>
        {NAV.map((name) => (
          <button
            key={name}
            class={`nav-item ${view === name ? "is-active" : ""}`}
            aria-current={view === name ? "page" : undefined}
            onClick={() => setView(name)}
          >
            {t(`nav.${name}` as MessageKey)}
          </button>
        ))}
        <div class="sidebar-foot">
          <button class="btn btn-primary btn-block" onClick={() => setCreating(true)}>
            {t("nav.new_member")}
          </button>
        </div>
      </nav>

      <main class="content">
        {view === "today" && (
          <TodayView
            settings={settings}
            refreshKey={refreshKey}
            onOpenMember={setOpenMember}
            onFilter={goToFilter}
            onToast={toast}
          />
        )}
        {view === "members" && (
          <MembersView
            settings={settings}
            filter={filter}
            refreshKey={refreshKey}
            onFilter={setFilter}
            onOpenMember={setOpenMember}
          />
        )}
        {view === "expiries" && (
          <ExpiriesView refreshKey={refreshKey} onOpenMember={setOpenMember} />
        )}
        {view === "settings" && (
          <SettingsView
            settings={raw}
            currency={currency}
            onSaved={() => void loadSettings()}
            onToast={toast}
          />
        )}
      </main>

      {openMember !== null && (
        <MemberDrawer
          memberId={openMember}
          settings={settings}
          currency={currency}
          onClose={() => setOpenMember(null)}
          onToast={toast}
          onChanged={changed}
        />
      )}

      {creating && (
        <MemberFormDialog
          onClose={() => setCreating(false)}
          onDone={(id, message) => {
            setCreating(false);
            toast(message);
            changed();
            setOpenMember(id);
          }}
        />
      )}

      <Toasts items={toasts.items} onExpire={toasts.expire} />
    </>
  );
}

const root = document.getElementById("app");
if (root) render(<App />, root);
