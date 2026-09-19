use rusqlite::params;
use serde::Serialize;
use tauri::State;

use super::{blank_to_none, today};
use crate::error::{AppError, Result};
use crate::models::Checkin;
use crate::AppState;

/// What the front desk sees before admitting someone.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryCheck {
    pub member_id: i64,
    pub first_name: String,
    pub last_name: String,
    pub paid_through: Option<String>,
    pub cert_through: Option<String>,
    /// `ok` | `warn` | `block` — the colour of the banner.
    pub status: String,
    /// Plain sentences for the receptionist, not error codes.
    pub reasons: Vec<String>,
    /// Membership id that authorises entry, if any.
    pub membership_id: Option<i64>,
}

/// Evaluate whether a member may train today, without recording anything.
///
/// Expired membership and an expired (or missing) certificate both produce
/// `block`, but blocking is advisory: `checkin_create` still accepts an
/// override with a reason, because a gym is run by people and the system
/// should record what happened rather than pretend it cannot.
#[tauri::command]
pub fn entry_check(state: State<AppState>, member_id: i64) -> Result<EntryCheck> {
    let conn = state.db();
    evaluate(&conn, member_id)
}

/// The rule itself, separated from the command so `checkin_create` can reuse it
/// while holding a single lock on the connection.
fn evaluate(conn: &rusqlite::Connection, member_id: i64) -> Result<EntryCheck> {
    let today = today();
    let today_s = today.to_string();

    let (first_name, last_name, paid_through, cert_through): (
        String,
        String,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT first_name, last_name, paid_through, cert_through
               FROM member_status WHERE id = ?1",
            [member_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::not_found(format!("member {member_id}"))
            }
            other => AppError::Db(other),
        })?;

    let grace_days: i64 = crate::db::setting(conn, "grace_days", "0")
        .parse()
        .unwrap_or(0);
    let warn_days: i64 = crate::db::setting(conn, "expiry_warning_days", "7")
        .parse()
        .unwrap_or(7);
    let cert_warn_days: i64 = crate::db::setting(conn, "cert_warning_days", "30")
        .parse()
        .unwrap_or(30);

    let mut reasons = Vec::new();
    let mut blocked = false;
    let mut warned = false;

    match &paid_through {
        None => {
            blocked = true;
            reasons.push("No membership on file.".into());
        }
        Some(p) => {
            let end = super::parse_date(p, "stored end date")?;
            let days_left = (end - today).num_days();
            if days_left < -grace_days {
                blocked = true;
                reasons.push(format!("Membership expired on {p}."));
            } else if days_left < 0 {
                warned = true;
                reasons.push(format!("Membership expired on {p}, within grace period."));
            } else if days_left <= warn_days {
                warned = true;
                reasons.push(match days_left {
                    0 => "Membership ends today.".to_string(),
                    1 => "Membership ends tomorrow.".to_string(),
                    n => format!("Membership ends in {n} days."),
                });
            }
        }
    }

    match &cert_through {
        None => {
            blocked = true;
            reasons.push("No health certificate on file.".into());
        }
        Some(c) => {
            let end = super::parse_date(c, "stored expiry date")?;
            let days_left = (end - today).num_days();
            if days_left < 0 {
                blocked = true;
                reasons.push(format!("Health certificate expired on {c}."));
            } else if days_left <= cert_warn_days {
                warned = true;
                reasons.push(format!("Health certificate expires on {c}."));
            }
        }
    }

    let membership_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM membership
              WHERE member_id = ?1 AND voided_at IS NULL
                AND starts_on <= ?2 AND ends_on >= ?2
              ORDER BY ends_on DESC LIMIT 1",
            params![member_id, today_s],
            |r| r.get(0),
        )
        .ok();

    let status = if blocked {
        "block"
    } else if warned {
        "warn"
    } else {
        "ok"
    };

    Ok(EntryCheck {
        member_id,
        first_name,
        last_name,
        paid_through,
        cert_through,
        status: status.to_string(),
        reasons,
        membership_id,
    })
}

/// Record a visit. An `override_reason` is required when `entry_check` says
/// `block`, so every exception leaves a trail with a name on it.
#[tauri::command]
pub fn checkin_create(
    state: State<AppState>,
    member_id: i64,
    override_reason: Option<String>,
) -> Result<Checkin> {
    let conn = state.db();
    let check = evaluate(&conn, member_id)?;
    let reason = blank_to_none(override_reason);

    if check.status == "block" && reason.is_none() {
        return Err(AppError::invalid(format!(
            "entry is blocked: {} Provide a reason to admit anyway.",
            check.reasons.join(" ")
        )));
    }

    conn.execute(
        "INSERT INTO checkin (member_id, membership_id, override_reason)
         VALUES (?1, ?2, ?3)",
        params![member_id, check.membership_id, reason],
    )?;

    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, member_id, at, membership_id, override_reason
           FROM checkin WHERE id = ?1",
        [id],
        |r| {
            Ok(Checkin {
                id: r.get(0)?,
                member_id: r.get(1)?,
                at: r.get(2)?,
                membership_id: r.get(3)?,
                override_reason: r.get(4)?,
            })
        },
    )
    .map_err(Into::into)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckinRow {
    pub id: i64,
    pub member_id: i64,
    pub first_name: String,
    pub last_name: String,
    pub at: String,
    pub override_reason: Option<String>,
}

/// Today's visits, most recent first.
#[tauri::command]
pub fn checkins_today(state: State<AppState>) -> Result<Vec<CheckinRow>> {
    let conn = state.db();
    let mut stmt = conn.prepare(
        "SELECT c.id, c.member_id, m.first_name, m.last_name, c.at, c.override_reason
           FROM checkin c JOIN member m ON m.id = c.member_id
          WHERE date(c.at) = date('now','localtime')
          ORDER BY c.at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(CheckinRow {
            id: r.get(0)?,
            member_id: r.get(1)?,
            first_name: r.get(2)?,
            last_name: r.get(3)?,
            at: r.get(4)?,
            override_reason: r.get(5)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}
