-- Two fields the desk asked for on the member form: who teaches them, and the
-- association card (tessera) with its own expiry.
--
-- `teachers` is free text: there is no teacher table to pick from, and a
-- member may follow more than one.
--
-- `card_expires_on` is a plain date like every other one here. The form
-- proposes 31 December of the current year, which is when the card normally
-- lapses, but the operator can change it, so it is stored rather than derived.
--
-- ADD COLUMN leaves `member_status` untouched: the view names its columns.
ALTER TABLE member ADD COLUMN teachers        TEXT;
ALTER TABLE member ADD COLUMN card_number     TEXT;
ALTER TABLE member ADD COLUMN card_expires_on TEXT;
