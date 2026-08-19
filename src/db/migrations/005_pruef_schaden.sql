-- 005 — Prüfungen und Schäden
--
-- Prüfarten sind ABSICHTLICH leer: welche wiederkehrenden Prüfungen im Betrieb
-- tatsächlich anfallen, weiß Julius noch nicht. Er legt sie in der App an,
-- wenn es soweit ist. Eine geratene Vorgabe wäre schlimmer als keine.

CREATE TABLE IF NOT EXISTS pruefarten (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             CITEXT UNIQUE NOT NULL,
  intervall_monate INT NOT NULL CHECK (intervall_monate > 0),
  notiz            TEXT,
  aktiv            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pruefarten IS
  'Vom Betrieb selbst angelegt, z.B. "E-Geräte-Prüfung" alle 12 Monate.';

CREATE TABLE IF NOT EXISTS geraet_pruefungen (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geraet_id   UUID NOT NULL REFERENCES geraete(id) ON DELETE CASCADE,
  pruefart_id UUID NOT NULL REFERENCES pruefarten(id) ON DELETE RESTRICT,

  geprueft_am      DATE NOT NULL,
  -- Rechnet der Server aus geprueft_am + intervall_monate. Käme der Wert vom
  -- Browser, könnte ein Tippfehler eine Prüfung um Jahre verschieben.
  naechste_faellig DATE NOT NULL,

  ergebnis TEXT NOT NULL
           CHECK (ergebnis IN ('bestanden', 'maengel', 'durchgefallen')),
  pruefer       TEXT,
  dokument_pfad TEXT,
  notiz         TEXT,

  erfasst_von UUID REFERENCES benutzer(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pruefungen_faellig
  ON geraet_pruefungen (naechste_faellig);
CREATE INDEX IF NOT EXISTS pruefungen_geraet
  ON geraet_pruefungen (geraet_id, geprueft_am DESC);

-- Schäden. Ein Schaden der Schwere 'ausfall' setzt das Gerät auf 'defekt'
-- und nimmt es damit aus dem Ausgabeumlauf (durchgesetzt in der Fachschicht,
-- nicht hier — die Datenbank kennt die Regel nicht, nur den Zustand).
CREATE TABLE IF NOT EXISTS schaeden (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geraet_id  UUID NOT NULL REFERENCES geraete(id) ON DELETE CASCADE,
  buchung_id UUID REFERENCES buchungen(id) ON DELETE SET NULL,

  gemeldet_von UUID NOT NULL REFERENCES benutzer(id) ON DELETE RESTRICT,
  gemeldet_am  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  beschreibung TEXT NOT NULL,
  schwere      TEXT NOT NULL CHECK (schwere IN ('gering', 'mittel', 'ausfall')),
  status       TEXT NOT NULL DEFAULT 'offen'
               CHECK (status IN ('offen', 'in_reparatur', 'erledigt')),

  foto_pfade TEXT[] NOT NULL DEFAULT '{}',

  erledigt_am    TIMESTAMPTZ,
  erledigt_notiz TEXT
);

CREATE INDEX IF NOT EXISTS schaeden_offen
  ON schaeden (status) WHERE status <> 'erledigt';
CREATE INDEX IF NOT EXISTS schaeden_geraet
  ON schaeden (geraet_id, gemeldet_am DESC);
