#!/usr/bin/env python3
"""Smoke-test the built frontend in the engine that actually ships it.

The app runs on WebKitGTK, not Chromium. Testing the bundle in a Chromium
browser proves that it renders in Chromium — which is how a black screen
reached the desk unnoticed: a syntax WebKit rejects, a module that throws
before the first render, or a stylesheet that never loads all look fine in the
wrong engine.

This loads `dist/` in WebKitGTK 4.1 through the same bindings the app uses,
installs a minimal stub of the Tauri bridge, waits for the interface to mount,
and reports what the DOM actually contains. It exits non-zero when the window
would be blank.

    python3 scripts/smoke.py            # needs a display
    xvfb-run -a python3 scripts/smoke.py

It also opens the settings screen and reads the PIXELS a <select> is drawn
with, because a select is the one control the engine will happily paint itself
over the top of our stylesheet: `getComputedStyle` reported our background
while WebKit drew the platform's, and in dark mode that was white text on a
white box at 1.02:1. Computed styles cannot see that; the framebuffer can.

It cannot replace running the real app: the bridge here is a stub, so it proves
the frontend boots and renders, not that the Rust commands behave. What it does
catch is every failure that leaves the operator looking at an empty window.
"""

from __future__ import annotations

import http.server
import json
import os
import pathlib
import sys
import threading

# Must be set before WebKit initialises. The harness runs without a GPU context
# on some setups ("GDK is not able to create a GL context"), and WebKit aborts
# rather than falling back. This is also the first thing to try when the real
# app shows a black window on Linux.
os.environ.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
os.environ.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
INDEX = ROOT / "dist" / "index.html"

# Give the bundle time to parse, mount and run its first effects. Generous on
# purpose: a slow first paint is not the failure being hunted here.
SETTLE_MS = 2500

# Just enough bridge for the shell to boot. Every command answers with the
# smallest shape its caller destructures; anything unlisted returns null, which
# is what an unimplemented command would do.
BRIDGE_STUB = r"""
(function () {
  var today = new Date().toISOString().slice(0, 10);
  var answers = {
    settings_all: {
      language: "it", gym_name: "Smoke Test", currency: "EUR",
      default_price_cents: "3500", grace_days: "0",
      expiry_warning_days: "7", cert_warning_days: "30"
    },
    dashboard: {
      gymName: "Smoke Test", currency: "EUR", today: today,
      activeMembers: 0, expiringSoon: 0, expired: 0,
      certExpired: 0, certMissing: 0, checkinsToday: 0
    },
    checkins_today: [],
    documents_expiring: [],
    members_list: [],
    expiries_list: [],
    certificates_missing: []
  };
  window.__SMOKE_CALLS__ = [];
  window.__TAURI__ = {
    core: {
      invoke: function (cmd, args) {
        window.__SMOKE_CALLS__.push(cmd);
        return Promise.resolve(
          Object.prototype.hasOwnProperty.call(answers, cmd) ? answers[cmd] : null
        );
      }
    },
    dialog: { open: function () { return Promise.resolve(null); } }
  };
})();
"""

# Read back what the operator would actually be looking at.
PROBE = r"""
(function () {
  var root = document.getElementById("app");
  var sidebar = document.querySelector(".sidebar");
  var body = getComputedStyle(document.body);
  var alert = root && root.querySelector('[role="alert"]');
  return JSON.stringify({
    rootChildren: root ? root.children.length : -1,
    elements: document.getElementsByTagName("*").length,
    sidebarItems: document.querySelectorAll(".nav-item").length,
    heading: (document.querySelector("h1") || {}).textContent || null,
    stylesheetApplied: body.backgroundColor,
    bodyFontSize: body.fontSize,
    lang: document.documentElement.lang,
    bootError: alert ? alert.textContent.slice(0, 400) : null,
    calls: window.__SMOKE_CALLS__ || []
  });
})();
"""


# Open the settings screen — the one place a <select> and an <input> sit next
# to each other — and hand back where they landed, so the pixels under them can
# be read. The nav order is fixed in app.tsx: today, members, expiries, settings.
OPEN_SETTINGS = r"""
(function () {
  var items = document.querySelectorAll(".nav-item");
  if (items.length >= 4) items[3].click();
  return "ok";
})();
"""

CONTROL_BOXES = r"""
(function () {
  function box(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top),
             w: Math.round(r.width), h: Math.round(r.height) };
  }
  return JSON.stringify({ select: box("s-language"), input: box("s-gym") });
})();
"""


def luminance(rgb) -> float:
    """Relative luminance, WCAG 2.1 definition."""
    def channel(value: int) -> float:
        c = value / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b) -> float:
    """Contrast ratio between two colours."""
    hi, lo = max(luminance(a), luminance(b)), min(luminance(a), luminance(b))
    return round((hi + 0.05) / (lo + 0.05), 2)


class Pixels:
    """Random access to a cairo ARGB32 snapshot, as (r, g, b) tuples."""

    def __init__(self, surface):
        self.data = surface.get_data()
        self.stride = surface.get_stride()
        self.width = surface.get_width()
        self.height = surface.get_height()

    def at(self, x: int, y: int):
        if not (0 <= x < self.width and 0 <= y < self.height):
            raise IndexError(f"({x}, {y}) is outside {self.width}x{self.height}")
        # ARGB32 is stored little-endian, so the bytes come out B, G, R, A.
        off = y * self.stride + x * 4
        return (self.data[off + 2], self.data[off + 1], self.data[off])

    def row(self, x0: int, x1: int, y: int):
        return [self.at(x, y) for x in range(x0, x1)]


def check_select_rendering(pixels: Pixels, boxes: dict) -> list[str]:
    """Compare what a <select> is actually painted with to the <input> beside it.

    Two assertions, and both of them have failed for real:

      * The select's fill must equal the input's. When the select keeps the
        native appearance the engine paints the platform widget over our
        background — near-white in both themes — while the input keeps the
        colour the stylesheet asked for. They stop matching, which is visible
        in a light theme too and is what makes this check fail either way.
      * The text inside the select must reach 4.5:1 against that fill. That is
        the one the operator actually suffers: dark theme, white on white,
        measured at 1.02:1.
    """
    problems: list[str] = []
    select, field = boxes.get("select"), boxes.get("input")
    if not select or not field:
        return ["non ho trovato i controlli nella schermata impostazioni"]

    # A few pixels in from the left edge: past the border, before any glyph.
    select_fill = pixels.at(select["x"] + 4, select["y"] + select["h"] // 2)
    input_fill = pixels.at(field["x"] + 4, field["y"] + field["h"] // 2)

    # Along the middle of the control, stopping short of the arrow.
    strip = pixels.row(select["x"] + 14, select["x"] + select["w"] - 40,
                       select["y"] + select["h"] // 2)
    if not strip:
        return [f"la select è larga {select['w']}px: troppo poco per leggerne il testo"]
    ink = min(strip, key=luminance)
    paper = max(strip, key=luminance)
    ratio = contrast(ink, paper)

    print(f"  select disegnata: fondo {select_fill}, testo {ink}, contrasto {ratio}:1")
    print(f"  input  disegnato: fondo {input_fill}")

    if select_fill != input_fill:
        problems.append(
            f"la select è disegnata {select_fill} ma l'input accanto {input_fill}: "
            "il motore sta ridipingendo il controllo nativo sopra il foglio di stile"
        )
    if ratio < 4.5:
        problems.append(
            f"il testo della select è a {ratio}:1 sul suo fondo, sotto il minimo di 4.5:1"
        )
    return problems


def serve(directory: pathlib.Path) -> int:
    """Serve `directory` on a free port for the lifetime of the process."""

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(directory), **kw)

        def log_message(self, *_args):  # keep the harness output readable
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server.server_port


def main() -> int:
    if not INDEX.exists():
        print(f"FALLITO: {INDEX} non esiste — esegui prima `bun run build`", file=sys.stderr)
        return 2

    # Served over http, not file://. An ES module loaded from file:// is fetched
    # with a null origin and blocked by CORS, which would fail here for a reason
    # the real app never has — it serves the page from its own protocol handler.
    port = serve(INDEX.parent)

    state: dict[str, object] = {}

    window = Gtk.OffscreenWindow()
    window.set_default_size(1280, 800)

    manager = WebKit2.UserContentManager()
    manager.add_script(
        WebKit2.UserScript.new(
            BRIDGE_STUB,
            WebKit2.UserContentInjectedFrames.TOP_FRAME,
            WebKit2.UserScriptInjectionTime.START,
            None,
            None,
        )
    )

    view = WebKit2.WebView.new_with_user_content_manager(manager)
    # Console messages go to stdout, so a WebKit-only error is visible here
    # rather than only inside a window nobody can open.
    settings = view.get_settings()
    settings.set_enable_write_console_messages_to_stdout(True)
    settings.set_enable_developer_extras(True)
    window.add(view)
    window.show_all()

    def run_js(script: str, then) -> None:
        """Evaluate `script` and hand its string result to `then`."""

        def done(webview, result, _data):
            try:
                then(webview.run_javascript_finish(result).get_js_value().to_string())
            except Exception as exc:  # noqa: BLE001
                state["probeError"] = str(exc)
                Gtk.main_quit()

        view.run_javascript(script, None, done, None)

    def finish() -> bool:
        """Snapshot the rendered surface and read the select's pixels out of it."""

        def got(webview, result, _data):
            try:
                pixels = Pixels(webview.get_snapshot_finish(result))
                state["selectProblems"] = check_select_rendering(pixels, state["boxes"])
            except Exception as exc:  # noqa: BLE001
                # Reading the framebuffer needs pycairo (python3-gi-cairo). It is
                # not worth failing the boot check over, but it is worth saying
                # out loud that the rendering went unverified.
                state["snapshotError"] = str(exc)
            Gtk.main_quit()

        view.get_snapshot(
            WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, got, None
        )
        return False

    def measure_controls() -> bool:
        def got(raw: str) -> None:
            state["boxes"] = json.loads(raw)
            # One more frame for the settings screen to paint before it is read.
            GLib.timeout_add(400, finish)

        run_js(CONTROL_BOXES, got)
        return False

    def open_settings() -> bool:
        run_js(OPEN_SETTINGS, lambda _raw: GLib.timeout_add(400, measure_controls))
        return False

    def probe() -> bool:
        def got(raw: str) -> None:
            state.update(json.loads(raw))
            GLib.timeout_add(200, open_settings)

        run_js(PROBE, got)
        return False

    def on_load(_view, event):
        if event == WebKit2.LoadEvent.FINISHED:
            GLib.timeout_add(SETTLE_MS, probe)

    def on_failed(_view, _event, uri, error):
        state["loadError"] = f"{uri}: {error.message}"
        Gtk.main_quit()
        return True

    view.connect("load-changed", on_load)
    view.connect("load-failed", on_failed)
    view.load_uri(f"http://127.0.0.1:{port}/index.html")

    GLib.timeout_add(SETTLE_MS + 15000, lambda: (Gtk.main_quit(), False)[1])
    Gtk.main()

    print("\n--- stato del DOM in WebKitGTK ---")
    for key in sorted(state):
        if key not in ("boxes", "selectProblems"):
            print(f"  {key}: {state[key]}")

    problems: list[str] = []
    if "loadError" in state:
        problems.append(f"la pagina non si è caricata: {state['loadError']}")
    if state.get("bootError"):
        problems.append(f"la guardia di avvio ha mostrato un errore: {state['bootError']}")
    if not state.get("rootChildren"):
        problems.append("#app è vuoto: la finestra sarebbe nera")
    if not state.get("sidebarItems"):
        problems.append("nessuna voce di menu: l'interfaccia non si è disegnata")
    if state.get("stylesheetApplied") in (None, "", "rgba(0, 0, 0, 0)"):
        problems.append("il foglio di stile non è stato applicato")
    if "settings_all" not in (state.get("calls") or []):
        problems.append("il frontend non ha mai chiamato il backend")
    if "probeError" in state:
        problems.append(f"una sonda non ha risposto: {state['probeError']}")

    print("\n--- controlli disegnati (schermata impostazioni) ---")
    if "snapshotError" in state:
        # The one tolerated gap: without pycairo the framebuffer cannot be read
        # at all. Said out loud rather than passed over in silence.
        print(f"  NON VERIFICATO: non sono riuscito a leggere i pixel "
              f"({state['snapshotError']}). Manca python3-gi-cairo?")
    elif "selectProblems" not in state:
        # Anything else that stops the chain — a probe that threw, a callback
        # that never fired, the watchdog firing first — leaves no result, and a
        # missing result is a failure. A check that can be skipped in silence is
        # not a check.
        problems.append(
            "il controllo sui pixel non è mai arrivato in fondo: la select non è stata verificata"
        )
    else:
        problems.extend(state["selectProblems"])

    print()
    if problems:
        for p in problems:
            print(f"FALLITO: {p}")
        return 1

    print(f"OK: interfaccia disegnata ({state['elements']} elementi, "
          f"{state['sidebarItems']} voci di menu, titolo {state['heading']!r})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
