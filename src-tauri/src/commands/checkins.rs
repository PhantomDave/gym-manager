use rusqlite::params;
use serde::Serialize;
use tauri::State;

use super::{blank_to_none, today};
use crate::error::{AppError, Reason, Result};
use crate::models::Checkin;
use crate::AppState;

/// The colour of the entry banner.
#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum EntryStatus {
    Ok,
    Warn,
    Block,
}

/// What the front desk sees before admitting someone.
#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct EntryCheck {
    pub member_id: i64,
    pub first_name: String,
    pub last_name: String,
    pub paid_through: Option<String>,
    pub cert_through: Option<String>,
    pub status: EntryStatus,
    /// Translatable codes, never finished sentences — the frontend writes the
    /// prose so the receptionist reads it in her own language.
    pub reasons: Vec<Reason>,
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
                AppError::new("member.not_found", "member does not exist").with("id", member_id)
            }
            other => other.into(),
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
            reasons.push(Reason::new("entry.no_membership"));
        }
        Some(p) => {
            let end = super::parse_date(p, "stored end date")?;
            let days_left = (end - today).num_days();
            if days_left < -grace_days {
                blocked = true;
                reasons.push(Reason::new("entry.membership_expired").with("date", p));
            } else if days_left < 0 {
                warned = true;
                reasons.push(Reason::new("entry.membership_grace").with("date", p));
            } else if days_left <= warn_days {
                warned = true;
                // Plural selection belongs to the frontend: Italian and English
                // do not agree on how many forms there are.
                reasons.push(
                    Reason::new("entry.membership_ending")
                        .with("days", days_left)
                        .with("date", p),
                );
            }
        }
    }

    match &cert_through {
        None => {
            blocked = true;
            reasons.push(Reason::new("entry.no_certificate"));
        }
        Some(c) => {
            let end = super::parse_date(c, "stored expiry date")?;
            let days_left = (end - today).num_days();
            if days_left < 0 {
                blocked = true;
                reasons.push(Reason::new("entry.certificate_expired").with("date", c));
            } else if days_left <= cert_warn_days {
                warned = true;
                reasons.push(
                    Reason::new("entry.certificate_ending")
                        .with("days", days_left)
                        .with("date", c),
                );
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
        EntryStatus::Block
    } else if warned {
        EntryStatus::Warn
    } else {
        EntryStatus::Ok
    };

    Ok(EntryCheck {
        member_id,
        first_name,
        last_name,
        paid_through,
        cert_through,
        status,
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

    if check.status == EntryStatus::Block && reason.is_none() {
        // The frontend already holds the reasons from entry_check, so this
        // carries only the fact that a reason is required.
        return Err(AppError::new(
            "checkin.blocked",
            "entry is blocked; a reason is required to admit anyway",
        ));
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
#[cfg_attr(test, derive(ts_rs::TS))]
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
