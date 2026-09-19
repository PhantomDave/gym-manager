//! Connection setup and migrations.
//!
//! Migrations are plain SQL applied in order, tracked by `PRAGMA user_version`.
//! That is roughly twenty lines and removes a dependency; there is no reason to
//! pull in a migration framework for a single-file desktop database.
//!
//! To add a migration: drop `NNNN_name.sql` in `src/migrations/` and append it
//! to `MIGRATIONS`. Never edit a migration that has shipped.

use rusqlite::Connection;
use std::path::Path;

use crate::error::Result;

const MIGRATIONS: &[&str] = &[include_str!("migrations/0001_init.sql")];

/// Open (creating if needed) the database and bring it up to date.
pub fn open(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut conn = Connection::open(path)?;
    apply_pragmas(&conn)?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// An in-memory database, migrated. Used by tests.
#[cfg(test)]
pub fn open_in_memory() -> Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// Tuned for a 2 GB desktop, not a server.
///
/// `cache_size = -2000` is 2 MB (the negative form means kibibytes). `mmap_size = 0`
/// keeps page mapping out of the process's address space, which matters far more
/// than the throughput it costs on a database this small.
fn apply_pragmas(conn: &Connection) -> Result<()> {
    // journal_mode returns a row and cannot run inside a transaction.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "cache_size", -2000i64)?;
    conn.pragma_update(None, "mmap_size", 0i64)?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    Ok(())
}

fn migrate(conn: &mut Connection) -> Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as i64;
        if current >= version {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

/// Read a setting, falling back to `default` if it is missing.
pub fn setting(conn: &Connection, key: &str, default: &str) -> String {
    conn.query_row("SELECT value FROM setting WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .unwrap_or_else(|_| default.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_are_idempotent() {
        let mut conn = open_in_memory().unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, MIGRATIONS.len() as i64);
        // Running again must be a no-op rather than an error.
        migrate(&mut conn).unwrap();
    }

    #[test]
    fn member_status_view_reports_derived_state() {
        let conn = open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO member (id, first_name, last_name) VALUES (1, 'Ada', 'Lovelace')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO membership (member_id, starts_on, ends_on, price_cents)
             VALUES (1, '2026-01-01', '2026-01-31', 3000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO document (member_id, kind, sha256, rel_path, expires_on)
             VALUES (1, 'health_cert', 'abc', 'docs/ab/abc.pdf', '2026-12-31')",
            [],
        )
        .unwrap();

        let (paid, cert): (String, String) = conn
            .query_row(
                "SELECT paid_through, cert_through FROM member_status WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(paid, "2026-01-31");
        assert_eq!(cert, "2026-12-31");
    }

    #[test]
    fn voided_membership_does_not_count_as_coverage() {
        let conn = open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO member (id, first_name, last_name) VALUES (1, 'Ada', 'Lovelace')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO membership (member_id, starts_on, ends_on, price_cents, voided_at)
             VALUES (1, '2026-01-01', '2026-01-31', 3000, '2026-01-02 10:00:00')",
            [],
        )
        .unwrap();
        let paid: Option<String> = conn
            .query_row(
                "SELECT paid_through FROM member_status WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(paid, None);
    }

    #[test]
    fn archived_members_drop_out_of_the_view() {
        let conn = open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO member (id, first_name, last_name, archived_at)
             VALUES (1, 'Ada', 'Lovelace', '2026-01-01 10:00:00')",
            [],
        )
        .unwrap();
        let n: i64 = conn
            .query_row("SELECT count(*) FROM member_status", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }
}
