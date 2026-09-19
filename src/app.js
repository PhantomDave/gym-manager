// Gym Manager frontend.
//
// Plain JavaScript, no framework and no build step: the file you edit is the
// file that ships. The rendering strategy is deliberately dumb — re-render a
// section's innerHTML from the data it was given — because the largest list in
// this app is a few hundred rows and a virtual DOM would cost more memory than
// it saves.
//
// Status colour lives in exactly one place (`statusOf`). The backend hands over
// raw dates; the interpretation happens here, once.

const { invoke } = window.__TAURI__.core;
const { open: openFileDialog } = window.__TAURI__.dialog;

const state = {
  filter: "all",
  query: "",
  currency: "EUR",
  settings: {},
  openMemberId: null,
};

/* --------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** Escape anything that came from a member record before it reaches innerHTML. */
function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whole days from today until an ISO date; negative once it has passed. */
function daysUntil(iso) {
  if (!iso) return null;
  const ms = new Date(`${iso}T00:00:00`) - new Date(`${today()}T00:00:00`);
  return Math.round(ms / 86400000);
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtMoney(cents) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: state.currency || "EUR",
  }).format((cents || 0) / 100);
}

function toast(message, bad = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("bad", bad);
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
}

/** Every backend call goes through here so no error can fail silently. */
async function call(command, args) {
  try {
    return await invoke(command, args);
  } catch (err) {
    toast(String(err), true);
    throw err;
  }
}

/* --------------------------------------------------------------------------
 * The one status rule
 * ---------------------------------------------------------------------- */

/**
 * Turn the two raw dates into a colour and a label.
 * `ok` = paid and certified; `warn` = something expires soon; `bad` = expired
 * or missing. This is the only place that decision is made.
 */
function statusOf(row) {
  const warnDays = Number(state.settings.expiry_warning_days ?? 7);
  const certWarnDays = Number(state.settings.cert_warning_days ?? 30);
  const grace = Number(state.settings.grace_days ?? 0);

  const paid = daysUntil(row.paidThrough);
  const cert = daysUntil(row.certThrough);
  const badges = [];

  if (paid === null) {
    badges.push({ tone: "bad", text: "No membership" });
  } else if (paid < -grace) {
    badges.push({ tone: "bad", text: `Expired ${fmtDate(row.paidThrough)}` });
  } else if (paid < 0) {
    badges.push({ tone: "warn", text: "In grace period" });
  } else if (paid <= warnDays) {
    badges.push({ tone: "warn", text: paid === 0 ? "Ends today" : `${paid}d left` });
  } else {
    badges.push({ tone: "ok", text: `Paid to ${fmtDate(row.paidThrough)}` });
  }

  if (cert === null) {
    badges.push({ tone: "bad", text: "No certificate" });
  } else if (cert < 0) {
    badges.push({ tone: "bad", text: "Cert expired" });
  } else if (cert <= certWarnDays) {
    badges.push({ tone: "warn", text: `Cert ${cert}d` });
  } else {
    badges.push({ tone: "ok", text: "Cert valid" });
  }

  const tone = badges.some((b) => b.tone === "bad")
    ? "bad"
    : badges.some((b) => b.tone === "warn")
      ? "warn"
      : "ok";
  return { tone, badges };
}

function badgeHtml(badges) {
  return badges.map((b) => `<span class="badge ${b.tone}">${esc(b.text)}</span>`).join("");
}

/* --------------------------------------------------------------------------
 * Navigation
 * ---------------------------------------------------------------------- */

function showView(name) {
  $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === `view-${name}`));
  $$(".nav-item").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
  if (name === "today") refreshToday();
  if (name === "members") refreshMembers();
  if (name === "settings") refreshSettings();
}

/* --------------------------------------------------------------------------
 * Today
 * ---------------------------------------------------------------------- */

async function refreshToday() {
  const d = await call("dashboard");
  state.currency = d.currency;
  $("#gym-name").textContent = d.gymName;
  $("#today-date").textContent = fmtDate(d.today);

  const tiles = [
    { n: d.activeMembers, k: "Active", filter: "active", tone: "" },
    { n: d.expiringSoon, k: "Expiring soon", filter: "expiring", tone: "warn" },
    { n: d.expired, k: "Expired", filter: "expired", tone: "bad" },
    { n: d.certExpired, k: "Cert expired", filter: "certExpired", tone: "bad" },
    { n: d.certMissing, k: "Cert missing", filter: "certMissing", tone: "bad" },
    { n: d.checkinsToday, k: "Check-ins today", filter: null, tone: "" },
  ];
  $("#tiles").innerHTML = tiles
    .map(
      (t) => `<button class="tile ${t.n > 0 ? t.tone : ""}" data-filter="${t.filter || ""}">
                <div class="n">${t.n}</div><div class="k">${esc(t.k)}</div>
              </button>`,
    )
    .join("");

  const visits = await call("checkins_today");
  $("#checkins-today").innerHTML = visits.length
    ? visits
        .map(
          (v) => `<div class="row" data-member="${v.memberId}">
                    <div class="grow">
                      <div class="name">${esc(v.firstName)} ${esc(v.lastName)}</div>
                      <div class="sub">${esc(v.at.slice(11, 16))}${
                        v.overrideReason ? ` · override: ${esc(v.overrideReason)}` : ""
                      }</div>
                    </div>
                  </div>`,
        )
        .join("")
    : `<div class="empty">Nobody has checked in yet.</div>`;

  const certs = await call("documents_expiring", { kind: "health_cert", days: 30 });
  $("#certs-expiring").innerHTML = certs.length
    ? certs
        .map((c) => {
          const left = daysUntil(c.expiresOn);
          const tone = left < 0 ? "bad" : "warn";
          return `<div class="row" data-member="${c.memberId}">
                    <div class="grow">
                      <div class="name">${esc(c.firstName)} ${esc(c.lastName)}</div>
                      <div class="sub">${fmtDate(c.expiresOn)}</div>
                    </div>
                    <span class="badge ${tone}">${left < 0 ? "expired" : `${left}d`}</span>
                  </div>`;
        })
        .join("")
    : `<div class="empty">No certificates expiring in the next 30 days.</div>`;
}

async function runCheckinSearch(term) {
  const box = $("#checkin-results");
  if (!term.trim()) {
    box.innerHTML = "";
    return;
  }
  const rows = await call("members_list", { query: term, limit: 8 });
  if (!rows.length) {
    box.innerHTML = `<div class="empty">No member matches “${esc(term)}”.</div>`;
    return;
  }
  box.innerHTML = rows
    .map((r) => {
      const { badges } = statusOf(r);
      return `<div class="row" data-checkin="${r.id}">
                <div class="grow">
                  <div class="name">${esc(r.firstName)} ${esc(r.lastName)}</div>
                  <div class="sub">${esc(r.phone || r.email || "")}</div>
                </div>
                <div class="badges">${badgeHtml(badges)}</div>
              </div>`;
    })
    .join("");
}

/** Show the entry banner, then either record the visit or ask for a reason. */
async function attemptCheckin(memberId) {
  const check = await call("entry_check", { memberId });
  const box = $("#checkin-results");
  box.innerHTML = `
    <div class="entry ${check.status}">
      <div class="grow">
        <div class="who">${esc(check.firstName)} ${esc(check.lastName)}</div>
        ${check.reasons.length ? `<ul>${check.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      </div>
      <button class="btn ${check.status === "block" ? "" : "btn-primary"}" data-confirm-checkin="${memberId}">
        ${check.status === "block" ? "Admit anyway…" : "Check in"}
      </button>
      <button class="btn btn-ghost" data-member="${memberId}">Open</button>
    </div>`;

  if (check.status !== "block") return;

  // Blocked entries need a reason, so the override leaves a trail.
  box.dataset.blocked = "1";
}

async function confirmCheckin(memberId, blocked) {
  if (!blocked) {
    await call("checkin_create", { memberId });
    toast("Checked in.");
    $("#checkin-search").value = "";
    $("#checkin-results").innerHTML = "";
    refreshToday();
    return;
  }
  openModal({
    title: "Admit anyway",
    body: `<div class="field full">
             <label for="override">Reason (recorded against the visit)</label>
             <input id="override" type="text" placeholder="e.g. certificate renewal booked for Friday" />
           </div>`,
    confirmText: "Admit",
    onConfirm: async () => {
      const reason = $("#override").value.trim();
      if (!reason) {
        toast("A reason is required.", true);
        return false;
      }
      await call("checkin_create", { memberId, overrideReason: reason });
      toast("Checked in with override.");
      $("#checkin-search").value = "";
      $("#checkin-results").innerHTML = "";
      refreshToday();
      return true;
    },
  });
}

/* --------------------------------------------------------------------------
 * Members list
 * ---------------------------------------------------------------------- */

async function refreshMembers() {
  const rows = await call("members_list", {
    filter: state.filter,
    query: state.query,
    limit: 200,
  });
  $("#members-table").innerHTML = rows.length
    ? rows
        .map((r) => {
          const { badges } = statusOf(r);
          return `<div class="row" data-member="${r.id}">
                    <div class="grow">
                      <div class="name">${esc(r.lastName)}, ${esc(r.firstName)}</div>
                      <div class="sub">${esc(r.phone || r.email || "—")}</div>
                    </div>
                    <div class="badges">${badgeHtml(badges)}</div>
                  </div>`;
        })
        .join("")
    : `<div class="empty">No members match this filter.</div>`;
}

/* --------------------------------------------------------------------------
 * Member drawer
 * ---------------------------------------------------------------------- */

async function openMember(id) {
  const detail = await call("member_get", { id });
  state.openMemberId = id;
  const m = detail.member;
  const { badges } = statusOf(detail);

  $("#drawer-name").textContent = `${m.firstName} ${m.lastName}`;
  $("#drawer-badges").innerHTML = badgeHtml(badges);

  const certs = detail.documents.filter((d) => d.kind === "health_cert");
  const others = detail.documents.filter((d) => d.kind !== "health_cert");

  $("#drawer-body").innerHTML = `
    <div class="drawer-actions">
      <button class="btn btn-primary" data-act="renew">Renew month</button>
      <button class="btn" data-act="add-cert">Record certificate</button>
      <button class="btn" data-act="add-doc">Add document</button>
      <button class="btn btn-ghost btn-danger" data-act="archive">Archive</button>
    </div>

    <div class="drawer-section">
      <h3>Details</h3>
      <dl class="kv">
        <dt>ID number</dt><dd>${esc(m.nationalId || "—")}</dd>
        <dt>Born</dt><dd>${fmtDate(m.birthDate)}</dd>
        <dt>Phone</dt><dd>${esc(m.phone || "—")}</dd>
        <dt>Email</dt><dd>${esc(m.email || "—")}</dd>
        <dt>Emergency</dt><dd>${esc(m.emergencyContact || "—")} ${esc(m.emergencyPhone || "")}</dd>
        <dt>Member since</dt><dd>${fmtDate(m.joinedOn)}</dd>
        ${m.notes ? `<dt>Notes</dt><dd>${esc(m.notes)}</dd>` : ""}
      </dl>
    </div>

    <div class="drawer-section">
      <h3>Health certificate</h3>
      ${certs.length ? docList(certs) : `<div class="empty">None on file. The member cannot be cleared to train.</div>`}
    </div>

    <div class="drawer-section">
      <h3>Membership history</h3>
      ${
        detail.memberships.length
          ? detail.memberships
              .map(
                (s) => `<div class="row" style="cursor:default">
                          <div class="grow">
                            <div class="name" ${s.voidedAt ? 'style="text-decoration:line-through;opacity:.55"' : ""}>
                              ${fmtDate(s.startsOn)} → ${fmtDate(s.endsOn)}
                            </div>
                            <div class="sub">${fmtMoney(s.paidCents)}${
                              s.paymentMethod ? ` · ${esc(s.paymentMethod)}` : ""
                            }${s.paidCents < s.priceCents ? ` · owes ${fmtMoney(s.priceCents - s.paidCents)}` : ""}</div>
                          </div>
                          ${
                            s.voidedAt
                              ? `<span class="badge plain">voided</span>`
                              : `<button class="btn btn-ghost btn-sm" data-void="${s.id}">Void</button>`
                          }
                        </div>`,
              )
              .join("")
          : `<div class="empty">No memberships yet.</div>`
      }
    </div>

    <div class="drawer-section">
      <h3>Documents</h3>
      ${others.length ? docList(others) : `<div class="empty">No documents registered.</div>`}
    </div>`;

  $("#drawer").hidden = false;
}

function docList(docs) {
  return docs
    .map((d) => {
      const left = daysUntil(d.expiresOn);
      const tone = left === null ? "plain" : left < 0 ? "bad" : left <= 30 ? "warn" : "ok";
      const label = left === null ? d.kind.replace(/_/g, " ") : left < 0 ? "expired" : `${left}d`;
      return `<div class="row" data-open-doc="${d.id}">
                <div class="grow">
                  <div class="name">${esc(d.title || d.originalName || d.kind)}</div>
                  <div class="sub">${
                    d.expiresOn ? `expires ${fmtDate(d.expiresOn)}` : `added ${fmtDate(d.addedAt.slice(0, 10))}`
                  }${d.issuer ? ` · ${esc(d.issuer)}` : ""} · ${Math.round((d.bytes || 0) / 1024)} KB</div>
                </div>
                <span class="badge ${tone}">${esc(label)}</span>
                <button class="btn btn-ghost btn-sm" data-del-doc="${d.id}">✕</button>
              </div>`;
    })
    .join("");
}

/* --------------------------------------------------------------------------
 * Actions
 * ---------------------------------------------------------------------- */

async function renewDialog(memberId) {
  const p = await call("membership_preview", { memberId });
  openModal({
    title: "Renew membership",
    body: `
      <p class="hint">
        ${p.stacks
          ? "Still covered, so this month starts the day the current one ends."
          : "Not currently covered, so this month starts today."}
      </p>
      <div class="form-grid">
        <div class="field"><label>Starts</label><input type="text" value="${fmtDate(p.startsOn)}" disabled /></div>
        <div class="field"><label>Ends</label><input type="text" value="${fmtDate(p.endsOn)}" disabled /></div>
        <div class="field"><label for="price">Price</label>
          <input id="price" type="number" step="0.01" min="0" value="${(p.priceCents / 100).toFixed(2)}" /></div>
        <div class="field"><label for="paid">Paid now</label>
          <input id="paid" type="number" step="0.01" min="0" value="${(p.priceCents / 100).toFixed(2)}" /></div>
        <div class="field"><label for="method">Method</label>
          <select id="method">
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="transfer">Transfer</option>
          </select></div>
        <div class="field"><label for="msnote">Note</label><input id="msnote" type="text" /></div>
      </div>`,
    confirmText: "Take payment",
    onConfirm: async () => {
      await call("membership_renew", {
        memberId,
        priceCents: Math.round(parseFloat($("#price").value || "0") * 100),
        paidCents: Math.round(parseFloat($("#paid").value || "0") * 100),
        paymentMethod: $("#method").value,
        note: $("#msnote").value,
      });
      toast("Membership renewed.");
      await openMember(memberId);
      return true;
    },
  });
}

async function documentDialog(memberId, isCert) {
  let picked = null;
  openModal({
    title: isCert ? "Record health certificate" : "Add document",
    body: `
      <div class="field full">
        <label>File</label>
        <button id="pick" class="btn btn-block" type="button">Choose a file…</button>
        <div id="picked" class="hint">Nothing selected.</div>
      </div>
      <div class="form-grid" style="margin-top:12px">
        ${
          isCert
            ? `<input type="hidden" id="kind" value="health_cert" />`
            : `<div class="field"><label for="kind">Kind</label>
                 <select id="kind">
                   <option value="id_card">ID card</option>
                   <option value="waiver">Waiver</option>
                   <option value="contract">Contract</option>
                   <option value="photo">Photo</option>
                   <option value="receipt">Receipt</option>
                   <option value="other">Other</option>
                 </select></div>`
        }
        <div class="field"><label for="title">Title</label><input id="title" type="text" /></div>
        <div class="field"><label for="issued">Issued on</label><input id="issued" type="date" /></div>
        <div class="field"><label for="expires">Expires on${isCert ? " (required)" : ""}</label>
          <input id="expires" type="date" /></div>
        ${
          isCert
            ? `<div class="field full"><label for="issuer">Issuing doctor or clinic</label>
                 <input id="issuer" type="text" /></div>`
            : ""
        }
      </div>`,
    confirmText: "Register",
    onOpen: () => {
      $("#pick").addEventListener("click", async () => {
        const selected = await openFileDialog({
          multiple: false,
          filters: [{ name: "Documents", extensions: ["pdf", "jpg", "jpeg", "png", "webp", "tif", "tiff"] }],
        });
        if (selected) {
          picked = selected;
          $("#picked").textContent = selected.split("/").pop();
        }
      });
      // A certificate typically runs a year from issue; prefill and let the
      // receptionist correct it rather than making them count months.
      $("#issued").addEventListener("change", () => {
        if (isCert && $("#issued").value && !$("#expires").value) {
          const d = new Date(`${$("#issued").value}T00:00:00`);
          d.setFullYear(d.getFullYear() + 1);
          $("#expires").value = d.toISOString().slice(0, 10);
        }
      });
    },
    onConfirm: async () => {
      if (!picked) {
        toast("Choose a file first.", true);
        return false;
      }
      await call("document_add", {
        input: {
          memberId,
          kind: $("#kind").value,
          sourcePath: picked,
          title: $("#title").value,
          issuer: $("#issuer") ? $("#issuer").value : null,
          issuedOn: $("#issued").value,
          expiresOn: $("#expires").value,
        },
      });
      toast("Document registered.");
      await openMember(memberId);
      return true;
    },
  });
}

function newMemberDialog() {
  const f = (id, label, type = "text", full = false) =>
    `<div class="field ${full ? "full" : ""}"><label for="${id}">${label}</label>
       <input id="${id}" type="${type}" /></div>`;

  openModal({
    title: "New member",
    body: `<div class="form-grid">
             ${f("f-first", "First name")}${f("f-last", "Last name")}
             ${f("f-nid", "ID number")}${f("f-birth", "Date of birth", "date")}
             ${f("f-phone", "Phone", "tel")}${f("f-email", "Email", "email")}
             ${f("f-ec", "Emergency contact")}${f("f-ep", "Emergency phone", "tel")}
             ${f("f-notes", "Notes", "text", true)}
           </div>`,
    confirmText: "Create",
    onConfirm: async () => {
      const id = await call("member_create", {
        input: {
          firstName: $("#f-first").value,
          lastName: $("#f-last").value,
          nationalId: $("#f-nid").value,
          birthDate: $("#f-birth").value,
          phone: $("#f-phone").value,
          email: $("#f-email").value,
          emergencyContact: $("#f-ec").value,
          emergencyPhone: $("#f-ep").value,
          notes: $("#f-notes").value,
        },
      });
      toast("Member created.");
      await openMember(id);
      refreshMembers();
      return true;
    },
  });
}

/* --------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------- */

const SETTING_LABELS = {
  gym_name: "Gym name",
  currency: "Currency code",
  default_price_cents: "Default monthly price (cents)",
  grace_days: "Grace days after expiry",
  expiry_warning_days: "Warn this many days before membership expiry",
  cert_warning_days: "Warn this many days before certificate expiry",
};

async function refreshSettings() {
  state.settings = await call("settings_all");
  state.currency = state.settings.currency || "EUR";
  $("#settings-form").innerHTML = Object.entries(state.settings)
    .map(
      ([k, v]) => `<div class="field full">
                     <label for="set-${esc(k)}">${esc(SETTING_LABELS[k] || k)}</label>
                     <input id="set-${esc(k)}" data-key="${esc(k)}" type="text" value="${esc(v)}" />
                   </div>`,
    )
    .join("");
}

/* --------------------------------------------------------------------------
 * Modal plumbing
 * ---------------------------------------------------------------------- */

let modalConfirm = null;

function openModal({ title, body, confirmText = "Save", onConfirm, onOpen }) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = body;
  $("#modal-confirm").textContent = confirmText;
  modalConfirm = onConfirm;
  $("#modal").hidden = false;
  if (onOpen) onOpen();
  const first = $("#modal-body input:not([disabled]), #modal-body select");
  if (first) first.focus();
}

function closeModal() {
  $("#modal").hidden = true;
  $("#modal-body").innerHTML = "";
  modalConfirm = null;
}

/* --------------------------------------------------------------------------
 * Wiring
 * ---------------------------------------------------------------------- */

// One delegated listener rather than handlers per row: rows are re-rendered
// constantly and per-row listeners would leak on every refresh.
document.addEventListener("click", async (e) => {
  const hit = (attr) => e.target.closest(`[${attr}]`);

  const nav = e.target.closest(".nav-item");
  if (nav) return showView(nav.dataset.view);

  const tile = e.target.closest(".tile");
  if (tile && tile.dataset.filter) {
    state.filter = tile.dataset.filter;
    $$("#filter-chips .chip").forEach((c) =>
      c.classList.toggle("is-active", c.dataset.filter === state.filter),
    );
    return showView("members");
  }

  const chip = e.target.closest(".chip");
  if (chip) {
    state.filter = chip.dataset.filter;
    $$("#filter-chips .chip").forEach((c) => c.classList.toggle("is-active", c === chip));
    return refreshMembers();
  }

  const checkinRow = hit("data-checkin");
  if (checkinRow) return attemptCheckin(Number(checkinRow.dataset.checkin));

  const confirmBtn = hit("data-confirm-checkin");
  if (confirmBtn) {
    const blocked = $("#checkin-results").dataset.blocked === "1";
    delete $("#checkin-results").dataset.blocked;
    return confirmCheckin(Number(confirmBtn.dataset.confirmCheckin), blocked);
  }

  const memberRow = hit("data-member");
  if (memberRow) return openMember(Number(memberRow.dataset.member));

  const act = hit("data-act");
  if (act) {
    const id = state.openMemberId;
    if (act.dataset.act === "renew") return renewDialog(id);
    if (act.dataset.act === "add-cert") return documentDialog(id, true);
    if (act.dataset.act === "add-doc") return documentDialog(id, false);
    if (act.dataset.act === "archive") {
      return openModal({
        title: "Archive member",
        body: `<p class="hint">The member disappears from the roster, but their membership
                 history and documents are kept. This cannot be undone from the UI.</p>`,
        confirmText: "Archive",
        onConfirm: async () => {
          await call("member_archive", { id });
          $("#drawer").hidden = true;
          toast("Member archived.");
          refreshMembers();
          return true;
        },
      });
    }
  }

  const voidBtn = hit("data-void");
  if (voidBtn) {
    e.stopPropagation();
    const msId = Number(voidBtn.dataset.void);
    return openModal({
      title: "Void membership",
      body: `<div class="field full"><label for="vreason">Reason</label>
               <input id="vreason" type="text" placeholder="e.g. entered twice by mistake" /></div>
             <p class="hint">The record stays visible and struck through; it stops counting
                as coverage immediately.</p>`,
      confirmText: "Void",
      onConfirm: async () => {
        const reason = $("#vreason").value.trim();
        if (!reason) { toast("A reason is required.", true); return false; }
        await call("membership_void", { id: msId, reason });
        toast("Membership voided.");
        await openMember(state.openMemberId);
        return true;
      },
    });
  }

  const delDoc = hit("data-del-doc");
  if (delDoc) {
    e.stopPropagation();
    await call("document_delete", { id: Number(delDoc.dataset.delDoc) });
    toast("Document removed.");
    return openMember(state.openMemberId);
  }

  const openDoc = hit("data-open-doc");
  if (openDoc) return call("document_open", { id: Number(openDoc.dataset.openDoc) });
});

$("#btn-new-member").addEventListener("click", newMemberDialog);
$("#drawer-close").addEventListener("click", () => { $("#drawer").hidden = true; });
$("#modal-cancel").addEventListener("click", closeModal);

$("#modal-confirm").addEventListener("click", async () => {
  if (!modalConfirm) return closeModal();
  const btn = $("#modal-confirm");
  btn.disabled = true;
  try {
    const done = await modalConfirm();
    if (done !== false) closeModal();
  } catch {
    // `call` has already shown the message; keep the dialog open so the user
    // can fix the input rather than retyping everything.
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("#modal").hidden) return closeModal();
    if (!$("#drawer").hidden) $("#drawer").hidden = true;
  }
});

// Debounced so typing a name does not fire a query per keystroke.
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

$("#checkin-search").addEventListener("input", debounce((e) => runCheckinSearch(e.target.value), 180));
$("#member-search").addEventListener("input", debounce((e) => {
  state.query = e.target.value;
  refreshMembers();
}, 180));

$("#btn-backup").addEventListener("click", async () => {
  const path = await call("backup_now");
  $("#backup-result").textContent = `Saved to ${path}`;
  toast("Backup written.");
});

document.addEventListener("change", async (e) => {
  const key = e.target.dataset.key;
  if (!key) return;
  await call("settings_set", { key, value: e.target.value });
  state.settings[key] = e.target.value;
  if (key === "currency") state.currency = e.target.value;
  if (key === "gym_name") $("#gym-name").textContent = e.target.value;
  toast("Saved.");
});

/* Boot --------------------------------------------------------------------- */
(async function start() {
  await refreshSettings();
  await refreshToday();
  $("#checkin-search").focus();
})();
