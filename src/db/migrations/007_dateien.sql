-- 007 — Fotos und Dokumente
--
-- Eine Tabelle für beides: technisch ist der Unterschied nur der Dateityp,
-- und zwei fast gleiche Tabellen wären zwei fast gleiche Uploadwege.
--
-- Die Dateien selbst liegen im Dateisystem unter DATA_PATH, in der Datenbank
-- steht nur der Verweis. Bilder als BLOB aufzubewahren bläht jedes Backup auf
-- und bringt bei dieser Größenordnung keinen Vorteil.
--
-- WICHTIG: Der Ablageort liegt AUSSERHALB des statisch ausgelieferten
-- Ordners. Ausgeliefert wird ausschließlich über GET /api/dateien/:id mit
-- Anmeldeprüfung — sonst wären Baustellenfotos über eine geratene Adresse
-- öffentlich, und das fiele niemandem auf.

CREATE TABLE IF NOT EXISTS dateien (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geraet_id  UUID NOT NULL REFERENCES geraete(id) ON DELETE CASCADE,

  -- Woran die Datei hängt. Ein Schadensfoto gehört zum Schaden, ein
  -- Zustandsfoto zur Buchung, ein Typenschildfoto zum Gerät selbst.
  schaden_id  UUID,
  buchung_id  UUID REFERENCES buchungen(id) ON DELETE SET NULL,

  art TEXT NOT NULL DEFAULT 'foto' CHECK (art IN ('foto', 'dokument')),

  dateiname   TEXT NOT NULL,        -- wie der Benutzer sie kennt
  pfad        TEXT NOT NULL,        -- relativ zu DATA_PATH
  mime        TEXT NOT NULL,
  groesse     BIGINT NOT NULL,
  breite      INT,
  hoehe       INT,

  titel       TEXT,
  -- Das Bild, das in Listen und auf der Gerätekarte erscheint.
  ist_titelbild BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INT NOT NULL DEFAULT 0,

  hochgeladen_von UUID REFERENCES benutzer(id) ON DELETE SET NULL,
  hochgeladen_am  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dateien_geraet ON dateien (geraet_id, art, sort_order);
CREATE INDEX IF NOT EXISTS dateien_schaden ON dateien (schaden_id) WHERE schaden_id IS NOT NULL;

-- Genau ein Titelbild je Gerät. Ohne diese Regel müsste der Anwendungscode
-- beim Setzen aufpassen — und würde es irgendwann vergessen.
CREATE UNIQUE INDEX IF NOT EXISTS dateien_ein_titelbild
  ON dateien (geraet_id) WHERE ist_titelbild;

COMMENT ON COLUMN dateien.pfad IS
  'Relativ zu DATA_PATH. Der Dateiname wird beim Hochladen durch eine UUID '
  'ersetzt — ein vom Benutzer gewählter Name darf nie in einen Pfad geraten.';

-- Das Feld foto_pfade in "schaeden" wird durch diese Tabelle abgelöst.
-- Es bleibt vorerst stehen (leer), damit die Migration nichts zerstört;
-- entfernt wird es, sobald die Oberfläche vollständig umgestellt ist.
COMMENT ON COLUMN schaeden.foto_pfade IS
  'VERALTET — abgelöst durch die Tabelle "dateien" (Migration 007).';
