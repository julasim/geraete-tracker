-- Logbuch: lückenloser Nachweis, wer wann was getan hat.
--
-- Die Buchungshistorie (004_buchungen.sql) deckt Gerätebewegungen ab;
-- alles andere — Stammdaten, Konten, Rollen, Einstellungen — war bisher
-- unsichtbar. Dieses Logbuch hält jeden schreibenden Vorgang fest, quer
-- über alle Bereiche.
--
-- Wie bei den Buchungen: append-only. Ein Eintrag entsteht und bleibt.
-- Kein UPDATE, kein DELETE — sonst wäre es kein Nachweis.

CREATE TABLE IF NOT EXISTS logbuch (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zeitpunkt   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  benutzer_id UUID NOT NULL REFERENCES benutzer(id) ON DELETE RESTRICT,
  aktion      TEXT NOT NULL,
  bereich     TEXT NOT NULL,
  ziel_id     UUID,
  ziel_text   TEXT,
  details     JSONB
);

-- Unveränderlich: UPDATE und DELETE laufen ins Leere.
CREATE OR REPLACE RULE logbuch_kein_update AS
  ON UPDATE TO logbuch DO INSTEAD NOTHING;
CREATE OR REPLACE RULE logbuch_kein_delete AS
  ON DELETE TO logbuch DO INSTEAD NOTHING;

-- Abfragen: jüngste zuerst, nach Bereich und Benutzer filterbar.
CREATE INDEX IF NOT EXISTS logbuch_zeitpunkt ON logbuch (zeitpunkt DESC);
CREATE INDEX IF NOT EXISTS logbuch_bereich ON logbuch (bereich, zeitpunkt DESC);
CREATE INDEX IF NOT EXISTS logbuch_benutzer ON logbuch (benutzer_id, zeitpunkt DESC);

COMMENT ON TABLE logbuch IS
  'Unveränderliches Protokoll aller schreibenden Vorgänge. '
  'UPDATE und DELETE sind per Rule wirkungslos.';
COMMENT ON COLUMN logbuch.aktion IS
  'Was geschehen ist: angelegt, geaendert, geloescht, gebucht, ausgemustert, …';
COMMENT ON COLUMN logbuch.bereich IS
  'Welcher Teil der Anwendung betroffen ist: geraet, buchung, standort, benutzer, …';
COMMENT ON COLUMN logbuch.ziel_id IS
  'UUID des betroffenen Datensatzes, wenn vorhanden.';
COMMENT ON COLUMN logbuch.ziel_text IS
  'Lesbarer Name des Ziels zum Zeitpunkt der Aktion (Gerätename, Benutzername, …).';
COMMENT ON COLUMN logbuch.details IS
  'Zusätzliche Angaben als JSON — z.B. geänderte Felder, Buchungsart, Import-Zahlen.';
