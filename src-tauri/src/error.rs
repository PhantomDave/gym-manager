//! One error type for the whole backend.
//!
//! Errors cross the IPC boundary as `{ code, message, params }`, never as a
//! finished sentence. The frontend looks the code up in its catalogue and
//! interpolates the params; `message` is an English developer fallback for
//! anything the catalogue has not mapped yet.
//!
//! The rule this enforces: **no user-facing prose is written in Rust.** Without
//! it, an Italian receptionist reads "not found: member 5".

use std::collections::BTreeMap;

use serde::{Serialize, Serializer};
#[cfg(test)]
use ts_rs::TS;

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug)]
#[cfg_attr(test, derive(TS))]
pub struct AppError {
    /// Dotted identifier the frontend translates, e.g. `member.duplicate_id`.
    pub code: &'static str,
    /// English fallback, shown only when the catalogue lacks the code.
    pub message: String,
    /// Values interpolated into the translated string.
    pub params: BTreeMap<&'static str, String>,
}

impl AppError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        AppError {
            code,
            message: message.into(),
            params: BTreeMap::new(),
        }
    }

    /// Attach a value for the translated string to interpolate.
    pub fn with(mut self, key: &'static str, value: impl ToString) -> Self {
        self.params.insert(key, value.to_string());
        self
    }

    pub fn not_found(code: &'static str, message: impl Into<String>) -> Self {
        AppError::new(code, message)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::new("db.error", err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::new("io.error", err.to_string())
    }
}

// Tauri needs the error to serialise. The shape here is the frontend contract.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 3)?;
        s.serialize_field("code", self.code)?;
        s.serialize_field("message", &self.message)?;
        s.serialize_field("params", &self.params)?;
        s.end()
    }
}

/// A single reason the front desk is being warned about, ready for translation.
///
/// Same contract as `AppError`: the backend decides *what* is wrong, the
/// frontend decides how to say it.
#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(TS))]
pub struct Reason {
    pub code: &'static str,
    pub params: BTreeMap<&'static str, String>,
}

impl Reason {
    pub fn new(code: &'static str) -> Self {
        Reason {
            code,
            params: BTreeMap::new(),
        }
    }

    pub fn with(mut self, key: &'static str, value: impl ToString) -> Self {
        self.params.insert(key, value.to_string());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_to_the_frontend_contract() {
        let err = AppError::new("member.not_found", "member 5 does not exist").with("id", 5);
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "member.not_found");
        assert_eq!(json["params"]["id"], "5");
        assert!(json["message"].is_string());
    }

    #[test]
    fn database_errors_carry_a_code() {
        let err: AppError = rusqlite::Error::QueryReturnedNoRows.into();
        assert_eq!(err.code, "db.error");
    }
}
