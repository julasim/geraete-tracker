-- 009 — Rollen mit Rechten
--
-- Bis hierher gab es genau zwei Rollen, fest verdrahtet im CHECK-Constraint
-- von Migration 001. Damit ließ sich keine Abstufung dazwischen abbilden:
-- Wer den Bauhof führt, soll Geräte anlegen dürfen, aber keine Konten.
--
-- Ab jetzt sind Rollen Daten, keine Konstanten. Eine Rolle ist ein benanntes
-- Bündel von Rechten; die drei mitgelieferten decken den Betrieb ab, eigene
-- lassen sich in der App zusammenstellen — etwa eine reine Leserolle, indem
-- man gar kein Recht ankreuzt.
--
-- REIHENFOLGE IST WICHTIG, und zwar genau diese:
--   1. Tabelle "rollen" anlegen und mit den Vorgaben füllen
--   2. den alten CHECK auf benutzer.rolle ENTFERNEN
--   3. erst dann die Konten umhängen
--   4. zuletzt den Fremdschlüssel setzen
--
-- Schritt 2 muss vor Schritt 3 kommen: Der alte CHECK erlaubt nur 'admin'
-- und 'mitarbeiter' und weist das UPDATE auf 'verwaltung' sonst ab.
-- (Beim ersten Lauf genau so passiert — die Transaktion hat sauber
-- zurückgerollt, weshalb nichts halb umgestellt liegen blieb.)
--
-- Schritt 4 muss nach Schritt 3 kommen: Ein Fremdschlüssel auf Konten mit
-- der alten Rolle 'admin' würde scheitern, weil es diese Rolle nicht gibt.

CREATE TABLE IF NOT EXISTS rollen (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  beschreibung TEXT,

  -- Die Rechte als Textliste. Bewusst keine eigene Zuordnungstabelle:
  -- Der Katalog steht im Code (src/domain/rechte.ts), und eine Rolle ohne
  -- ihre Rechte zu lesen kommt nirgends vor.
  rechte       TEXT[] NOT NULL DEFAULT '{}',

  -- Mitgelieferte Rollen lassen sich umbenennen, aber nicht löschen —
  -- sonst stünde die Anwendung ohne Verwaltungsrolle da.
  ist_vorgabe  BOOLEAN NOT NULL DEFAULT FALSE,

  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN rollen.rechte IS
  'Liste der Rechte aus src/domain/rechte.ts. Leere Liste = reine Leserolle.';

-- ── Die drei mitgelieferten Rollen ──────────────────────────────────────────
-- Die Rechtelisten stehen zusätzlich in src/domain/rechte.ts. Doppelt, ja —
-- aber die Migration muss ohne Anwendungscode laufen, und der Code muss ohne
-- Datenbank testbar bleiben. Ein Test vergleicht beide Seiten.

INSERT INTO rollen (id, name, beschreibung, rechte, ist_vorgabe, sort_order)
VALUES
  ('mitarbeiter', 'Mitarbeiter',
   'Für die Baustelle: scannen, ausgeben, zurücknehmen, Schäden melden. Sieht den ganzen Bestand, ändert aber keine Stammdaten.',
   ARRAY['buchungen.erfassen', 'schaeden.melden', 'dateien.hochladen'],
   TRUE, 10),

  ('lager', 'Lager und Werkstatt',
   'Führt den Bauhof: legt Geräte an, pflegt Standorte und Regale, trägt Prüfungen ein, erledigt Schäden, druckt Etiketten.',
   ARRAY['buchungen.erfassen', 'schaeden.melden', 'dateien.hochladen',
         'geraete.pflegen', 'stammdaten.pflegen', 'pruefungen.eintragen',
         'schaeden.bearbeiten', 'dateien.verwalten', 'etiketten.drucken'],
   TRUE, 20),

  ('verwaltung', 'Verwaltung',
   'Vollzugriff einschließlich Benutzerverwaltung, Import und Export, Korrekturbuchungen und Ausmustern.',
   ARRAY['buchungen.erfassen', 'schaeden.melden', 'dateien.hochladen',
         'geraete.pflegen', 'stammdaten.pflegen', 'pruefungen.eintragen',
         'schaeden.bearbeiten', 'dateien.verwalten', 'etiketten.drucken',
         'geraete.ausmustern', 'buchungen.korrigieren', 'daten.austauschen',
         'benutzer.verwalten'],
   TRUE, 30)
ON CONFLICT (id) DO NOTHING;

-- ── Zuerst den alten CHECK weg ──────────────────────────────────────────────
-- Er kennt nur 'admin' und 'mitarbeiter' und würde das Umhängen unten
-- abweisen.
ALTER TABLE benutzer DROP CONSTRAINT IF EXISTS benutzer_rolle_check;

-- ── Dann die Konten umhängen ────────────────────────────────────────────────
-- 'admin' war die Vollzugriffsrolle und wird zu 'verwaltung'.
-- 'mitarbeiter' behält seinen Namen und seine Rechte.
UPDATE benutzer SET rolle = 'verwaltung' WHERE rolle = 'admin';

-- ── Zuletzt der Fremdschlüssel ──────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE benutzer ADD CONSTRAINT benutzer_rolle_fk
    FOREIGN KEY (rolle) REFERENCES rollen(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN benutzer.rolle IS
  'Verweist auf rollen.id. RESTRICT: eine Rolle, die jemand trägt, lässt sich nicht löschen.';

CREATE INDEX IF NOT EXISTS benutzer_rolle ON benutzer (rolle);
