//! Gym Manager — a small, local-first membership desk.
//!
//! Architecture in one paragraph: a Tauri 2 shell around a single SQLite file,
//! with documents kept as content-addressed files next to it. There is no
//! server, no network access, and no background workers. The frontend is static
//! HTML/CSS/JS with no build step, so the whole runtime cost is one WebKitGTK
//! webview and a Rust process holding one connection behind a mutex.
//!
//! The target machine has 2 GB of RAM. Every dependency here has to earn that.

pub mod commands;
pub mod dates;
pub mod db;
pub mod error;
pub mod models;
pub mod storage;

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::Manager;

/// Application state: one connection, one data directory.
///
/// A single `Mutex<Connection>` rather than a pool. One person uses this app at
/// a time on one machine; a pool would add a dependency and a lifetime problem
/// to solve contention that does not exist.
pub struct AppState {
    conn: Mutex<Connection>,
    pub data_dir: PathBuf,
}

impl AppState {
    /// Lock the connection.
    ///
    /// Panics only if a previous command panicked while holding the lock, at
    /// which point the database state is unknown and continuing would be worse.
    pub fn db(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().expect("database lock poisoned")
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // ~/.local/share/gym-manager on Linux.
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let conn = db::open(&data_dir.join("gym.db"))?;
            app.manage(AppState {
                conn: Mutex::new(conn),
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::backup_now,
            commands::app::dashboard,
            commands::app::settings_all,
            commands::app::settings_set,
            commands::checkins::checkin_create,
            commands::checkins::checkins_today,
            commands::checkins::entry_check,
            commands::documents::document_add,
            commands::documents::document_delete,
            commands::documents::document_open,
            commands::documents::documents_expiring,
            commands::expiries::certificates_missing,
            commands::expiries::expiries_list,
            commands::members::member_archive,
            commands::members::member_create,
            commands::members::member_get,
            commands::members::member_update,
            commands::members::members_list,
            commands::memberships::membership_preview,
            commands::memberships::membership_renew,
            commands::memberships::membership_void,
        ])
        .run(tauri::generate_context!())
        .expect("error while running gym-manager");
}
