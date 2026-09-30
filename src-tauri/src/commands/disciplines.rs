//! Disciplines a member practises.
//!
//! A discipline with no `expires_on` follows the membership, so there is no
//! date to keep in step on renewal: `through` is resolved at read time from
//! the live memberships. See migration 0006 and DECISIONS 23.

use rusqlite::{params, Connection};
use tauri::State;

use super::{blank_to_none, optional_date};
use crate::error::{AppError, Result};
use crate::models::{Discipline, DisciplineInput};
use crate::AppState;

#[tauri::command]
pub fn discipline_add(
    state: State<AppState>,
    member_id: i64,
    input: DisciplineInput,
) -> Result<Discipline> {
    let conn = state.db();
    super::members::load_member(&conn, member_id)?;
    let id = insert(&conn, member_id, input)?;
    load(&conn, id)
}

/// Rename, set a custom expiry, or clear it (`expires_on: None`) so the
/// discipline follows the membership again.
#[tauri::command]
pub fn discipline_update(state: State<AppState>, id: i64, input: DisciplineInput) -> Result<()> {
    update(&state.db(), id, input)
}

/// Soft delete, like documents: the row stays, it just stops being listed.
#[tauri::command]
pub fn discipline_remove(state: State<AppState>, id: i64) -> Result<()> {
    remove(&state.db(), id)
}

pub(crate) fn insert(conn: &Connection, member_id: i64, input: DisciplineInput) -> Result<i64> {
    let (name, expires_on) = validate(input)?;
    conn.execute(
        "INSERT INTO member_discipline (member_id, name, expires_on) VALUES (?1, ?2, ?3)",
        params![member_id, name, expires_on],
    )
    .map_err(|e| duplicate_hint(e, &name))?;
    Ok(conn.last_insert_rowid())
}

fn update(conn: &Connection, id: i64, input: DisciplineInput) -> Result<()> {
    let (name, expires_on) = validate(input)?;
    let changed = conn
        .execute(
            "UPDATE member_discipline SET name = ?2, expires_on = ?3
              WHERE id = ?1 AND removed_at IS NULL",
            params![id, name, expires_on],
        )
        .map_err(|e| duplicate_hint(e, &name))?;
    if changed == 0 {
        return Err(not_found(id));
    }
    Ok(())
}

fn remove(conn: &Connection, id: i64) -> Result<()> {
    let changed = conn.execute(
        "UPDATE member_discipline SET removed_at = datetime('now','localtime')
          WHERE id = ?1 AND removed_at IS NULL",
        [id],
    )?;
    if changed == 0 {
        return Err(not_found(id));
    }
    Ok(())
}

/// Every live discipline of one member, with the expiry that applies.
pub(crate) fn list(conn: &Connection, member_id: i64) -> Result<Vec<Discipline>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE d.member_id = ?1 AND d.removed_at IS NULL
          ORDER BY d.name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([member_id], map_discipline)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn load(conn: &Connection, id: i64) -> Result<Discipline> {
    conn.query_row(&format!("{SELECT} WHERE d.id = ?1"), [id], map_discipline)
        .map_err(Into::into)
}

/// The paid-through date is computed here rather than read from
/// `member_status`, because that view hides archived members and an archived
/// member's card still shows what they practised.
const SELECT: &str = "SELECT d.id, d.member_id, d.name, d.expires_on,
        coalesce(d.expires_on,
                 (SELECT max(s.ends_on) FROM membership s
                   WHERE s.member_id = d.member_id AND s.voided_at IS NULL))
   FROM member_discipline d";

fn map_discipline(r: &rusqlite::Row) -> rusqlite::Result<Discipline> {
    Ok(Discipline {
        id: r.get(0)?,
        member_id: r.get(1)?,
        name: r.get(2)?,
        expires_on: r.get(3)?,
        through: r.get(4)?,
    })
}

fn validate(input: DisciplineInput) -> Result<(String, Option<String>)> {
    let name = blank_to_none(Some(input.name))
        .ok_or_else(|| AppError::new("discipline.name_required", "a discipline needs a name"))?;
    let expires_on = optional_date(input.expires_on, "expires_on")?;
    Ok((name, expires_on))
}

fn duplicate_hint(err: rusqlite::Error, name: &str) -> AppError {
    // SQLite names either the columns or the index, depending on version.
    let msg = err.to_string();
    if msg.contains("member_discipline.") || msg.contains("idx_discipline_member_name") {
        AppError::new(
            "discipline.duplicate",
            "the member already has that discipline",
        )
        .with("name", name)
    } else {
        err.into()
    }
}

fn not_found(id: i64) -> AppError {
    AppError::new("discipline.not_found", "discipline does not exist").with("id", id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn input(name: &str, expires_on: Option<&str>) -> DisciplineInput {
        DisciplineInput {
            name: name.into(),
            expires_on: expires_on.map(Into::into),
        }
    }

    fn setup() -> Connection {
        let conn = db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO member (id, first_name, last_name) VALUES (1, 'Ada', 'Lovelace')",
            [],
        )
        .unwrap();
        conn
    }

    fn pay(conn: &Connection, starts: &str, ends: &str) {
        conn.execute(
            "INSERT INTO membership (member_id, starts_on, ends_on, price_cents)
             VALUES (1, ?1, ?2, 3000)",
            [starts, ends],
        )
        .unwrap();
    }

    #[test]
    fn follows_the_membership_and_moves_with_a_renewal() {
        let conn = setup();
        let id = insert(&conn, 1, input("Boxe", None)).unwrap();
        assert_eq!(load(&conn, id).unwrap().through, None);

        pay(&conn, "2026-01-01", "2026-01-31");
        assert_eq!(
            load(&conn, id).unwrap().through.as_deref(),
            Some("2026-01-31")
        );

        pay(&conn, "2026-02-01", "2026-02-28");
        let d = load(&conn, id).unwrap();
        assert_eq!(d.expires_on, None);
        assert_eq!(d.through.as_deref(), Some("2026-02-28"));
    }

    #[test]
    fn custom_date_overrides_and_clearing_it_follows_again() {
        let conn = setup();
        pay(&conn, "2026-01-01", "2026-01-31");
        let id = insert(&conn, 1, input("Pilates", Some("2026-06-30"))).unwrap();
        assert_eq!(
            load(&conn, id).unwrap().through.as_deref(),
            Some("2026-06-30")
        );

        update(&conn, id, input("Pilates", Some(""))).unwrap();
        let d = load(&conn, id).unwrap();
        assert_eq!(d.expires_on, None);
        assert_eq!(d.through.as_deref(), Some("2026-01-31"));
    }

    #[test]
    fn duplicate_name_is_rejected_ignoring_case_until_removed() {
        let conn = setup();
        let id = insert(&conn, 1, input("Boxe", None)).unwrap();
        let err = insert(&conn, 1, input("  boxe ", None)).unwrap_err();
        assert_eq!(err.code, "discipline.duplicate");

        remove(&conn, id).unwrap();
        assert!(list(&conn, 1).unwrap().is_empty());
        insert(&conn, 1, input("boxe", None)).unwrap();
        assert_eq!(list(&conn, 1).unwrap().len(), 1);
    }

    #[test]
    fn blank_name_and_bad_date_are_rejected() {
        let conn = setup();
        assert_eq!(
            insert(&conn, 1, input("  ", None)).unwrap_err().code,
            "discipline.name_required"
        );
        assert_eq!(
            insert(&conn, 1, input("Yoga", Some("31/12/2026")))
                .unwrap_err()
                .code,
            "date.invalid"
        );
    }

    #[test]
    fn removing_twice_is_not_found() {
        let conn = setup();
        let id = insert(&conn, 1, input("Yoga", None)).unwrap();
        remove(&conn, id).unwrap();
        assert_eq!(remove(&conn, id).unwrap_err().code, "discipline.not_found");
        assert_eq!(
            update(&conn, id, input("Yoga", None)).unwrap_err().code,
            "discipline.not_found"
        );
    }
}
