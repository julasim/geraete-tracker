#!/usr/bin/env bash
#
# Sicherung: Datenbank und Fotos in einen Ordner auf dem Mini-PC.
#
#   ./scripts/sicherung.sh              nach ./sicherung/
#   ZIEL=/mnt/nas ./scripts/sicherung.sh
#
# Eine Sicherung, die auf derselben Platte liegt, hilft gegen Bedienfehler,
# nicht gegen einen Plattenschaden. Legen Sie ZIEL auf einen Netzwerkordner
# oder eine USB-Platte.
#
# Aufbewahrung: die letzten 14 Läufe, ältere werden entfernt.

set -euo pipefail

cd "$(dirname "$0")/.."

ZIEL="${ZIEL:-./sicherung}"
BEHALTEN="${BEHALTEN:-14}"
STEMPEL="$(date +%Y-%m-%d_%H%M)"

mkdir -p "$ZIEL"

# Zugangsdaten aus der .env — bewusst NICHT per "source": Dort dürfen Werte
# mit Leerzeichen ohne Anführungszeichen stehen (Compose verträgt das,
# FIRMENNAME=SIMA INFRA Construction GmbH etwa), und die Shell bricht dann mit
# "INFRA: command not found" ab. Beim Bau genau so passiert.
wert_aus_env() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -1 | sed 's/^"//; s/"$//'
}
DB_BENUTZER="$(wert_aus_env POSTGRES_USER)"; DB_BENUTZER="${DB_BENUTZER:-tracker}"
DB_NAME="$(wert_aus_env POSTGRES_DB)";      DB_NAME="${DB_NAME:-tracker}"

echo "Sicherung $STEMPEL nach $ZIEL"

# ── Datenbank ───────────────────────────────────────────────────────────────
# --clean --if-exists: Die Datei kann in eine bestehende Datenbank
# zurückgespielt werden, ohne dass man sie vorher leeren muss.
docker compose exec -T postgres \
  pg_dump -U "$DB_BENUTZER" -d "$DB_NAME" --clean --if-exists \
  | gzip > "$ZIEL/datenbank_$STEMPEL.sql.gz"
echo "  Datenbank: $(du -h "$ZIEL/datenbank_$STEMPEL.sql.gz" | cut -f1)"

# ── Fotos und Anhänge ───────────────────────────────────────────────────────
# Ohne die ist die Sicherung unvollständig: In der Datenbank stünden Verweise
# auf Dateien, die es nicht mehr gibt.
docker compose exec -T app tar -cf - -C /data . \
  | gzip > "$ZIEL/dateien_$STEMPEL.tar.gz"
echo "  Dateien:   $(du -h "$ZIEL/dateien_$STEMPEL.tar.gz" | cut -f1)"

# ── Alte Läufe entfernen ────────────────────────────────────────────────────
for muster in "datenbank_" "dateien_"; do
  # shellcheck disable=SC2012
  ls -1t "$ZIEL/$muster"* 2>/dev/null | tail -n "+$((BEHALTEN + 1))" | while read -r alt; do
    rm -f "$alt"
    echo "  entfernt (älter als $BEHALTEN Läufe): $(basename "$alt")"
  done
done

echo "Fertig. Zurückspielen: ./scripts/ruecksicherung.sh $STEMPEL"
