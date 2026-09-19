use rusqlite::params;
use serde::Serialize;
use std::collections::BTreeMap;
use tauri::State;

use super::today;
use crate::error::{AppError, Result};
use crate::AppState;

#[tauri::command]
pub fn settings_all(state: State<AppState>) -> Result<BTreeMap<String, String>> {
    let conn = state.db();
    let mut stmt = conn.prepare("SELECT key, value FROM setting ORDER BY key")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = BTreeMap::new();
    for row in rows {
        let (k, v) = row?;
        out.insert(k, v);
    }
    Ok(out)
}

#[tauri::command]
pub fn settings_set(state: State<AppState>, key: String, value: String) -> Result<()> {
    let conn = state.db();
    conn.execute(
        "INSERT INTO setting (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key.trim(), value.trim()],
    )?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub gym_name: String,
    pub currency: String,
    pub today: String,
    pub active_members: i64,
    pub expiring_soon: i64,
    pub expired: i64,
    pub cert_expired: i64,
    pub cert_missing: i64,
    pub checkins_today: i64,
}

/// One query per tile. They are all counts over a view on a table with a few
/// hundred rows; the dashboard does not need to be clever.
#[tauri::command]
pub fn dashboard(state: State<AppState>) -> Result<Dashboard> {
    let conn = state.db();
    let today = today().to_string();
    let warn: i64 = crate::db::setting(&conn, "expiry_warning_days", "7")
        .parse()
        .unwrap_or(7);

    // Every tile is a count over `member_status`, differing only in the WHERE
    // clause. rusqlite rejects a named parameter the statement does not use, so
    // each call passes exactly the bindings its clause mentions.
    let count = |where_clause: &str, args: &[(&str, &dyn rusqlite::ToSql)]| -> Result<i64> {
        conn.query_row(
            &format!("SELECT count(*) FROM member_status WHERE {where_clause}"),
            args,
            |r| r.get(0),
        )
        .map_err(Into::into)
    };
    let by_day: &[(&str, &dyn rusqlite::ToSql)] = &[(":today", &today)];

    Ok(Dashboard {
        gym_name: crate::db::setting(&conn, "gym_name", "My Gym"),
        currency: crate::db::setting(&conn, "currency", "EUR"),
        today: today.clone(),
        active_members: count(
            "paid_through IS NOT NULL AND paid_through >= :today",
            by_day,
        )?,
        expiring_soon: count(
            "paid_through >= :today AND paid_through <= date(:today, '+' || :warn || ' days')",
            &[(":today", &today), (":warn", &warn)],
        )?,
        expired: count("paid_through IS NULL OR paid_through < :today", by_day)?,
        cert_expired: count("cert_through IS NOT NULL AND cert_through < :today", by_day)?,
        cert_missing: count("cert_through IS NULL", &[])?,
        checkins_today: conn.query_row(
            "SELECT count(*) FROM checkin WHERE date(at) = date('now','localtime')",
            [],
            |r| r.get(0),
        )?,
    })
}

/// Snapshot the database next to it, using SQLite's own consistent copy.
///
/// `VACUUM INTO` is safe while WAL is active and compacts as it goes, which
/// beats copying three files and hoping. Documents are content-addressed and
/// append-only, so they are rsynced separately rather than duplicated here —
/// see the backup section of the README.
#[tauri::command]
pub fn backup_now(state: State<AppState>) -> Result<String> {
    let dir = state.data_dir.join("backups");
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(format!("gym-{}.db", today()));

    if dest.exists() {
        std::fs::remove_file(&dest)?;
    }

    let conn = state.db();
    // VACUUM INTO takes a literal path; bind it as a parameter so a path with a
    // quote in it cannot break the statement.
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().as_ref()])
        .map_err(|e| AppError::new("backup.failed", e.to_string()))?;

    prune_backups(&dir, 7)?;
    Ok(dest.to_string_lossy().to_string())
}

/// Keep the newest `keep` snapshots. Unbounded backups on a machine with a
/// small disk is its own outage.
fn prune_backups(dir: &std::path::Path, keep: usize) -> Result<()> {
    let mut snapshots: Vec<_> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .is_some_and(|n| n.starts_with("gym-") && n.ends_with(".db"))
        })
        .collect();

    snapshots.sort_by_key(|e| e.file_name());
    while snapshots.len() > keep {
        let oldest = snapshots.remove(0);
        let _ = std::fs::remove_file(oldest.path());
    }
    Ok(())
}
