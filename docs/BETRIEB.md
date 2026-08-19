# Betrieb auf dem Mini-PC

Der Geräte-Tracker läuft als zwei Docker-Container: die Anwendung und ihre
Datenbank. Alles Weitere — Weboberfläche, API, Etikettendruck — steckt in der
Anwendung; es braucht keinen zusätzlichen Webserver.

```
      Internet (Cloudflare Tunnel, HTTPS)
                    │
            ┌───────▼────────┐
            │  tracker-app   │  Anwendung + Oberfläche, Port 3000
            └───────┬────────┘  läuft als "node" (uid 1000), nicht als root
                    │  internes Docker-Netz
            ┌───────▼────────┐
            │tracker-postgres│  KEIN Port nach außen
            └────────────────┘
```

Ohne Tunnel ist die Anwendung nur auf dem Mini-PC selbst erreichbar
(`127.0.0.1:3000`) — bewusst, siehe „Nur im Büro-Netz" weiter unten.

---

## Voraussetzungen

- Ein Rechner, der durchläuft (Mini-PC, NUC, kleiner Server)
- **Docker** mit Compose-Plugin (Docker Desktop unter Windows genügt)
- **Git**

Sparsam: Im Leerlauf braucht der Stapel etwa 300 MB Arbeitsspeicher und
kaum Rechenzeit. 4 GB RAM reichen mit Reserve.

---

## Einrichten

```bash
git clone <repo-adresse> geraete-tracker
cd geraete-tracker
cp .env.example .env
```

In der `.env` **müssen** zwei Werte gesetzt werden — beide sind Geheimnisse
und dürfen nirgends sonst auftauchen:

```bash
# Beide Zeilen erzeugen einen Wert, den man einfach hineinkopiert:
openssl rand -base64 24 | tr -d '/+='     # → POSTGRES_PASSWORD
openssl rand -base64 48 | tr -d '/+='     # → JWT_SECRET
```

`JWT_SECRET` unter 32 Zeichen lässt die Anwendung gar nicht erst starten —
mit einer kurzen Fassung wären fremde Sitzungs-Cookies fälschbar.

Danach die Datei absichern, sie enthält Klartext-Geheimnisse:

```bash
chmod 600 .env
```

Starten:

```bash
docker compose up -d --build
```

Der erste Bau dauert ein paar Minuten. Danach:

```bash
docker compose ps
# app        Up (healthy)
# postgres   Up (healthy)
```

Die Datenbank wird beim ersten Start **von selbst** angelegt — alle
Migrationen laufen automatisch. Es gibt bewusst **kein Standardkonto**:

```bash
docker compose exec app node dist/werkzeuge/benutzer-anlegen.js \
  --name julius --rolle verwaltung
```

Das Passwort wird abgefragt, nicht als Argument übergeben — Argumente landen
sonst in der Shell-Historie und in der Prozessliste. Alle weiteren Konten legt
man danach in der Oberfläche an, siehe [`BEDIENUNG.md`](BEDIENUNG.md).

Prüfen, dass wirklich alles läuft:

```bash
docker compose exec app node scripts/rauchtest.mjs julius <passwort>
docker compose exec app node dist/werkzeuge/pruefe-schema.js
```

---

## Erreichbar machen

### Aus dem Internet: Cloudflare Tunnel

Keine Portfreigabe am Router, keine feste IP-Adresse nötig — der Tunnel baut
die Verbindung von innen nach außen auf.

1. Im Cloudflare-Zero-Trust-Dashboard einen Tunnel anlegen und das **Token**
   kopieren.
2. Als Ziel (**Public Hostname**) die Domain eintragen, dahinter den Dienst
   `http://app:3000` — der Dienstname aus dem Compose, **nicht** `localhost`:
   Aus Sicht des Tunnel-Containers wäre `localhost` er selbst.
3. Token in die `.env`: `CLOUDFLARE_TUNNEL_TOKEN=…`
4. Starten:

```bash
docker compose --profile tunnel up -d
```

**`COOKIE_SECURE=true` muss dann gesetzt sein** (Vorgabe). Cloudflare liefert
echtes HTTPS — und das ist nicht nur eine Frage der Verschlüsselung: Ohne
gültiges Zertifikat gibt der Browser die **Kamera nicht frei**, und der
Scanner ist tot. Ein selbstsigniertes Zertifikat reicht dafür nicht.

### Nur im Büro-Netz

Ohne Tunnel horcht die Anwendung nur auf `127.0.0.1`. Wer sie im WLAN
erreichen will, ändert im `docker-compose.yml`:

```yaml
    ports:
      - "3000:3000"        # statt "127.0.0.1:3000:3000"
```

Dann steht sie unter `http://<mini-pc-ip>:3000` — **unverschlüsselt**. Damit
funktioniert die Kamera nicht (kein *secure context*), Anmeldedaten gehen
im Klartext durchs Netz, und `COOKIE_SECURE` muss auf `false`. Für ein paar
Minuten Fehlersuche in Ordnung, als Dauerlösung nicht.

---

## Sicherung

**Von Hand:**

```bash
./scripts/sicherung.sh
```

Legt zwei Dateien in `./sicherung/`: die Datenbank und die Fotos. Beides
zusammen — in der Datenbank stehen nur Verweise auf die Dateien; ohne sie
wäre die Sicherung unvollständig.

**Auf eine andere Platte** (dringend empfohlen — eine Sicherung neben den
Daten hilft gegen Bedienfehler, nicht gegen einen Plattenschaden):

```bash
ZIEL=/mnt/nas/tracker ./scripts/sicherung.sh
```

**Täglich um 2 Uhr** (auf einem Linux-Mini-PC):

```bash
crontab -e
# eine Zeile:
0 2 * * * cd /home/<benutzer>/geraete-tracker && ZIEL=/mnt/nas/tracker ./scripts/sicherung.sh >> sicherung.log 2>&1
```

Unter Windows dasselbe über die Aufgabenplanung.

Aufgehoben werden die letzten 14 Läufe (`BEHALTEN=30` für mehr).

**Zurückspielen:**

```bash
./scripts/ruecksicherung.sh              # zeigt, was da ist
./scripts/ruecksicherung.sh 2026-08-19_0200
```

Das Skript hält die Anwendung an, spielt Datenbank und Dateien ein und startet
sie wieder. Es fragt einmal nach, weil der aktuelle Stand dabei verloren geht.

> **Einmal echt durchgespielt** (2026-08-19): Nach `docker compose down -v`,
> also vollständigem Verlust beider Volumes, waren nach dem Rückspielen 28
> Geräte, 4 Buchungen, 2 Konten und die Fotos wieder da, und die Anmeldung
> funktionierte. Eine Sicherung, die man nie zurückgespielt hat, ist eine
> Vermutung — probieren Sie es einmal im Jahr selbst aus.

---

## Neue Fassung einspielen

```bash
cd geraete-tracker
./scripts/sicherung.sh          # erst sichern
git pull
docker compose up -d --build
```

Datenbankänderungen laufen beim Start von selbst; Daten und Fotos bleiben in
ihren Volumes und werden vom Neubau nicht angefasst (geprüft). Rechnen Sie mit
ein bis zwei Minuten, in denen die Anwendung nicht erreichbar ist.

---

## Nachsehen, wenn etwas klemmt

```bash
docker compose ps                       # läuft alles? (healthy?)
docker compose logs -f app              # Protokoll der Anwendung
docker compose logs --since 5m app      # nur die letzten Minuten
docker stats --no-stream                # Speicher und Last
docker compose restart app              # Anwendung neu starten
```

**Erst Protokoll, dann raten.** Die Anwendung schreibt jeden Fehler mit
Zeitstempel; Geheimnisse werden dabei herausgefiltert.

### Häufiges

**`.env` geändert, nichts passiert.** `docker compose restart` liest sie
**nicht** neu ein. Richtig:

```bash
docker compose up -d --force-recreate app
```

**App startet nicht, Protokoll zeigt `JWT_SECRET ist nur … Zeichen lang`.**
Genau so gedacht: In Produktion verweigert die Anwendung den Start mit einem
schwachen Geheimnis, statt eine unsichere Anmeldung anzubieten.

**Anmeldung schlägt fehl, obwohl das Passwort stimmt.** Nach zehn
Fehlversuchen sperrt sich ein Konto für 15 Minuten — auch für das richtige
Passwort. Warten oder in der Datenbank entsperren:

```bash
docker compose exec postgres psql -U tracker -d tracker \
  -c "UPDATE benutzer SET fehlversuche = 0, gesperrt_bis = NULL WHERE benutzername = 'julius';"
```

**Kein Zugriff auf die Benutzerverwaltung mehr.** Sollte nicht passieren — die
Anwendung verhindert es an zwei Stellen. Falls doch, hilft die Kommandozeile:

```bash
docker compose exec app node dist/werkzeuge/benutzer-anlegen.js --name notfall --rolle verwaltung
```

**Fotos lassen sich nicht hochladen (`EACCES`).** Der Ordner im Container
gehört `node` (uid 1000). Das ist nur ein Thema, wenn jemand statt des
Volumes ein Verzeichnis vom Host einhängt — dann auf dem Host:

```bash
sudo chown -R 1000:1000 /pfad/zum/ordner
```

---

## Was wo liegt

| | |
|---|---|
| Datenbank | Docker-Volume `geraete-tracker_datenbank` |
| Fotos und PDFs | Docker-Volume `geraete-tracker_fotos` |
| Geheimnisse | `.env` im Projektordner (`chmod 600`) |
| Sicherungen | `./sicherung/` oder `$ZIEL` |

`docker compose down` hält nur an — die Volumes bleiben.
**`docker compose down -v` löscht sie.** Das ist der einzige Befehl in dieser
Anleitung, der Daten vernichtet.
