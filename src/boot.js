/* Makes a failed boot visible.
 *
 * This is a separate classic script loaded BEFORE the bundle, and it has to be:
 *   - the CSP is `script-src 'self'`, so an inline <script> is blocked;
 *   - a handler at the top of app.tsx would be too late, because the bundler
 *     inlines modules in dependency order and api.ts is evaluated first. If
 *     api.ts throws while being evaluated, app.tsx never runs at all.
 *
 * Without this, any failure before the first render leaves the operator looking
 * at an empty window the colour of the page background — a black screen on a
 * machine with no developer tools and nobody around who could open them.
 *
 * Deliberately dependency-free and inline-styled: it must work when styles.css
 * is the thing that failed.
 */
(function () {
  "use strict";

  var BOOT_TIMEOUT_MS = 8000;
  var shown = false;

  function show(detail) {
    if (shown) return;
    shown = true;

    var root = document.getElementById("app");
    if (!root) return;
    root.textContent = "";

    var box = document.createElement("div");
    box.setAttribute("role", "alert");
    box.style.cssText =
      "margin:40px auto;max-width:640px;padding:24px;border:1px solid #a8231a;" +
      "border-radius:14px;background:#fbe4e1;color:#12191f;" +
      'font:16px/25px "Inter","Cantarell",system-ui,sans-serif';

    var h = document.createElement("h1");
    h.textContent = "L'applicazione non è riuscita ad avviarsi";
    h.style.cssText = "margin:0 0 12px;font-size:19px;line-height:26px;color:#a8231a";

    var p = document.createElement("p");
    p.textContent =
      "Riavvia il programma. Se il problema continua, fai una copia di sicurezza " +
      "della cartella dei dati e mostra questo messaggio a chi ti assiste.";
    p.style.cssText = "margin:0 0 16px";

    var pre = document.createElement("pre");
    pre.textContent = detail;
    pre.style.cssText =
      "margin:0;padding:12px;background:#ffffff;border-radius:10px;" +
      "font-size:13px;line-height:19px;white-space:pre-wrap;word-break:break-word";

    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(pre);
    root.appendChild(box);
  }

  window.addEventListener("error", function (e) {
    show(e.message + (e.filename ? "\n" + e.filename + ":" + e.lineno : ""));
  });

  window.addEventListener("unhandledrejection", function (e) {
    show("Promise non gestita: " + String(e.reason && e.reason.message ? e.reason.message : e.reason));
  });

  // Catches the silent failures too: no exception, but nothing ever rendered.
  window.setTimeout(function () {
    var root = document.getElementById("app");
    if (root && root.children.length === 0) {
      show(
        "Nessun errore riportato, ma l'interfaccia non si è disegnata entro " +
          BOOT_TIMEOUT_MS / 1000 +
          " secondi.\nProbabile causa: il ponte verso il backend non è disponibile."
      );
    }
  }, BOOT_TIMEOUT_MS);
})();
