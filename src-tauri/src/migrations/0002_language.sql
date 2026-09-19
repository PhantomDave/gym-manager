-- The UI became bilingual. 0001 has shipped, so it is never edited: the new
-- default arrives as its own migration.
INSERT INTO setting (key, value) VALUES ('language', 'it')
  ON CONFLICT(key) DO NOTHING;
