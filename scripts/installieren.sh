#!/usr/bin/env bash
#
# Erstinstallation des Geräte-Trackers auf dem Mini-PC.
#
#   git clone https://github.com/julasim/geraete-tracker.git
#   cd geraete-tracker
#   ./scripts/installieren.sh
#
# Was das Skript tut:
#   1. Prüft, ob Docker und Compose da sind
#   2. Legt die .env aus der Vorlage an (falls noch nicht vorhanden)
#   3. Erzeugt sichere Geheimnisse und setzt sie ein
#   4. Fragt die Domain ab
#   5. Baut und startet die drei Container
#   6. Wartet, bis alles gesund ist
#   7. Legt das erste Benutzerkonto an
#
# Läuft das Skript ein zweites Mal, erkennt es vorhandene Schritte und
# überspringt sie — es richtet nichts Kaputtes an.

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

# ── 1. Voraussetzungen ────────────────────────────────────────────────────
titel "Voraussetzungen prüfen"

if ! command -v docker &>/dev/null; then
  fehler "Docker ist nicht installiert."
  echo "  Anleitung: https://docs.docker.com/engine/install/"
  exit 1
fi
ok "Docker $(docker --version | sed 's/Docker version //' | cut -d, -f1)"

if ! docker compose version &>/dev/null; then
  fehler "Docker Compose (Plugin) fehlt."
  echo "  'docker compose' muss funktionieren — nicht das alte 'docker-compose'."
  exit 1
fi
ok "Docker Compose $(docker compose version --short)"

if ! docker info &>/dev/null 2>&1; then
  fehler "Der Docker-Dienst läuft nicht (oder keine Berechtigung)."
  echo "  Unter Linux: sudo systemctl start docker"
  exit 1
fi
ok "Docker-Dienst erreichbar"

# ── 2. .env anlegen ───────────────────────────────────────────────────────
titel "Konfiguration"

if [ -f .env ]; then
  hinweis ".env existiert bereits — wird nicht überschrieben."
else
  cp .env.example .env
  ok ".env aus Vorlage angelegt"

  # Geheimnisse erzeugen und einsetzen
  PG_PASS=$(openssl rand -base64 24 | tr -d '/+=')
  JWT=$(openssl rand -base64 48 | tr -d '/+=')

  # Plattformunabhängig ersetzen (sed -i verhält sich auf macOS/BSD anders)
  tmpfile=$(mktemp)
  sed "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG_PASS|" .env \
    | sed "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" \
    | sed "s|^NODE_ENV=.*|NODE_ENV=production|" \
    | sed "s|^COOKIE_SECURE=.*|COOKIE_SECURE=true|" \
    > "$tmpfile"
  mv "$tmpfile" .env

  ok "Sichere Geheimnisse erzeugt und eingesetzt"
fi

# Domain abfragen, falls noch der Platzhalterwert drinsteht
wert_aus_env() {
  sed -n "s/^$1=//p" .env | tail -1 | tr -d '\r' | sed 's/^"//; s/"$//'
}

DOMAIN_AKTUELL=$(wert_aus_env DOMAIN)
if [ "$DOMAIN_AKTUELL" = "tracker.local" ] || [ -z "$DOMAIN_AKTUELL" ]; then
  echo
  echo "Unter welcher Adresse soll die Anwendung erreichbar sein?"
  echo "  Beispiel Internet:  geraete.meinefirma.at"
  echo "  Beispiel Büronetz:  tracker.local"
  read -r -p "Domain: " NEUE_DOMAIN
  NEUE_DOMAIN="${NEUE_DOMAIN:-tracker.local}"

  tmpfile=$(mktemp)
  sed "s|^DOMAIN=.*|DOMAIN=$NEUE_DOMAIN|" .env > "$tmpfile"
  mv "$tmpfile" .env

  if [ "$NEUE_DOMAIN" = "tracker.local" ] || [[ "$NEUE_DOMAIN" != *.* ]]; then
    # Lokales Netz: internes TLS
    tmpfile=$(mktemp)
    sed "s|^TLS_MODUS=.*|TLS_MODUS=tls internal|" .env > "$tmpfile"
    mv "$tmpfile" .env
    hinweis "Büronetz-Modus: Caddy stellt ein eigenes Zertifikat aus."
    hinweis "Das Wurzelzertifikat muss auf jedes Gerät — siehe docs/BETRIEB.md."
  else
    # Öffentliche Domain: Let's Encrypt
    tmpfile=$(mktemp)
    sed "s|^TLS_MODUS=.*|TLS_MODUS=|" .env > "$tmpfile"
    mv "$tmpfile" .env

    ACME_AKTUELL=$(wert_aus_env ACME_EMAIL)
    if [ -z "$ACME_AKTUELL" ]; then
      read -r -p "E-Mail für Let's Encrypt (für Ablaufwarnungen): " ACME_MAIL
      if [ -n "$ACME_MAIL" ]; then
        tmpfile=$(mktemp)
        sed "s|^ACME_EMAIL=.*|ACME_EMAIL=$ACME_MAIL|" .env > "$tmpfile"
        mv "$tmpfile" .env
      fi
    fi
    ok "Internet-Modus: Let's Encrypt holt das Zertifikat automatisch."
    hinweis "Port 80 und 443 müssen am Router auf diesen Rechner zeigen."
  fi
  ok "Domain: $(wert_aus_env DOMAIN)"
fi

# Rechte einschränken
chmod 600 .env 2>/dev/null || true
ok ".env abgesichert"

# ── 3. Bauen und starten ──────────────────────────────────────────────────
titel "Container bauen und starten"

echo "Das dauert beim ersten Mal ein paar Minuten …"
docker compose up -d --build 2>&1 | tail -5
echo

# ── 4. Warten bis gesund ──────────────────────────────────────────────────
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
  fehler "Die Anwendung wurde nicht rechtzeitig gesund."
  echo "  Protokoll ansehen: docker compose logs app"
  exit 1
fi

# Alle drei Container prüfen
for DIENST in tracker-app tracker-postgres tracker-caddy; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$DIENST" 2>/dev/null || echo "fehlt")
  if [ "$STATUS" = "running" ]; then
    ok "$DIENST läuft"
  else
    fehler "$DIENST: $STATUS"
  fi
done

# ── 5. Erstes Benutzerkonto ──────────────────────────────────────────────
titel "Erstes Benutzerkonto"

KONTEN=$(docker compose exec -T postgres psql -U "$(wert_aus_env POSTGRES_USER || echo tracker)" \
  -d "$(wert_aus_env POSTGRES_DB || echo tracker)" -tAc "SELECT count(*) FROM benutzer;" 2>/dev/null || echo "0")
KONTEN=$(echo "$KONTEN" | tr -d '[:space:]')

if [ "$KONTEN" -gt 0 ] 2>/dev/null; then
  hinweis "Es gibt bereits $KONTEN Benutzerkonto(n) — Schritt übersprungen."
else
  echo "Das erste Konto muss hier auf der Kommandozeile angelegt werden."
  echo "Alle weiteren legt man danach in der Oberfläche an."
  echo
  docker compose exec app node dist/werkzeuge/benutzer-anlegen.js --rolle verwaltung
fi

# ── 6. Sicherungshinweis ─────────────────────────────────────────────────
titel "Geschafft!"

DOMAIN_FINAL=$(wert_aus_env DOMAIN)
echo
echo -e "  Die Anwendung läuft unter: ${FETT}https://$DOMAIN_FINAL${RESET}"
echo
echo "  Nächste Schritte:"
echo "    1. Im Browser öffnen und anmelden"
echo "    2. Sicherung einrichten (BETRIEB.md, Abschnitt 'Sicherung'):"
echo "       crontab -e"
echo "       0 2 * * * cd $(pwd) && ./scripts/sicherung.sh >> sicherung.log 2>&1"
echo "    3. Rauchtest: docker compose exec app node scripts/rauchtest.mjs <name> <passwort>"
echo
