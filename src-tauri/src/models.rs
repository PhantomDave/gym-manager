//! Row shapes shared with the frontend.
//!
//! Status is deliberately not a stored column anywhere. `MemberRow` carries the
//! two raw dates (`paid_through`, `cert_through`) and the UI derives the colour
//! from them, so there is exactly one place the rule lives.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Membership {
    pub id: i64,
    pub member_id: i64,
    pub starts_on: String,
    pub ends_on: String,
    pub price_cents: i64,
    pub paid_cents: i64,
    pub payment_method: Option<String>,
    pub note: Option<String>,
    pub created_at: String,
    pub voided_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: i64,
    pub member_id: Option<i64>,
    pub kind: String,
    pub title: Option<String>,
    pub sha256: String,
    pub rel_path: String,
    pub mime: Option<String>,
    pub bytes: Option<i64>,
    pub original_name: Option<String>,
    pub issuer: Option<String>,
    pub issued_on: Option<String>,
    pub expires_on: Option<String>,
    pub added_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInput {
    pub member_id: i64,
    /// One of: health_cert, id_card, waiver, contract, photo, receipt, other.
    pub kind: String,
    /// Absolute path on disk of the file being imported; it is copied, not moved.
    pub source_path: String,
    pub title: Option<String>,
    pub issuer: Option<String>,
    pub issued_on: Option<String>,
    pub expires_on: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberDetail {
    pub member: Member,
    pub memberships: Vec<Membership>,
    pub documents: Vec<Document>,
    pub paid_through: Option<String>,
    pub cert_through: Option<String>,
}

#[derive(Debug, Serialize)]
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

pub const DOCUMENT_KINDS: &[&str] = &[
    "health_cert",
    "id_card",
    "waiver",
    "contract",
    "photo",
    "receipt",
    "other",
];
