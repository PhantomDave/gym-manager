//! The "who needs a phone call" query.
//!
//! Memberships and certificates expire for different reasons but produce the
//! same job at the desk, so they come back as one sorted list rather than two
//! the frontend has to interleave.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::today;
use crate::error::Result;
use crate::models::sql_via_serde;
use crate::AppState;

/// What kind of expiry this is, and hence which job it is at the desk.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone, Copy)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum ExpiryKind {
    Membership,
    Certificate,
    CertificateMissing,
    IdDocumentMissing,
    /// A discipline with a custom expiry. One that follows the membership is
    /// already the `Membership` row, so it is never listed twice.
    Discipline,
}
sql_via_serde!(ExpiryKind);

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Expiry {
    pub member_id: i64,
    pub first_name: String,
    pub last_name: String,
    pub phone: Option<String>,
    pub kind: ExpiryKind,
    pub date: String,
    /// Negative once the date has passed.
    pub days_left: i64,
    /// The discipline's name for `Discipline`; `None` for the other kinds.
    pub label: Option<String>,
}

/// Custom discipline expiries as `(member_id, name, date)` rows, read from
/// `member_status` so archived members drop out the same way they do above.
/// Shared with the test, so the branch it checks is the one that ships.
const DISCIPLINE_EXPIRIES: &str = "
         SELECT s.id, s.first_name, s.last_name, s.phone, 'discipline' AS kind,
                d.expires_on AS date,
                CAST(julianday(d.expires_on) - julianday(:today) AS INTEGER) AS days_left,
                d.name AS label
           FROM member_discipline d JOIN member_status s ON s.id = d.member_id
          WHERE d.removed_at IS NULL AND d.expires_on IS NOT NULL
            AND d.expires_on >= date(:today, '-' || :overdue || ' days')
            AND d.expires_on <= date(:today, '+' || :days || ' days')";

/// Everything expiring between `overdue_days` ago and `days` from now.
///
/// The backward window is bounded on purpose: a member who lapsed three years
/// ago is not a phone call, and an unbounded list would bury the people who
/// actually are.
#[tauri::command]
pub fn expiries_list(
    state: State<AppState>,
    days: Option<i64>,
    overdue_days: Option<i64>,
) -> Result<Vec<Expiry>> {
    let conn = state.db();
    let days = days.unwrap_or(30);
    let overdue = overdue_days.unwrap_or(60);
    let today = today().to_string();

    let mut stmt = conn.prepare(&format!(
        "SELECT id, first_name, last_name, phone, 'membership' AS kind,
                paid_through AS date,
                CAST(julianday(paid_through) - julianday(:today) AS INTEGER) AS days_left,
                NULL AS label
           FROM member_status
          WHERE paid_through IS NOT NULL
            AND paid_through >= date(:today, '-' || :overdue || ' days')
            AND paid_through <= date(:today, '+' || :days || ' days')

         UNION ALL

         SELECT id, first_name, last_name, phone, 'certificate' AS kind,
                cert_through AS date,
                CAST(julianday(cert_through) - julianday(:today) AS INTEGER) AS days_left,
                NULL AS label
           FROM member_status
          WHERE cert_through IS NOT NULL
            AND cert_through >= date(:today, '-' || :overdue || ' days')
            AND cert_through <= date(:today, '+' || :days || ' days')

         UNION ALL
         {DISCIPLINE_EXPIRIES}

          ORDER BY date ASC, last_name COLLATE NOCASE"
    ))?;

    let rows = stmt.query_map(
        rusqlite::named_params! { ":today": today, ":days": days, ":overdue": overdue },
        |r| {
            Ok(Expiry {
                member_id: r.get(0)?,
                first_name: r.get(1)?,
                last_name: r.get(2)?,
                phone: r.get(3)?,
                kind: r.get(4)?,
                date: r.get(5)?,
                days_left: r.get(6)?,
                label: r.get(7)?,
            })
        },
    )?;

    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

/// Members with no certificate at all.
///
/// Separate from `expiries_list` because a missing certificate has no date to
/// sort by, and it is a more urgent problem than one expiring next month.
#[tauri::command]
pub fn certificates_missing(state: State<AppState>) -> Result<Vec<Expiry>> {
    missing(
        &state.db(),
        "cert_through IS NULL",
        ExpiryKind::CertificateMissing,
    )
}

/// Members for whom no ID document was ever added. Dateless, like
/// `certificates_missing`, and listed the same way.
#[tauri::command]
pub fn id_documents_missing(state: State<AppState>) -> Result<Vec<Expiry>> {
    id_documents_missing_in(&state.db())
}

fn id_documents_missing_in(conn: &rusqlite::Connection) -> Result<Vec<Expiry>> {
    missing(
        conn,
        super::members::ID_DOC_MISSING,
        ExpiryKind::IdDocumentMissing,
    )
}

/// One row per member matching `clause`, with no date to sort by.
fn missing(conn: &rusqlite::Connection, clause: &str, kind: ExpiryKind) -> Result<Vec<Expiry>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT id, first_name, last_name, phone
           FROM member_status
          WHERE {clause}
          ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE"
    ))?;

    let rows = stmt.query_map(params![], |r| {
        Ok(Expiry {
            member_id: r.get(0)?,
            first_name: r.get(1)?,
            last_name: r.get(2)?,
            phone: r.get(3)?,
            kind,
            date: String::new(),
            days_left: 0,
            label: None,
        })
    })?;

    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::{ExpiryKind, DISCIPLINE_EXPIRIES};
    use crate::db;

    /// The SQL literals `'membership'`/`'certificate'` below have to agree
    /// with what `ExpiryKind`'s `#[serde(rename_all = "snake_case")]`
    /// actually produces, and nothing enforces that at compile time — so
    /// derive the expected strings from the enum itself rather than
    /// hardcoding them a second time, the way the query does.
    fn kind_str(kind: ExpiryKind) -> String {
        serde_json::to_value(kind)
            .unwrap()
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn id_documents_missing_lists_only_members_without_one() {
        let conn = db::open_in_memory().unwrap();
        conn.execute_batch(
            "INSERT INTO member (id, first_name, last_name) VALUES
               (1, 'Ada', 'Lovelace'), (2, 'Alan', 'Turing');
             INSERT INTO document (member_id, kind) VALUES (1, 'id_card');",
        )
        .unwrap();
        let rows = super::id_documents_missing_in(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].member_id, 2);
        assert_eq!(rows[0].kind, ExpiryKind::IdDocumentMissing);
    }

    /// The UNION ALL query is the kind that breaks silently when a column is
    /// added to the view, so pin its shape against a real schema.
    #[test]
    fn expiries_query_matches_the_schema() {
        let conn = db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO member (id, first_name, last_name) VALUES (1, 'Ada', 'Lovelace')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO membership (member_id, starts_on, ends_on, price_cents)
             VALUES (1, date('now','localtime','-20 days'), date('now','localtime','+5 days'), 3000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO document (member_id, kind, sha256, rel_path, expires_on)
             VALUES (1, 'health_cert', 'abc', 'docs/ab/abc.pdf', date('now','localtime','-3 days'))",
            [],
        )
        .unwrap();

        let mut stmt = conn
            .prepare(
                "SELECT kind, CAST(julianday(date) - julianday(date('now','localtime')) AS INTEGER)
                   FROM (
                     SELECT 'membership' AS kind, paid_through AS date FROM member_status
                      WHERE paid_through IS NOT NULL
                     UNION ALL
                     SELECT 'certificate' AS kind, cert_through AS date FROM member_status
                      WHERE cert_through IS NOT NULL
                   ) ORDER BY date ASC",
            )
            .unwrap();
        let rows: Vec<(String, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert_eq!(rows.len(), 2);
        // The expired certificate sorts before the membership that is still valid.
        assert_eq!(rows[0].0, kind_str(ExpiryKind::Certificate));
        assert_eq!(rows[0].1, -3);
        assert_eq!(rows[1].0, kind_str(ExpiryKind::Membership));
        assert_eq!(rows[1].1, 5);
    }

    /// Only custom dates are listed, removed and archived ones are not, and
    /// the window bounds apply.
    #[test]
    fn discipline_expiries_list_custom_dates_only() {
        let conn = db::open_in_memory().unwrap();
        conn.execute_batch(
            "INSERT INTO member (id, first_name, last_name) VALUES (1, 'Ada', 'Lovelace');
             INSERT INTO member (id, first_name, last_name, archived_at)
               VALUES (2, 'Old', 'Timer', '2026-01-01 10:00:00');
             INSERT INTO membership (member_id, starts_on, ends_on, price_cents)
               VALUES (1, date('now','localtime'), date('now','localtime','+5 days'), 3000);
             INSERT INTO member_discipline (member_id, name, expires_on) VALUES
               (1, 'Follows', NULL),
               (1, 'Pilates', date('now','localtime','+3 days')),
               (1, 'Far', date('now','localtime','+400 days')),
               (2, 'Archived', date('now','localtime','+3 days'));
             INSERT INTO member_discipline (member_id, name, expires_on, removed_at)
               VALUES (1, 'Gone', date('now','localtime','+3 days'), '2026-01-01 10:00:00');",
        )
        .unwrap();

        let mut stmt = conn.prepare(DISCIPLINE_EXPIRIES).unwrap();
        let rows: Vec<(String, String, i64)> = stmt
            .query_map(
                rusqlite::named_params! {
                    ":today": super::super::today().to_string(), ":days": 30, ":overdue": 60,
                },
                |r| Ok((r.get(4)?, r.get(7)?, r.get(6)?)),
            )
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert_eq!(
            rows,
            [(kind_str(ExpiryKind::Discipline), "Pilates".into(), 3)]
        );
    }
}
