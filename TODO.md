# TODO

Working list. Roughly ordered: things above the line make the app usable at a
real front desk, things below make it better.

Convention: `[ ]` open, `[x]` done, `[~]` partially done. Add a one-line "why"
to anything non-obvious so it is still legible in three months.

---

## Done in the skeleton

- [x] Tauri 2 shell, SQLite, migrations via `user_version`
- [x] Membership period arithmetic + tests (clamping, leap years, stacking)
- [x] Derived status via the `member_status` view — no `is_active` column
- [x] Content-addressed document store with dedup and traversal guards
- [x] Health certificate as `document.kind = 'health_cert'`
- [x] Member CRUD, renew, void, archive
- [x] Check-in with entry rules and recorded overrides — built and tested,
      switched off in `src/features.ts` at the gym's request (DECISIONS 19)
- [x] Dashboard tiles, expiring-certificate list
- [x] `VACUUM INTO` backup with 7-snapshot retention
- [x] CI (fmt, clippy, test, build, version consistency), release, audit workflows
- [x] TypeScript + Preact frontend, bundled by bun; `tsc --noEmit` in CI
- [x] Bilingual UI (Italian default), backend errors as codes not sentences
- [x] Member edit, certificate update, and the expiries screen
- [x] Native `<dialog>` (focus trap, Escape, focus return) and three-select dates
- [x] Larger type scale, labelled search fields, Enter to check in

---

## Before it goes on the gym's desk

- [x] ~~Confirm the black window is gone~~ — found and fixed: the AppImage
      bundled the build host's graphics libraries and failed with
      `EGL_BAD_PARAMETER`. The release ships the .deb only. See DECISIONS 18.
- [ ] **Run it on real target hardware and measure RSS.** Every memory claim
      in the README is an estimate until someone reads it off that box.
      `ps -o rss= -C gym-manager` after ten minutes of normal use.
- [x] ~~Seed script / demo data~~ — `scripts/seed.py`. Fifty members across
      every combination of membership and certificate state, plus partial
      payments, a voided period, archived members and overridden check-ins. It
      reads `paid_through` and `cert_through` back out of `member_status` and
      fails if they are not the dates it asked for, so CI runs it as a check
      that the schema and the seeder still agree.
- [ ] **Confirm before archiving works, but there is no un-archive.** Add an
      "Archived" filter and a restore action — someone will archive the wrong
      person in week one.
- [ ] **Partial payments are stored but invisible.** The drawer shows "owes X"
      but there is no way to record a later payment against an existing period.
- [ ] **Empty states and first-run.** Fresh install shows zeroes and no guidance.
      A first-run panel that sets the gym name and monthly price would help.
- [x] ~~Generate `types.ts` from Rust~~ — `ts-rs` derives `src/bindings.ts`
      from every IPC-facing struct/enum under `#[cfg(test)]`; `cargo test`
      fails if it drifts from what is committed (`bindings_test.rs`).
      `src/types.ts` re-exports it plus the handful of frontend-only types.
      `PaymentMethod`, `DocumentKind`, `EntryStatus` and `Expiry`'s `kind` are
      now real Rust enums rather than validated strings, so the generated
      unions stay as precise as the old hand-written ones were.
- [ ] **Verify the date picker claim on the target distribution.** `DateField`
      uses three selects because WebKitGTK is believed not to render
      `<input type="date">`. Confirm with
      `/usr/lib/webkit2gtk-4.1/MiniBrowser 'data:text/html,<input type="date">'`
      — if it works after all, the component is still fine, but record the fact.

## Data and correctness

- [ ] **Timezone/date rollover.** Dates use `date('now','localtime')`. Confirm
      behaviour for an 00:30 check-in and for a machine whose clock is wrong.
- [ ] **Backdating a membership.** Sometimes someone paid last Tuesday. Needs a
      deliberate "start on" override, and the overlap check already in
      `membership_renew` becomes load-bearing rather than belt-and-braces.
- [ ] **Membership freezes** (injury, travel). Probably a `freeze` table with a
      date range that extends `ends_on`. Decide whether frozen time is paid time
      before building it.
- [ ] **Orphaned blob sweep.** `document_delete` is a soft delete and leaves the
      file, because content-addressing means another row may point at the same
      hash. Write a sweep that deletes files no live row references.
- [ ] **Migration test with real data.** Once `0002_*.sql` exists, add a test
      that migrates a fixture database from v1 rather than only from empty.

## Features

- [ ] **Plans beyond one month** — quarterly, annual, ten-entry punch cards. The
      schema needs a `plan` table; `dates.rs` needs a period length parameter.
      Do not do this until someone actually asks for it.
- [ ] **Attendance reporting** — visits per member per month, quiet hours.
      Needs `features.checkins` back on first; with it off nothing is being
      recorded to report, and the old rows stop at the day it was switched.
- [ ] **Revenue report** — takings per month, outstanding balances. All the data
      is already there; it is one query and a table. A breakdown *by payment
      method* would need `features.paymentMethod` back on: new renewals record
      NULL while it is off, so any such split would be blank from that day on.
- [ ] **Printable receipt** for a renewal. Probably HTML + the system print
      dialog rather than a PDF library.
- [ ] **Member photo** on the member card — and on the check-in banner if
      `features.checkins` is ever back on — so the desk can verify identity.
      Capture from webcam is a much bigger job than file import — start with
      import.
- [ ] **Bulk import** from whatever spreadsheet the gym is using today. This is
      likely the actual blocker to adoption.
- [ ] **Expiry reminders** — a list to phone through, or exported to CSV. Email
      would mean network access and a new class of dependency; think first.

## Operations

- [ ] **Scheduled backup**, not just the manual button. Simplest version: run one
      on startup if the newest snapshot is older than a day.
- [ ] **Restore path.** There is a backup button and no documented way back.
      Write the three commands down in the README and test them once.
- [ ] **Auto-update.** Tauri's updater needs a signing key and somewhere to host
      the manifest. For one machine, `apt install ./the-new.deb` may be enough —
      decide rather than drift.
- [ ] **Retention policy for health data.** Pick the statutory period, then add
      a purge for archived members' documents past it.
- [ ] **Extend the release matrix** if it ever needs to run on Windows or macOS.
      The workflow builds Linux only today.

## Known, not actionable yet

- [ ] **Dependabot's `bun` updater fails on this repo.** The configuration is
      correct — GitHub's own `dependabot.yml` check passes, the run pulls
      `dependabot-updater-bun` and executes `bun --version` — but then
      `bin/run update_files` exits 1 and the inner error is not surfaced in the
      logs. `cargo` and `github-actions` both succeed, so it is specific to bun.
      **Unverified hypothesis:** our `bun.lock` is `lockfileVersion: 2`, written
      by bun 1.4.2, and the updater image may ship an older bun that only reads
      version 1. Do not downgrade the lockfile to suit the updater — with two
      direct frontend dependencies the cost of checking them by hand is near
      zero. Re-check after the next bun or Dependabot release.
      Run: <https://github.com/PhantomDave/gym-manager/actions/runs/35462231920>

- [ ] **The glib security update run fails every time, by design of the
      situation.** Dependabot tries to resolve RUSTSEC-2024-0429 and cannot,
      because gtk 0.18 pins glib 0.18 (see the entry below). A permanently red
      Dependabot run trains people to ignore red runs, which is its own risk —
      if it becomes noise, the answer is an `ignore` entry with this reasoning
      written next to it, not silence.

- [ ] **CodeQL does not cover the Rust backend.** Default setup is enabled for
      `actions` and `javascript-typescript`, but the API rejects `rust` as a
      configurable language even though it reports it among the detected ones.
      So the half of the codebase that touches the filesystem, SQLite and
      `xdg-open` is the half not being scanned. Re-check when GitHub adds Rust
      to default setup; `cargo clippy -- -D warnings` and `cargo audit` are the
      cover until then.

- [ ] **RUSTSEC-2024-0429, `glib` 0.18.5 unsoundness** (Dependabot: medium).
      Transitive and unfixable here: `tauri 2.11.5 → muda → gtk 0.18 → atk →
      glib 0.18.5`, and the fix landed in glib 0.20. Nothing pins it on our
      side, so it moves only when Tauri moves off gtk 0.18. The affected
      functions are `glib::VariantStrIter`'s iterator impls, which this app
      never calls. **Deliberately not silenced** with an audit ignore — leave it
      visible so it gets re-checked on the next Tauri bump.

## Code health

- [ ] **Integration tests for the commands.** `dates`, `db` and `storage` are
      covered; the command layer is not. Needs a test harness that builds an
      `AppState` without a Tauri window.
- [ ] **Frontend has no tests.** `statusOf`, `daysUntil` and `eurosToCents` are
      pure functions holding real rules — `eurosToCents` in particular parses the
      comma an Italian operator types, and getting that wrong loses money.
      `bun test` needs no extra dependency.
- [x] ~~`app.js` is one file~~ — split into views, components and lib.
- [x] ~~Error messages are strings across the IPC boundary~~ — `AppError` now
      carries `{ code, message, params }` and the frontend translates it.
