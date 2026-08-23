# Betrieb auf dem Mini-PC

Der Geräte-Tracker läuft als drei Docker-Container: der Eingang (Caddy), die
Anwendung und ihre Datenbank. Weboberfläche, API und Etikettendruck stecken
alle in der Anwendung.

```
          Handy · iPad (HTTPS, Port 443)
                    │
            ┌───────▼────────┐
            │  tracker-caddy │  einziger Eingang, holt das Zertifikat selbst
            └───────┬────────┘  80 leitet auf 443 um
                    │  internes Docker-Netz
            ┌───────▼────────┐
            │  tracker-app   │  Anwendung + Oberfläche, Port 3000
            └───────┬────────┘  läuft als "node" (uid 1000), nicht als root
                    │           horcht nur auf 127.0.0.1
            ┌───────▼────────┐
            │tracker-postgres│  KEIN Port nach außen
            └────────────────┘
```

Nur Caddy ist von außen erreichbar. Die Anwendung selbst horcht auf
`127.0.0.1` — für Fehlersuche und die Prüfläufe auf dem Mini-PC.

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

In der `.env` **müssen** drei Dinge stimmen: die beiden Geheimnisse (sie
dürfen nirgends sonst auftauchen) und die Adresse, unter der die Anwendung
erreichbar sein soll (`DOMAIN`, siehe „Erreichbar machen").

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
# caddy      Up
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

Beide Wege liefern echtes HTTPS. Das ist keine Kür: Ohne gültiges Zertifikat
gibt der Browser die **Kamera nicht frei**, und der Barcode-Scanner ist tot.

### A — Aus dem Internet (Baustelle, unterwegs)

Der übliche Fall: Die Leute stehen auf der Baustelle, nicht im Büro-WLAN.

**1. Domain und DNS.** Eine Subdomain auf die Internet-Adresse des Anschlusses
zeigen lassen, etwa `geraete.meinefirma.at`. Wechselt die Adresse regelmäßig
(bei den meisten Anschlüssen der Fall), einen DynDNS-Dienst dazwischenschalten
— viele Router bringen einen mit.

**2. Portfreigabe am Router.** Port **443** und **80** auf den Mini-PC.
Port 80 wird nur gebraucht, damit Let's Encrypt das Zertifikat ausstellen kann;
Caddy leitet dort alles auf HTTPS um.

**3. `.env` ausfüllen:**

```bash
DOMAIN=geraete.meinefirma.at
ACME_EMAIL=julius@sima.or.at
TLS_MODUS=
COOKIE_SECURE=true
```

`TLS_MODUS` bleibt **leer** — das ist das Zeichen für „echtes Zertifikat holen".

**4. Starten.** Beim ersten Aufruf holt Caddy das Zertifikat, das dauert ein
paar Sekunden:

```bash
docker compose up -d --build
docker compose logs -f caddy      # "certificate obtained successfully"
```

Danach läuft die Anwendung unter `https://geraete.meinefirma.at` in jedem
Browser, ohne Warnung und ohne Zusatz-App auf den Handys.

> **Was Sie sich damit einhandeln:** Der Mini-PC ist aus dem Internet
> erreichbar. Die Anwendung ist darauf ausgelegt — Standard ist gesperrt,
> argon2id mit nachgemessenen 58 ms je Versuch, Bremse ab dem dritten
> Fehlversuch, Kontosperre nach zehn. Trotzdem gilt: Halten Sie die Fassung
> aktuell, und vergeben Sie keine schwachen Passwörter. Wer das Restrisiko
> nicht will, nimmt Weg B und ein VPN.

### B — Nur im Büro-Netz

Ohne Portfreigabe, ohne Internet, ohne Domain. Dafür ist die Anwendung
außerhalb des Firmen-WLANs nicht erreichbar.

**1. `.env`:**

```bash
DOMAIN=tracker.local
TLS_MODUS=tls internal
COOKIE_SECURE=true
```

**2. Namen auflösbar machen.** Entweder einen Eintrag im Router
(`tracker.local` → IP des Mini-PCs) oder in der Hosts-Datei jedes Geräts.

**3. Das Wurzelzertifikat auf jedes Gerät.** Caddy stellt sein eigenes
Zertifikat aus. Damit iPad und Handy es ohne Warnung akzeptieren — und die
Kamera freigeben — muss Caddys Wurzelzertifikat einmalig installiert werden:

```bash
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > tracker-wurzel.crt
```

Diese Datei (rund 600 Byte, zehn Jahre gültig) auf die Geräte bringen, etwa
per Mail oder USB-Stick:

- **iPhone / iPad:** Datei öffnen → Profil installieren → dann
  **Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen**
  und dort den Schalter für „Caddy Local Authority" umlegen. *Dieser zweite
  Schritt wird gern vergessen — ohne ihn bleibt die Kamera gesperrt.*
- **Android:** Einstellungen → Sicherheit → Verschlüsselung → Zertifikat
  installieren → CA-Zertifikat.
- **Windows:** Doppelklick → Installieren → Lokaler Computer →
  Vertrauenswürdige Stammzertifizierungsstellen.

Danach zeigt der Browser `https://tracker.local` ohne Warnung, und der
Scanner funktioniert.

### Was nicht geht

**Ohne HTTPS.** Über `http://<ip>:3000` läuft die Anwendung zwar, aber der
Browser gibt die Kamera nicht frei — es bleibt die Handeingabe. Außerdem
gingen die Anmeldedaten im Klartext durchs Netz. Für zehn Minuten Fehlersuche
in Ordnung, als Dauerlösung nicht.

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

**Diesen Eintrag wirklich anlegen.** Die Skripte allein sichern nichts —
ohne cron läuft nie eine Sicherung, und das fällt erst auf, wenn eine
gebraucht wird.

### Sie sehen in der App, ob es geklappt hat

Jeder Lauf hinterlässt seinen Ausgang in `daten/sicherung-stand.json`. Die
Anwendung liest die Datei und zeigt das Ergebnis unter **Mehr → Verwaltung →
Datensicherung**:

| Anzeige | Bedeutung |
|---|---|
| „Heute gesichert" (grün) | Alles in Ordnung |
| „Vor 3 Tagen gesichert" (rot) | Der cron-Lauf kommt nicht durch |
| „Zuletzt fehlgeschlagen" (rot) | Der Lauf ist abgebrochen — `sicherung.log` ansehen |
| „Noch nie gesichert" (rot) | Es gibt keinen cron-Eintrag |

Das ersetzt die Mail, die diese Anwendung bewusst nicht verschickt: Wer die
App öffnet, sieht es. Sichtbar ist es nur mit dem Recht
`benutzer.verwalten` — einen Mitarbeiter auf der Baustelle geht der Zustand
der Anlage nichts an.

> **Warum eine Datei und kein Eintrag in der Datenbank:** Die Sicherung muss
> auch dann noch melden können, wenn genau die Datenbank das Problem ist.

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
| Zertifikate | Docker-Volume `geraete-tracker_caddy_daten` |
| Geheimnisse | `.env` im Projektordner (`chmod 600`) |
| Sicherungen | `./sicherung/` oder `$ZIEL` |

`docker compose down` hält nur an — die Volumes bleiben.
**`docker compose down -v` löscht sie.** Das ist der einzige Befehl in dieser
Anleitung, der Daten vernichtet.
