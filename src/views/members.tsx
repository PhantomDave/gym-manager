import { useEffect, useState } from "preact/hooks";
import { t, type MessageKey } from "../i18n.js";
import { api } from "../api.js";
import { Badges, Empty, Select } from "../components/ui.js";
import { statusOf } from "../lib/status.js";
import type { DisciplineName, Filter, MemberRow, StatusSettings } from "../types.js";

const FILTERS: Filter[] = [
  "all",
  "active",
  "expiring",
  "expired",
  "certExpired",
  "certMissing",
  "idDocMissing",
];

export function MembersView({
  settings,
  filter,
  refreshKey,
  onFilter,
  onOpenMember,
}: {
  settings: StatusSettings;
  filter: Filter;
  refreshKey: number;
  onFilter: (filter: Filter) => void;
  onOpenMember: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  // "" is every discipline. Names come from the roster itself (free text,
  // grouped ignoring case): DECISIONS 23.
  const [discipline, setDiscipline] = useState("");
  const [names, setNames] = useState<DisciplineName[]>([]);
  const [rows, setRows] = useState<MemberRow[]>([]);

  useEffect(() => {
    void api.disciplineNames().then((ns) => {
      setNames(ns);
      // The last member practising it may have just dropped it: an option
      // that no longer exists would filter the list down to nobody, unseen.
      setDiscipline((d) =>
        d && !ns.some((n) => n.name.toLowerCase() === d.toLowerCase()) ? "" : d,
      );
    });
  }, [refreshKey]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setRows(await api.membersList({ filter, query, discipline, limit: 200 }));
    }, 180);
    return () => clearTimeout(timer);
  }, [filter, query, discipline, refreshKey]);

  return (
    <section class="view">
      <header class="view-head">
        <h1>{t("members.title")}</h1>
        <span class="muted">{t("members.count", { count: rows.length })}</span>
      </header>

      <div class="toolbar">
        <div class="field">
          <label class="field-label" for="member-search">
            {t("members.search_label")}
          </label>
          <input
            id="member-search"
            class="search"
            type="search"
            autocomplete="off"
            placeholder={t("members.search_placeholder")}
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </div>
        {names.length > 0 && (
          <Select
            id="member-discipline"
            label={t("members.discipline_label")}
            value={discipline}
            onInput={setDiscipline}
            options={[
              { value: "", label: t("members.discipline_all") },
              ...names.map((n) => ({
                value: n.name,
                label: t("members.discipline_option", { name: n.name, count: n.members }),
              })),
            ]}
          />
        )}
        <div class="chips" role="group">
          {FILTERS.map((f) => (
            <button
              key={f}
              class={`chip ${f === filter ? "is-active" : ""}`}
              aria-pressed={f === filter}
              onClick={() => onFilter(f)}
            >
              {t(`filter.${f}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 ? (
        <div class="list panel">
          {rows.map((m) => (
            <button key={m.id} class="row row-button" onClick={() => onOpenMember(m.id)}>
              <div class="grow">
                <div class="name">
                  {m.lastName}, {m.firstName}
                </div>
                <div class="sub">{m.phone ?? m.email ?? ""}</div>
              </div>
              <Badges items={statusOf(m, settings).badges} />
            </button>
          ))}
        </div>
      ) : (
        <div class="panel">
          <Empty>{t("members.empty")}</Empty>
        </div>
      )}
    </section>
  );
}
