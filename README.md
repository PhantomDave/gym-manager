# Gym Manager

A small desktop app for running the front desk of a single gym: month-long
memberships, health certificate expiry, and the documents you have to keep on
file for each member.

Built to run comfortably on a **Linux Mint machine with 2 GB of RAM**. That
constraint drives most of the design decisions below.

---

## What it does

- **Members** — roster with search, filtered by membership and certificate state.
- **Memberships** — one calendar month at a time, with the renewal maths handled
  so early renewals stack and lapses don't get backdated.
- **Health certificates** — expiry tracked, warned about 30 days ahead, and
  enforced at check-in.
- **Documents** — ID cards, waivers, contracts, receipts and photos registered
  against a member, stored on disk and opened in the system viewer.
- **Check-in** — type a name, get a green/amber/red banner, admit or override
  with a recorded reason.
- **Backup** — one button, a consistent SQLite snapshot, seven kept.

## Why this stack

| | |
|---|---|
| **Shell** | Tauri 2 — uses the WebKitGTK already on Mint instead of shipping a second browser. Electron idles around 400 MB; this sits near 100–150 MB. |
| **Backend** | Rust, one SQLite file, one connection behind a mutex. No server, no pool, no ORM. |
| **Frontend** | Preact + TypeScript, bundled by bun. Three npm packages in total; no CSS framework. |
| **Documents** | Content-addressed files on disk, never BLOBs in the database. |
| **Viewing** | `xdg-open` hands PDFs to the system viewer. Bundling a renderer would cost more memory than the rest of the app. |

The app makes no network requests at all.

## Design decisions worth knowing

**Membership status is derived, never stored.** There is no `is_active` column.
A member is active if a non-voided period covers today, computed from the
`member_status` view. Nothing can drift out of sync because there is nothing to
sync.

**A health certificate is a document.** `kind = 'health_cert'` with an
`expires_on`, in the same table as everything else. One upload path, one expiry
rule, one place to fix bugs.

**Money and people are never deleted.** Memberships are voided with a reason,
members are archived, documents are soft-deleted. All of it stays auditable.

**Period arithmetic lives in one file** with tests covering the cases that
actually bite: `Jan 31 → Feb 27`, leap years, year rollover, and the difference
between renewing early and renewing late. See
[`src-tauri/src/dates.rs`](src-tauri/src/dates.rs).

## Layout

```
src/                     frontend (TypeScript + Preact)
  types.ts               the IPC contract — mirrors models.rs
  i18n.ts  locales/      Italian and English catalogues
  lib/status.ts          the single rule turning dates into a colour
  views/                 one .tsx per screen
src-tauri/
  src/
    dates.rs             membership period rules (the subtle part)
    db.rs                pragmas + migrations
    storage.rs           content-addressed document store
    error.rs             coded errors — never prose
    commands/            the entire IPC surface
    migrations/          plain .sql, applied by user_version
  tauri.conf.json
  capabilities/          exactly two permissions beyond core
```

## Language

The interface is bilingual, Italian by default, English available in Settings.
Code, comments and commits are English. UI strings live in `src/locales/`; the
English catalogue is typed against the Italian one, so a missing translation is
a compile error rather than a blank label.

## Building

Rust 1.85+ and the Tauri system libraries. On Debian/Ubuntu/Mint:

```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev libxdo-dev libssl-dev build-essential file
```

Then the toolchains:

```bash
cargo install tauri-cli --locked --version "^2"
bun install
```

Run it in development — the frontend bundle is built automatically first:

```bash
cd src-tauri && cargo tauri dev
```

Tests, types and lints:

```bash
bun run check
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

Demo data — fifty fake members across every combination of membership and
certificate state, so the interface can be judged without typing rows in:

```bash
python3 scripts/seed.py --db /tmp/demo.db
```

That seeds a throwaway file. To fill the app's own database instead, drop
`--db` and add `--reset`, which deletes everything already in it — so never
point it at the gym's machine. The seeded gym is named "Palestra Demo" and the
certificates are generated PDFs that say so on the page.

Build the installable package:

```bash
cd src-tauri && cargo tauri build --bundles deb
```

**The .deb, not an AppImage.** The AppImage bundles the build host's graphics
libraries and fails with `EGL_BAD_PARAMETER` on any machine whose mesa differs —
a black window with the app running fine behind it. The .deb links against the
system WebKitGTK, which is what `cargo tauri dev` does and why dev works.
See [DECISIONS.md](DECISIONS.md).

> **Don't compile on the 2 GB target machine.** A release build with `lto = true`
> will thrash swap for a very long time. Build on a development machine (or let
> the release workflow do it) and install the resulting `.deb` on the gym's
> desktop.

## Releasing

Tag and push; CI builds the package and opens a **draft** release with the
`.deb` attached.

```bash
# bump the version in src-tauri/Cargo.toml AND src-tauri/tauri.conf.json first
git tag v0.2.0 && git push origin v0.2.0
```

CI fails the release if those two versions disagree with the tag.

## Data and backups

Everything lives in one directory:

```
~/.local/share/dev.phantomdave.gymmanager/
  gym.db                  the database
  docs/ab/ab12cd…pdf      documents, sharded by hash
  backups/gym-2026-09-19.db
```

**Settings → Back up now** writes a consistent snapshot via `VACUUM INTO` and
prunes to the last seven. Documents are append-only and content-addressed, so
`rsync` them to external storage separately:

```bash
rsync -a ~/.local/share/dev.phantomdave.gymmanager/ /media/usb/gym-backup/
```

A gym's entire membership record living on one desktop with no second copy is
the biggest risk in this system — well above anything in the code.

## Health data

Health certificates are medical data. Depending on where the gym operates they
may be a special category under GDPR or a local equivalent, with consent,
retention and access obligations attached.

Practical consequences, all of which this design already assumes:

- Everything stays local. The app has no network access and no telemetry.
- Don't put `docs/` in an unencrypted cloud folder. Encrypt backups that leave
  the building (`age` or `gpg`).
- Define a retention period and purge archived members' documents after it.

## Scope

Built for one gym, one machine, one or two people at the desk. No concurrent
access, no online payments, no member portal.

If you need more than one machine, **do not put the SQLite file on a network
share** — that is a corruption bug waiting to happen. Replace the local
connection with a small server process instead.

## Contributing

[AGENTS.md](AGENTS.md) is the operating brief — for AI agents, and readable by
anyone. It covers the workflow (branch, pull request, merge only on green), the
rules that are easy to break by accident, and why verifying the real artifact
rather than a stand-in matters here.

## Licence

MIT. See [LICENSE](LICENSE).
