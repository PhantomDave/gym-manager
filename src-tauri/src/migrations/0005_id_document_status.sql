-- The desk wants "no ID document on file" flagged the way a missing health
-- certificate already is: a badge, a dashboard tile, a roster filter and a
-- list on the Expiries screen.
--
-- Status stays derived (DECISIONS 3): the view gains a column computed from
-- `document`, and nothing is stored on `member`. An ID document is any live
-- row of kind 'id_card', with or without a file attached; its expiry, if any,
-- is not considered — the request is about one never having been added.
-- `idx_document_member (member_id, kind, …)` already covers the lookup.
--
-- A view cannot be altered, only replaced. The columns before the new one are
-- unchanged and in the same order.
DROP VIEW member_status;

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
  (SELECT max(c.at) FROM checkin c WHERE c.member_id = m.id)  AS last_checkin,
  EXISTS (SELECT 1 FROM document d
           WHERE d.member_id = m.id AND d.kind = 'id_card'
             AND d.deleted_at IS NULL)                        AS has_id_document
FROM member m
WHERE m.archived_at IS NULL;
