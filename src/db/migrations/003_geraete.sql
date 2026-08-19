-- 003 — Geräte, ihre Etiketten und ihre Schlagworte
--
-- Der Zustand eines Geräts (status, Standort, Lagerplatz, Nutzer) ist
-- ABGELEITET aus der Buchungshistorie in 004. Er wird hier trotzdem
-- mitgeführt, weil die häufigste Frage "wo ist 10013?" sonst bei jedem
-- Aufruf die ganze Historie durchrechnen müsste. Geschrieben wird beides
-- immer in derselben Transaktion (siehe src/data/buchungen.ts).

CREATE TABLE IF NOT EXISTS geraete (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Fünfstellige Nummer vom Etikett, fortlaufend ab 10001.
  -- Zugleich Inventarnummer — ein zweites Nummernfeld gäbe es nur, damit
  -- beide irgendwann auseinanderlaufen.
  inventarnummer TEXT UNIQUE,

  bezeichnung    TEXT NOT NULL,
  hersteller     TEXT,
  modell         TEXT,
  seriennummer   TEXT,

  anschaffungsdatum DATE,
  anschaffungswert  NUMERIC(12,2),

  status TEXT NOT NULL DEFAULT 'verfuegbar'
         CHECK (status IN ('verfuegbar', 'ausgegeben', 'wartung', 'defekt', 'ausgemustert')),

  aktueller_standort_id   UUID REFERENCES standorte(id) ON DELETE SET NULL,
  aktueller_lagerplatz_id UUID REFERENCES lagerplaetze(id) ON DELETE SET NULL,
  aktueller_nutzer_id     UUID REFERENCES benutzer(id) ON DELETE SET NULL,

  foto_pfad TEXT,
  notiz     TEXT,

  -- Konfliktschutz: wer mit veralteter Fassung speichert, bekommt 409
  -- statt die Änderung eines anderen stillschweigend zu überschreiben.
  rev INT NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES benutzer(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES benutzer(id) ON DELETE SET NULL
);

COMMENT ON COLUMN geraete.status IS
  'Abgeleitet aus der Buchungshistorie, in derselben Transaktion mitgeschrieben.';
COMMENT ON COLUMN geraete.rev IS
  'Zähler für den Konfliktschutz. Jede Änderung erhöht ihn um 1.';

CREATE INDEX IF NOT EXISTS geraete_status   ON geraete (status);
CREATE INDEX IF NOT EXISTS geraete_standort ON geraete (aktueller_standort_id);
CREATE INDEX IF NOT EXISTS geraete_platz    ON geraete (aktueller_lagerplatz_id);
-- Kein Volltextindex: bei ~200 Zeilen ist ein Sequential Scan schneller als
-- jeder Index, und gefiltert wird ohnehin im Browser.

-- Ein Gerät darf mehrere Etiketten tragen. Klebt jemand ein Ersatzetikett auf,
-- weil das alte unleserlich wurde, bleibt das alte gültig — sonst findet ein
-- halb abgeschabtes, aber noch lesbares Etikett plötzlich nichts mehr.
CREATE TABLE IF NOT EXISTS geraete_barcodes (
  barcode     CITEXT PRIMARY KEY,
  geraet_id   UUID NOT NULL REFERENCES geraete(id) ON DELETE CASCADE,
  aktiv       BOOLEAN NOT NULL DEFAULT TRUE,
  erfasst_am  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  erfasst_von UUID REFERENCES benutzer(id) ON DELETE SET NULL
);

-- Gegenstück zur Platz-Regel aus 002: Gerätecodes dürfen NICHT mit "P-"
-- beginnen. Zusammen schließen die beiden Regeln eine Verwechslung aus.
DO $$ BEGIN
  ALTER TABLE geraete_barcodes ADD CONSTRAINT geraete_barcodes_kein_platz
    CHECK (barcode !~* '^P-');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS geraete_barcodes_geraet ON geraete_barcodes (geraet_id);

-- Schlagworte: n:m. Beliebig viele je Gerät.
CREATE TABLE IF NOT EXISTS geraet_schlagworte (
  geraet_id     UUID NOT NULL REFERENCES geraete(id) ON DELETE CASCADE,
  schlagwort_id UUID NOT NULL REFERENCES schlagworte(id) ON DELETE CASCADE,
  PRIMARY KEY (geraet_id, schlagwort_id)
);

CREATE INDEX IF NOT EXISTS geraet_schlagworte_wort
  ON geraet_schlagworte (schlagwort_id);
