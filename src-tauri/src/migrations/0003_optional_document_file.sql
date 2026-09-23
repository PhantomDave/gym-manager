-- Document attachments become optional: the desk can register a document (a
-- certificate read out over the phone, a waiver signed on paper and filed
-- elsewhere) before a scan of it exists, and attach the file later.
--
-- SQLite has no ALTER COLUMN to drop a NOT NULL constraint, so the table is
-- rebuilt: rename, recreate with the columns relaxed, copy, drop the old one.
-- Dropping `document_old` also drops its indexes, so they are recreated
-- fresh on the new table rather than needing an explicit DROP INDEX first.
--
-- `member_status` selects from `document`. Modern ALTER TABLE RENAME rewrites
-- that reference in the view's stored SQL to follow the renamed table, which
-- would leave the view pointing at `document_old` after it is dropped.
-- `legacy_alter_table` turns that propagation off, so the view keeps saying
-- `document` throughout and simply resolves to the new table once it exists.
PRAGMA legacy_alter_table = ON;
ALTER TABLE document RENAME TO document_old;

CREATE TABLE document (
  id            INTEGER PRIMARY KEY,
  member_id     INTEGER REFERENCES member(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,  -- health_cert | id_card | waiver | contract | photo | receipt | other
  title         TEXT,
  sha256        TEXT,           -- NULL when no file is attached
  rel_path      TEXT,           -- NULL when no file is attached
  mime          TEXT,
  bytes         INTEGER,
  original_name TEXT,
  issuer        TEXT,           -- doctor / clinic, for health certificates
  issued_on     TEXT,
  expires_on    TEXT,           -- NULL for documents that do not expire
  added_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at    TEXT
);

INSERT INTO document (id, member_id, kind, title, sha256, rel_path, mime, bytes,
                       original_name, issuer, issued_on, expires_on, added_at, deleted_at)
  SELECT id, member_id, kind, title, sha256, rel_path, mime, bytes,
         original_name, issuer, issued_on, expires_on, added_at, deleted_at
    FROM document_old;

DROP TABLE document_old;
PRAGMA legacy_alter_table = OFF;

CREATE INDEX idx_document_member ON document(member_id, kind, expires_on DESC);
CREATE INDEX idx_document_sha    ON document(sha256);
