# CLAUDE.md

Operating brief for this repository. The reasoning behind these rules is in
[DECISIONS.md](DECISIONS.md) — read that before changing anything structural.

## What this is

A front-desk app for one gym: month-long memberships, health certificate expiry,
member documents. Tauri 2 + SQLite + a Preact/TypeScript frontend.

It runs on a **Linux Mint desktop with 2 GB of RAM**, operated by **people with
no technical background**. Both facts constrain almost every choice.

## Commands

```bash
bun install                                            # once
bun run check                                          # tsc --noEmit
bun run build                                          # src/ -> dist/
bun run smoke                                          # boots dist/ in WebKitGTK
cd src-tauri && cargo tauri dev                        # runs the bundle first
cd src-tauri && cargo test
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo fmt --all
cd src-tauri && cargo tauri build --bundles deb
```

`bun build` only strips types. **`bun run check` is the real check** — run it
before committing, and never assume a successful bundle means the code
typechecks.

## Rules that are easy to break by accident

**Never format a user-facing sentence in Rust.** `AppError` carries
`{ code, message, params }` and the frontend translates the code. The English
`message` is a developer fallback, not UI copy. Same for `entry_check` reasons.

**Never add a cached status column.** Membership and certificate state is derived
from the `member_status` view. If something is slow, add an index.

**Never delete money or people.** Memberships are voided with a reason, members
archived, documents soft-deleted.

**Never compute period dates in the frontend.** `dates.rs` owns the stacking
rule; the frontend only displays what the backend returns.

**Never use `<input type="date">`.** WebKitGTK may render it as a bare text field.
Use the `DateField` component (three selects).

**Never add a UI string outside `src/locales/`.** A literal in a component is
invisible to the other language. Adding a key to `it.ts` makes `en.ts` a compile
error until it is translated, which is the intended pressure.

**Never edit a migration that has shipped.** Add `NNNN_name.sql` and append it to
`MIGRATIONS` in `db.rs`.

**Never put the SQLite file on a network share.**

**Never add an AppImage target back without excluding the graphics libraries.**
It bundles the build host's `libepoxy` and `libwayland*`, which fail with
`EGL_BAD_PARAMETER` on a machine with different mesa — the app runs, the window
stays black. The .deb uses the system WebKitGTK and works.

**Never invent a colour, size or spacing value.** They come from the design
system and `styles.css` uses its token names verbatim. A literal px in a rule is
a bug unless it is a 1px border or a circle. Adding a value means adding a token
there first.

**Never trust a CSS rule without measuring the result.** The base input selector
once outranked `.search-lg` and pinned the check-in field to 44px instead of
52px, silently. Read the rendered height.

**Never call a frontend change verified because it renders in a browser.** The
app ships on WebKitGTK; a Chromium tab is a different engine with a different
parser and a fake bridge. `bun run smoke` boots `dist/` in the real engine and
fails if the window would be blank. Run it before saying anything works.

**Never read `window.__TAURI__` at module scope.** Destructuring it at the top
of a module means a missing or late bridge throws during evaluation, before
anything renders, and the operator gets an empty window. Resolve it inside the
function that uses it — `bridge()` in `api.ts`.

## Dependencies

Latest **stable** release, always. Not pre-releases — Tauri 3 alpha does not
displace Tauri 2.

If `cargo add` resolves to an older version than `cargo info <crate>` reports as
latest, the crate's MSRV probably exceeds our `rust-version`. Raise the MSRV.

## Frontend layout

```
src/
  index.html  styles.css
  types.ts                      the IPC contract — mirrors src-tauri/src/models.rs
  globals.d.ts                  window.__TAURI__
  i18n.ts  locales/it.ts  locales/en.ts
  api.ts                        invoke wrappers + error-code translation
  lib/                          format.ts, status.ts
  views/                        one .tsx per screen
  components/                   shared widgets
dist/                           generated, git-ignored
```

`statusOf()` in `lib/status.ts` is the single place that turns dates into a
colour. Do not reimplement that rule in a view.

**`types.ts` is hand-written and can drift from Rust.** Change a struct in
`models.rs`, change `types.ts` in the same commit. Codegen is the proper fix and
is tracked in TODO.md.

## Language

Code, comments and commits in **English** (the repo is public). UI strings in
`src/locales/`, Italian by default. `Intl` calls take the chosen locale
explicitly, never `undefined`.

## Don't

- Don't compile a release build on the 2 GB target machine; it will thrash swap.
- Don't add a CSS framework or component library; the CSP blocks CDNs and the
  stylesheet already carries the design system's tokens.
- Don't reject a library "because 2 GB" without checking whether it actually
  moves the number. The webview dominates by two orders of magnitude.
