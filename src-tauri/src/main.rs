// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    soften_webkit_rendering();

    gym_manager_lib::run()
}

/// Ask WebKitGTK not to rely on GPU compositing.
///
/// WebKitGTK renders the window black on a number of Linux setups where it
/// cannot get a GL context — old or unaccelerated graphics, some AMD/Wayland
/// combinations, and anything with a compositor or overlay injected into the
/// process. The frontend is fine in those cases; it draws correctly and calls
/// the backend, and the operator still sees an empty black window with no way
/// to tell the difference from a crash.
///
/// The target machine has 2 GB of RAM and a desktop GPU nobody chose, so the
/// accelerated path buys nothing here: the interface has no animations, no
/// canvas and no video. Trading it for a window that always draws is the right
/// side of that bargain.
///
/// Both are left overridable, so anyone diagnosing this can put the hardware
/// path back with `WEBKIT_DISABLE_COMPOSITING_MODE=0 cargo tauri dev`.
#[cfg(target_os = "linux")]
fn soften_webkit_rendering() {
    for (key, value) in [
        ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
        ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
    ] {
        if std::env::var_os(key).is_none() {
            // SAFETY: single-threaded, before any Tauri or GTK initialisation.
            unsafe { std::env::set_var(key, value) };
        }
    }
}
