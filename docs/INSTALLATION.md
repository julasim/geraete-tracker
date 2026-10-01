# Installation von Null

Alles, was nötig ist, um den Geräte-Tracker auf einem Mini-PC zum Laufen zu
bringen — vom leeren Rechner bis zum ersten Anmelden am Handy.

> **Kurzfassung** für Ungeduldige:
>
> ```bash
> git clone https://github.com/julasim/geraete-tracker.git
> cd geraete-tracker
> ./scripts/installieren.sh
> ```
>
> Das Skript fragt alles ab und richtet alles ein. Der Rest dieser Anleitung
> erklärt, was es tut und warum.

---

## 1. Was Sie brauchen

| Was | Warum | Mindestens |
|---|---|---|
| **Einen Rechner, der durchläuft** (Mini-PC, NUC, kleiner Server) | Die Anwendung muss erreichbar sein, wenn jemand auf der Baustelle scannt | 4 GB RAM, 20 GB Platte |
| **Docker** mit Compose-Plugin | Die drei Container (Eingang, Anwendung, Datenbank) brauchen nichts anderes | Docker 24+ |
| **Git** | Zum Herunterladen und für spätere Aktualisierungen | |
| **Eine Domain** (falls aus dem Internet erreichbar) | Caddy holt damit automatisch ein Zertifikat von Let's Encrypt | z. B. `geraete.meinefirma.at` |

> **Docker unter Linux installieren:**
> ```bash
> curl -fsSL https://get.docker.com | sh
> sudo usermod -aG docker $USER
> # Abmelden und wieder anmelden, damit die Gruppe greift
> ```
>
> Unter Windows genügt **Docker Desktop**.

---

## 2. Herunterladen

```bash
git clone https://github.com/julasim/geraete-tracker.git
cd geraete-tracker
```

Ab hier passiert alles in diesem Ordner.

---

## 3. Konfiguration (`.env`)

Die `.env` ist die einzige Datei, die Sie anfassen müssen. Das
Installationsskript legt sie an und füllt die Geheimnisse — von Hand geht
es so:

```bash
cp .env.example .env
```

### Was drinsteht und was Sie ändern müssen

| Variable | Was sie tut | Muss ich etwas tun? |
|---|---|---|
| **`POSTGRES_PASSWORD`** | Datenbankpasswort | **Ja.** Sicheren Wert einsetzen: `openssl rand -base64 24 \| tr -d '/+='` |
| **`JWT_SECRET`** | Unterschrift der Sitzungs-Cookies | **Ja.** Mindestens 32 Zeichen, besser 48: `openssl rand -base64 48 \| tr -d '/+='`. Ist er zu kurz, bricht der Start ab |
| **`DOMAIN`** | Adresse, unter der die App erreichbar ist | **Ja.** z. B. `geraete.meinefirma.at` oder `tracker.local` |
| **`TLS_MODUS`** | Wie das Zertifikat entsteht | **Ja**, je nach Weg (siehe unten). Leer = Let's Encrypt, `tls internal` = Caddy stellt selbst aus |
| **`ACME_EMAIL`** | E-Mail für Let's Encrypt | Nur bei Weg A (Internet). Dorthin kommen Ablaufwarnungen |
| `POSTGRES_USER` | Datenbankbenutzer | Vorgabe `tracker` passt |
| `POSTGRES_DB` | Datenbankname | Vorgabe `tracker` passt |
| `COOKIE_SECURE` | Cookie nur über HTTPS | Vorgabe `true` passt. Nur in der Entwicklung `false` |
| `SESSION_TAGE` | Wie lange man angemeldet bleibt | Vorgabe `30` passt |
| `PASSWORT_MIN_LAENGE` | Kürzestes erlaubtes Passwort | Vorgabe `12` passt |
| `LEAK_PRUEFUNG` | Abgleich gegen bekannte geleakte Passwörter | Vorgabe `true`. Braucht Internet; `false` falls der Mini-PC keinen Zugang hat |
| `SPERRE_NACH_VERSUCHEN` | Fehlversuche bis zur Kontosperre | Vorgabe `10` passt |
| `SPERRE_MINUTEN` | Sperrdauer | Vorgabe `15` passt |
| `FIRMENNAME` | Steht auf jedem gedruckten Etikett | Optional. Leer = keine Zeile auf dem Etikett |
| `ETIKETT_FORMAT` | Bogengröße | `70x37` (24/Bogen), `63x38` (21), `48x25` (40) |
| `UPLOAD_MAX_MB` | Größte hochladbare Datei | Vorgabe `5` passt |
| `LOG_LEVEL` | Wie viel ins Protokoll kommt | `info` reicht; `debug` nur zur Fehlersuche |
| `HOST_PORT` | Auf welchem Port die App am Mini-PC selbst horcht | Vorgabe `3000`. Nur für Fehlersuche am Gerät selbst |

> **Die `.env` gehört NIE ins Repo.** Sie enthält Klartextgeheimnisse. Nach
> dem Ausfüllen: `chmod 600 .env`

---

## 4. Erreichbar machen

Das Zertifikat ist **technische Voraussetzung**, kein Komfort: Ohne gültiges
HTTPS gibt der Browser die Kamera nicht frei, und der Barcode-Scanner ist tot.

### Weg A — Aus dem Internet (Baustelle, unterwegs)

Der übliche Fall. Die Leute stehen auf der Baustelle, nicht im Büro-WLAN.

**Was Sie brauchen:**

1. Eine Domain, z. B. `geraete.meinefirma.at`
2. Einen **DNS-Eintrag** (A-Record), der auf die Internet-Adresse des
   Anschlusses zeigt. Wechselt sie regelmäßig → DynDNS dazwischalten (viele
   Router bringen einen mit)
3. **Portfreigabe** am Router: Port **80** und **443** auf den Mini-PC.
   Port 80 braucht Let's Encrypt zur Prüfung; Caddy leitet dort alles auf
   HTTPS um

**In der `.env`:**

```bash
DOMAIN=geraete.meinefirma.at
ACME_EMAIL=julius@sima.or.at    # hierhin kommen Ablaufwarnungen
TLS_MODUS=                      # LEER lassen = Let's Encrypt
COOKIE_SECURE=true
```

> **Was Sie sich damit einhandeln:** Der Mini-PC ist aus dem Internet
> erreichbar. Die Anwendung ist darauf ausgelegt — argon2id, Bremse, Sperre.
> Halten Sie die Fassung aktuell und vergeben Sie keine schwachen Passwörter.

### Weg B — Nur im Büro-Netz

Ohne Portfreigabe, ohne Internet, ohne Domain. Dafür ist die Anwendung
außerhalb des Firmen-WLANs nicht erreichbar.

**In der `.env`:**

```bash
DOMAIN=tracker.local
TLS_MODUS=tls internal          # Caddy stellt selbst ein Zertifikat aus
COOKIE_SECURE=true
```

**Zwei Zusatzschritte:**

1. **Name auflösbar machen:** Eintrag im Router (`tracker.local` → IP des
   Mini-PCs) oder in der Hosts-Datei jedes Geräts
2. **Wurzelzertifikat auf jedes Gerät:** Caddy stellt sein eigenes
   Zertifikat aus. Damit die Geräte es ohne Warnung akzeptieren:

```bash
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > tracker-wurzel.crt
```

Diese Datei (rund 600 Byte, zehn Jahre gültig) per Mail oder USB-Stick
auf die Geräte bringen:

| Gerät | Weg |
|---|---|
| **iPhone / iPad** | Datei öffnen → Profil installieren → **dann** Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen → Schalter umlegen. **Ohne den zweiten Schritt bleibt die Kamera gesperrt** |
| **Android** | Einstellungen → Sicherheit → Verschlüsselung → Zertifikat installieren → CA-Zertifikat |
| **Windows** | Doppelklick → Installieren → Lokaler Computer → Vertrauenswürdige Stammzertifizierungsstellen |

---

## 5. Starten

```bash
docker compose up -d --build
```

Der erste Bau dauert ein paar Minuten (Node-Abhängigkeiten, TypeScript-Bau).
Danach:

```bash
docker compose ps
```

Alle drei müssen laufen:

```
tracker-caddy     running
tracker-app       running (healthy)
tracker-postgres  running (healthy)
```

> **Beim Weg A:** Caddy holt beim ersten Aufruf das Zertifikat von Let's
> Encrypt. Das dauert ein paar Sekunden. Im Protokoll steht dann
> `certificate obtained successfully`:
>
> ```bash
> docker compose logs -f caddy
> ```

Die Datenbank wird beim ersten Start **von selbst** angelegt — alle
Migrationen laufen automatisch.

---

## 6. Erstes Benutzerkonto

Es gibt bewusst **kein Standardkonto** und **keinen Einrichtungsassistenten
im Browser** — eine offen erreichbare Seite, an der sich das erste Konto
anlegen lässt, ist ein Wettrennen, das man verlieren kann.

```bash
docker compose exec app node dist/werkzeuge/benutzer-anlegen.js \
  --name julius --rolle verwaltung
```

Der Befehl fragt nacheinander nach **Anzeigename**, **E-Mail** (darf leer
bleiben) und dem **Passwort** (wird zweimal abgefragt). Das Passwort ist
bewusst kein Argument — sonst stünde es in der Shell-Historie.

> **Braucht ein echtes Terminal.** Das Werkzeug stellt Rückfragen; in einem
> Skript ohne Eingabe bricht es ab.

Alle weiteren Konten legt man danach **in der Oberfläche** an:
[`BEDIENUNG.md`](BEDIENUNG.md) → Benutzer und Rollen.

---

## 7. Prüfen, dass alles läuft

```bash
# Rauchtest: 10 Prüfungen gegen die laufende App
docker compose exec app node scripts/rauchtest.mjs julius <passwort>

# 23 Schutzregeln am Datenbankschema
docker compose exec app node dist/werkzeuge/pruefe-schema.js
```

Dann im Browser öffnen: `https://geraete.meinefirma.at` (oder
`https://tracker.local`). Anmelden, Übersicht erscheint.

---

## 8. Sicherung einrichten

**Das ist kein optionaler Schritt.** Ohne cron-Eintrag läuft nie eine
Sicherung — und das fällt erst auf, wenn eine gebraucht wird.

```bash
crontab -e
```

Eine Zeile eintragen (Pfad anpassen):

```
0 2 * * * cd /home/<benutzer>/geraete-tracker && ./scripts/sicherung.sh >> sicherung.log 2>&1
```

**Auf eine andere Platte** (dringend empfohlen):

```
0 2 * * * cd /home/<benutzer>/geraete-tracker && ZIEL=/mnt/nas/tracker ./scripts/sicherung.sh >> sicherung.log 2>&1
```

Aufgehoben werden die letzten 14 Läufe. Ob sie geklappt hat, sehen Sie in
der App unter **Mehr → Verwaltung → Datensicherung**.

**Einmal ausprobieren:** Rückspielen testen, bevor es darauf ankommt:

```bash
./scripts/ruecksicherung.sh              # zeigt, was da ist
./scripts/ruecksicherung.sh 2026-08-19_0200   # spielt diesen Stand ein
```

---

## 9. Neue Fassung einspielen

```bash
cd geraete-tracker
./scripts/aktualisieren.sh
```

Das Skript:
1. Prüft, ob es Neues auf GitHub gibt
2. Sichert vorher
3. Holt die neue Fassung (`git pull`)
4. Baut das App-Image neu
5. Wartet, bis die Anwendung gesund ist
6. Zeigt die Änderungen

Datenbankänderungen laufen beim Start von selbst. Rechnen Sie mit ein bis zwei
Minuten, in denen die Anwendung nicht erreichbar ist.

**Von Hand:**

```bash
./scripts/sicherung.sh
git pull
docker compose up -d --build
```

---

## 10. Checkliste nach der Erstinstallation

- [ ] `docker compose ps` — alle drei Dienste laufen und sind gesund
- [ ] Im Browser anmelden — Übersicht erscheint
- [ ] **Sicherung einrichten** (cron-Eintrag, siehe oben)
- [ ] **Sicherung testen** — einmal `./scripts/sicherung.sh` von Hand, dann
      die Anzeige in der App prüfen
- [ ] Weitere Benutzerkonten in der App anlegen
- [ ] Standorte anlegen (Lager, erste Baustellen)
- [ ] Schlagworte und Prüfarten einrichten
- [ ] Bestand erfassen (einzeln oder per Import)
- [ ] Etiketten drucken für Geräte ohne Aufkleber
- [ ] **Testbogen drucken** — prüfen, ob der Drucker die Barcodes maßhaltig
      ausgibt (Browser schrumpft standardmäßig um 3–5 %, „Tatsächliche Größe"
      in den Druckeinstellungen wählen)
- [ ] Scanner am echten Etikett testen (erst ab HTTPS möglich)

---

## Häufige Probleme

### Caddy startet nicht: `port is already allocated`

Auf dem Rechner belegt etwas Port 80 oder 443 — oft ein vorinstallierter
Webserver.

```bash
sudo ss -tlnp '( sport = :80 or sport = :443 )'
```

Den fremden Dienst abschalten und erneut starten:

```bash
sudo systemctl disable --now apache2   # oder nginx
docker compose up -d
```

### App startet nicht: `JWT_SECRET ist nur … Zeichen lang`

Gewollt — die Anwendung bricht mit einem zu kurzen Geheimnis ab, statt eine
unsichere Anmeldung anzubieten. Längeren Wert in die `.env`, dann
`docker compose up -d --force-recreate app`.

### `.env` geändert, nichts passiert

`docker compose restart` liest die `.env` **nicht** neu ein. Richtig:

```bash
docker compose up -d --force-recreate app
```

### Sicherung: `role "tracker" does not exist`

Die `.env` hat Windows-Zeilenenden (CR). Die Skripte fangen das inzwischen
selbst ab; bei einer älteren Fassung:

```bash
sed -i 's/\r$//' .env
```

Prüfen: `file .env` — steht dort „CRLF", ist es das.

### Anmeldung schlägt fehl trotz richtigem Passwort

Nach zehn Fehlversuchen sperrt sich das Konto für 15 Minuten — auch für das
richtige Passwort. Warten oder entsperren:

```bash
docker compose exec postgres psql -U tracker -d tracker \
  -c "UPDATE benutzer SET fehlversuche = 0, gesperrt_bis = NULL WHERE benutzername = 'julius';"
```

### Fotos lassen sich nicht hochladen (`EACCES`)

Der Container läuft als `node` (uid 1000). Falls statt des Volumes ein
Host-Verzeichnis eingehängt ist:

```bash
sudo chown -R 1000:1000 /pfad/zum/ordner
```

### Kamera funktioniert nicht (Handy)

1. Adresse muss `https://` sein — ohne gültiges Zertifikat gibt der Browser
   die Kamera nicht frei
2. Bei Weg B: Wurzelzertifikat auf dem Gerät installiert? Auf dem iPad den
   **zweiten** Schritt nicht vergessen (Vertrauenseinstellungen)
3. Browser fragt nach Kamerazugriff → erlauben
4. Funktioniert die Kamera trotzdem nicht → Nummer eintippen. Das
   Handeingabefeld blendet sich nach 10 Sekunden von selbst ein

---

## Wo liegt was

| Was | Wo |
|---|---|
| Datenbank | Docker-Volume `geraete-tracker_datenbank` |
| Fotos und PDFs | Docker-Volume `geraete-tracker_fotos` |
| Zertifikate | Docker-Volume `geraete-tracker_caddy_daten` |
| Geheimnisse | `.env` im Projektordner |
| Sicherungen | `./sicherung/` oder `$ZIEL` |
| Protokolle | `docker compose logs app` |

`docker compose down` hält nur an — die Volumes bleiben.
**`docker compose down -v` löscht sie.** Das ist der einzige Befehl, der
Daten vernichtet.

---

## Weitere Anleitungen

| Dokument | Inhalt |
|---|---|
| [`BETRIEB.md`](BETRIEB.md) | Betrieb im Alltag: Sicherung, Aktualisierung, Fehlersuche |
| [`BEDIENUNG.md`](BEDIENUNG.md) | Die Anwendung benutzen: scannen, buchen, Etiketten, Benutzer, Rollen |
| [`../README.md`](../README.md) | Entwicklung auf dem eigenen Rechner |
