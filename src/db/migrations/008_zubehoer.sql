-- 008 — Zubehör
--
-- "Minibagger + 3 Löffel + Anhänger". Bei Baumaschinen fehlt sonst
-- regelmäßig ein Teil, und niemand weiß, wo es geblieben ist.
--
-- Umgesetzt als Selbstbezug, nicht als eigene Set-Tabelle: Jedes Zubehör
-- IST ein Gerät mit eigenem Etikett und eigener Historie. Ein Löffel kann
-- damit auch einzeln irgendwo liegen, und man sieht es.
--
-- Bewusst nur EINE Ebene tief: Zubehör von Zubehör wäre ein Baum, den
-- niemand pflegt und der beim Ausgeben nur Rückfragen erzeugt.

ALTER TABLE geraete
  ADD COLUMN IF NOT EXISTS gehoert_zu_id UUID REFERENCES geraete(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS geraete_gehoert_zu ON geraete (gehoert_zu_id);

COMMENT ON COLUMN geraete.gehoert_zu_id IS
  'Zubehör eines anderen Geräts. Nur eine Ebene tief — siehe Migration 008.';

-- Ein Gerät kann nicht sein eigenes Zubehör sein.
DO $$ BEGIN
  ALTER TABLE geraete ADD CONSTRAINT geraete_nicht_eigenes_zubehoer
    CHECK (gehoert_zu_id IS NULL OR gehoert_zu_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Betriebsstunden: bei Maschinen mit Motor die ehrlichere Größe für die
-- Wartung als ein Datum. Wird beim Zurücknehmen abgelesen und eingetragen.
ALTER TABLE geraete
  ADD COLUMN IF NOT EXISTS betriebsstunden NUMERIC(10,1);

ALTER TABLE buchungen
  ADD COLUMN IF NOT EXISTS betriebsstunden NUMERIC(10,1);

COMMENT ON COLUMN buchungen.betriebsstunden IS
  'Zählerstand bei dieser Buchung. Die Differenz zwischen Ausgabe und '
  'Rücknahme ergibt, wie lange das Gerät auf der Baustelle wirklich lief.';
