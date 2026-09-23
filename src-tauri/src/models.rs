//! Row shapes shared with the frontend.
//!
//! Status is deliberately not a stored column anywhere. `MemberRow` carries the
//! two raw dates (`paid_through`, `cert_through`) and the UI derives the colour
//! from them, so there is exactly one place the rule lives.

use serde::{Deserialize, Serialize};
#[cfg(test)]
use ts_rs::TS;

/// Bind and read a serde-friendly unit enum through SQLite as the same string
/// its `Serialize` impl already produces, so there is one mapping to a text
/// value, not two.
macro_rules! sql_via_serde {
    ($t:ty) => {
        impl rusqlite::types::ToSql for $t {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                match serde_json::to_value(self) {
                    Ok(serde_json::Value::String(s)) => Ok(rusqlite::types::ToSqlOutput::from(s)),
                    _ => Err(rusqlite::Error::ToSqlConversionFailure(
                        "enum did not serialise to a string".into(),
                    )),
                }
            }
        }

        impl rusqlite::types::FromSql for $t {
            fn column_result(
                value: rusqlite::types::ValueRef<'_>,
            ) -> rusqlite::types::FromSqlResult<Self> {
                let s = value.as_str()?;
                serde_json::from_value(serde_json::Value::String(s.to_owned()))
                    .map_err(|e| rusqlite::types::FromSqlError::Other(Box::new(e)))
            }
        }
    };
}
pub(crate) use sql_via_serde;

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
pub struct MemberRow {
    pub id: i64,
    pub first_name: String,
    pub last_name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub joined_on: String,
    /// Last day currently paid for, or None if they have never had a membership.
    pub paid_through: Option<String>,
    /// Expiry of the newest health certificate on file, or None if there is none.
    pub cert_through: Option<String>,
    pub last_checkin: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: i64,
    pub first_name: String,
    pub last_name: String,
    pub national_id: Option<String>,
    pub birth_date: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub emergency_contact: Option<String>,
    pub emergency_phone: Option<String>,
    pub notes: Option<String>,
    pub joined_on: String,
}

#[derive(Debug, Default, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
pub struct MemberInput {
    pub first_name: String,
    pub last_name: String,
    pub national_id: Option<String>,
    pub birth_date: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub emergency_contact: Option<String>,
    pub emergency_phone: Option<String>,
    pub notes: Option<String>,
}

/// How a renewal was paid. `Membership.payment_method` is `None` while
/// `features.paymentMethod` is off — see `src/features.ts`.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone, Copy)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "snake_case")]
pub enum PaymentMethod {
    Cash,
    Card,
    Transfer,
}
sql_via_serde!(PaymentMethod);

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
pub struct Membership {
    pub id: i64,
    pub member_id: i64,
    pub starts_on: String,
    pub ends_on: String,
    pub price_cents: i64,
    pub paid_cents: i64,
    pub payment_method: Option<PaymentMethod>,
    pub note: Option<String>,
    pub created_at: String,
    pub voided_at: Option<String>,
}

/// What a document is. A health certificate is `HealthCert` with `expires_on`
/// set — there is no separate certificate table.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone, Copy)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "snake_case")]
pub enum DocumentKind {
    HealthCert,
    IdCard,
    Waiver,
    Contract,
    Photo,
    Receipt,
    Other,
}
sql_via_serde!(DocumentKind);

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: i64,
    pub member_id: Option<i64>,
    pub kind: DocumentKind,
    pub title: Option<String>,
    /// `None` when the document was registered with no file attached.
    pub sha256: Option<String>,
    pub rel_path: Option<String>,
    pub mime: Option<String>,
    pub bytes: Option<i64>,
    pub original_name: Option<String>,
    pub issuer: Option<String>,
    pub issued_on: Option<String>,
    pub expires_on: Option<String>,
    pub added_at: String,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
pub struct DocumentInput {
    pub member_id: i64,
    pub kind: DocumentKind,
    /// Absolute path on disk of the file being imported; it is copied, not
    /// moved. `None` (or blank) registers the document with no file attached.
    pub source_path: Option<String>,
    pub title: Option<String>,
    pub issuer: Option<String>,
    pub issued_on: Option<String>,
    pub expires_on: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
pub struct MemberDetail {
    pub member: Member,
    pub memberships: Vec<Membership>,
    pub documents: Vec<Document>,
    pub paid_through: Option<String>,
    pub cert_through: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
pub struct Checkin {
    pub id: i64,
    pub member_id: i64,
    pub at: String,
    pub membership_id: Option<i64>,
    pub override_reason: Option<String>,
}

/// Which slice of the roster the members list should return.
#[derive(Debug, Default, Deserialize, PartialEq, Eq, Clone, Copy)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
pub enum Filter {
    #[default]
    All,
    Active,
    Expiring,
    Expired,
    CertExpired,
    CertMissing,
}
