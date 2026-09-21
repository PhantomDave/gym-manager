// The screen the desk lives on.
//
// With check-ins ON the whole flow is: type a surname, press Enter, read the
// colour, done. Enter confirms the top result, because this happens a hundred
// times a day and two extra clicks each time adds up to twenty minutes a week.
//
// With check-ins OFF (the default — see src/features.ts) the search stays, but
// it is a way to reach a member card rather than a door: Enter opens the card,
// there is no entry banner, no override, and no list of who came in. Everything
// that decides whether someone may train — membership and certificate — is
// still on the card and in the badges; the app simply stops recording visits.

import { useEffect, useRef, useState } from "preact/hooks";
import { t, translateCode } from "../i18n.js";
import { api } from "../api.js";
import { FEATURES } from "../features.js";
import { Badges, Empty } from "../components/ui.js";
import { ReasonDialog } from "../components/dialogs.js";
import { statusOf } from "../lib/status.js";
import { daysUntil, fmtDate, fmtTime } from "../lib/format.js";
import type {
  CheckinRow,
  Dashboard,
  EntryCheck,
  ExpiringDocument,
  Filter,
  MemberRow,
  StatusSettings,
} from "../types.js";

interface Tile {
  n: number;
  label: string;
  filter: Filter | null;
  tone: "" | "warn" | "blocked";
}

export function TodayView({
  settings,
  refreshKey,
  onOpenMember,
  onFilter,
  onToast,
}: {
  settings: StatusSettings;
  refreshKey: number;
  onOpenMember: (id: number) => void;
  onFilter: (filter: Filter) => void;
  onToast: (message: string) => void;
}) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [visits, setVisits] = useState<CheckinRow[]>([]);
  const [certs, setCerts] = useState<ExpiringDocument[]>([]);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<MemberRow[]>([]);
  const [entry, setEntry] = useState<EntryCheck | null>(null);
  const [askReason, setAskReason] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const [d, c, v] = await Promise.all([
      api.dashboard(),
      api.documentsExpiring("health_cert", 30),
      // Not called at all when the feature is off, rather than called and
      // ignored: a command that is never invoked cannot fail in the background.
      FEATURES.checkins ? api.checkinsToday() : Promise.resolve<CheckinRow[]>([]),
    ]);
    setDash(d);
    setCerts(c);
    setVisits(v);
  };

  useEffect(() => {
    void reload();
    searchRef.current?.focus();
  }, [refreshKey]);

  // Debounced, so typing a surname does not fire a query per keystroke.
  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      setEntry(null);
      return;
    }
    const timer = setTimeout(async () => {
      setMatches(await api.membersList({ query, limit: 8 }));
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  /** Picking somebody out of the search results. */
  const choose = async (memberId: number) => {
    if (!FEATURES.checkins) {
      setQuery("");
      setMatches([]);
      onOpenMember(memberId);
      return;
    }
    setEntry(await api.entryCheck(memberId));
    setMatches([]);
  };

  const admit = async (memberId: number, reason: string | null = null) => {
    await api.checkinCreate(memberId, reason);
    onToast(reason ? t("today.checked_in_override") : t("today.checked_in_ok"));
    setQuery("");
    setEntry(null);
    setAskReason(false);
    searchRef.current?.focus();
    void reload();
  };

  // A blocked entry never goes straight through: the operator types why.
  const requestAdmit = (memberId: number, blocked: boolean) => {
    if (blocked) setAskReason(true);
    else void admit(memberId);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    // Enter admits a clean member outright; on a blocked one it only opens the
    // banner, so nobody overrides without having read the reason. With check-ins
    // off there is no banner and Enter goes straight to the top result's card.
    if (FEATURES.checkins && entry && entry.status !== "block") void admit(entry.memberId);
    else if (matches[0]) void choose(matches[0].id);
  };

  const tiles: Tile[] = dash
    ? [
        { n: dash.activeMembers, label: t("tile.active"), filter: "active", tone: "" },
        { n: dash.expiringSoon, label: t("tile.expiring"), filter: "expiring", tone: "warn" },
        { n: dash.expired, label: t("tile.expired"), filter: "expired", tone: "blocked" },
        { n: dash.certExpired, label: t("tile.cert_expired"), filter: "certExpired", tone: "blocked" },
        { n: dash.certMissing, label: t("tile.cert_missing"), filter: "certMissing", tone: "blocked" },
        ...(FEATURES.checkins
          ? [{ n: dash.checkinsToday, label: t("tile.checkins"), filter: null, tone: "" as const }]
          : []),
      ]
    : [];

  const certsPanel = (
    <div class="panel">
      <h2>{t("today.certs_expiring")}</h2>
      {certs.length > 0 ? (
        <div class="list">
          {certs.map((c) => {
            const left = daysUntil(c.expiresOn) ?? 0;
            return (
              <button key={c.id} class="row row-button" onClick={() => onOpenMember(c.memberId)}>
                <div class="grow">
                  <div class="name">
                    {c.firstName} {c.lastName}
                  </div>
                  <div class="sub">{fmtDate(c.expiresOn)}</div>
                </div>
                <span class={`badge ${left < 0 ? "blocked" : "warn"}`}>
                  {left < 0 ? t("status.cert_expired") : t("status.days_left", { count: left })}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <Empty>{t("today.no_certs_expiring")}</Empty>
      )}
    </div>
  );

  return (
    <section class="view">
      <header class="view-head">
        <h1>{t("today.title")}</h1>
        <span class="muted">{dash ? fmtDate(dash.today) : ""}</span>
      </header>

      <div class="tiles">
        {tiles.map((tile) => (
          <button
            key={tile.label}
            class={`tile ${tile.n > 0 ? tile.tone : ""}`}
            disabled={tile.filter === null}
            onClick={() => tile.filter && onFilter(tile.filter)}
          >
            <div class="n">{tile.n}</div>
            <div class="k">{tile.label}</div>
          </button>
        ))}
      </div>

      <div class="panel">
        <h2>{FEATURES.checkins ? t("today.checkin") : t("today.find")}</h2>
        <label class="field-label" for="checkin-search">
          {FEATURES.checkins ? t("today.search_label") : t("today.find_label")}
        </label>
        <input
          id="checkin-search"
          ref={searchRef}
          class="search search-lg"
          type="search"
          autocomplete="off"
          placeholder={t("today.search_placeholder")}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
        />

        {FEATURES.checkins && entry && (
          <EntryBanner entry={entry} onAdmit={requestAdmit} onOpen={onOpenMember} />
        )}

        {FEATURES.checkins && askReason && entry && (
          <ReasonDialog
            title={t("entry.override_title")}
            label={t("entry.override_why")}
            placeholder={t("entry.override_placeholder")}
            hint={t("entry.override_hint")}
            confirmText={t("entry.override_confirm")}
            onClose={() => setAskReason(false)}
            onConfirm={(reason) => admit(entry.memberId, reason)}
          />
        )}

        {!entry && query.trim() !== "" && matches.length === 0 && (
          <Empty>{t("today.no_match", { query })}</Empty>
        )}

        {!entry && matches.length > 0 && (
          <div class="list">
            {matches.map((m) => (
              <button key={m.id} class="row row-button" onClick={() => void choose(m.id)}>
                <div class="grow">
                  <div class="name">
                    {m.firstName} {m.lastName}
                  </div>
                  <div class="sub">{m.phone ?? m.email ?? ""}</div>
                </div>
                <Badges items={statusOf(m, settings).badges} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Two panels side by side only while there is a second one to show.
          A lone panel in a two-column grid would sit in half the width with a
          hole beside it. */}
      {FEATURES.checkins ? (
        <div class="split">
          <div class="panel">
            <h2>{t("today.checked_in")}</h2>
            {visits.length > 0 ? (
              <div class="list">
                {visits.map((v) => (
                  <button
                    key={v.id}
                    class="row row-button"
                    onClick={() => onOpenMember(v.memberId)}
                  >
                    <div class="grow">
                      <div class="name">
                        {v.firstName} {v.lastName}
                      </div>
                      <div class="sub">
                        {fmtTime(v.at)}
                        {v.overrideReason ? ` · ${v.overrideReason}` : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <Empty>{t("today.nobody_yet")}</Empty>
            )}
          </div>
          {certsPanel}
        </div>
      ) : (
        certsPanel
      )}
    </section>
  );
}

/**
 * The banner the desk actually reads: a colour plus sentences, never a code.
 * A blocked entry changes the button's wording so nobody admits by muscle
 * memory.
 *
 * Only reachable with FEATURES.checkins on.
 */
function EntryBanner({
  entry,
  onAdmit,
  onOpen,
}: {
  entry: EntryCheck;
  onAdmit: (memberId: number, blocked: boolean) => void;
  onOpen: (id: number) => void;
}) {
  const blocked = entry.status === "block";
  return (
    <div class={`entry ${entry.status}`}>
      <div class="grow">
        <div class="who">
          {entry.firstName} {entry.lastName}
        </div>
        {entry.reasons.length > 0 && (
          <ul>
            {entry.reasons.map((r, i) => (
              <li key={i}>{translateCode(r)}</li>
            ))}
          </ul>
        )}
      </div>
      <button
        class={`btn btn-lg ${blocked ? "btn-danger-solid" : "btn-primary"}`}
        onClick={() => onAdmit(entry.memberId, blocked)}
      >
        {blocked ? t("today.admit_anyway") : t("today.admit")}
      </button>
      <button class="btn btn-ghost" onClick={() => onOpen(entry.memberId)}>
        {t("today.open_card")}
      </button>
    </div>
  );
}
