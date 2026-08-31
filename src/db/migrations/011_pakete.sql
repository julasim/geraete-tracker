-- Pakete: benannte Zusammenstellungen, die gemeinsam hinausgehen.
--
-- Der Anlass kommt aus dem Bauhof: Für eine Estrich-Baustelle fahren immer
-- dieselben acht Geräte mit. Sie einzeln zu scannen ist nicht falsch, nur
-- mühsam — und wer eines vergisst, merkt es erst auf der Baustelle.
--
-- Ein Paket ist bewusst NUR eine Liste von Geräten, kein eigener Bestand:
--
--   * Der Zustand bleibt am Gerät. Ein Paket "hat" nichts, es zeigt nur
--     darauf. Sonst gäbe es zwei Wahrheiten darüber, wo etwas steht — und
--     falscher Bestand ist in dieser Anwendung der teuerste Fehler.
--   * Ein Gerät darf in mehreren Paketen stecken. Die Rüttelplatte gehört
--     zum Estrich-Set und zum Erdbau-Set; sie deshalb doppelt zu führen,
--     wäre unsinnig.
--   * Beim Buchen ist ein Paket nur ein Vorschlag: Es füllt die Liste, und
--     was gerade nicht mitfährt, wird abgewählt. Verbindlich ist immer, was
--     tatsächlich gebucht wird.

CREATE TABLE IF NOT EXISTS pakete (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  notiz      TEXT,
  aktiv      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES benutzer(id) ON DELETE SET NULL,
  rev        INTEGER NOT NULL DEFAULT 1
);

-- Namen nur unter den AKTIVEN eindeutig — wie bei den Standorten: Ein
-- stillgelegtes Paket darf seinen Namen behalten, ohne einen neuen zu
-- blockieren.
CREATE UNIQUE INDEX IF NOT EXISTS pakete_name_aktiv
  ON pakete (lower(name)) WHERE aktiv;

CREATE TABLE IF NOT EXISTS paket_geraete (
  paket_id   UUID NOT NULL REFERENCES pakete(id)  ON DELETE CASCADE,
  -- CASCADE auch hier: Verschwindet ein Gerät aus dem Bestand, soll es nicht
  -- als Leiche in einem Paket stehen bleiben. Die Buchungshistorie bleibt
  -- davon unberührt — sie hängt an `buchungen`, nicht hier.
  geraet_id  UUID NOT NULL REFERENCES geraete(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (paket_id, geraet_id)
);

CREATE INDEX IF NOT EXISTS paket_geraete_geraet ON paket_geraete (geraet_id);

COMMENT ON TABLE pakete IS
  'Benannte Zusammenstellung von Geräten für die Sammelbuchung. Hält keinen '
  'eigenen Bestand — der Zustand bleibt am Gerät.';
