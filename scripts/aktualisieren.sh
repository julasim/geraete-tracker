#!/usr/bin/env bash
#
# Neue Fassung vom GitHub-Repo einspielen.
#
#   ./scripts/aktualisieren.sh
#
# Was das Skript tut:
#   1. Prüft, ob es lokale Änderungen gibt (bricht ab, falls ja)
#   2. Sichert Datenbank und Fotos
#   3. Merkt sich die aktuelle Fassung
#   4. Holt die neue Fassung von GitHub
#   5. Baut das App-Image neu
#   6. Startet die Anwendung mit dem neuen Image
#   7. Wartet, bis sie gesund ist
#   8. Zeigt die Änderungen seit der letzten Fassung
#
# Falls etwas schiefgeht, zeigt es den Befehl zum Zurückrollen.

set -euo pipefail

cd "$(dirname "$0")/.."

# ── Farben (nur wenn Terminal) ─────────────────────────────────────────────
if [ -t 1 ]; then
  GRUEN='\033[0;32m' ROT='\033[0;31m' GELB='\033[0;33m' FETT='\033[1m' RESET='\033[0m'
else
  GRUEN='' ROT='' GELB='' FETT='' RESET=''
fi

ok()    { echo -e "${GRUEN}✓${RESET} $1"; }
fehler(){ echo -e "${ROT}✗ $1${RESET}" >&2; }
hinweis(){ echo -e "${GELB}→ $1${RESET}"; }
titel() { echo -e "\n${FETT}$1${RESET}"; }

# ── 1. Sauberer Ausgangszustand ──────────────────────────────────────────
titel "Ausgangszustand prüfen"

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  fehler "Kein Git-Repo — wurde das Projekt ohne 'git clone' kopiert?"
  echo "  Ohne Git sind keine Updates möglich."
  exit 1
fi
ok "Git-Repo erkannt"

# Lokale Änderungen würde git pull nicht zusammenführen können.
if ! git diff --quiet HEAD 2>/dev/null; then
  fehler "Es gibt lokale Änderungen, die nicht committet sind."
  echo "  'git status' zeigt, was sich geändert hat."
  echo "  Entweder committen (git add . && git commit -m '...') oder"
  echo "  verwerfen (git checkout .)."
  exit 1
fi
ok "Keine lokalen Änderungen"

ALTER_STAND=$(git rev-parse --short HEAD)
ok "Aktuelle Fassung: $ALTER_STAND"

# Prüfen, ob es überhaupt etwas Neues gibt
git fetch origin --quiet 2>/dev/null
VORSPRUNG=$(git rev-list HEAD..origin/master --count 2>/dev/null || echo "0")

if [ "$VORSPRUNG" = "0" ]; then
  ok "Bereits auf dem neuesten Stand — nichts zu tun."
  exit 0
fi

hinweis "$VORSPRUNG neue Commit(s) verfügbar"
echo
git log --oneline HEAD..origin/master | head -10
echo

# ── 2. Sichern ───────────────────────────────────────────────────────────
titel "Sicherung vor dem Update"

if [ -f ./scripts/sicherung.sh ]; then
  ./scripts/sicherung.sh
  ok "Sicherung abgeschlossen"
else
  hinweis "Kein Sicherungsskript gefunden — übersprungen."
  hinweis "Bei Problemen gibt es keinen Stand zum Zurückspielen!"
fi

# ── 3. Neue Fassung holen ────────────────────────────────────────────────
titel "Neue Fassung holen"

git pull origin master --ff-only 2>&1
NEUER_STAND=$(git rev-parse --short HEAD)
ok "Aktualisiert: $ALTER_STAND → $NEUER_STAND"

# ── 4. Neu bauen und starten ─────────────────────────────────────────────
titel "Container neu bauen"

echo "Das dauert ein bis zwei Minuten …"
docker compose up -d --build 2>&1 | tail -5

# ── 5. Warten bis gesund ─────────────────────────────────────────────────
titel "Warte auf Bereitschaft"

VERSUCHE=0
MAX=30
while [ $VERSUCHE -lt $MAX ]; do
  ZUSTAND=$(docker inspect --format='{{.State.Health.Status}}' tracker-app 2>/dev/null || echo "starting")
  if [ "$ZUSTAND" = "healthy" ]; then
    ok "Anwendung ist bereit"
    break
  fi
  VERSUCHE=$((VERSUCHE + 1))
  printf "\r  Warte … (%d/%d)" "$VERSUCHE" "$MAX"
  sleep 2
done
echo

if [ "$ZUSTAND" != "healthy" ]; then
  fehler "Die Anwendung wurde nach dem Update nicht gesund."
  echo
  echo "  Protokoll ansehen:"
  echo "    docker compose logs --since 2m app"
  echo
  echo "  Zurückrollen auf den Stand davor:"
  echo "    git checkout $ALTER_STAND"
  echo "    docker compose up -d --build"
  echo
  echo "  Sicherung zurückspielen:"
  echo "    ./scripts/ruecksicherung.sh"
  exit 1
fi

# ── 6. Zusammenfassung ───────────────────────────────────────────────────
titel "Update abgeschlossen"

echo
echo "  Fassung:  $ALTER_STAND → $NEUER_STAND"
echo "  Änderungen:"
git log --oneline "$ALTER_STAND".."$NEUER_STAND" | sed 's/^/    /'
echo
echo "  Datenbankänderungen sind beim Start automatisch gelaufen."
echo "  Bei Problemen: ./scripts/ruecksicherung.sh"
echo
