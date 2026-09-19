use rusqlite::params;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

use super::{blank_to_none, optional_date};
use crate::error::{AppError, Result};
use crate::models::{Document, DocumentInput, DOCUMENT_KINDS};
use crate::storage;
use crate::AppState;

/// Register a document against a member.
///
/// A health certificate is just `kind = "health_cert"` with `expires_on` set —
/// there is no separate certificate table, so there is one upload path, one
/// expiry rule, and one place to fix bugs.
#[tauri::command]
pub fn document_add(state: State<AppState>, input: DocumentInput) -> Result<Document> {
    if !DOCUMENT_KINDS.contains(&input.kind.as_str()) {
        return Err(
            AppError::new("document.unknown_kind", "unknown document kind")
                .with("kind", &input.kind)
                .with("expected", DOCUMENT_KINDS.join(", ")),
        );
    }

    let issued_on = optional_date(input.issued_on, "issued_on")?;
    let expires_on = optional_date(input.expires_on, "expires_on")?;

    // A certificate with no expiry is the failure mode this whole feature
    // exists to prevent, so it is a hard error rather than a warning.
    if input.kind == "health_cert" && expires_on.is_none() {
        return Err(AppError::new(
            "document.cert_needs_expiry",
            "a health certificate needs an expiry date",
        ));
    }
    if let (Some(i), Some(e)) = (&issued_on, &expires_on) {
        if e < i {
            return Err(AppError::new(
                "document.expiry_before_issue",
                "the expiry date is before the issue date",
            ));
        }
    }

    let conn = state.db();
    super::members::load_member(&conn, input.member_id)?;

    let stored = storage::import(&state.data_dir, std::path::Path::new(&input.source_path))?;

    conn.execute(
        "INSERT INTO document (member_id, kind, title, sha256, rel_path, mime, bytes,
                               original_name, issuer, issued_on, expires_on)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            input.member_id,
            input.kind,
            blank_to_none(input.title),
            stored.sha256,
            stored.rel_path,
            stored.mime,
            stored.bytes as i64,
            stored.original_name,
            blank_to_none(input.issuer),
            issued_on,
            expires_on,
        ],
    )?;

    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, member_id, kind, title, sha256, rel_path, mime, bytes,
                original_name, issuer, issued_on, expires_on, added_at
           FROM document WHERE id = ?1",
        [id],
        super::members::map_document,
    )
    .map_err(Into::into)
}

/// Hand the file to the desktop's own viewer.
///
/// Bundling a PDF renderer would cost more memory than the rest of the app put
/// together. `xdg-open` reuses a viewer the user already has, and its memory is
/// not our process's memory.
#[tauri::command]
pub fn document_open(app: tauri::AppHandle, state: State<AppState>, id: i64) -> Result<()> {
    let rel_path: String = {
        let conn = state.db();
        conn.query_row(
            "SELECT rel_path FROM document WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::new("document.not_found", "document does not exist").with("id", id)
            }
            other => other.into(),
        })?
    };

    let path = storage::resolve(&state.data_dir, &rel_path)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::new("document.open_failed", e.to_string()))
}

/// Soft-delete a document row.
///
/// The file on disk is intentionally left alone: it is content-addressed, so
/// another member's identical document may point at it. Reclaiming orphaned
/// blobs is a separate, deliberate sweep (see TODO.md).
#[tauri::command]
pub fn document_delete(state: State<AppState>, id: i64) -> Result<()> {
    let conn = state.db();
    let changed = conn.execute(
        "UPDATE document SET deleted_at = datetime('now','localtime')
          WHERE id = ?1 AND deleted_at IS NULL",
        [id],
    )?;
    if changed == 0 {
        return Err(AppError::new("document.not_found", "document does not exist").with("id", id));
    }
    Ok(())
}

/// Documents expiring within `days`, soonest first. Drives the dashboard list.
#[tauri::command]
pub fn documents_expiring(
    state: State<AppState>,
    kind: Option<String>,
    days: Option<i64>,
) -> Result<Vec<ExpiringDocument>> {
    let conn = state.db();
    let days = days.unwrap_or(30);
    let kind = kind.unwrap_or_else(|| "health_cert".to_string());

    let mut stmt = conn.prepare(
        "SELECT d.id, d.member_id, m.first_name, m.last_name, d.kind, d.expires_on
           FROM document d
           JOIN member m ON m.id = d.member_id
          WHERE d.deleted_at IS NULL
            AND m.archived_at IS NULL
            AND d.kind = ?1
            AND d.expires_on IS NOT NULL
            AND d.expires_on <= date('now','localtime','+' || ?2 || ' days')
            -- only the newest certificate per member matters
            AND d.expires_on = (SELECT max(d2.expires_on) FROM document d2
                                 WHERE d2.member_id = d.member_id
                                   AND d2.kind = d.kind
                                   AND d2.deleted_at IS NULL)
          ORDER BY d.expires_on ASC",
    )?;

    let rows = stmt.query_map(params![kind, days], |r| {
        Ok(ExpiringDocument {
            id: r.get(0)?,
            member_id: r.get(1)?,
            first_name: r.get(2)?,
            last_name: r.get(3)?,
            kind: r.get(4)?,
            expires_on: r.get(5)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiringDocument {
    pub id: i64,
    pub member_id: i64,
    pub first_name: String,
    pub last_name: String,
    pub kind: String,
    pub expires_on: String,
}
