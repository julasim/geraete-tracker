-- 006 — Startdaten
--
-- Bewusst fast leer. Angelegt wird nur ein Lager-Standort, weil ohne
-- mindestens einen Ort keine einzige Rücknahme buchbar wäre.
--
-- AUSDRÜCKLICH NICHT angelegt:
--   * kein Benutzerkonto. Es gibt zu keinem Zeitpunkt ein "admin/admin",
--     das jemand erraten könnte. Das erste Konto entsteht auf dem Server
--     mit  npm run benutzer:anlegen.
--   * keine Schlagworte — Julius legt seine Einteilung selbst an.
--   * keine Prüfarten — welche im Betrieb anfallen, steht noch nicht fest.
--   * keine Lagerplätze — Regale werden erfasst, wenn sie etikettiert sind.

INSERT INTO standorte (name, typ, notiz)
SELECT 'Lager', 'lager', 'Automatisch angelegt bei der Einrichtung.'
WHERE NOT EXISTS (SELECT 1 FROM standorte WHERE typ = 'lager');
