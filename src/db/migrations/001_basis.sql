-- 001 — Grundlage: Erweiterungen, Benutzer, Anmeldeprotokoll
--
-- CITEXT wird für alles genommen, was Menschen eintippen oder scannen
-- (Benutzername, E-Mail, Barcode). Damit findet "Meier" auch "meier",
-- ohne dass jede Abfrage lower() bemühen muss.
--
-- Die Sicherheitsfelder in "benutzer" gehören von Anfang an hierher, nicht in
-- eine spätere Migration: die App steht offen im Internet, und ein nachträglich
-- eingezogener Schutz lässt erfahrungsgemäß Lücken.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS benutzer (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benutzername   CITEXT UNIQUE NOT NULL,
  email          CITEXT UNIQUE,
  passwort_hash  TEXT NOT NULL,
  anzeigename    TEXT NOT NULL,
  rolle          TEXT NOT NULL DEFAULT 'mitarbeiter'
                 CHECK (rolle IN ('admin', 'mitarbeiter')),
  aktiv          BOOLEAN NOT NULL DEFAULT TRUE,

  -- Sitzungswiderruf. Jedes ausgestellte Token trägt diesen Zähler; die
  -- Middleware vergleicht ihn bei JEDER Anfrage mit der Datenbank. Wird er
  -- erhöht (Logout überall, Passwortwechsel, Rollenwechsel, Deaktivierung),
  -- sind alle bestehenden Anmeldungen augenblicklich ungültig. Ohne das gilt
  -- ein einmal ausgestelltes Token bis zum Ablauf weiter — auch für ein
  -- verlorenes Handy.
  token_version  INT NOT NULL DEFAULT 1,

  -- Sperre nach Fehlversuchen (siehe src/api/bremse.ts)
  fehlversuche   INT NOT NULL DEFAULT 0,
  gesperrt_bis   TIMESTAMPTZ,

  passwort_geaendert_am   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  passwort_wechsel_noetig BOOLEAN NOT NULL DEFAULT TRUE,
  letzter_login  TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN benutzer.token_version IS
  'Erhöhen macht alle bestehenden Anmeldungen dieses Kontos sofort ungültig.';
COMMENT ON COLUMN benutzer.email IS
  'Optional. Anmeldung ist wahlweise über Benutzername oder E-Mail möglich.';

-- Protokoll aller Anmeldeversuche, auch der erfolglosen und derer auf
-- nicht existierende Konten. Grundlage für die Sperre und für die
-- Admin-Ansicht "wer hat vergeblich versucht hereinzukommen".
CREATE TABLE IF NOT EXISTS anmeldeversuche (
  id         BIGSERIAL PRIMARY KEY,
  zeitpunkt  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kennung    CITEXT,
  ip         INET,
  erfolg     BOOLEAN NOT NULL,
  grund      TEXT,
  user_agent TEXT
);

COMMENT ON COLUMN anmeldeversuche.kennung IS
  'Was eingegeben wurde (Benutzername oder E-Mail) — auch bei unbekanntem Konto.';
COMMENT ON COLUMN anmeldeversuche.grund IS
  'ok | passwort_falsch | unbekannt | gesperrt | inaktiv';

CREATE INDEX IF NOT EXISTS anmeldeversuche_ip_zeit
  ON anmeldeversuche (ip, zeitpunkt DESC);
CREATE INDEX IF NOT EXISTS anmeldeversuche_kennung_zeit
  ON anmeldeversuche (kennung, zeitpunkt DESC);
