# Geräte-Tracker

Baustellengeräte per Barcode verfolgen: scannen, ausgeben, zurücknehmen — mit
lückenloser Historie, wer ein Gerät wann auf welche Baustelle gebracht hat.
Für Handy und iPad, ~200 Geräte, ~5–10 Benutzer.

Die Etiketten sind vorhandene **Code-128**-Aufkleber, fünfstellig ab `10001`.
Ohne Kamera geht es genauso: Nummer eintippen.

---

## Voraussetzungen

- **Node 24** (`node --version`)
- **PostgreSQL 16** — in der Entwicklung als Docker-Container

---

## Installation

```bash
npm ci
```

Das installiert Server **und** Oberfläche (das Frontend hängt als
`postinstall` daran — ohne das bricht der Bau mit „vue-tsc nicht gefunden" ab).

Datenbank starten (Entwicklung, Port 5433 — 5432 ist belegt):

```bash
docker run -d --name tracker-db -e POSTGRES_USER=tracker -e POSTGRES_PASSWORD=tracker -e POSTGRES_DB=tracker -p 5433:5432 postgres:16
```

Konfiguration anlegen:

```bash
cp .env.example .env
```

Darin **mindestens** `JWT_SECRET` ersetzen (32 Zeichen aufwärts, sonst bricht
der Start in Produktion ab — in der Entwicklung genügt der Platzhalter):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Bauen, Schema anlegen, erstes Konto:

```bash
npm run build
npm run db:migrate
npm run benutzer:anlegen -- --name julius --rolle verwaltung
```

Das Passwort wird abgefragt, nicht als Argument übergeben — Argumente landen in
der Shell-Historie und in der Prozessliste.

Starten:

```bash
npm start
```

Die Oberfläche liegt unter **http://localhost:3000** — derselbe Prozess liefert
API und Web-Anwendung aus.

---

## Prüfen, dass alles läuft

```bash
npm test
```

323 Tests. Zusätzlich sechs Durchläufe **gegen die laufende Anwendung** — die
Testsuite läuft im selben Prozess und würde nicht merken, wenn der gebaute
Server gar nicht startet:

```bash
node scripts/rauchtest.mjs <name> <passwort>            # Anmeldung und Absicherung
node scripts/durchlauf.mjs <name> <passwort>            # Büro: anlegen, etikettieren
node scripts/durchlauf-buchen.mjs <name> <passwort>     # Baustelle: scannen, buchen
node scripts/durchlauf-pflege.mjs <name> <passwort>     # Fotos, Prüfungen, Schäden
node scripts/durchlauf-erfassung.mjs <name> <passwort>  # Export, Excel-Runde, Import
node scripts/durchlauf-benutzer.mjs <name> <passwort>   # Konten, Rollen, Sperren
```

Und die Datenbank selbst:

```bash
npm run pruefe:schema    # 19 Schutzregeln am laufenden Schema
```

Zum Ansehen mit Inhalt: `node scripts/beispieldaten.mjs <name> <passwort>`
legt 12 Geräte, 4 Orte, 4 Regale und ein paar Buchungen an.

---

## Entwicklung an der Oberfläche

```bash
npm run dev:web     # Port 5174, leitet /api an 3000 weiter
```

Der Umweg über den Vite-Proxy ist nötig: `SameSite=Strict` würde das
Sitzungs-Cookie sonst blockieren.

---

## Wer darf was

Drei mitgelieferte Rollen — **Mitarbeiter**, **Lager und Werkstatt**,
**Verwaltung** — und ein Baukasten aus 13 Rechten für eigene Rollen.
Lesen ist kein Recht: Wer angemeldet ist, sieht den ganzen Bestand.

Alles Weitere in [`docs/BEDIENUNG.md`](docs/BEDIENUNG.md).

---

## Stolpersteine

**WSL fährt bei Untätigkeit herunter** und nimmt das Port-Forwarding mit. Dann
`wsl -d Ubuntu-24.04 -- docker start tracker-db`.

**Die Kamera braucht HTTPS.** `getUserMedia()` gibt sie nur im *secure context*
frei; ein selbstsigniertes Zertifikat reicht nicht, Safari verweigert dann. Über
`http://localhost` funktioniert sie, über `http://<IP>` nicht.

**Der Drucker verkleinert Etiketten.** Browser drucken standardmäßig „an Seite
anpassen" und schrumpfen den Barcode um 3–5 %. Vorher den Testbogen ausprobieren.

---

## Aufbau

```
src/          Server: api/ (Routen), data/ (Datenbankzugriff),
              domain/ (Fachlogik, ohne Datenbank), db/migrations/
web/          Vue-3-Oberfläche (mobile-first, Navigation unten)
scripts/      Migrationen, Kontoanlage, Durchläufe, Schemaprüfung
tests/        323 Tests (Vitest)
docs/         PLAN.md, BEDIENUNG.md, scanner-abnahme.md
```

Technisch: Node 24 · TypeScript ESM strict · Hono 4 · PostgreSQL 16 über
postgres.js (kein ORM) · Vue 3.5 + Vite + Pinia · Vitest.

Für die Arbeit am Code: [`CLAUDE.md`](CLAUDE.md) — dort stehen die
Entscheidungen und warum sie so getroffen wurden.
