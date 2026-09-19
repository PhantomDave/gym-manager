use rusqlite::{params, Connection};
use tauri::State;

use super::{blank_to_none, optional_date, today};
use crate::error::{AppError, Result};
use crate::models::*;
use crate::AppState;

/// List members, optionally filtered and searched.
///
/// The filters are expressed against the `member_status` view, so "active" and
/// "expired" always agree with what the member detail screen shows. `limit` is
/// enforced because a list screen has no business loading the whole roster.
#[tauri::command]
pub fn members_list(
    state: State<AppState>,
    filter: Option<Filter>,
    query: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<MemberRow>> {
    let conn = state.db();
    let today = today().to_string();
    let warn_days: i64 = crate::db::setting(&conn, "expiry_warning_days", "7")
        .parse()
        .unwrap_or(7);

    let filter = filter.unwrap_or_default();
    let clause = match filter {
        Filter::All => "1=1",
        Filter::Active => "paid_through IS NOT NULL AND paid_through >= :today",
        Filter::Expiring => {
            "paid_through IS NOT NULL AND paid_through >= :today \
             AND paid_through <= date(:today, '+' || :warn || ' days')"
        }
        Filter::Expired => "paid_through IS NULL OR paid_through < :today",
        Filter::CertExpired => "cert_through IS NOT NULL AND cert_through < :today",
        Filter::CertMissing => "cert_through IS NULL",
    };

    let needle = blank_to_none(query).map(|q| format!("%{}%", q.to_lowercase()));
    let search = if needle.is_some() {
        "AND (lower(first_name) LIKE :q OR lower(last_name) LIKE :q \
          OR lower(first_name || ' ' || last_name) LIKE :q)"
    } else {
        ""
    };

    let sql = format!(
        "SELECT id, first_name, last_name, phone, email, joined_on,
                paid_through, cert_through, last_checkin
           FROM member_status
          WHERE ({clause}) {search}
          ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE
          LIMIT :limit"
    );

    // rusqlite errors on a named parameter the statement does not mention, and
    // which ones appear depends on the filter and whether there is a search
    // term. Binding only what the assembled SQL actually references keeps that
    // correct as new filters are added.
    let limit = limit.unwrap_or(200);
    let needle = needle.unwrap_or_default();
    let mut args: Vec<(&str, &dyn rusqlite::ToSql)> = vec![(":limit", &limit)];
    for (name, value) in [
        (":today", &today as &dyn rusqlite::ToSql),
        (":warn", &warn_days),
        (":q", &needle),
    ] {
        if sql.contains(name) {
            args.push((name, value));
        }
    }

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(args.as_slice(), map_member_row)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

/// Everything the member detail screen needs, in one round trip.
#[tauri::command]
pub fn member_get(state: State<AppState>, id: i64) -> Result<MemberDetail> {
    let conn = state.db();
    let member = load_member(&conn, id)?;

    let mut stmt = conn.prepare(
        "SELECT id, member_id, starts_on, ends_on, price_cents, paid_cents,
                payment_method, note, created_at, voided_at
           FROM membership WHERE member_id = ?1
          ORDER BY starts_on DESC",
    )?;
    let memberships = stmt
        .query_map([id], map_membership)?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let mut stmt = conn.prepare(
        "SELECT id, member_id, kind, title, sha256, rel_path, mime, bytes,
                original_name, issuer, issued_on, expires_on, added_at
           FROM document WHERE member_id = ?1 AND deleted_at IS NULL
          ORDER BY added_at DESC",
    )?;
    let documents = stmt
        .query_map([id], map_document)?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let (paid_through, cert_through) = conn.query_row(
        "SELECT paid_through, cert_through FROM member_status WHERE id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    Ok(MemberDetail {
        member,
        memberships,
        documents,
        paid_through,
        cert_through,
    })
}

#[tauri::command]
pub fn member_create(state: State<AppState>, input: MemberInput) -> Result<i64> {
    let conn = state.db();
    let (first, last) = validate_name(&input)?;
    let birth_date = optional_date(input.birth_date, "birth_date")?;

    conn.execute(
        "INSERT INTO member (first_name, last_name, national_id, birth_date, phone,
                             email, emergency_contact, emergency_phone, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            first,
            last,
            blank_to_none(input.national_id),
            birth_date,
            blank_to_none(input.phone),
            blank_to_none(input.email),
            blank_to_none(input.emergency_contact),
            blank_to_none(input.emergency_phone),
            blank_to_none(input.notes),
        ],
    )
    .map_err(duplicate_id_hint)?;

    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn member_update(state: State<AppState>, id: i64, input: MemberInput) -> Result<()> {
    let conn = state.db();
    let (first, last) = validate_name(&input)?;
    let birth_date = optional_date(input.birth_date, "birth_date")?;

    let changed = conn
        .execute(
            "UPDATE member SET first_name = ?2, last_name = ?3, national_id = ?4,
                    birth_date = ?5, phone = ?6, email = ?7, emergency_contact = ?8,
                    emergency_phone = ?9, notes = ?10
              WHERE id = ?1 AND archived_at IS NULL",
            params![
                id,
                first,
                last,
                blank_to_none(input.national_id),
                birth_date,
                blank_to_none(input.phone),
                blank_to_none(input.email),
                blank_to_none(input.emergency_contact),
                blank_to_none(input.emergency_phone),
                blank_to_none(input.notes),
            ],
        )
        .map_err(duplicate_id_hint)?;

    if changed == 0 {
        return Err(AppError::new("member.not_found", "member does not exist").with("id", id));
    }
    Ok(())
}

/// Archive rather than delete. Membership history is financial record keeping
/// and health certificates may carry a statutory retention period; neither
/// should vanish because someone cancelled.
#[tauri::command]
pub fn member_archive(state: State<AppState>, id: i64) -> Result<()> {
    let conn = state.db();
    let changed = conn.execute(
        "UPDATE member SET archived_at = datetime('now','localtime')
          WHERE id = ?1 AND archived_at IS NULL",
        [id],
    )?;
    if changed == 0 {
        return Err(AppError::new("member.not_found", "member does not exist").with("id", id));
    }
    Ok(())
}

fn validate_name(input: &MemberInput) -> Result<(String, String)> {
    let first = input.first_name.trim().to_string();
    let last = input.last_name.trim().to_string();
    if first.is_empty() || last.is_empty() {
        return Err(AppError::new(
            "member.name_required",
            "first and last name are both required",
        ));
    }
    Ok((first, last))
}

/// The unique index on `national_id` is the one constraint a receptionist will
/// hit routinely, so it gets a human sentence instead of a SQLite error code.
fn duplicate_id_hint(err: rusqlite::Error) -> AppError {
    let msg = err.to_string();
    if msg.contains("idx_member_national_id") {
        AppError::new(
            "member.duplicate_national_id",
            "another member already has that ID number",
        )
    } else {
        err.into()
    }
}

pub(crate) fn load_member(conn: &Connection, id: i64) -> Result<Member> {
    conn.query_row(
        "SELECT id, first_name, last_name, national_id, birth_date, phone, email,
                emergency_contact, emergency_phone, notes, joined_on
           FROM member WHERE id = ?1",
        [id],
        |r| {
            Ok(Member {
                id: r.get(0)?,
                first_name: r.get(1)?,
                last_name: r.get(2)?,
                national_id: r.get(3)?,
                birth_date: r.get(4)?,
                phone: r.get(5)?,
                email: r.get(6)?,
                emergency_contact: r.get(7)?,
                emergency_phone: r.get(8)?,
                notes: r.get(9)?,
                joined_on: r.get(10)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::new("member.not_found", "member does not exist").with("id", id)
        }
        other => other.into(),
    })
}

fn map_member_row(r: &rusqlite::Row) -> rusqlite::Result<MemberRow> {
    Ok(MemberRow {
        id: r.get(0)?,
        first_name: r.get(1)?,
        last_name: r.get(2)?,
        phone: r.get(3)?,
        email: r.get(4)?,
        joined_on: r.get(5)?,
        paid_through: r.get(6)?,
        cert_through: r.get(7)?,
        last_checkin: r.get(8)?,
    })
}

pub(crate) fn map_membership(r: &rusqlite::Row) -> rusqlite::Result<Membership> {
    Ok(Membership {
        id: r.get(0)?,
        member_id: r.get(1)?,
        starts_on: r.get(2)?,
        ends_on: r.get(3)?,
        price_cents: r.get(4)?,
        paid_cents: r.get(5)?,
        payment_method: r.get(6)?,
        note: r.get(7)?,
        created_at: r.get(8)?,
        voided_at: r.get(9)?,
    })
}

pub(crate) fn map_document(r: &rusqlite::Row) -> rusqlite::Result<Document> {
    Ok(Document {
        id: r.get(0)?,
        member_id: r.get(1)?,
        kind: r.get(2)?,
        title: r.get(3)?,
        sha256: r.get(4)?,
        rel_path: r.get(5)?,
        mime: r.get(6)?,
        bytes: r.get(7)?,
        original_name: r.get(8)?,
        issuer: r.get(9)?,
        issued_on: r.get(10)?,
        expires_on: r.get(11)?,
        added_at: r.get(12)?,
    })
}
