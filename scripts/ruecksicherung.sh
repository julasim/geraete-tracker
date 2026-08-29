#!/usr/bin/env bash
#
# Eine Sicherung zurückspielen.
#
#   ./scripts/ruecksicherung.sh 2026-08-19_0930
#   ./scripts/ruecksicherung.sh                  (zeigt, was da ist)
#
# ACHTUNG: Der aktuelle Stand wird ERSETZT. Alles, was seit der Sicherung
# gebucht wurde, ist danach weg.
#
# Eine Sicherung, die nie zurückgespielt wurde, ist eine Vermutung. Spielen
# Sie sie einmal im Jahr probeweise ein — am besten auf einem zweiten Rechner.

set -euo pipefail

cd "$(dirname "$0")/.."

ZIEL="${ZIEL:-./sicherung}"
STEMPEL="${1:-}"

if [ -z "$STEMPEL" ]; then
  echo "Vorhandene Sicherungen in $ZIEL:"
  ls -1t "$ZIEL"/datenbank_*.sql.gz 2>/dev/null \
    | sed 's|.*/datenbank_||; s|\.sql\.gz$||' \
    | sed 's/^/  /' || echo "  (keine)"
  echo
  echo "Aufruf: $0 <stempel>"
  exit 1
fi

DB_DATEI="$ZIEL/datenbank_$STEMPEL.sql.gz"
DATEI_DATEI="$ZIEL/dateien_$STEMPEL.tar.gz"

[ -f "$DB_DATEI" ] || { echo "Nicht gefunden: $DB_DATEI"; exit 1; }

# Zugangsdaten aus der .env — bewusst NICHT per "source": Dort dürfen Werte
# mit Leerzeichen ohne Anführungszeichen stehen (Compose verträgt das,
# FIRMENNAME=SIMA INFRA Construction GmbH etwa), und die Shell bricht dann mit
# "INFRA: command not found" ab. Beim Bau genau so passiert.
wert_aus_env() {
  [ -f .env ] || return 0
  # tr -d '\r': Wurde die .env unter Windows bearbeitet, hängt an jedem Wert
  # ein Wagenrücklauf. pg_dump bekäme dann den Benutzer "tracker\r" und
  # antwortet mit `role "tracker" does not exist` — das \r ist in der Meldung
  # unsichtbar, und man sucht den Fehler stundenlang in der Datenbank statt in
  # den Zeilenenden. Beim Abnahmetest genau so passiert.
  sed -n "s/^$1=//p" .env | tail -1 | tr -d '\r' | sed 's/^"//; s/"$//'
}
DB_BENUTZER="$(wert_aus_env POSTGRES_USER)"; DB_BENUTZER="${DB_BENUTZER:-tracker}"
DB_NAME="$(wert_aus_env POSTGRES_DB)";      DB_NAME="${DB_NAME:-tracker}"

echo "Zurückgespielt wird der Stand von $STEMPEL."
echo "Der AKTUELLE Stand geht dabei verloren."
read -r -p "Wirklich? Dann 'ja' tippen: " antwort
[ "$antwort" = "ja" ] || { echo "Abgebrochen."; exit 1; }

# Die App anhalten: Läuft sie weiter, schreibt sie während des Einspielens
# in eine Datenbank, die gerade umgebaut wird.
echo "App anhalten …"
docker compose stop app > /dev/null

echo "Datenbank einspielen …"
gunzip -c "$DB_DATEI" | docker compose exec -T postgres psql -U "$DB_BENUTZER" -d "$DB_NAME" -q

if [ -f "$DATEI_DATEI" ]; then
  echo "Dateien einspielen …"
  # Der Container muss laufen, um hineinschreiben zu können — dafür kurz
  # ohne die Anwendung starten.
  docker compose run --rm --no-deps -T --user root --entrypoint sh app \
    -c 'rm -rf /data/* && tar -xzf - -C /data && chown -R node:node /data' < "$DATEI_DATEI"
else
  # Nicht stillschweigend uebergehen: Eine abgebrochene Sicherung kann die
  # Datenbank ohne die zugehoerigen Dateien hinterlassen. Wer das nicht
  # erfaehrt, haelt die Wiederherstellung fuer vollstaendig - dabei zeigt
  # jeder Fotoeintrag ins Leere. Bei der Abnahme lag genau so ein halber
  # Stand im Ordner.
  echo
  echo "  ACHTUNG: Zu diesem Stand gibt es KEINE Dateisicherung."
  echo "  ($DATEI_DATEI fehlt.)"
  echo "  Die Datenbank ist eingespielt, aber Fotos und Dokumente FEHLEN."
  echo "  Liegt ein vollstaendigerer Stand vor, diesen verwenden:"
  echo "    ./scripts/ruecksicherung.sh"
  echo
fi

echo "App wieder starten …"
docker compose start app > /dev/null

echo
echo "Fertig. Bitte kurz prüfen:"
echo "  docker compose exec app node scripts/rauchtest.mjs <name> <passwort>"
