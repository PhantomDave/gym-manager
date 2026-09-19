//! Tauri commands — the entire surface the frontend can call.
//!
//! Every command takes `State<AppState>`, locks the connection, does its work,
//! and returns a plain serialisable value. There is no ORM and no repository
//! layer: the SQL is short enough to read in place, and one indirection less is
//! one less thing to keep in sync with the schema.

pub mod app;
pub mod checkins;
pub mod documents;
pub mod members;
pub mod memberships;

use chrono::{Local, NaiveDate};

use crate::error::{AppError, Result};

/// Today, in the machine's local timezone.
///
/// The gym runs on one desk in one timezone; UTC would put late-evening
/// check-ins on the wrong day, which is the only thing that matters here.
pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// Parse an ISO date coming from the frontend, with a useful error message.
pub fn parse_date(value: &str, field: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::invalid(format!("{field} must be a date in YYYY-MM-DD form")))
}

/// Normalise an optional free-text field: blank strings become None so the
/// database holds NULL rather than empty strings.
pub fn blank_to_none(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Same, but validating that anything present is a date.
pub fn optional_date(value: Option<String>, field: &str) -> Result<Option<String>> {
    match blank_to_none(value) {
        None => Ok(None),
        Some(v) => {
            parse_date(&v, field)?;
            Ok(Some(v))
        }
    }
}
