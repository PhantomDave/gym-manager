use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use super::{blank_to_none, today};
use crate::dates;
use crate::error::{AppError, Result};
use crate::models::Membership;
use crate::AppState;

/// What a renewal *would* do, so the UI can show the dates and price before
/// anyone commits. Same code path as the real thing, so the preview can never
/// disagree with the result.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenewalPreview {
    pub starts_on: String,
    pub ends_on: String,
    pub price_cents: i64,
    /// True when the member is still covered, so this period stacks on the end
    /// of the current one rather than starting today.
    pub stacks: bool,
}

#[tauri::command]
pub fn membership_preview(state: State<AppState>, member_id: i64) -> Result<RenewalPreview> {
    let conn = state.db();
    let today = today();
    let paid_through = current_coverage(&conn, member_id)?;
    let (starts_on, ends_on) = dates::next_period(today, paid_through);
    let price_cents: i64 = crate::db::setting(&conn, "default_price_cents", "3000")
        .parse()
        .unwrap_or(3000);

    Ok(RenewalPreview {
        starts_on: starts_on.to_string(),
        ends_on: ends_on.to_string(),
        price_cents,
        stacks: paid_through.is_some_and(|p| p >= today),
    })
}

/// Sell one month of membership.
///
/// Start and end dates are computed here, not taken from the frontend, so the
/// stacking rule cannot be bypassed by a stale form.
#[tauri::command]
pub fn membership_renew(
    state: State<AppState>,
    member_id: i64,
    price_cents: i64,
    paid_cents: Option<i64>,
    payment_method: Option<String>,
    note: Option<String>,
) -> Result<Membership> {
    if price_cents < 0 {
        return Err(AppError::invalid("price cannot be negative"));
    }
    let paid_cents = paid_cents.unwrap_or(price_cents);
    if paid_cents < 0 {
        return Err(AppError::invalid("paid amount cannot be negative"));
    }

    let conn = state.db();
    super::members::load_member(&conn, member_id)?;

    let paid_through = current_coverage(&conn, member_id)?;
    let (starts_on, ends_on) = dates::next_period(today(), paid_through);

    // Belt and braces: the stacking rule should make this impossible, but a
    // manually edited row or a future backdating feature could reintroduce it,
    // and overlapping periods would silently corrupt every revenue report.
    if let Some((s, e)) = latest_period(&conn, member_id)? {
        if dates::overlaps((starts_on, ends_on), (s, e)) {
            return Err(AppError::invalid(
                "that period overlaps an existing membership",
            ));
        }
    }

    conn.execute(
        "INSERT INTO membership (member_id, starts_on, ends_on, price_cents,
                                 paid_cents, payment_method, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            member_id,
            starts_on.to_string(),
            ends_on.to_string(),
            price_cents,
            paid_cents,
            blank_to_none(payment_method),
            blank_to_none(note),
        ],
    )?;

    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, member_id, starts_on, ends_on, price_cents, paid_cents,
                payment_method, note, created_at, voided_at
           FROM membership WHERE id = ?1",
        [id],
        super::members::map_membership,
    )
    .map_err(Into::into)
}

/// Void a membership that was entered by mistake.
///
/// Never a DELETE: money that was taken and refunded must stay visible, and the
/// derived status recomputes itself the moment `voided_at` is set.
#[tauri::command]
pub fn membership_void(state: State<AppState>, id: i64, reason: String) -> Result<()> {
    let reason = reason.trim().to_string();
    if reason.is_empty() {
        return Err(AppError::invalid(
            "a reason is required to void a membership",
        ));
    }
    let conn = state.db();
    let changed = conn.execute(
        "UPDATE membership SET voided_at = datetime('now','localtime'), void_reason = ?2
          WHERE id = ?1 AND voided_at IS NULL",
        params![id, reason],
    )?;
    if changed == 0 {
        return Err(AppError::not_found(format!(
            "membership {id} (or it is already voided)"
        )));
    }
    Ok(())
}

/// The member's latest paid-through date, ignoring voided periods.
fn current_coverage(conn: &Connection, member_id: i64) -> Result<Option<chrono::NaiveDate>> {
    let raw: Option<String> = conn.query_row(
        "SELECT max(ends_on) FROM membership
          WHERE member_id = ?1 AND voided_at IS NULL",
        [member_id],
        |r| r.get(0),
    )?;
    match raw {
        None => Ok(None),
        Some(v) => Ok(Some(super::parse_date(&v, "stored end date")?)),
    }
}

fn latest_period(
    conn: &Connection,
    member_id: i64,
) -> Result<Option<(chrono::NaiveDate, chrono::NaiveDate)>> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT starts_on, ends_on FROM membership
              WHERE member_id = ?1 AND voided_at IS NULL
              ORDER BY ends_on DESC LIMIT 1",
            [member_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    match row {
        None => Ok(None),
        Some((s, e)) => Ok(Some((
            super::parse_date(&s, "stored start date")?,
            super::parse_date(&e, "stored end date")?,
        ))),
    }
}
