# Working on this repository

Instructions for Claude and other AI agents. Humans are welcome to read them —
nothing here is agent-specific except the bluntness.

The *reasoning* behind every rule is in [DECISIONS.md](DECISIONS.md). Read the
relevant decision before changing anything structural; most of what looks odd
here is deliberate and the constraint is usually invisible in the code.

---

## What this is, and who uses it

A front-desk app for one gym: month-long memberships, health certificate
expiry, member documents. Tauri 2 + SQLite, with a Preact/TypeScript frontend.

Two facts decide almost every question:

1. It runs on a **Linux Mint desktop with 2 GB of RAM**.
2. It is operated by **people with no technical background**, standing up, while
   someone waits at the counter.

When those two conflict, the operator wins. An app that is light but that a
receptionist cannot use has failed.

---

## Verify the artifact, not a surrogate

**This is the rule that has been broken most often here, and it is first for
that reason.**

Three separate times, work was reported as verified when the thing actually
exercised was a stand-in for the thing the user runs:

| Claimed verified | What was actually run | What shipped |
|---|---|---|
| "the UI works" | the bundle in a Chromium pane, with a faked Tauri bridge | a black window on WebKitGTK |
| "the release pipeline works" | a dry run that was never re-checked after its fix | an untested workflow |
| "the black screen is fixed" | a log line from the *test harness*, not from the app | a wrong cause written into DECISIONS.md |

The pattern is always the same: mistaking *"the part I control compiles"* for
*"the thing the user opens works"*.

So, before saying anything works:

- **Run the real thing.** `bun run smoke` boots `dist/` in WebKitGTK — the
  engine that ships — and fails if the window would be blank. A Chromium tab
  proves only that Chromium is happy.
- **Read the output of the command you ran**, not the exit code. `cargo tauri
  build` printed `Error failed to bundle project` while the wrapper reported
  success.
- **Measure rendered results.** A CSS rule that looks right can be outranked: a
  base selector once pinned the check-in field to 44px instead of 52px, in
  silence. Read the height, do not read the stylesheet.
- **Say what you did not verify.** "The `.deb` builds and the binary runs; I
  could not watch the window" is useful. "It works" is not.

A check that cannot fail is not a check. When adding one, break the code on
purpose and confirm it goes red.

---

## How work gets done here

**Never push to `main`.** Every change: branch → pull request → review the diff
properly → wait for CI → merge only on green. `main` has a ruleset requiring
PRs; an admin account can bypass it, and that is not permission to.

```bash
git checkout -b kind/short-description
# …work, verify…
gh pr create --title "…" --body "…"
gh pr checks <n> --watch
gh pr merge <n> --squash --delete-branch
```

Review your own diff before merging, with the same suspicion you would give
someone else's. It has caught real bugs every time it was done honestly: an
`npm` ecosystem that could not update `bun.lock`, a `:where()` selector that
could have stripped every input of its styling, two spellings of one state.

If a push ever prints "Bypassed rule violations", that is a mistake to report,
not a success.

---

## Rules that are easy to break by accident

### Optional features

**Check-ins and the payment method are switched off**, in `src/features.ts`.
They are flags, not deletions: the `checkin` table, the `payment_method` column
and the Rust commands behind both are intact and tested, and a flag flip brings
the screens back with their history. Do not "finish the job" by removing the
backend — see DECISIONS 19, and the rule below about never deleting money or
people.

When adding UI for something behind a flag, guard the render and the call, not
just the render: a command that is never invoked cannot fail in the background.

### Money, people and dates

**Never delete money or people.** Memberships are voided with a reason, members
are archived, documents are soft-deleted. It is financial and health record
keeping.

**Never add a cached status column.** Membership and certificate state is
derived from the `member_status` view. If something is slow, add an index.

**Never compute period dates in the frontend.** `dates.rs` owns the stacking
rule — early renewals stack, lapses start today, months clamp to the end of the
target month. The frontend displays what the backend returns.

**Never edit a migration that has shipped.** Add `NNNN_name.sql` and append it
to `MIGRATIONS` in `db.rs`.

**Never put the SQLite file on a network share.** One machine, one connection.

### What the operator reads

**Never format a user-facing sentence in Rust.** `AppError` carries
`{ code, message, params }` and the frontend translates the code; the English
`message` is a developer fallback, not UI copy. Same for `entry_check` reasons.
Without this, a receptionist reads `not found: member 5`.

**Never add a UI string outside `src/locales/`.** A literal in a component is
invisible to the other language. Adding a key to `it.ts` makes `en.ts` a compile
error until it is translated — that pressure is deliberate.

**Never let colour travel alone.** Every status badge carries a word containing
the date. Roughly one man in twelve cannot separate the red from the green and
reads the word instead.

**Never invent a colour, size or spacing value.** They come from the design
system and `styles.css` uses its token names verbatim. A literal px is a bug
unless it is a 1px border or a circle. New value means new token, there first.

### The platform

**Never use `<input type="date">`.** WebKitGTK may render it as a bare text
field expecting `YYYY-MM-DD`, which is how a certificate expiry gets entered
wrong. Use `DateField` (three selects).

**Never let a `<select>` keep the native appearance.** With `appearance: auto`
WebKitGTK paints the GTK widget over the background and border the stylesheet
set, while still using our `color` for the text — near-white on near-white in
dark mode, measured at 1.02:1. `getComputedStyle` reports the colour we asked
for and sees none of it; only the rendered pixels do. `styles.css` opts every
select out and draws its own arrow. See DECISIONS 20.

**Never read `window.__TAURI__` at module scope.** Destructuring it at the top
of a module means a missing or late bridge throws during evaluation, before
anything renders, and the operator gets an empty window. Resolve it inside the
function that uses it — `bridge()` in `api.ts`.

**Never add an AppImage target back without excluding the graphics libraries.**
It bundles the build host's `libepoxy` and `libwayland*`, which fail with
`EGL_BAD_PARAMETER` wherever mesa differs: the app runs and the window stays
black. The `.deb` links against the system WebKitGTK and works.

**Never compile a release build on the 2 GB target machine.** `lto = true` will
thrash swap. Build elsewhere, install the `.deb`.

### Dependencies

Latest **stable**, always — not pre-releases. Tauri 3 alpha does not displace
Tauri 2.

If `cargo add` resolves lower than `cargo info <crate>` reports as latest, the
crate's MSRV probably exceeds our `rust-version`. **Raise the MSRV** rather than
staying behind; that is what happened with `sha2` 0.11 needing Rust 1.85.

**Don't reject a library "because 2 GB"** without checking whether it moves the
number. The webview dominates memory by two orders of magnitude; a 5 KB bundle
versus a 60 KB one is noise. Reject for maintenance cost, not bytes.

**Don't add a CSS framework or component library.** The CSP blocks CDNs and the
stylesheet already carries the design system's tokens.

---

## Commands

```bash
bun install                                       # once
bun run check                                     # tsc --noEmit — the real check
bun run build                                     # src/ -> dist/
bun run smoke                                     # boots dist/ in WebKitGTK
cd src-tauri && cargo tauri dev                   # builds the bundle first
cd src-tauri && cargo test
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo fmt --all
cd src-tauri && cargo tauri build --bundles deb   # .deb only, never appimage
```

`bun build` only strips types — it will happily bundle code that does not
typecheck. `bun run check` is the check that matters.

---

## The map

```
src/                       frontend (TypeScript + Preact)
  boot.js                  loaded BEFORE the bundle; turns a failed boot into a
                           readable message instead of a black window
  types.ts                 the IPC contract — mirrors src-tauri/src/models.rs
  features.ts              which optional features are switched on
  api.ts                   invoke wrappers + error-code translation
  i18n.ts  locales/        it.ts is the reference; en.ts is typed against it
  lib/status.ts            statusOf(): the ONE place dates become a colour
  lib/format.ts            dates and money; Intl always takes an explicit locale
  views/                   one .tsx per screen
  components/              shared widgets
src-tauri/src/
  dates.rs                 period arithmetic — the subtle part, well tested
  db.rs                    pragmas + migrations by user_version
  storage.rs               content-addressed document store
  error.rs                 coded errors, never prose
  commands/                the entire IPC surface
scripts/smoke.py           boots dist/ in WebKitGTK; CI runs it under xvfb
dist/                      generated, git-ignored
```

`statusOf()` is the single source of the colour rule. Do not reimplement it in
a view.

**`types.ts` is hand-written and can drift from Rust.** Change a struct in
`models.rs`, change `types.ts` in the same commit. Codegen (`ts-rs`) is the
proper fix and is the top correctness item in [TODO.md](TODO.md).

---

## Language

Code, comments and commit messages in **English** — the repository is public.
The *interface* is Italian by default with English available; UI strings live in
`src/locales/` and nowhere else.

---

## What to read, when

| Question | File |
|---|---|
| Why is it built this way? | [DECISIONS.md](DECISIONS.md) |
| What is still broken or missing? | [TODO.md](TODO.md) |
| What does a token or component mean? | the design system, linked from DECISIONS 16 |
| How do I run or package it? | [README.md](README.md) |

When you finish a piece of work, say what you verified **and what you did not**.
The second half is the part that turns out to matter.
