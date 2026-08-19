-- 002 — Stammdaten: Schlagworte, Standorte, Lagerplätze
--
-- Bewusst NICHTS vorgegeben: keine Kategorien, keine Prüfarten, keine Regale.
-- Julius legt seine Einteilung selbst an. Eine mitgelieferte Liste, die nicht
-- zum Betrieb passt, wird erfahrungsgemäß nie aufgeräumt, sondern umschifft.

-- Frei vergebbare Schlagworte statt fester Kategorien: ein Gerät kann
-- gleichzeitig "Bagger", "Mietgerät" und "Führerschein nötig" sein.
CREATE TABLE IF NOT EXISTS schlagworte (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       CITEXT UNIQUE NOT NULL,
  farbe      TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN schlagworte.farbe IS
  'Optionaler Farbpunkt in Listen, z.B. "#b91c1c". NULL = neutral.';

-- Orte, an denen Geräte stehen können.
CREATE TABLE IF NOT EXISTS standorte (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  typ        TEXT NOT NULL DEFAULT 'baustelle'
             CHECK (typ IN ('lager', 'baustelle', 'werkstatt', 'extern')),
  adresse    TEXT,
  notiz      TEXT,
  aktiv      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Namen nur unter den AKTIVEN eindeutig: eine abgeschlossene Baustelle
-- "Lindengasse" darf stillgelegt bestehen bleiben, während Jahre später
-- eine neue gleichen Namens angelegt wird.
CREATE UNIQUE INDEX IF NOT EXISTS standorte_name_aktiv
  ON standorte (lower(name)) WHERE aktiv;

-- Lagerplätze: eigene Datensätze mit eigenem Etikett am Regal.
-- Ablauf beim Einlagern: Gerät scannen -> Platz scannen -> fertig, ohne Tippen.
CREATE TABLE IF NOT EXISTS lagerplaetze (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standort_id UUID NOT NULL REFERENCES standorte(id) ON DELETE CASCADE,
  bezeichnung TEXT NOT NULL,
  barcode     CITEXT UNIQUE,
  typ         TEXT NOT NULL DEFAULT 'regal'
              CHECK (typ IN ('regal', 'fach', 'container', 'freiflaeche')),
  notiz       TEXT,
  aktiv       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Getrennter Nummernkreis, hier erzwungen statt nur vereinbart:
-- Platz-Etiketten beginnen mit "P-", Geräte-Etiketten sind reine Ziffern
-- (siehe 003). Ein gescannter Code kann damit nie mehrdeutig sein — auch
-- dann nicht, wenn jemand später Daten von Hand einträgt.
DO $$ BEGIN
  ALTER TABLE lagerplaetze ADD CONSTRAINT lagerplaetze_barcode_praefix
    CHECK (barcode IS NULL OR barcode ~ '^P-');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN lagerplaetze.barcode IS
  'Etikett am Regal, immer mit Präfix "P-" (z.B. P-0001). NULL = Platz ohne Etikett.';

CREATE INDEX IF NOT EXISTS lagerplaetze_standort
  ON lagerplaetze (standort_id) WHERE aktiv;
