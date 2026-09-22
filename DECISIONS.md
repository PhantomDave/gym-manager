# Decisions

Why this app is built the way it is. Read this before changing anything
structural — most of what looks odd here is deliberate, and the reasoning is
usually a constraint that is not visible in the code.

Format: each decision states what was chosen, what it rules out, and what would
make us revisit it.

---

## 0. The constraint everything else follows from

**This app should be as lightweight and efficient as possible.** That is the
principle almost every question below answers to — not a specific machine, but
a standing bias against weight: every dependency, every abstraction, every MB
has to earn its place.

### Measured, not assumed

Taken on 2026-09-19 against the real frontend:

| | |
|---|---|
| Frontend total | 42.6 KB (11.4 KB gzip) |
| 400-member list | 2933 DOM nodes, rendered in **0.9 ms** |
| JS heap | **1.85 – 3.5 MB** |
| WebKitGTK process | ~100–150 MB (**estimate — still unverified on target hardware**) |

**The consequence people get wrong:** the webview dominates memory by two orders
of magnitude. A JS bundle of 5 KB versus 60 KB is noise. Never reject a library
for its footprint without checking whether it moves that number — it almost
never does. Reject libraries for maintenance cost, not for bytes.

The 100–150 MB figure is an estimate. Verifying it on real hardware is the
first item in TODO.md and nothing should be built on that number until someone
reads it off `ps -o rss= -C gym-manager`.

---

## 1. Tauri 2, not Electron

Tauri uses the WebKitGTK already installed on the system. Electron ships its
own Chromium and Node and idles around 400 MB before the app does anything.

**Revisit if:** the app ever needs to target Windows and macOS seriously and
WebKitGTK divergence becomes a bigger tax than Electron's memory. Unlikely.

**Update, 2026-09-22:** the release workflow now builds Windows and macOS
bundles too (decision 21). That is not the Electron trade-off above — Tauri
still uses each platform's own WebView2/WKWebView rather than bundling
Chromium — but it does mean the WebKitGTK-specific code in this app (decision
11's three-select date field, decision 20's `appearance: none` on `select`)
now runs on engines it was never measured against. Nothing in it is expected
to behave worse elsewhere — both workarounds route around platform quirks
rather than relying on one — but nobody has looked at a rendered screen on
either platform. See decision 21.

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
design system — <https://claude.ai/artifact/A7KjGfvhFdWDexJ3ErResX> — and
`src/styles.css` uses **the same token names**, so a change there is a
find-and-replace here rather than a translation exercise.

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

### What is fixed versus what was wrongly suspected — corrected 2026-09-21

The smoke test **proved** the frontend boots and renders correctly in
WebKitGTK, so the bundle was never the cause.

**The cause recorded here first was wrong.** It blamed `GDK is not able to
create a GL context` and added `WEBKIT_DISABLE_COMPOSITING_MODE` and
`WEBKIT_DISABLE_DMABUF_RENDERER` to `main.rs`. That log line came from the test
harness — `Gtk.OffscreenWindow`, which legitimately has no GL context — not from
the app. The env vars were then tested against the failing AppImage and changed
nothing. They have been removed: a workaround with no evidence behind it is
cruft, and the app runs fine without them.

The real cause is decision 18.

## 18. The release ships a .deb, not an AppImage — 2026-09-21

`cargo tauri dev` worked while the AppImage showed a black window. Running the
AppImage and reading its stderr gave the answer in one line:

```
Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
```

The WebKit processes were alive; the graphics path was not, so the window never
painted. **The AppImage bundles the build host's graphics stack** — `libepoxy`,
`libwayland-client`, `libwayland-egl` and friends, taken from the ubuntu-22.04
runner — and those conflict with the mesa on any machine that differs.

Proved by deleting exactly those five libraries from the extracted AppDir and
running it again: the EGL error disappeared completely. No environment variable
fixed it — compositing off, DMABUF off, software GL, `GDK_BACKEND=wayland` and
a cairo renderer were all tried and all still failed.

The `.deb` links against the **system** WebKitGTK, epoxy and Wayland, which is
exactly what `cargo tauri dev` does and exactly why dev worked. Verified by
running the release binary: no EGL error, web and network processes alive.

**So the release ships the .deb only.** The target is a single known desktop
Linux install, where .deb is the native format; the AppImage's portability
buys nothing there and cost a black screen. It is also 80 MB against 2.5 MB,
and 244 MB unpacked.

**Revisit if:** the app ever has to run on a distro without a matching
WebKitGTK. Reviving the AppImage means excluding the graphics libraries from the
bundle, not re-enabling the target as it stands.

### Building the AppImage locally does not work either

On Arch/CachyOS the bundled `linuxdeploy` fails on every system library:

```
strip: ... unknown type [0x13] section `.relr.dyn'
```

Its `strip` predates the relocation format the modern toolchain emits.
`NO_STRIP=1` works around it, but since the target is now `deb` only, nothing
here needs linuxdeploy at all.

## 19. Optional features are build-time flags — 2026-09-21

The gym asked for two things to go: recording who trained and when, and asking
how a renewal was paid. Neither is a mistake in the code, and another desk would
want both, so they are switched off in `src/features.ts` rather than deleted.

**Nothing behind a flag was removed.** The `checkin` table, the
`payment_method` column, `entry_check` / `checkin_create` / `checkins_today` and
the entry rules in `commands/checkins.rs` are all still there, still tested,
still backed up. A flag decides what the frontend renders and which commands it
calls; rows already recorded stay in the database and reappear the moment the
flag goes back to `true`. That is the same reasoning as decision 6 — this app
does not delete money or people, and it should not delete their history either
because a screen was turned off.

**Why build-time constants and not rows in `setting`.** The settings screen is
operated by a receptionist between customers. A toggle there that removes half
the main screen is a way to lose the main screen by accident, and no member of
staff needs it: turning check-ins back on is a decision the owner makes once,
and it ships in the `.deb`. The cost is that flipping one needs a rebuild, which
for an app distributed as a `.deb` is the same trip as any other change.

**What the operator loses with `checkins: false`.** The Today screen keeps its
search box — it is still the fastest way to a member card, and Enter still
confirms the top result — but it opens the card instead of admitting, and there
is no entry banner, no override, no "came in today" list and no visits tile.
Nothing about whether a person *may* train is lost: the membership and
certificate badges are unchanged and the card still says it in words.

**Revisit if:** a third flag appears. Two is a config module; five would be an
argument for the `setting` table and a screen behind a password.

## 20. The stylesheet does not own a `<select>` until it says `appearance: none` — 2026-09-21

The select controls were being drawn by the platform, not by `styles.css`. With
the native appearance left on, WebKitGTK paints the GTK widget over our
background and border **while still using our `color` for the text**. On a dark
system theme that is `--surface-ink` (near-white) on the theme's near-white
control: measured at **1.02:1**, where 4.5:1 is the floor. The date field is
three of them, and decision 11 exists because that is the field most likely to
be entered wrong.

`getComputedStyle` could not see it. It reported `background-color:
rgb(24, 32, 40)` — the colour we asked for — the whole time. Only the rendered
framebuffer showed white on white, which is decision 17's rule applied to one
control: read the pixels, not the rule that was supposed to produce them.

Two changes, both measured in WebKitGTK:

| | select fill | text contrast (dark) |
|---|---|---|
| before | GTK's `#f4f4f4` | **1.02:1** |
| `color-scheme` alone | GTK's `#343434` | 10.89:1 |
| `appearance: none` | `--surface-card` | **14.36:1** |

* **`color-scheme: light dark` on `:root`.** The document never declared that it
  handles both, so the engine rendered native chrome with the light theme while
  the tokens went dark. This also reaches the dropdown list, the focus ring and
  the scrollbars, which CSS cannot style.
* **`appearance: none` on `select`**, which hands the control to the stylesheet
  and makes it measure identically to the input beside it. The arrow that the
  native widget provided is drawn back with two gradients in `currentColor` —
  not an image, so it follows the text into dark mode on its own, there is no
  colour literal, and the CSP has no data: URI to allow.

`scripts/smoke.py` now opens the settings screen and reads those pixels back,
and it fails if a select is not painted the same as the input next to it, or if
its text drops under 4.5:1. Confirmed red by reverting each half of the fix.

**Revisit if:** a control needs the platform's own rendering. Then it needs its
own measured contrast, not the assumption that our colours applied.

## 15. Build on a development machine, not on the target

A release build with `lto = true` and `codegen-units = 1` will thrash swap on
modest hardware for a very long time. Build the `.deb` elsewhere and install
it there.

## 21. The release matrix builds Windows and macOS, unsigned and unverified — 2026-09-22

Decision 1 called this "Unlikely"; TODO.md carried it as the accepted-but-not-
started next step. This is that step, done to the letter of what it costs
rather than what it looks like on paper.

**What changed:**

- `tauri.conf.json`'s `bundle.targets` went from `["deb"]` to `"all"`, and
  `icons/icon.icns` was generated (`cargo tauri icon`) — the macOS bundler
  refuses to build without it, and it was the one file this repo's icon set
  never had a use for until now.
- `release.yml` gained a `windows` job (`--bundles nsis`) and a `macos` job
  (`--bundles dmg`), each building on that OS's own GitHub-hosted runner —
  there is no cross-compiling a webview app from Linux. A `publish` job
  downloads all three bundles and opens one draft release with all of them
  attached.
- `ci.yml`'s `rust` job became a three-OS matrix, so `cargo test`/`clippy`
  run on Windows and macOS on every PR, not just at release time.

**What this deliberately does not do**, and both are tracked in TODO.md
rather than silently assumed:

- **No code signing.** Windows installers show SmartScreen's "unrecognized
  publisher" warning; macOS disk images are blocked by Gatekeeper until the
  user right-clicks → Open once. Signing needs a purchased certificate (or
  Azure Trusted Signing) and an Apple Developer ID with notarization
  credentials — neither exists yet, and adding secrets to make CI *look*
  finished without them actually being configured would be worse than
  saying so in the release notes.
- **No smoke test for the two new engines.** `scripts/smoke.py` boots
  WebKitGTK because that is the engine decision 17 was written to stop
  lying about. There is no equivalent harness for WebView2 or WKWebView, so
  the Windows and macOS release jobs verify only that `cargo tauri build`
  produced a file — the same category of check that let the AppImage's
  black window through in decision 18, just named honestly this time
  instead of mistaken for more than it is.

**The glibc pin was dropped along the way.** `ci.yml` and the old Linux-only
`release.yml` job ran on `ubuntu-22.04` specifically for its glibc 2.35 — the
oldest version this app built against, so the `.deb` would run on anything at
least that recent (see the removed comment in `ci.yml`). Both files now use
`ubuntu-latest` everywhere, matching `windows-latest`/`macos-latest` for a
consistent matrix. **The trade-off:** the `.deb` now links against whatever
glibc the current `ubuntu-latest` image ships, which moves forward over time
and could eventually be newer than what an older deployment target has
installed. Nothing has hit this yet. If a `.deb` from a future release
refuses to start with a `GLIBC_2.NN not found` error, that is this trade-off
arriving — the fix is to pin the Linux job back to a specific `ubuntu-XX.04`
runner, not to chase the error in the app's own code.

**Revisit if:** either gap above causes a real failure — a signing
requirement from a distribution channel, or a rendering bug on Windows/macOS
that a build-only check cannot catch. Until then this matches what was asked
for: multiplatform builds, not a multiplatform verification story this repo
hasn't earned yet.
