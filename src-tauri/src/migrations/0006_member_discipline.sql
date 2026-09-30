-- Disciplines a member practises (Boxe, Pilates, ...), any number of them.
--
-- `expires_on` NULL means the discipline follows the membership: its expiry is
-- whatever `member_status.paid_through` says, so a renewal extends it with no
-- write here. A date is a deliberate override from the desk. Copying the
-- membership's date in instead would be a cached status column in disguise,
-- and would go stale on the first renewal.
--
-- Names are free text. The unique index stops "Boxe" being listed twice on one
-- person, ignoring case, among the disciplines not removed.
CREATE TABLE member_discipline (
  id         INTEGER PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  expires_on TEXT,           -- NULL = follows the membership's paid_through
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  removed_at TEXT            -- soft delete, like documents
);
CREATE UNIQUE INDEX idx_discipline_member_name
  ON member_discipline(member_id, name COLLATE NOCASE) WHERE removed_at IS NULL;
