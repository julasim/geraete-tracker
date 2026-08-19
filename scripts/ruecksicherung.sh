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

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi
DB_BENUTZER="${POSTGRES_USER:-tracker}"
DB_NAME="${POSTGRES_DB:-tracker}"

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
fi

echo "App wieder starten …"
docker compose start app > /dev/null

echo
echo "Fertig. Bitte kurz prüfen:"
echo "  docker compose exec app node scripts/rauchtest.mjs <name> <passwort>"
