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

    def probe() -> bool:
        def done(webview, result, _data):
            try:
                value = webview.run_javascript_finish(result).get_js_value()
                state.update(json.loads(value.to_string()))
            except Exception as exc:  # noqa: BLE001
                state["probeError"] = str(exc)
            Gtk.main_quit()

        view.run_javascript(PROBE, None, done, None)
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
