-- Initial schema.
--
-- Design notes that are easy to lose:
--   * All dates are ISO 'YYYY-MM-DD' TEXT. All timestamps are 'YYYY-MM-DD HH:MM:SS'
--     local time. SQLite has no date type; consistency here is the whole game.
--   * Membership status is DERIVED, never stored. There is no is_active column.
--   * A health certificate is just a document with kind='health_cert' and an
--     expires_on. It does not get its own table.
--   * Money is INTEGER cents. Never floats.
--   * People and payments are soft-deleted (archived_at / voided_at).

CREATE TABLE member (
  id                INTEGER PRIMARY KEY,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  national_id       TEXT,
  birth_date        TEXT,
  phone             TEXT,
  email             TEXT,
  emergency_contact TEXT,
  emergency_phone   TEXT,
  notes             TEXT,
  joined_on         TEXT NOT NULL DEFAULT (date('now','localtime')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  archived_at       TEXT
);
CREATE INDEX idx_member_name ON member(last_name, first_name);
CREATE UNIQUE INDEX idx_member_national_id
  ON member(national_id) WHERE national_id IS NOT NULL;

CREATE TABLE membership (
  id             INTEGER PRIMARY KEY,
  member_id      INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  starts_on      TEXT NOT NULL,          -- inclusive
  ends_on        TEXT NOT NULL,          -- inclusive
  price_cents    INTEGER NOT NULL,
  paid_cents     INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,                   -- cash | card | transfer
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  voided_at      TEXT,
  void_reason    TEXT,
  CHECK (ends_on >= starts_on),
  CHECK (price_cents >= 0 AND paid_cents >= 0)
);
CREATE INDEX idx_membership_member ON membership(member_id, ends_on DESC);

CREATE TABLE document (
  id            INTEGER PRIMARY KEY,
  member_id     INTEGER REFERENCES member(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,  -- health_cert | id_card | waiver | contract | photo | receipt | other
  title         TEXT,
  sha256        TEXT NOT NULL,
  rel_path      TEXT NOT NULL,  -- e.g. docs/a3/a3f19c...pdf, relative to the data dir
  mime          TEXT,
  bytes         INTEGER,
  original_name TEXT,
  issuer        TEXT,           -- doctor / clinic, for health certificates
  issued_on     TEXT,
  expires_on    TEXT,           -- NULL for documents that do not expire
  added_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at    TEXT
);
CREATE INDEX idx_document_member ON document(member_id, kind, expires_on DESC);
CREATE INDEX idx_document_sha    ON document(sha256);

CREATE TABLE checkin (
  id              INTEGER PRIMARY KEY,
  member_id       INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  at              TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  membership_id   INTEGER REFERENCES membership(id),  -- what authorised entry
  override_reason TEXT                                -- set when staff admit anyway
);
CREATE INDEX idx_checkin_at ON checkin(at DESC);

CREATE TABLE setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The single view the UI reads member state from.
CREATE VIEW member_status AS
SELECT
  m.id,
  m.first_name,
  m.last_name,
  m.phone,
  m.email,
  m.joined_on,
  (SELECT max(s.ends_on) FROM membership s
     WHERE s.member_id = m.id AND s.voided_at IS NULL)        AS paid_through,
  (SELECT max(d.expires_on) FROM document d
     WHERE d.member_id = m.id AND d.kind = 'health_cert'
       AND d.deleted_at IS NULL)                              AS cert_through,
  (SELECT max(c.at) FROM checkin c WHERE c.member_id = m.id)  AS last_checkin
FROM member m
WHERE m.archived_at IS NULL;

INSERT INTO setting (key, value) VALUES
  ('gym_name',            'My Gym'),
  ('currency',            'EUR'),
  ('default_price_cents', '3000'),
  ('grace_days',          '0'),
  ('expiry_warning_days', '7'),
  ('cert_warning_days',   '30');
