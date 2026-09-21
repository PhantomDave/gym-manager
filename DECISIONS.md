# Decisions

Why this app is built the way it is. Read this before changing anything
structural — most of what looks odd here is deliberate, and the reasoning is
usually a constraint that is not visible in the code.

Format: each decision states what was chosen, what it rules out, and what would
make us revisit it.

---

## 0. The constraint everything else follows from

The app runs on a **Linux Mint desktop with 2 GB of RAM**, at the front desk of
a single gym, operated by **people with no technical background**.

Those two facts — 2 GB, non-technical operators — decide almost every question
below. When they conflict, the operator wins: an app that is light but that a
receptionist cannot use has failed.

### Measured, not assumed

Taken on 2026-09-19 against the real frontend:

| | |
|---|---|
| Frontend total | 42.6 KB (11.4 KB gzip) |
| 400-member list | 2933 DOM nodes, rendered in **0.9 ms** |
| JS heap | **1.85 – 3.5 MB** |
| WebKitGTK process | ~100–150 MB (**estimate — still unverified on the target machine**) |

**The consequence people get wrong:** the webview dominates memory by two orders
of magnitude. A JS bundle of 5 KB versus 60 KB is noise. Never reject a library
"because 2 GB" without checking whether it moves that number — it almost never
does. Reject libraries for maintenance cost, not for bytes.

The 100–150 MB figure is an estimate. Verifying it on the Mint machine is the
first item in TODO.md and nothing should be built on that number until someone
reads it off `ps -o rss= -C gym-manager`.

---

## 1. Tauri 2, not Electron

Tauri uses the WebKitGTK already installed on Mint. Electron ships its own
Chromium and Node and idles around 400 MB, which is a fifth of the machine
before the app does anything.

**Revisit if:** the app ever needs to target Windows and macOS seriously and
WebKitGTK divergence becomes a bigger tax than Electron's memory. Unlikely.

## 2. TypeScript, bundled by bun — REVERSED 2026-09-19

**This decision originally read "no build step, no `node_modules`".** It was
reversed the same day, deliberately, and the original reasoning is kept below
because it still describes what the reversal costs.

The frontend is TypeScript in `strict` mode, bundled by `bun build` into
`dist/`. Tauri's `beforeBuildCommand` runs it, so `cargo tauri build` remains the
single command that produces an installable app.

**Why the reversal:** the data model is exactly the shape where types pay —
money in integer cents, ISO date strings, `Option<T>` fields that arrive as
`null`, and three near-identical member shapes (`MemberRow`, `Member`,
`MemberInput`) that are easy to confuse at a call site. The IPC boundary is
untyped by construction; `types.ts` is where that is fixed.

**What it costs**, and these are real:

- `node_modules` exists now. The surface is three packages: `preact`,
  `typescript`, and bun's own resolution. That is small enough to audit, which
  is the only reason it is acceptable on an app holding health data.
- CI needs `oven-sh/setup-bun` and `bun install --frozen-lockfile`.
- The file you edit is no longer the file that ships. `dist/` is generated and
  git-ignored.

**`tsc --noEmit` is the check that matters.** `bun build` only strips types; it
will happily bundle code that does not typecheck. CI runs both.

**Revisit if:** the bundler becomes a maintenance burden of its own, or someone
has to resurrect this in five years and bun is gone. The escape hatch is that
`tsc` alone can emit runnable JavaScript.

## 3. Membership status is derived, never stored

There is no `is_active` column. A member is active if a non-voided period covers
today, computed by the `member_status` view. Nothing can drift out of sync
because there is nothing to sync.

**Never add a cached status column.** If a query is slow, add an index. At a few
hundred members this will never be slow.

## 4. A health certificate is a document

`document.kind = 'health_cert'` with an `expires_on`, in the same table as ID
cards and waivers. No separate certificate table.

One upload path, one expiry rule, one place to fix bugs. The "current"
certificate is the one with `max(expires_on)`.

**Revisit if:** certificate types need fields no other document has. Add columns
or a JSON `meta` before adding a table.

## 5. Documents on disk, never BLOBs in SQLite

Content-addressed at `docs/<first 2 hex>/<sha256>.<ext>`. Identical uploads
deduplicate for free.

A few hundred members' scans is several GB. Inside the database that means slow
backups, a bloated WAL, and page-cache pressure the machine cannot afford.

**Consequence:** `document_delete` is a soft delete and leaves the file, because
another row may point at the same hash. Reclaiming orphans is a separate
deliberate sweep, not a side effect of deleting a row.

## 6. Money and people are never deleted

Memberships are voided with a reason, members are archived, documents are
soft-deleted. Financial records and health documents may carry statutory
retention; neither should vanish because someone cancelled.

## 7. PDFs open with `xdg-open`

Bundling a PDF renderer would cost more memory than the rest of the app put
together. The system viewer already exists and its memory is not our process's
memory.

## 8. Preact with TSX — adopted 2026-09-19

Preact 10 from npm, written as `.tsx`. **htm was evaluated and dropped:** its
tagged templates are not type-checked, so pairing it with TypeScript would pay
the cost of a toolchain and skip the benefit exactly where component props are
wired together. Once a build step exists (decision 2), JSX is strictly better.

Adopted because the UI grew past three screens (member edit, certificate update,
expiries). It removes the `innerHTML` + manual `esc()` pattern — which was
correct but one forgotten call away from breaking — and gives keyed lists that
preserve focus and scroll.

Bundle: **99 KB raw, 23.6 KB gzip**, including Preact, every screen and both
language catalogues. Not minified on purpose: nothing is served over a network,
so the only thing minification would buy is harder debugging.

### What was rejected, and why it was NOT the memory

Measured 2026-09-19:

| | gzip | build step | verdict |
|---|---|---|---|
| **preact (+ TSX)** | **~5 KB** | yes | adopted |
| React + ReactDOM | 46.5 KB | yes, for JSX | redundant — Preact is API-compatible at 1/9 the size |
| Vue 3 global prod | 61.2 KB | no | legitimate, but 12× Preact for no gain here |
| Angular | — | heavy | CLI + TypeScript + RxJS + zone.js outlives its usefulness at this size |

Vue is the **heaviest** of the three, which contradicts the usual intuition.

None of them were rejected for memory. Even Vue at 61 KB gzip is 2–3 MB of heap
against a 100–150 MB webview — about 2%. They were rejected for toolchain weight
(Angular) and redundancy (React).

**No router.** A sidebar plus a `currentView` state variable is enough for six
screens.

## 9. Bilingual UI, Italian by default — adopted 2026-09-19

The operators are Italian. The repository is public, so **code, comments and
commit messages stay in English**; only the *interface* is translated.

- Flat catalogue per language in `src/locales/`, `t(key, params)` to read it.
- Chosen language lives in the `setting` table, default `it`.
- `Intl` formatting takes the **chosen** locale explicitly. Passing `undefined`
  reads the system locale, which would show an Italian UI with American dates.
- Italian has two plural forms; `Intl.PluralRules` is native and free.

### Catalogue completeness is a compile error

`it.ts` is the reference. `en.ts` is typed `Record<CatalogueKey, string>`, where
`CatalogueKey` is derived from the Italian object, so a key present in one and
missing from the other fails `tsc`. There is no runtime check because there does
not need to be one.

### The part that is easy to get wrong

**Backend errors cross the IPC boundary as codes, not sentences.** `AppError`
carries `{ code, message, params }`; the frontend translates the code and falls
back to `message` for anything unmapped.

Without this, a receptionist sees `not found: member 5` in English. The rule:
**never format a user-facing sentence in Rust.** That includes the `entry_check`
reasons, which are `{ code, params }` for the same reason.

## 10. Period arithmetic lives in one file

`src-tauri/src/dates.rs`, with tests for the cases that bite:

1. A period is one calendar month, clamped. Jan 15 → Feb 14. **Jan 31 → Feb 27**,
   because `Jan 31 + 1 month` clamps to Feb 28 and the end date is inclusive.
2. Renewing early **stacks** — the new period starts the day after the current
   one ends, so paying ahead never costs days.
3. Renewing after a lapse **starts today** — lapsing never grants backdated time.

Start and end dates are computed in the backend, never taken from the frontend,
so a stale form cannot bypass the stacking rule.

**Grace periods are a display concept only.** Baking grace into `ends_on` would
let it compound on every renewal.

## 11. Dates are entered with three selects, not `<input type="date">`

WebKitGTK does not reliably render a date picker; it can degrade to a plain text
field expecting `YYYY-MM-DD`. Asking a non-technical operator to type that is
exactly how a certificate expiry gets entered wrong.

Verify on the target machine with:

```bash
/usr/lib/webkit2gtk-4.1/MiniBrowser 'data:text/html,<input type="date">'
```

## 12. One SQLite connection behind a mutex

No pool. One person uses this on one machine; a pool adds a dependency and a
lifetime problem to solve contention that does not exist.

**Never put the database on a network share.** If a second machine is ever
needed, replace the local connection with a small server process. SQLite over
SMB/NFS is a corruption bug waiting to happen.

## 13. Dependencies track the latest stable release

Not the latest *pre-release* — Tauri 3 alpha does not displace Tauri 2.

When `cargo add` silently resolves to an older version, the cause is usually the
crate's MSRV exceeding our declared `rust-version`. Raise the MSRV rather than
staying behind. This is what happened with `sha2` 0.11, which needs Rust 1.85.

When an upgrade forces hand-written code that the crate used to provide, pin the
behaviour with a test — `storage.rs` hashes a published SHA-256 vector for
exactly this reason.

## 14. Health data

Health certificates are medical data, plausibly a special category under GDPR or
the local equivalent, with consent, retention and access obligations.

- Everything stays local. No network calls, no telemetry.
- `docs/` must not sit in an unencrypted cloud folder. Encrypt backups that
  leave the building.
- A retention period must be chosen and archived members' documents purged after
  it. **Still open** — see TODO.md.

## 16. The design system owns the visual values — adopted 2026-09-21

The palette, type scale, spacing, radii and target sizes live in a published
design system, and `src/styles.css` uses **the same token names**, so a change
there is a find-and-replace here rather than a translation exercise.

Three numbers changed when it was applied, and none of them are taste:

| | was | now | why |
|---|---|---|---|
| Target height | 39px | **44px** | WCAG 2.2 SC 2.5.5 (AAA). The 24px AA floor is not enough for someone uneasy with a mouse. |
| Body / secondary text | 14 / 12px | **16 / 14px** | 14px is now an absolute floor; phone numbers and expiry dates are not captions. |
| Focus ring | 2px | **3px** | It has to be visible from the other side of the counter. |

`border-control` was darkened to #7d848c specifically to clear 3:1. That is not
decoration: a text field has to *look* like a text field to someone who never
learned that a pale rectangle can be typed into.

**Every colour pair was measured, not estimated.** The generator script computes
the contrast ratios and emits `tokens.json` from the same source, so the check
and the file cannot drift. 30 pairs pass in both themes; the weakest is 3.46:1
where 3:1 is needed.

**The third state is called `blocked`, not `bad`.** The word says what it means
to the desk — this person cannot train — rather than how it feels.

**Colour never travels alone.** Every badge carries a word containing the date.
Roughly one man in twelve cannot separate the red from the green and reads the
word instead. A badge that is only a coloured dot is a bug.

### Specificity is part of the contract

`.search-lg` is meant to lift the check-in search to 52px, and for one commit it
did not: the base input rule was written `input:not(…):not(…):not(…)`, whose
specificity outranks a single class, so the field silently stayed at 44px. The
negations now sit inside `:where()`, which contributes none. **Measure a target,
never assume the rule that sets it wins** — this was caught by reading the
rendered height, not the stylesheet.

## 17. The frontend is verified in WebKitGTK, and a failed boot is visible

Two separate holes let a black window reach the desk, and both are closed.

**The engine.** Every frontend check until now ran in a Chromium pane against a
stubbed bridge. That proves the bundle renders in Chromium — a different parser,
a different module loader, a different CSS engine from the WebKitGTK the app
actually ships on. `scripts/smoke.py` loads `dist/` in WebKitGTK 4.1 through the
same bindings Tauri uses, stubs the bridge, waits for the mount and reports what
the DOM contains; it exits non-zero when the window would be blank. It runs in
CI under `xvfb`.

It was verified by breaking the app on purpose: with a module-scope throw it
reports three specific failures, and with the app restored it passes. A check
that cannot fail is not a check.

**The silence.** A failure before the first render left `#app` empty, so the
operator saw the page background and nothing else — on a machine with no
developer tools and nobody who could open them. `src/boot.js` is a classic
script loaded *before* the bundle (the CSP is `script-src 'self'`, so an inline
handler is blocked, and a handler at the top of `app.tsx` would be too late
because the bundler evaluates `api.ts` first). It installs error handlers and an
eight-second watchdog, and paints a readable message with the underlying error.

**The bridge.** `api.ts` used to destructure `window.__TAURI__` at module scope.
Any missing, late or incomplete bridge therefore threw during module evaluation,
before a single component mounted. It is now resolved lazily inside `bridge()`
and raises a sentence the boot guard can show.

### What is fixed versus what is suspected

The smoke test **proves** the frontend boots and renders correctly in WebKitGTK,
so the bundle was not the cause of the reported black screen. Running the app on
this machine logged `GDK is not able to create a GL context`, which is a known
cause of a black WebKitGTK window on Linux and is unrelated to the frontend.
`main.rs` therefore sets `WEBKIT_DISABLE_COMPOSITING_MODE` and
`WEBKIT_DISABLE_DMABUF_RENDERER` on Linux unless they are already set. The
accelerated path buys nothing here — no animation, no canvas, no video — and a
window that always draws is worth more than it.

**Still unconfirmed:** nobody has watched the window before and after that
change. It is a strong hypothesis supported by the log, not a reproduction.

## 15. Build on a development machine, not on the target

A release build with `lto = true` and `codegen-units = 1` will thrash swap on
2 GB for a very long time. Build the `.deb` elsewhere and install it there.
