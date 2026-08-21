-- Register aller Etikettennummern.
--
-- Bis hierher galt eine Nummer als vergeben, sobald ein GERÄT sie trug. Das
-- reicht nicht: Solange die Ersterfassung läuft, kleben draußen Etiketten,
-- die im System niemand kennt. Die Vergabe leitete die nächste Nummer aus
-- dem höchsten Wert IM SYSTEM ab — und traf damit womöglich eine Nummer,
-- die auf einer noch nicht erfassten Maschine klebt. Dann klebt sie zweimal.
--
-- Dieses Register hält jede Nummer fest, die dem System je begegnet ist:
--   vergeben    — ein Gerät trägt sie
--   reserviert  — auf Vorrat gedruckt, Gerät folgt noch
--   gesehen     — beim Scannen aufgetaucht, aber kein Gerät dazu (Altbestand)
--
-- Die Nummernvergabe fragt ab sofort dieses Register, nicht mehr die
-- Gerätetabelle. Damit kann keine Nummer zweimal ausgegeben werden.

CREATE TABLE IF NOT EXISTS etikettennummern (
  nummer      CITEXT PRIMARY KEY,
  zustand     TEXT NOT NULL DEFAULT 'vergeben'
              CHECK (zustand IN ('vergeben', 'reserviert', 'gesehen')),
  -- Nur bei 'vergeben' gesetzt. ON DELETE SET NULL statt CASCADE: Wird ein
  -- Gerät gelöscht, bleibt die Nummer verbraucht — das Etikett klebt ja
  -- weiterhin irgendwo, und sie darf nie an ein zweites Gerät gehen.
  geraet_id   UUID REFERENCES geraete(id) ON DELETE SET NULL,

  -- Zählt diese Nummer für die fortlaufende Vergabe mit?
  --
  -- Ein Gerät darf mehrere Etiketten tragen; ein Ersatzetikett bekommt
  -- gelegentlich eine Nummer aus einem ganz anderen Bereich. Zöge die den
  -- Höchstwert mit, spränge die Vergabe von 10113 auf 60090 und ließe
  -- 50.000 Nummern liegen. Solche Zusatzetiketten sind hier vermerkt,
  -- damit sie nie neu vergeben werden — für den laufenden Kreis zählen
  -- sie aber nicht.
  zaehlt_fuer_vergabe BOOLEAN NOT NULL DEFAULT TRUE,
  notiz       TEXT,
  erfasst_am  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  erfasst_von UUID REFERENCES benutzer(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS etikettennummern_zustand_idx
  ON etikettennummern (zustand);

-- Für die Vergabe: nur rein numerische Nummern zählen mit, und die größte
-- gewinnt. Ohne diesen Index würde jede Anlage die ganze Tabelle sortieren.
CREATE INDEX IF NOT EXISTS etikettennummern_zahl_idx
  ON etikettennummern (((nummer)::text))
  WHERE (nummer)::text ~ '^[0-9]+$' AND zaehlt_fuer_vergabe;

-- ── Bestand übernehmen ─────────────────────────────────────────────────────
-- Alles, was heute schon bekannt ist, kommt ins Register: die Inventarnummern
-- der Geräte und sämtliche Etiketten-Codes (ein Gerät darf mehrere tragen,
-- etwa nach einem Ersatzetikett).

INSERT INTO etikettennummern (nummer, zustand, geraet_id, notiz)
SELECT g.inventarnummer, 'vergeben', g.id, 'aus dem Bestand übernommen'
  FROM geraete g
 WHERE g.inventarnummer IS NOT NULL
ON CONFLICT (nummer) DO NOTHING;

-- Zusatzetiketten (der Code entspricht nicht der Inventarnummer des Geräts)
-- kommen mit zaehlt_fuer_vergabe = FALSE herein.
INSERT INTO etikettennummern (nummer, zustand, geraet_id, zaehlt_fuer_vergabe, notiz)
SELECT b.barcode, 'vergeben', b.geraet_id,
       (g.inventarnummer IS NOT DISTINCT FROM (b.barcode)::text),
       'Etikett aus dem Bestand übernommen'
  FROM geraete_barcodes b
  JOIN geraete g ON g.id = b.geraet_id
ON CONFLICT (nummer) DO NOTHING;
