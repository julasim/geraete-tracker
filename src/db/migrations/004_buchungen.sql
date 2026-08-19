-- 004 — Buchungen: die Historie, wer was wann wohin gebracht hat
--
-- APPEND-ONLY. Eine Buchung wird nie geändert und nie gelöscht — sonst wäre
-- die Historie keine Historie, sondern eine Behauptung. Ein Fehler wird durch
-- eine Gegenbuchung (art = 'korrektur') begradigt, nicht durch Überschreiben.

CREATE TABLE IF NOT EXISTS buchungen (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geraet_id UUID NOT NULL REFERENCES geraete(id) ON DELETE RESTRICT,

  art TEXT NOT NULL
      CHECK (art IN ('ausgabe', 'ruecknahme', 'umbuchung', 'korrektur')),

  -- ALLE Fremdschlüssel hier stehen auf RESTRICT, keiner auf SET NULL.
  -- Zwei Gründe, beide zwingend:
  --
  -- 1. Fachlich: Was in der Historie steht, muss auffindbar bleiben.
  --    "Ausgegeben nach: nichts" wäre keine Historie. Ein Standort, an dem
  --    je gebucht wurde, wird stillgelegt (aktiv = false), nicht gelöscht.
  --
  -- 2. Technisch: SET NULL würde Postgres dazu bringen, beim Löschen des
  --    Zielsatzes ein UPDATE auf buchungen auszuführen — das aber fängt die
  --    Unveränderlichkeitsregel weiter unten ab. Ergebnis wäre ein
  --    unverständlicher Fehler (XX000, "rule has rewritten the query")
  --    statt einer klaren Meldung. Beim Aufbau aufgefallen und behoben.
  von_standort_id    UUID REFERENCES standorte(id) ON DELETE RESTRICT,
  nach_standort_id   UUID REFERENCES standorte(id) ON DELETE RESTRICT,
  nach_lagerplatz_id UUID REFERENCES lagerplaetze(id) ON DELETE RESTRICT,

  -- Empfänger entweder ein Konto oder, für Subunternehmer ohne Zugang,
  -- ein Name als Freitext.
  empfaenger_id       UUID REFERENCES benutzer(id) ON DELETE RESTRICT,
  empfaenger_freitext TEXT,

  erfasst_von UUID NOT NULL REFERENCES benutzer(id) ON DELETE RESTRICT,
  zeitpunkt   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  geplante_rueckgabe DATE,
  notiz              TEXT,

  -- Nur bei 'korrektur' gesetzt: welche Buchung richtiggestellt wird.
  storniert_durch UUID REFERENCES buchungen(id) ON DELETE RESTRICT
);

COMMENT ON TABLE buchungen IS
  'Append-only. UPDATE und DELETE sind per Rule wirkungslos (siehe unten).';
COMMENT ON COLUMN buchungen.erfasst_von IS
  'Wer gebucht hat — nicht zu verwechseln mit empfaenger_id, wer es bekommt.';

CREATE INDEX IF NOT EXISTS buchungen_geraet_zeit
  ON buchungen (geraet_id, zeitpunkt DESC);
CREATE INDEX IF NOT EXISTS buchungen_standort_zeit
  ON buchungen (nach_standort_id, zeitpunkt DESC);
CREATE INDEX IF NOT EXISTS buchungen_empfaenger_zeit
  ON buchungen (empfaenger_id, zeitpunkt DESC);

-- Die Historie hart schützen. Diese beiden Regeln sorgen dafür, dass ein
-- versehentliches UPDATE oder DELETE im Anwendungscode folgenlos bleibt,
-- statt still Geschichte umzuschreiben.
--
-- Achtung beim Weiterentwickeln: DO INSTEAD NOTHING meldet KEINEN Fehler,
-- die Anweisung läuft nur ins Leere. Wer hier künftig doch ändern muss,
-- lässt die Regel in einer neuen Migration ausdrücklich fallen.
DO $$ BEGIN
  CREATE RULE buchungen_kein_update AS ON UPDATE TO buchungen DO INSTEAD NOTHING;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE RULE buchungen_kein_delete AS ON DELETE TO buchungen DO INSTEAD NOTHING;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
