-- How many entries a member has left, counted down by hand at the desk: the
-- operator presses − each time they come in and + to correct or top up.
--
-- This is stored, not derived (contrast DECISIONS 3): nothing else records a
-- visit while `features.checkins` is off, so the number IS the record. It may
-- go negative — a member let in on credit owes the difference. Renewing a
-- membership does not touch it. See DECISIONS 24.
--
-- ADD COLUMN leaves `member_status` untouched: the view names its columns.
ALTER TABLE member ADD COLUMN entries_left INTEGER NOT NULL DEFAULT 10;
