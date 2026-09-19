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
- [x] Check-in with entry rules and recorded overrides
- [x] Dashboard tiles, expiring-certificate list
- [x] `VACUUM INTO` backup with 7-snapshot retention
- [x] CI (fmt, clippy, test, build, version consistency), release, audit workflows

---

## Before it goes on the gym's desk

- [ ] **Run it on the actual Mint machine and measure RSS.** Every memory claim
      in the README is an estimate until someone reads it off that box.
      `ps -o rss= -C gym-manager` after ten minutes of normal use.
- [ ] **Seed script / demo data.** Fifty fake members across every status
      combination, so the UI can be judged without hand-entering rows.
- [ ] **Edit an existing member.** `member_update` exists on the backend but the
      drawer has no edit form yet.
- [ ] **Confirm before archiving works, but there is no un-archive.** Add an
      "Archived" filter and a restore action — someone will archive the wrong
      person in week one.
- [ ] **Partial payments are stored but invisible.** The drawer shows "owes X"
      but there is no way to record a later payment against an existing period.
- [ ] **Empty states and first-run.** Fresh install shows zeroes and no guidance.
      A first-run panel that sets the gym name and monthly price would help.
- [ ] **Keyboard flow at the desk.** Enter should check in the top search result;
      right now it needs a click.

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
- [ ] **Revenue report** — takings per month, outstanding balances. All the data
      is already there; it is one query and a table.
- [ ] **Printable receipt** for a renewal. Probably HTML + the system print
      dialog rather than a PDF library.
- [ ] **Member photo** on the check-in banner, so the desk can verify identity.
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

## Code health

- [ ] **Integration tests for the commands.** `dates`, `db` and `storage` are
      covered; the command layer is not. Needs a test harness that builds an
      `AppState` without a Tauri window.
- [ ] **Frontend has no tests at all.** `statusOf` and `daysUntil` are pure
      functions holding the whole status rule — worth extracting and testing if
      the UI grows.
- [ ] **`app.js` is one file.** Fine at this size; split when a screen is added,
      not before.
- [ ] **Error messages are strings across the IPC boundary.** If the UI ever
      needs to branch on error type, give `AppError` a code field.
