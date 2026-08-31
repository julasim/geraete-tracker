# Geräte-Tracker — Baustellengeräte per Barcode verfolgen

Web-Anwendung für Handy und iPad: Baumaschinen mit vorhandenen 1D-Strichcode-Etiketten
scannen, ausgeben, zurücknehmen — mit lückenloser Historie, wer ein Gerät wann auf
welche Baustelle gebracht hat.

**Stand: 2026-08-31 — AP1 bis AP23 fertig, als Docker-Paket abgenommen.** Anmelden, scannen, ausgeben,
zurücknehmen, umbuchen; Fotos und Dokumente; Prüfungen; Schäden; Zubehör;
Geräte anlegen und bearbeiten, Import/Export als Tabelle, Etikettendruck;
**Benutzerverwaltung in der Oberfläche mit frei zusammenstellbaren Rollen.**
**Läuft als drei Docker-Container auf dem Mini-PC** (Caddy, Anwendung, Datenbank) — Aufsetzen, Sicherung und
Fehlersuche: [`docs/BETRIEB.md`](docs/BETRIEB.md).
Vollständiger Plan: [`docs/PLAN.md`](docs/PLAN.md),
Bedienung der Benutzerverwaltung: [`docs/BEDIENUNG.md`](docs/BEDIENUNG.md).
**Seit 2026-08-19 unter Git** (vorher gab es keine Versionskontrolle).

## Loslegen

> Einstieg für einen frischen Rechner: [`README.md`](README.md) — dort steht der
> Installationsweg, der einmal von Null gegen eine leere Datenbank durchgespielt
> wurde.

```bash
npm ci                                            # Server UND web/ (postinstall)
wsl -d Ubuntu-24.04 -- docker start tracker-db   # Datenbank hoch
npm run db:migrate                                # Schema aktuell halten
npm run benutzer:anlegen -- --name <name> --rolle verwaltung
npm run build && node dist/index.js               # läuft auf :3000
npm test                                          # 357 Tests
node scripts/rauchtest.mjs <name> <passwort>      # Anmeldung, gegen die laufende App
node scripts/durchlauf.mjs <name> <passwort>      # Büro-Weg: anlegen, etikettieren
node scripts/durchlauf-buchen.mjs <name> <pw>     # Baustellen-Weg: scannen, buchen
node scripts/durchlauf-pflege.mjs <name> <pw>     # Fotos, Prüfungen, Schäden, Zubehör
node scripts/durchlauf-erfassung.mjs <name> <pw>  # Anlegen, Export, Excel-Runde, Import
node scripts/beispieldaten.mjs <name> <pw>        # Bestand zum Ansehen
npm run pruefe:schema                             # 23 Schutzregeln der DB
npm run lint                                      # ESLint über Server UND Oberfläche
```

Die Oberfläche liegt unter **http://localhost:3000** — derselbe Prozess liefert
API und Vue-Anwendung aus. Zum Ansehen:
`node scripts/beispieldaten.mjs <name> <passwort>` legt 12 Geräte, 4 Orte,
4 Regale und ein paar Buchungen an (alles wiedererkennbar benannt).

Für die Frontend-Entwicklung mit Neuladen: `npm run dev:web` (Port 5174,
leitet `/api` an 3000 weiter — der Umweg ist nötig, weil `SameSite=Strict`
sonst das Sitzungs-Cookie blockiert).

## Was steht

**AP1 — Scanner-Machbarkeit.** Testwerkzeug in `scanner-test/` (Vite + zxing-wasm).
**Etikettenformat bestimmt: Code 128, fünfstellig, fortlaufend ab 10001.** Lese- und
Schreibkette gegen erzeugte Barcodes geprüft, WASM lädt lokal statt vom CDN.
Offen: Trefferquote am echten Etikett mit iPad — braucht eine HTTPS-Adresse.
Protokoll: [`docs/scanner-abnahme.md`](docs/scanner-abnahme.md).

**AP2 — Gerüst und Datenbank.** Sechs Migrationen, Konfiguration, Logger mit
Geheimnis-Filter, Migrationslauf mit Sperre, `benutzer:anlegen`.
`src/werkzeuge/pruefe-schema.ts` prüft **23 Schutzregeln am laufenden Schema** — alle grün.

**AP3 — Anmeldung und API-Grundgerüst.** Hono-Kette mit **Standard-gesperrt**,
argon2id, JWT im httpOnly-Cookie mit `token_version`-Widerruf, dreistufige Bremse,
zentrale Fehlerübersetzung ohne Interna, erzwingende CSP.
**40 Tests**, dazu `scripts/rauchtest.mjs` gegen die wirklich laufende App
(10 Prüfungen) — die Testsuite läuft im selben Prozess und würde nicht merken,
wenn der gebaute Server gar nicht startet.

**AP4 — Stammdaten-API.** Geräte, Etiketten, Schlagworte, Standorte, Lagerplätze.
Zod-Schemata, `rev`-Konfliktschutz, Rollenprüfung je Route. Nummern und
Platz-Kennungen werden fortlaufend von selbst vergeben (`10001…`, `P-0001…`).
**100 Tests**, dazu `scripts/durchlauf.mjs` — der Büro-Weg von der Baustelle
über das Regal bis zum Ersatzetikett, gegen die laufende App.

**AP5 — Buchungen und Scannen. Die Fachlogik ist damit vollständig.**
`src/domain/status.ts` ist der Zustandsautomat als reine Funktion (alle 20
Kombinationen aus Zustand und Buchungsart einzeln geprüft). `src/data/buchungen.ts`
schreibt Historie und Gerätezustand in EINER Transaktion mit `SELECT … FOR UPDATE`.
`/api/scan/:code` antwortet mit `typ`, den **erlaubten Aktionen** und Warnungen zu
Prüfung und Schäden. **181 Tests**, dazu `scripts/durchlauf-buchen.mjs`.

**AP6/AP7 — Oberfläche.** Vue 3 mit Pinia und vue-router, **im Design von PATIO**:
Tokens aus `apps/patio/web/src/patio-tokens.css` übernommen (monochrom, flach,
kein Brand-Akzent — Akzent ist Ink; Hairline statt Schatten; kleine Radien;
4pt-Raster; `pt-`-Präfix). Zwei Abweichungen: **nur Systemschriften** (PATIOs
Google-Fonts-Import lief auf einem Server ohne Internet in einen Timeout) und
**größere Tippziele** (48 px statt 36 — Daumen statt Maus, teils mit Handschuhen).

Layout **mobile-first mit Navigation unten** statt PATIOs 3-Spalten-Bürooberfläche:
auf der Baustelle wird einhändig bedient, der Daumen erreicht den oberen Rand nicht.

**AP8 — Fotos, Prüfungen, Schäden, Zubehör.** Eine `dateien`-Tabelle für Bilder
**und** PDFs; Aufnahme am Handy direkt über die Kamera, Verkleinerung im Browser
vor dem Hochladen (spart Mobilfunkdaten und erspart dem Server eine native
Bildbibliothek). Prüfarten frei anlegbar, Fälligkeit rechnet der Server.
Schaden mit Schwere `ausfall` sperrt das Gerät sofort; das Erledigen des letzten
offenen Schadens gibt es wieder frei. Zubehör als Selbstbezug, **eine Ebene tief**.
**198 Tests**, dazu `scripts/durchlauf-pflege.mjs`.

**AP9 — Bestandserfassung.** Geräte anlegen und bearbeiten in der Oberfläche,
Import und Export als Tabelle, Etikettendruck (Code 128, A4-Bögen).
**279 Tests**, dazu `scripts/durchlauf-erfassung.mjs`.

**AP10 — Benutzerverwaltung und Rollen.** Konten lassen sich in der Oberfläche
anlegen, ändern und stilllegen; Rollen sind **frei zusammenstellbar** (Tabelle
`rollen`, 13 Rechte als Baukasten), drei sind mitgeliefert: Mitarbeiter (3),
Lager und Werkstatt (9), Verwaltung (13). **323 Tests**, dazu
`scripts/durchlauf-benutzer.mjs`.

**Entwicklungsdatenbank:** Container `tracker-db` in WSL Ubuntu-24.04, Port **5433**
(5432 gehört PATIO). Erreichbar über `127.0.0.1:5433`.
*Falle: WSL fährt bei Untätigkeit herunter und nimmt das Port-Forwarding mit.
Dann `wsl -d Ubuntu-24.04 -- docker start tracker-db` und WSL wachhalten.*

**Das erste Konto entsteht auf der Kommandozeile** (`npm run benutzer:anlegen`),
alle weiteren in der Oberfläche. Bewusst kein Einrichtungsassistent im Web: eine
offen erreichbare Seite, an der sich das erste Konto anlegen lässt, ist ein
Wettrennen, das man verlieren kann.

## Was der Paket-Test von Null gefunden hat (2026-08-19)

Einmal komplett aufgesetzt wie auf einem neuen Rechner: frischer Klon, `npm ci`,
`.env` aus `.env.example`, leere Datenbank, alle neun Migrationen, erstes Konto
über die Kommandozeile, Start, sechs Durchläufe, 323 Tests. Vier Befunde, alle
behoben:

1. **`npm ci` installierte die Oberfläche nicht.** Der Bau brach mit
   „vue-tsc ist entweder falsch geschrieben oder konnte nicht gefunden werden"
   ab — für einen Neuling eine Sackgasse. Jetzt hängt `npm --prefix web install`
   als `postinstall` daran, die Installation ist einstufig.
2. **Die Schemaprüfung legte ein Konto mit der Rolle `admin` an**, die
   es seit AP10 nicht mehr gibt → Fremdschlüsselfehler. Beim Umstellen
   übersehen, weil das Skript nicht Teil von `npm test` ist.
3. **Ein abgebrochener Lauf machte die Schemaprüfung dauerhaft rot.** Das
   Aufräumen am Anfang löschte das Prüfgerät, nicht dessen Buchungen — und
   wegen der Unveränderlichkeitsregel ließ sich danach beides nicht mehr
   entfernen. Jetzt räumt das Skript auch die Buchungen weg.
4. **Die eigene Prüfung „Rolle lässt sich nicht löschen" richtete im
   Fehlerfall Schaden an.** Sie lief gegen `verwaltung`; fehlt der
   Fremdschlüssel — also genau in dem Fall, den sie sucht — löschte sie eine
   echte Vorgabe-Rolle. Bei der Gegenprobe genau so passiert, die Datenbank war
   danach unbrauchbar. Jetzt gegen eine eigens angelegte Prüfrolle.

**Was dabei bestätigt wurde:** Migrationen laufen von Null durch und sind
idempotent; der Produktionsstart bricht bei zu kurzem `JWT_SECRET` mit Exit-Code
1 und klarer Meldung ab; mit `COOKIE_SECURE=true` trägt das Sitzungs-Cookie
`Secure; HttpOnly; SameSite=Strict`; die Ignorierliste hält `.env`, `daten/`,
`dist/` und `.claude/` draußen; im Paket liegt kein Geheimnis.

*Der letzte Absatz dieses Abschnitts lautete bis zum 2026-08-19: „Noch nicht
gebaut: Der Betriebsweg … davon existiert nichts." Das ist mit AP11 und AP13
erledigt — Dockerfile, Compose, Caddy, Sicherung und Rückspielweg stehen.*

## Größenordnung (bestimmt fast alle Entwurfsentscheidungen)

~200 Geräte, ~5–10 Benutzer. Deshalb bewusst **weggelassen**: Paginierung,
Volltextindizes, Redis, SSE-Live-Updates, Zwei-Faktor, ORM. Die Geräteliste wird
komplett geladen und im Browser gefiltert.

**Nicht** gespart wird an drei Stellen, weil Fehler dort teuer sind:
1. **Buchungslogik** — falscher Bestand ist schlimmer als kein Bestand
2. **Anmeldung** — die App steht offen im Internet
3. **Scanner** — funktioniert er nicht, benutzt niemand die App

## Stack

Node 24 · TypeScript ESM strict · **Hono 4** · **PostgreSQL 16** über **postgres.js**
(kein ORM) · Vue 3.5 + Vite + Pinia + Tailwind v4 · Vitest · Docker Compose
(caddy + app + postgres — die Anwendung liefert Oberfläche und API selbst
aus, Caddy macht nur TLS und Weiterleitung).

Geerbt von `../patio` — gleiche Konventionen, damit nichts Neues zu lernen ist.
Drei bewusste Abweichungen: JWT im **httpOnly-Cookie** statt localStorage ·
`ApiError`-Klasse im Frontend statt nacktem `Error` · **mobile-first** statt
3-Spalten-Bürooberfläche.

## Betrieb

Mini-PC im Büro. **Kein Cloudflare-Tunnel** (Julius' Entscheidung vom
2026-08-21) — stattdessen **Caddy** als einziger Eingang, der das Zertifikat
selbst holt und erneuert. Zwei Wege, beide in [`docs/BETRIEB.md`](docs/BETRIEB.md):

* **Aus dem Internet:** Portfreigabe 80/443 am Router, DynDNS-Adresse,
  Let's-Encrypt-Zertifikat. Läuft in jedem Browser ohne Zusatz-App.
* **Nur im Büro-Netz:** `TLS_MODUS=tls internal`, Caddy stellt selbst aus.
  Dann muss sein Wurzelzertifikat einmalig auf jedes Gerät.

Das echte HTTPS-Zertifikat ist **technische Voraussetzung**: `getUserMedia()`
gibt die Kamera nur im *secure context* frei.

*Korrektur zu einer früheren Fassung dieser Datei: Ein selbstsigniertes
Zertifikat reicht sehr wohl — aber nur, wenn es auf dem Gerät als
vertrauenswürdig eingerichtet wird. Auf dem iPad braucht das einen zweiten
Schritt (Einstellungen → Info → Zertifikatsvertrauenseinstellungen), der
gern übersehen wird; ohne ihn bleibt die Kamera gesperrt.*

## Entscheidungen, die man kennen muss

**Getrennter Nummernkreis, von der Datenbank erzwungen.** Geräte-Etiketten sind reine
Ziffern (`10001`), Lagerplatz-Etiketten tragen das Präfix `P-` (`P-0001`). Zwei
CHECK-Constraints setzen das durch. Ein gescannter Code kann damit nie mehrdeutig sein —
`/scan/:code` antwortet mit `typ: geraet | lagerplatz | unbekannt`.

**Buchungen sind unveränderlich.** Zwei Regeln (`DO INSTEAD NOTHING`) machen `UPDATE`
und `DELETE` auf `buchungen` wirkungslos. Ein Fehler wird per Gegenbuchung
(`art = 'korrektur'`) begradigt. *Achtung: die Regeln melden keinen Fehler, die
Anweisung läuft nur ins Leere.*

**Alle Fremdschlüssel in `buchungen` stehen auf RESTRICT, keiner auf SET NULL.**
Fachlich, weil „ausgegeben nach: nichts" keine Historie wäre — ein Standort wird
stillgelegt (`aktiv = false`), nicht gelöscht. Technisch, weil `SET NULL` ein internes
`UPDATE` auf `buchungen` auslöst, das die Unveränderlichkeitsregel abfängt: Ergebnis
wäre ein kryptischer `XX000`-Fehler. Beim Aufbau aufgefallen und behoben.

**Nichts wird vorgegeben.** Keine Kategorien, keine Prüfarten, kein Standardkonto.
Einteilung geschieht über frei anlegbare **Schlagworte** (n:m, beliebig viele je Gerät).
Das erste Konto entsteht mit `npm run benutzer:anlegen` auf dem Server.

**Passwörter:** argon2id (64 MB, 3 Durchgänge, **58 ms** je Versuch nachgemessen),
mindestens 12 Zeichen, Abgleich gegen bekannte Lecks über Have I Been Pwned
(k-Anonymity — nur ein Hash-Präfix verlässt den Server).

**Standard ist gesperrt.** `anmeldungPruefen` läuft vor allen Routen; was ohne
Anmeldung erreichbar sein soll, steht in `OFFEN` in `src/api/server.ts` — derzeit
nur `/api/health` und `/api/auth/login`. Ein neuer Endpunkt ist damit automatisch
geschützt. `tests/api-auth-abdeckung.test.ts` geht **alle** registrierten Routen
durch und schlägt fehl, sobald etwas anderes ohne Cookie antwortet. Gegengeprüft:
mit einer eingeschmuggelten offenen Route wird der Test rot.

**Reihenfolge in `server.ts` ist Teil des Schutzes.** `secureHeaders` muss VOR den
Routen stehen — Hono wertet in Registrierungsreihenfolge aus. Beim ersten Testlauf
fiel auf, dass `/api/health` deshalb ganz ohne Sicherheits-Kopfzeilen antwortete.

**Anmeldung verrät nichts.** Gleiche Meldung und gleiche Antwortzeit, egal ob das
Konto existiert. Für unbekannte Konten wird gegen einen zur Laufzeit erzeugten
Vergleichs-Hash gerechnet (`blindPruefung()`), damit der Weg nicht schneller ist.
*Ein fest im Quelltext stehender Hash wäre hier eine Falle: stimmt er nicht exakt,
bricht `verify()` sofort ab statt zu rechnen — der Schutz wäre still wirkungslos.*

**Bremse, nachgemessen:** 12 Rateversuche dauern 48 Sekunden (Verzögerung 1/2/4/8 s
ab dem dritten), danach 15 Minuten Sperre, die auch das richtige Passwort abweist.
Rund 40 Versuche pro Stunde und Konto.

**Der Zustand eines Geräts wird NIE direkt gesetzt.** `PATCH /api/geraete/:id`
ändert nur Stammdaten. Standort, Lagerplatz und Nutzer ergeben sich
ausschließlich aus Buchungen (AP5) — gäbe es hier einen zweiten Weg, liefen
Bestand und Historie auseinander, und die Historie wäre nicht mehr die Wahrheit.

**Ein Gerät darf mehrere Etiketten tragen**, und das letzte gültige lässt sich
nicht stilllegen — ohne Etikett wäre es nicht mehr scanbar und damit praktisch
verschwunden, obwohl es im Bestand steht.

**Die erlaubten Aktionen kommen vom Server**, nicht aus dem Frontend. Sonst laufen
Anzeige und Regelwerk auseinander, und der Benutzer tippt auf „Ausgeben", um dann
zu erfahren, dass das Gerät defekt ist. Ein Test prüft, dass nie eine Aktion
angeboten wird, die der Automat verbietet.

**Nebenläufigkeit lässt sich nicht über zwei HTTP-Anfragen prüfen.** `Promise.all`
gegen `app.request()` läuft im selben Prozess und kommt sich nicht ins Gehege —
der Test blieb auch ohne `FOR UPDATE` grün (nachgemessen). Der echte Nachweis
steht in `api-buchungen.test.ts` und arbeitet direkt auf Datenbankebene mit
`FOR UPDATE NOWAIT`: Ist die Zeile gesperrt, meldet Postgres `55P03` sofort.

**`SELECT DISTINCT` verträgt sich nicht mit einer `json`-Spalte** — Postgres kennt
für `json` keinen Gleichheitsoperator (`jsonb` schon). Die Schlagworte werden per
`json_agg` mitgeliefert; ein `DISTINCT` daneben ergibt zur Laufzeit einen 500er.
Beim Bau genau so passiert.

**Der Scanner hat immer einen zweiten Weg.** Verweigert der Browser die Kamera
oder findet nach zehn Sekunden nichts, blendet sich die Handeingabe von selbst
ein — mit Vorschlägen aus dem bereits geladenen Bestand, ohne Serveraufruf.
Im Browser gegengeprüft: Kamera abgelehnt → Eingabefeld erscheint, Nummer 10002
eingetippt → Gerätekarte mit den richtigen Aktionen.

**`useScanner()` muss beim Verlassen der Ansicht aufräumen** (`onScopeDispose`):
jeden Track stoppen und die Bildschleife abbrechen. Sonst bleibt die
Kameraleuchte an, der Akku leert sich, und iOS verweigert beim nächsten Aufruf
den Zugriff.

**Datumsangaben kommen als TEXT aus der Datenbank, nicht als Zeitpunkt.**
Konfiguriert in `src/db/client.ts` über `types.datum` (OID 1082). Der Grund ist
ein Fehler, der zweimal auftrat: Ein Prüfdatum `2027-03-31` wurde als Date-Objekt
gelesen (lokale Mitternacht) und beim Umwandeln nach JSON in UTC ausgegeben —
und fiel dabei auf den **30.03.** zurück. Ein Datum ohne Uhrzeit HAT keine
Zeitzone; es als Zeitpunkt zu behandeln ist die Ursache, nicht die Umrechnung.
Dasselbe gilt in `src/domain/pruefung.ts`: dort rechnet alles in UTC.
*`TIMESTAMPTZ` bleibt unberührt — dort ist der Zeitpunkt gewollt.*
`tests/domain-pruefung.test.ts` fängt den Fall künftig ab (gegengeprüft:
mit der alten Rechnung werden 7 Tests rot).

**Hochgeladene Dateien werden an den ersten Bytes geprüft, nicht am Namen**, und
unter einer UUID abgelegt — ein vom Benutzer gewählter Name gerät nie in einen
Pfad. Ausgeliefert wird nur über `GET /api/dateien/:id` **mit Anmeldung**; läge
der Ordner im statischen Bereich, wären alle Baustellenfotos über eine geratene
Adresse öffentlich.

**Die Nummernvergabe läuft in der Transaktion, mit Sperre.** `pg_advisory_xact_lock`
in `naechsteFreieNummerInTx` (`src/data/geraete.ts`). Vorher wurde der Höchstwert
AUSSERHALB gelesen — bei 20 gleichzeitigen Anlagen kamen **nur 2 durch**, der Rest
scheiterte am eindeutigen Index und endete als Serverfehler 500. Gegengeprüft: ohne
die Sperre werden zwei Tests in `api-nummernvergabe.test.ts` rot.
*Bewusst keine Postgres-Sequenz — die reißt bei Abbrüchen Lücken, und eine
Inventarnummer wird auf ein Etikett geklebt.*

**Import: leere Zelle heißt „nicht ändern".** Julius' Vorgabe. Wer in Excel
versehentlich eine Spalte löscht, würde sonst mit einem Import 200 Angaben
vernichten. Absichtlich leeren geht über einen Bindestrich in der Zelle.
Pflicht ist ausschließlich die Bezeichnung — unvollständige Zeilen werden angelegt.

**Import ist alles oder nichts**, mit Vorschau vorher (`/import/geraete/pruefen`
schreibt garantiert nichts). Der Export trägt eine `Fassung`-Spalte: Wurde ein Gerät
nach dem Export in der App geändert, meldet der Import einen Konflikt statt zu
überschreiben. Standort und Zustand stehen im Export, sind beim Import aber
wirkungslos — sie entstehen nur aus Buchungen.

**Excel-Eigenheiten** in `src/domain/csv.ts`: Export mit **Semikolon und BOM**
(ohne BOM zerschießt Excel die Umlaute), Import erkennt Trennzeichen selbst und
versteht Windows-1252, `1234,50` und `31.03.2026`.

**Etikettendruck:** Ruhezone fest im Layout, Strichbreite ≥ 0,33 mm, PDF exakt in
A4. **Der Browser skaliert standardmäßig auf „an Seite anpassen" und schrumpft den
Barcode um 3–5 %** — die Ansicht weist darauf hin, und es gibt einen Testbogen mit
vier Etiketten zum Ausprobieren vor dem großen Lauf.
*Ob ein gedrucktes Etikett lesbar ist, kann kein automatischer Test belegen —
das entscheidet sich am Drucker und am Papier.*

**Rechte, nicht Rollen — und lesen ist kein Recht.** Wer angemeldet ist, sieht
den ganzen Bestand; die 13 Rechte entscheiden nur über das Ändern. Der Katalog
steht als reine Daten in `src/domain/rechte.ts`, die Zuordnung zu Rollen in der
Datenbank. Eine eigene Rolle braucht deshalb **keine Codeänderung** — auch das
Anlege-Skript liest die verfügbaren Rollen aus der Tabelle.

**Rechte werden bei JEDER Anfrage frisch aufgelöst** (`rechteVonRolle`, kein
Zwischenspeicher). Ein Rollenwechsel erhöht zusätzlich `token_version`, beendet
also alle Sitzungen des Betroffenen — sonst liefe er ohne Erklärung in 403er.

**Der Aussperr-Schutz sitzt an zwei Stellen, und nur eine davon ist über die
API auslösbar.** Am Konto (`pruefeLetzterVerwalter`) und an der Rolle
(`aendereRolle`). Eine **Gegenprobe hat gezeigt, dass der Schutz am Konto in der
Praxis nie greift**: Wer handelt, ist selbst ein aktiver Verwalter, also bleibt
nach jeder Änderung an einem fremden Konto mindestens er übrig — und am eigenen
fängt vorher der Selbstschutz ab. Der wirkliche Aussperr-Weg lief über die
**Rolle**: Eine eigene Rolle mit `benutzer.verwalten` ließ sich ihres Rechts
berauben. Das ist jetzt gesperrt und getestet. Der Schutz am Konto bleibt als
Netz und wird direkt auf der Datenschicht geprüft, damit er nicht still
verrottet.

**Die Testsuite legt echte Konten still** — anders lässt sich „letzter
Verwalter" nicht herstellen. Ihr `afterAll` aktiviert alle Nicht-Testkonten
wieder. Das fehlte zuerst, und nach einem Testlauf war die Anmeldung an der
Entwicklungsumgebung tot.

**`/api/benutzer` antwortet in zwei Ausprägungen.** Beim Ausgeben braucht jeder
die Namensliste, sonst lässt sich nichts auf jemanden buchen. Ohne
`benutzer.verwalten` kommen nur `id`, `anzeigename` und `aktiv` — keine E-Mail,
keine Rolle, kein Anmeldeverhalten.

**Konten werden nie gelöscht, nur stillgelegt.** Der Name steht in jeder
Buchung, die die Person erfasst hat.

## AP11 — Docker-Paket für den Mini-PC (2026-08-19)

Zweistufiges `Dockerfile` (bauen / laufen), `docker-compose.yml` mit App und
Postgres, Sicherung und Rückspielweg als Skripte. Anleitung:
[`docs/BETRIEB.md`](docs/BETRIEB.md).

*Der Cloudflare-Tunnel, den dieses Paket zunächst als optionales Profil
enthielt, ist am 2026-08-21 wieder entfallen — siehe AP13.*

**Der Fund, der das Paket sonst unbrauchbar gemacht hätte:** `scripts/` wird
von `tsc` **nicht** gebaut (`include: ["src/**/*.ts"]`). Im Container hätte es
also kein `benutzer:anlegen` gegeben — und ohne erstes Konto kommt niemand in
eine frische Installation. Die drei Betriebswerkzeuge liegen deshalb jetzt
unter `src/werkzeuge/` und landen in `dist/`. Die Durchlauf-Skripte (`.mjs`,
kein Bau nötig) bleiben in `scripts/` und werden ins Laufzeit-Abbild kopiert,
damit sich die Anlage **vor Ort** prüfen lässt.

**Weitere Entscheidungen:**
- **`tini` als Einstiegsprozess.** Ohne echten init-Prozess bekommt Node kein
  SIGTERM; `docker compose down` wartet dann jedes Mal zehn Sekunden auf den
  harten Abschuss.
- **Die Datenbank hat kein `ports:`.** Sie ist nur im internen Netz erreichbar.
  Die App horcht auf `127.0.0.1` — nach außen geht es allein über den Tunnel.
- **`USER node` (uid 1000)**, `/data` gehört ihm. Ein eingehängtes
  Host-Verzeichnis, das root gehört, wäre der klassische `EACCES`-Fall.
- **`.gitattributes` mit `eol=lf`.** Hier wird unter Windows entwickelt; eine
  Datei mit CRLF bricht im Container mit „CR: not found" ab — ein Fehler, den
  man auf dem eigenen Rechner nie sieht.
- **Healthcheck ohne curl**, Node kann seit v18 selbst `fetch`. Kein zusätzliches
  Paket im Abbild.

**Geprüft, nicht vermutet** (alles in WSL Ubuntu-24.04 gegen einen echten Klon):
Bau aus dem Repo · Start beider Container bis `healthy` · alle neun Migrationen
*(Stand 2026-08-19: neun Migrationen, zwei Container — Caddy kam mit AP13,
Migration 010 mit AP12 dazu.)*
von selbst · erstes Konto im Container · **alle sechs Durchläufe im Container** ·
19 Schutzregeln · läuft als uid 1000 · Datenbank nicht von außen erreichbar ·
`down`/`up` ohne Datenverlust · **Update-Weg** (`git pull` + `--build`) ohne
Datenverlust · **Rückspielweg echt durchgespielt**: nach `down -v` — also
vollständigem Verlust beider Volumes — waren 28 Geräte, 4 Buchungen, 2 Konten
und die Fotos wieder da, Anmeldung funktionierte.

**Beim Bauen gefunden und behoben:** `npm run build` scheiterte im Abbild, weil
`scripts/kopiere-migrationen.mjs` fehlte. Und die Sicherungsskripte lasen die
`.env` per `source` — `FIRMENNAME=SIMA INFRA Construction GmbH` (Leerzeichen
ohne Anführungszeichen, was Compose verträgt) ließ sie mit
„INFRA: command not found" abbrechen. Sie lesen die zwei Werte jetzt gezielt
per `sed`.

## AP12 — Nummernregister: keine Nummer geht zweimal hinaus (2026-08-21)

Julius' Vorgabe: „Beim Etikettendruck dürfen keine Nummern gedruckt werden, die
es im System schon gibt."

**Der Druck war nie das Problem** — er nimmt ausschließlich Geräte aus dem
Bestand. **Die Vergabe war es.** `naechsteFreieNummerInTx` las den Höchstwert
der ERFASSTEN Geräte. Während der Ersterfassung kleben draußen aber Etiketten,
die das System nicht kennt: Kennt es 10001–10113 und kleben real 10001–10200,
vergibt es 10114 — eine Nummer, die schon auf einer Maschine klebt. Ein
doppeltes Etikett fällt niemandem auf, bis ein Scan das falsche Gerät zeigt.

**Neue Tabelle `etikettennummern`** (Migration 010) mit drei Zuständen:
`vergeben` (ein Gerät trägt sie) · `reserviert` (auf Vorrat gedruckt) ·
`gesehen` (beim Scannen aufgetaucht, kein Gerät dazu). Die Vergabe fragt ab
sofort dieses Register.

**Was dazukam:**
- `POST /etiketten/vorrat` — Bogen mit neuen Nummern, die **vor** dem Druck
  reserviert werden. Für den Bauhof-Ablauf: drucken, kleben, später erfassen.
- Der Scan **lernt dazu**: Ein unbekanntes Etikett wird als `gesehen` vermerkt
  und danach nie automatisch vergeben. Das ist die einzige Möglichkeit, von
  Altetiketten zu erfahren, die nie erfasst wurden.
- `POST /etiketten/altbestand` — einen Bereich als belegt eintragen, falls
  jemand weiß, bis wohin die alten Aufkleber reichen. Kein Pflichtschritt.
- Vorratsdruck und Nummernstand in der Etiketten-Ansicht.

**Zwei Fallen, die beim Bauen auffielen:**
1. **Ersatzetiketten zogen den Nummernkreis mit.** Ein Zusatzetikett `90001`
   hätte die Vergabe von 10114 auf 90002 springen lassen und 80.000 Nummern
   liegen gelassen. Deshalb `zaehlt_fuer_vergabe`: Zusatzetiketten sind
   verbraucht, zählen aber nicht für den laufenden Kreis.
2. **Der Import ging am Register vorbei** — er las den Höchstwert aus der
   Gerätetabelle. Ausgerechnet der Weg, mit dem 200 Maschinen erfasst werden.
   Aufgefallen, weil ein Test dafür rot wurde, nachdem er zuerst aus dem
   falschen Grund grün war.

**Der Scan darf die Nummer nicht sperren, die er gerade meldet.** Erster
Entwurf: `gesehen` blockiert das Anlegen. Damit war genau der Normalfall tot —
scannen, „nicht erfasst", anlegen. Jetzt blockiert nur `vergeben` mit Gerät;
`reserviert` und `gesehen` sind ausdrücklich erlaubt und holen ihr Gerät ab.

**Am laufenden System nachgemessen:** Vorratsbogen 10575–10598 gedruckt → das
nächste automatisch angelegte Gerät bekam 10599, sprang also über den ganzen
Bogen. Etikett 10575 ließ sich für ein Gerät verwenden. Ein Scan von 10700
(unbekannt) machte die Nummer sofort zu `gesehen`, das nächste Gerät bekam
10701. **15 neue Tests**, vier Gegenproben (Vergabe ohne Register · Import ohne
Register · Scan ohne Mitschrift) — jede macht die zugehörigen Tests rot.

**Der schwerwiegendste Fund kam aus dem eigenen Testlauf: Ein Vertipper hätte
den Nummernkreis zerstört.** Ein Scan von `99999` trug die Nummer als
`gesehen` ein — und weil die Vergabe den Höchstwert des Registers nahm, sprang
die nächste Nummer auf 100000. Ab da wäre jedes Etikett sechsstellig gewesen,
wegen einer falsch eingetippten Handeingabe.

Die Vergabe beantwortet deshalb jetzt **zwei getrennte Fragen**:
1. *Wo steht die Reihe?* Nur `vergeben` und `reserviert` — also Nummern, die
   kontrolliert ausgegeben wurden.
2. *Ist DIESE Nummer frei?* Jeder Eintrag zählt, auch `gesehen`. Klebt 10114
   draußen und wurde gescannt, wird sie übersprungen.

Dieselbe Regel im Import. Gegengeprüft: ohne den Schutz vergibt die Anwendung
16140 statt 11138.

**Der Test dafür war zuerst wertlos** — er scannte fest `99999`, und der
Nummernkreis der Entwicklungsdatenbank lag zu dem Zeitpunkt darüber. Er prüft
jetzt relativ zum aktuellen Stand. *Merksatz: Eine Gegenprobe, die grün bleibt,
ist ein Befund über den Test, nicht über den Code.*

**Sperrzeit:** `reserviereNummern` und `merkeBereich` schreiben in EINEM Insert.
Mit einer Schleife über 500 Einzel-Inserts hielten sie die Nummernsperre
sekundenlang — im Testlauf liefen prompt andere Dateien in Zeitüberschreitungen.

## AP13 — Eigener Eingang statt Tunnel (2026-08-21)

Julius: „wir machen das ohne tunnel". Stattdessen **Caddy** als einziger
Eingang — er holt und erneuert das Zertifikat selbst, bei öffentlicher Domain
von Let's Encrypt, im reinen Büro-Netz stellt er eines selbst aus
(`TLS_MODUS=tls internal`).

**Warum überhaupt ein Proxy:** Ohne gültiges Zertifikat gibt der Browser die
Kamera nicht frei. Ohne HTTPS gäbe es also keinen Scanner, und die Etiketten
wären umsonst geklebt.

**Drei Stolpersteine beim Bauen, alle im laufenden Stack gefunden:**
1. **Eine leere `email`-Zeile lässt Caddy gar nicht erst starten.** Caddys
   eigene Vorgabe-Schreibweise (`{$VAR:vorgabe}`) hilft nicht: Sie greift nur,
   wenn die Variable UNGESETZT ist — Compose setzt sie aber immer, notfalls
   leer. Die ganze Zeile wird deshalb im Compose zusammengebaut
   (`${ACME_EMAIL:+email ${ACME_EMAIL}}`).
2. **Dem Sitzungs-Cookie fehlte das `Secure`-Flag.** `.env.example` stand auf
   `COOKIE_SECURE=false` — richtig für die Entwicklung an `http://localhost`,
   falsch für jeden, der die Vorlage für den Betrieb kopiert. Die Vorlage gibt
   jetzt den Betriebsfall vor, die Entwicklung ist die dokumentierte Ausnahme.
3. **Caddys Verwaltungsschnittstelle (2019) stand im Container-Netz offen.**
   Über sie ließe sich die Konfiguration im Betrieb austauschen; `admin off`.

**Weitergereicht:** `X-Forwarded-For` und `X-Real-IP`. Ohne sie sähe die
Anwendung nur die Adresse des Proxys — die Anmeldebremse zählte alle
Fehlversuche auf EINE Adresse und sperrte beim elften Versuch das ganze Büro
aus statt eines Rechners.

**Geprüft im laufenden Stack** (WSL, frischer Klon): drei Container gesund ·
HTTPS liefert die Anwendung aus · HTTP wird mit 308 auf HTTPS umgeleitet ·
Zertifikat von Caddys lokaler CA, zehn Jahre gültig · Anmeldung über HTTP/2
mit `Secure; HttpOnly; SameSite=Strict` · Rauchtest im Container grün ·
Datenbank ohne Host-Port, Anwendung nur auf 127.0.0.1, nach außen offen ist
allein Caddy (80/443).

**Offen und nur vor Ort prüfbar:** das Let's-Encrypt-Zertifikat (braucht die
echte Domain samt Portfreigabe) und die Kamera-Abnahme am Etikett.

## AP14 — ESLint (2026-08-21)

Das Projekt hatte als einziges im Workspace keine statische Prüfung. Jetzt
ESLint 10 mit flat config wie in `../patio`, erweitert um die Vue-Oberfläche
(dort größer als der Server): `npm run lint` über `src/`, `tests/`,
`scripts/` und `web/src/`.

**Neun Befunde beim ersten Lauf, zwei davon echte Fallen:**

1. **Ein unsichtbares BOM stand im Quelltext** — in `domain-csv.test.ts` und
   in `durchlauf-erfassung.mjs`. Der Test prüfte damit genau das Richtige,
   aber niemand konnte sehen, was da steht; ein Kopiervorgang hätte es
   stillschweigend verschluckt, und der Test hätte danach nichts mehr
   geprüft. Jetzt als `﻿` geschrieben — gleiche Wirkung, sichtbar.
   *In diesem Projekt ist schon zweimal etwas an unsichtbaren Zeichen
   gescheitert (Escape-Sequenzen in Heredocs, CRLF im Container).*
2. **`web/src/api.ts` hatte eine Zuweisung, die nie gelesen wurde.**
   Harmlos, aber sie täuschte einen Ausgangswert vor, den es nicht gab.

Der Rest: fünf tote Importe und ein `let`, das ein `const` sein wollte.
Nebenbei fiel eine Doppelung auf — die Nummernformatierung stand in
`domain/barcode.ts` **und** in `data/nummern.ts`. Jetzt gibt es `alsNummer()`
an einer Stelle, und beide rufen sie.

**Gegengeprüft**, dass die Prüfung überhaupt greift: eine Datei mit `any`,
totem Bezeichner und leerem catch untergeschoben — drei Befunde, danach
wieder entfernt.

Formatierungsregeln sind abgeschaltet (`eslint-config-prettier`): Zwei
Werkzeuge, die sich über Zeilenumbrüche streiten, kosten nur Zeit.

## AP15 — Fristen, Betrieb, Regal-Etiketten (2026-08-23)

Vier Befunde aus einer Durchsicht des fertigen Pakets, alle im Code belegt.

**1. Die App beantwortete ihre wichtigste wiederkehrende Frage nicht.**
`GET /pruefungen/faellig` lieferte seit AP8 eine fertige Ampelliste —
**keine einzige Ansicht rief sie ab.** Fällige Prüfungen sah man nur am
einzelnen Gerät; bei 200 Maschinen ist das keine Antwort. Neu:
`web/src/views/PruefungenView.vue` unter `/pruefungen`, nach Dringlichkeit
gruppiert, dazu eine Kennzahl und die fünf dringendsten in der Übersicht.
Restfristen stehen in Worten („seit 426 Tagen", „heute", „in 31 Tagen") —
im Bauhof brauchbarer als ein Datum, das man gegen den Kalender halten muss.
Serverseitig war **nichts** zu ändern.

*Nebenbefund:* Der Frontend-Typ hieß `FaelligeePruefung` (doppeltes e) und
wurde nirgends verwendet — der Tippfehler war nie aufgefallen, weil ihn nie
jemand aufrief.

**2. Der Health-Check log.** `app.get("/api/health", (c) => c.json({ok:true}))`
fasste die Datenbank nicht an. In dieser Umgebung ist genau das passiert:
Docker meldete `healthy`, während jede Anmeldung an einer weggebrochenen
Verbindung scheiterte — auf dem Mini-PC hieße das: kein Neustart, keine
Meldung. Jetzt `SELECT 1`, Erfolg → 200, Fehler → 503, **ohne** zu verraten
warum (der Endpunkt ist anonym erreichbar; diese Zurückhaltung war und bleibt
Absicht). Das Ergebnis wird ~5 s zwischengespeichert, sonst könnte eine
Anfrageflut Datenbanklast erzeugen.

**Im Betrieb gegengeprüft:** `docker compose stop postgres` → nach 80
Sekunden steht der App-Container auf `unhealthy`, der Endpunkt antwortet
`503 {"ok":false}`; nach dem Wiederanlauf wieder gesund.

**3. Die Docker-Protokolle wuchsen unbegrenzt.** Jetzt 3 × 10 MB je Dienst.
Der Ausfall, der sonst nach zwei Jahren kommt und den niemand kommen sieht.

**4. Regal-Etiketten ließen sich nicht drucken.** Das System vergibt
Lagerplatz-Kennungen (`P-0001`), erkennt sie beim Scannen und zeigt den
Regalinhalt — der Druck kannte nur Geräte. Neu: `POST
/etiketten/lagerplaetze` und eine zweite Auswahl in der Etiketten-Ansicht.
**Bewusst getrennt** von der Geräte-Route: Die beiden Nummernkreise sind
durchgängig auseinandergehalten, bis hinunter in zwei CHECK-Constraints —
ein gemeinsamer Endpunkt wäre die erste Stelle, an der sie wieder
zusammenliefen.

**Beim Testen:** Der erste Test für die Regal-Etiketten prüfte auf `"P-"` im
PDF-Text und wurde rot. PDFKit legt Schriftzeichen als Glyphen-Kennungen ab —
dasselbe war bei den Geräte-Etiketten schon einmal aufgefallen. Der Test
prüft jetzt das Belegbare (maßhaltiges PDF mit Inhalt) und zusätzlich, dass
zwei Regale einen anderen Bogen ergeben als eines; die Lesbarkeit bleibt
ausdrücklich der Handprüfung.

**351 Tests** (vorher 338), Lint sauber, alle sechs Durchläufe grün.

## AP16 — Prüfung bei jedem Push, sichtbare Sicherung (2026-08-23)

Zwei Punkte, die nach dem Push nach GitHub möglich bzw. überfällig waren.

**Prüfkette in der Werkbank.** `.github/workflows/pruefung.yml` fährt bei
jedem Push auf `master` und bei jedem Pull Request: `npm ci`, Migration,
Lint, beide Typprüfungen, 357 Tests, Bau, Schemaprüfung — gegen einen echten
Postgres-Dienst.

*Warum überhaupt, bei einer Person am Code:* Es fängt genau die Fehler, die
beim „schnell noch was ändern" entstehen, wenn man den Testlauf abkürzt.
Zwei Einstellungen sind dabei bewusst gesetzt: `LEAK_PRUEFUNG=false` (der
Abgleich gegen bekannte Passwortlecks geht ins Internet und würde jeden Lauf
von einem fremden Dienst abhängig machen) und ein `JWT_SECRET`, das nur dort
gilt. Die Testsuite überspringt ohne Datenbank **nichts**, sondern bricht
laut ab — genau deshalb steht der Postgres-Dienst in der Werkbank.

**Die Sicherung meldet sich, wenn sie scheitert.** Sie lief nachts per cron
und brach im Fehlerfall still ab; gemerkt hätte man es, wenn man sie braucht.
Da diese Anwendung bewusst keine Mails verschickt, nimmt die Meldung den
umgekehrten Weg: `scripts/sicherung.sh` schreibt den Ausgang jedes Laufs nach
`daten/sicherung-stand.json` (ein `trap ... ERR` fängt auch einen Abbruch
mitten im Lauf), und die Übersicht zeigt ihn unter *Mehr → Verwaltung →
Datensicherung* — grün bei „heute gesichert", rot ab drei Tagen, bei einem
Fehlschlag und wenn noch nie gesichert wurde.

**Warum eine Datei und kein Eintrag in der Datenbank:** Die Sicherung muss
auch dann noch melden können, wenn genau die Datenbank das Problem ist.

Sichtbar nur mit `benutzer.verwalten` — den Zustand der Anlage geht einen
Mitarbeiter auf der Baustelle nichts an (geprüft: 403).

**Sechs Tests**, darunter die beiden Fälle, die im Betrieb wirklich
vorkommen: halbes JSON aus einem abgebrochenen Schreibvorgang und ein
unbrauchbarer Zeitstempel — beides ergibt „nichts bekannt" statt einer
Fehlermeldung über eine Nebensache. *Der erste Testlauf schlug fehl, weil die
Datei aus einem Handtest noch dalag: Aufgeräumt wurde nach jedem Test, nötig
war es davor.*

## AP17 — Abnahme des ganzen Pakets (2026-08-28)

Eine Durchsicht des fertigen Stands: alles noch einmal geprüft, die Doku gegen
den Code gemessen und die Installation von Null durchgespielt. **Drei echte
Fehler, alle in Prüfwerkzeugen** — und genau deshalb schwer wiegend: Ein
Prüfwerkzeug, das falsch meldet, kostet entweder Vertrauen oder deckt etwas zu.

**1. Der erste Lauf der neuen Prüfkette war rot** — und hatte recht.
`api-nummernregister.test.ts` rechnete die nächste Nummer als
`höchste + 1`. In einer frischen Datenbank ist die höchste Nummer aber
`null`, der Test erwartete `00001`; die Anwendung vergibt korrekt `10001`,
weil der Nummernkreis bei 10000 beginnt. **Der Test war nur grün, weil die
Entwicklungsdatenbank längst gewachsen ist.** Die Regel selbst war getestet
(`domain-barcode.test.ts` prüft `naechsteNummer(null) === "10001"`) — der
Integrationstest kannte sie nur nicht. Genau der Fehler, für den eine
Werkbank da ist, die jedes Mal bei Null anfängt.

**2. Die Schemaprüfung meldete bei jeder Erstinstallation einen Mangel.**
Sie fragt unter anderem, ob der Seed ein Benutzerkonto anlegt (er darf
nicht). Ob die Datenbank noch unbenutzt ist, maß sie an Geräten und
Buchungen — **Konten zählten nicht mit**. Der dokumentierte Weg legt aber
erst das Verwaltungskonto an und ruft dann die Prüfung: Sie fand das gerade
angelegte Konto und meldete „erwartet 0, gefunden 1". Wer der Anleitung
folgte, bekam beim ersten Aufsetzen eine rote Zeile zu sehen — an der
Stelle, an der das Werkzeug Vertrauen schaffen soll.

**3. Der Schutz gegen doppelte Nummern wurde gar nicht geprüft.** Die
Prüfung nahm eine vorhandene Nummer und trug sie erneut ein:
`INSERT INTO etikettennummern … SELECT nummer FROM etikettennummern LIMIT 1`.
Auf einer frischen Anlage ist das Register leer, der SELECT traf null Zeilen,
der INSERT lief fehlerfrei durch — und die Prüfung meldete „wurde NICHT
abgelehnt". Sie brachte also einen Mangel zur Anzeige, den es nicht gab, und
hätte einen echten nicht bemerkt. Sie bringt ihre Zeile jetzt selbst mit.
*Gegengeprüft: Primärschlüssel entfernt → rot, wieder angelegt → grün.*

**Der Schutz selbst war nie defekt** — `nummer` ist Primärschlüssel, ein
zweiter Eintrag wird von Postgres abgewiesen (direkt an der Datenbank
nachgemessen). Kaputt war nur das Werkzeug, das es belegen sollte.

**4. Die Sicherung lief nicht, sobald die `.env` unter Windows bearbeitet
wurde.** Der schwerwiegendste Fund, weil er die letzte Verteidigungslinie
trifft. `wert_aus_env` liest die Zugangsdaten per `sed` aus der `.env`; hängt
dort ein Wagenrücklauf an, bekommt `pg_dump` den Benutzer `tracker\r` und
Postgres antwortet `role "tracker" does not exist`. **Das `\r` ist in der
Meldung unsichtbar** — man sucht den Fehler in der Datenbank, in den
Berechtigungen, in Compose, nur nicht in den Zeilenenden. Im Repo steht die
Vorlage dank `.gitattributes` mit LF, auf dem Mini-PC tritt es beim strikten
Befolgen der Anleitung also nicht auf; wer die `.env` aber am Windows-Rechner
mit Passwörtern befüllt und hinüberkopiert, steht ohne Sicherung da — und
merkt es erst, wenn er sie braucht. Beide Skripte entfernen den Wagenrücklauf
jetzt selbst. *Gegengeprüft mit genau der `.env`, an der es scheiterte.*

**5. Die Rückspielung überging eine fehlende Dateisicherung stumm.** Der
abgebrochene Lauf aus Befund 4 hinterließ einen halben Stand: Datenbank ja,
Fotos nein. `if [ -f "$DATEI_DATEI" ]` sprang ohne `else` darüber — die
Wiederherstellung meldete „Fertig", während jeder Fotoeintrag ins Leere zeigte.
Jetzt eine deutliche Warnung mit dem fehlenden Dateinamen.

**Und ein Fund in der eigenen Arbeit:** Der Fix zu Befund 4 stand zuerst als
**echtes Steuerzeichen** im Skript (`tr -d '<CR>'` statt `tr -d '\r'`).
Funktioniert — aber unsichtbar, und ein Kopiervorgang hätte es stillschweigend
verschluckt. Damit wäre die Härtung wirkungslos gewesen, ohne dass irgendwo
etwas rot geworden wäre. *Das ist in diesem Projekt jetzt das dritte Mal:
BOM im Quelltext (AP14), CRLF im Container (AP11), und nun dies. Die Lehre von
AP14 gilt unverändert — gleiche Wirkung, aber sichtbar geschrieben.*

**Was die Abnahme sonst bestätigt hat** (frische Installation in WSL, drei
Container aus dem gebauten Abbild): alle zehn Migrationen laufen von selbst ·
erstes Konto über die Kommandozeile inklusive Leck-Abgleich · Rauchtest
10 von 10 · **23 Schutzregeln, diesmal samt der drei Seed-Regeln, die nur auf
einer unbenutzten Datenbank etwas aussagen** · alle sechs Durchläufe · die
erste vergebene Nummer ist 10001 · HTTPS über Caddy mit selbst ausgestelltem
Zertifikat, Cookie mit `HttpOnly; Secure; SameSite=Strict` · Datenbank ohne
Host-Port · Anwendung als uid 1000 · **Rückspielweg nach `down -v`**: nach
vollständigem Verlust beider Volumes waren 28 Geräte, 4 Buchungen, 2 Konten,
30 Nummern und die Fotos wieder da, die Anmeldung lieferte 200 · Update-Weg
ohne Datenverlust · 357 Tests gegen eine frische Datenbank.

**Zwei Prüfungen, die es vorher nicht gab**, beide ohne Befund: Jeder der
38 Aufrufe der Oberfläche trifft eine der 70 registrierten Routen, und keine
Ansicht ist unerreichbar. Die zweite Frage hatte bei AP15 die vergessene
Fristenliste zutage gefördert — deshalb prüft sie jetzt ein Skript statt eines
Zufalls.

**Doku gegen den Code gemessen:** „zwei Docker-Container" stimmte seit AP13
nicht mehr (Caddy kam dazu), und die Konventionen empfahlen `npx vue-tsc` —
das lädt eine fremde Fassung aus dem Netz und meldet einen `baseUrl`-Fehler,
den das Projekt gar nicht hat. Richtig ist `npm --prefix web run pruefe`.
Rechte (13), Rollenumfänge (3/9/13) und alle Querverweise stimmten.

**In die Betriebsanleitung aufgenommen:** der Portkonflikt (`Bind for :::80
failed`) samt Befehl, um den Belegern auf die Spur zu kommen — auf einem
Mini-PC mit vorinstalliertem Webserver der wahrscheinlichste Stolperstein beim
ersten Start; und dass der Kontobefehl Rückfragen stellt und deshalb eine
echte Sitzung braucht.

## AP18 — Baustellen anlegen, wo man sie braucht (2026-08-29)

Julius' Frage beim ersten Zugriff vom Handy: „Wie lege ich Projekte an?" Die
Antwort war unangenehm: **gar nicht.** `POST /standorte` gab es seit AP4, mit
Rechteprüfung und Tests — nur rief es keine Ansicht auf. `OrteView` zeigte
Standorte an und listete ihren Bestand, mehr nicht. Dasselbe gilt weiterhin
für Lagerplätze, Schlagworte und Prüfarten.

**Warum es nie auffiel:** Die sechs Durchläufe und die Beispieldaten legen
Standorte selbst an. Wer die Anwendung zum Ausprobieren öffnet, findet immer
schon welche vor. Die Lücke zeigt sich erst, wenn jemand eine neue Baustelle
braucht — also im ersten echten Arbeitstag.

**Und die Abnahme von AP17 hat sie übersehen.** Dort stand „keine toten
Endpunkte"; die Suche zählte aber Tests und Durchlauf-Skripte mit, und die
rufen `POST /standorte` auf. Die richtige Frage lautet: *Ruft die Oberfläche
es auf?* Ein zweiter Anlauf lieferte ebenfalls Unsinn, weil die Oberfläche
neunmal direktes `fetch()` statt `api.post()` verwendet und das Muster daran
vorbeigriff. Belastbar wurde es erst durch direktes Nachsehen.
*Merksatz: Wer prüft, ob etwas benutzt wird, muss sagen — von wem.*

**Gebaut, an zwei Stellen:**

1. **`OrteView`** — „Neue Baustelle anlegen" mit Name, Art und Adresse. Nach
   dem Speichern bleibt das Formular offen und der Typ stehen: Beim
   Ersteinrichten legt man mehrere am Stück an.
2. **`BuchenView`** — „Baustelle ist noch nicht dabei" direkt unter der
   Zielauswahl. Der Fall aus der Praxis: Der Auftrag ist neu, das Gerät steht
   schon auf dem Hänger. Wer dafür die Buchung verlassen müsste, bucht am Ende
   gar nicht oder auf den falschen Ort — und **falscher Bestand ist in dieser
   Anwendung der teuerste Fehler.** Der neue Ort wird sofort ausgewählt.
   Nur beim Hinausgeben; ins Lager zurück geht es an Orte, die es längst gibt.

Beides nur mit `stammdaten.pflegen`. Ein neuer Ort landet über
`bestand.ergaenzeStandort()` sofort im Store und steht damit in **jedem**
Auswahlfeld, ohne dass die ~200 Geräte neu geladen werden.

**Gegen Dubletten:** Ein Hinweis erscheint, bevor gespeichert wird, sobald der
Name einem vorhandenen Ort ähnelt („Es gibt bereits ‚Bauhof Nord'."). Er
blockiert nicht — es kann ja ein anderer Ort sein. Ohne das entstünden mit der
Zeit „Lindengasse", „Lindengasse 14" und „lindengasse" nebeneinander, und der
Bestand verteilte sich auf drei Orte, die dasselbe meinen; die Datenbank
verhindert nur exakte Dubletten unter den aktiven Orten.

**Der Fund beim Bauen — erfundene Klassennamen.** Der erste Entwurf benutzte
`pt-knopf`, `pt-knopf--weit` und `pt-knopf--still`. **Keine davon existiert**;
die Klassen heißen `pt-btn`, `pt-btn--breit`, `pt-btn--still`. Ebenso
`var(--radius-1)` statt `--radius-md`. Weder `vue-tsc` noch ESLint schlagen
hier an: CSS-Klassen sind für sie bloße Zeichenketten. Das Formular wäre
vollständig ungestaltet ausgeliefert worden — genau der Befund, der in PATIO
dazu führte, dass **zehn Ansichten seit ihrem Bau ungestaltet liefen**.
Gefunden durch einen Abgleich jeder benutzten Klasse und jeder CSS-Variablen
gegen `basis.css`/`tokens.css`; seither: 26 bzw. 31 Klassen, alle vorhanden.

**Im Browser abgenommen:** Formular öffnet · Dublettenwarnung erscheint bei
„Bauhof" · „Prüfbaustelle Wienerberg" angelegt, steht **ohne Neuladen** in der
Liste (32 → 34 aktiv) · in `BuchenView` „Prüfbaustelle Donaufeld" aus dem
Buchungsvorgang heraus angelegt und **sofort ausgewählt** · Gerät darauf
gebucht, Status „ausgegeben". Prüfspuren danach zurückgebucht und die beiden
Orte stillgelegt.

**Noch offen:** Lagerplätze, Schlagworte und Prüfarten lassen sich weiterhin
nur über die API pflegen. Prüfarten braucht man einmal beim Einrichten,
Schlagworte gelegentlich — Baustellen waren der dringende Fall.

## AP19 — Alle Stammdaten bedienbar, und eine Prüfung, die das sicherstellt (2026-08-29)

Julius: „bitte einbauen. Das Programm muss wasserdicht sein." Zwei Teile also:
die restlichen Lücken schließen — und dafür sorgen, dass sie nicht unbemerkt
wiederkommen.

**Zuerst das Prüfwerkzeug**, weil erst dadurch die Bestandsaufnahme belastbar
wurde: `scripts/pruefe-oberflaeche.mjs` (`npm run pruefe:oberflaeche`, dazu ein
Schritt in der Werkbank). Es prüft zwei Fehlerarten, die in diesem Projekt
beide vorgekommen sind und die **weder TypeScript noch ESLint sehen können**:

1. *Eine schreibende Route ohne Bedienung.* So blieben Baustellen unanlegbar
   (AP18) und die Fristenliste unerreichbar (AP15).
2. *Eine CSS-Klasse oder Gestaltungsvariable, die es nicht gibt.* Für den
   Übersetzer ist beides eine gültige Zeichenkette; die Ansicht wird stumm
   ungestaltet ausgeliefert.

**Der erste Lauf fand drei Fehler im Bestand**, die niemand kannte:
`pt-chip--warnung` existierte nicht — in der Benutzerverwaltung erschien
„Passwort wechseln nötig" **ohne Warnfarbe**, ein Verwalter sah es nicht auf
einen Blick. Dazu `var(--tracking-wide)`, das es ebenfalls nicht gibt (richtig:
`--tracking-label`). Der dritte war ein **Fehlalarm des Skripts**: `konflikt`
ist ein BEM-Block zu `.konflikt__stand` und braucht keine eigene Regel — das
Skript erkennt solche Blöcke jetzt. *Ein Prüfwerkzeug, dem man nicht glaubt,
wird abgeschaltet; Fehlalarme sind deshalb kein Schönheitsfehler.*

**Gebaut — die restlichen sieben Bedienungen:**
- **Orte:** bearbeiten und stilllegen (nie löschen — der Name steht in jeder
  Buchung, die dorthin ging), Regalplätze anlegen und umbenennen. Die Kennung
  (`P-0001`) vergibt weiterhin der Server; sie klebt als Etikett am Regal.
- **`StammdatenView` (neu, `/stammdaten`):** Schlagworte anlegen, umbenennen,
  löschen — mit Angabe, an wie vielen Geräten eines hängt, bevor man es
  entfernt; Prüfarten anlegen mit Abstand in Worten („jährlich" statt „alle 12
  Monate"). Bewusst **eine** Ansicht für beides: zwei Menüpunkte für zwei kurze
  Listen wären mehr Navigation als Inhalt.

Zwei Ausnahmen stehen mit Begründung im Skript statt als Ansicht:
`POST /buchungen/korrektur` (eine Gegenbuchung soll niemand im Vorbeigehen
auslösen) und `POST /etiketten/altbestand` (einmalig beim Einrichten).

**Gestalterisch korrigiert:** Der erste Entwurf gab jedem Schlagwort einen
roten „Löschen"-Knopf. Bei zwanzig Zeilen sind das zwanzig rote Flächen
untereinander — lauter als alles andere auf der Seite, und das Auge gewöhnt
sich daran. `pt-btn--gefahr` wird im ganzen Projekt **nirgends** verwendet;
destruktive Aktionen sind stille Knöpfe, der Schutz ist die Rückfrage. Jetzt
auch hier.

**Gegenprobe des Werkzeugs:** Eine erfundene Klasse und eine entfernte
Bedienung eingeschmuggelt — beide gemeldet, Rückgabewert 1, die Werkbank
stolperte. Danach zurückgenommen: grün.

**Ein Verdacht, der sich nicht bestätigt hat.** Im Browser fiel
„BaustellenkreissÃ¤ge" auf, in der Datenbank ebenso `RÃ¼ttelplatte` und
`NivelliergerÃ¤t` — Doppelkodierung. Das wäre vor einem Import von 200 Geräten
ein ernster Befund gewesen. Nachgemessen: **Die Anwendung schreibt korrekt**,
über den Browser wie über Node (`identisch: true`), und die volle
Export-Import-Runde hält Umlaute heil (`PRUEF-Rüttelplatte Größe Ä`, Export mit
BOM). Kaputt sind allein Altdaten aus Testläufen, die über `curl` aus Git Bash
eingespielt wurden — dort reicht die Shell Latin-1 durch. *Werkzeugfehler in
der Prüfumgebung, nicht im Programm; der Unterschied war eine Messung wert.*

**Stand:** 357 Tests, 23 Schutzregeln, ESLint, beide Typprüfungen und die neue
Oberflächenprüfung grün. **Jede der 37 schreibenden Routen ist bedienbar.**

**Was „wasserdicht" hier nicht heißt:** Es gibt weiterhin keine
Frontend-Unit-Tests. Die Ansichten sind im Browser abgenommen und durch die
Oberflächenprüfung gegen die zwei häufigsten stummen Fehler abgesichert — eine
Testumgebung für Komponenten (vitest + jsdom) wäre ein eigenes Arbeitspaket.

## AP20 — Durchsicht der Oberfläche im Handyformat (2026-08-30)

Gemessen statt geschätzt, bei 375x812 im Browser.

**Was trägt:** Der ganze Bestand kostet **12,4 KB gzip** (290 Geräte, 161 KB
roh), alle vier Startabfragen zusammen rund 15 KB — weniger als ein einzelnes
Baustellenfoto. Der Entwurf „alles laden, im Browser filtern" ist damit für
diese Größenordnung belegt, nicht bloß behauptet. Das 1-MB-WASM des
Barcode-Lesers wird **erst beim Scannen** nachgeladen (dynamischer Import),
Ansichten werden einzeln nachgeladen, und der Hauptweg „Gerät ausgeben"
braucht **zwei Tipper**, weil Ziel und Person vorbelegt sind.

**Vier Befunde, alle behoben:**

1. **Die Filterleiste war das kleinste Tippziel der Anwendung** — 37 px,
   der „Neu"-Knopf 40 px, gegen die eigene Vorgabe von 48 px („Daumen statt
   Maus, teils mit Handschuhen"). Jetzt 48 px; **alle** Tippziele liegen
   darüber. *Beim Beheben zunächst überschossen: Mit größerem seitlichen
   Abstand wurden die vier Filter zusammen breiter als der Bildschirm und
   „Defekt" rutschte hinaus. Die Leiste scrollt zwar, aber ein Filter, den
   man erst heranziehen muss, wird nicht benutzt — korrigiert gehörte die
   Höhe, nicht die Breite.*

2. **Die Trefferliste war falsch sortiert.** Bei Eingabe von `1001` kamen
   10011, 10010, 10015, 10016 — alphabetisch nach Bezeichnung. Wer eine
   Nummer vom Etikett abtippt (der Normalfall bei streikender Kamera oder
   verschmutztem Etikett), sucht die Nummer. `suche()` sortiert reine
   Ziffern jetzt numerisch, Präfix-Treffer zuerst; die Zahl wird als Zahl
   verglichen, sonst käme 10100 vor 10011. Nachgemessen: 10010, 10011,
   10012, 10013 …

3. **Der Sucher belegte die halbe Höhe, auch ohne Kamera.** Verweigert der
   Browser den Zugriff, blieb ein leerer schwarzer Block über 46 % der Höhe
   stehen — ausgerechnet im Handeingabe-Fall, wo die Trefferliste den Platz
   braucht. Er schrumpft jetzt auf die Meldung. **Ausdrücklich nicht** bei
   „startet" oder „aus": Dort kommt die Kamera gleich, und ein springendes
   Layout unter dem Daumen ist schlimmer als ein Moment ungenutzter Fläche.
   *Dabei selbst einen Fehler gebaut: Die absolut positionierten Licht- und
   Tastatur-Knöpfe lagen danach über der Meldung. Ohne Kamera sind beide
   gegenstandslos — Licht schaltet nichts, die Handeingabe steht schon offen
   — und entfallen jetzt.*

4. **Die inaktiven Reiter der Hauptnavigation** standen auf `--fg-subtle`:
   **2,56:1** bei 11 px, bei Sonnenlicht kaum zu lesen. Jetzt `--fg-muted`
   mit **7,73:1** (Norm 4,5); der aktive Reiter bleibt mit 19,8:1 klar
   abgesetzt.

**Eine Korrektur in eigener Sache — und eine Lehre über das Messen.**
Zwischendurch hatte diese Durchsicht gemeldet, die aktive Navigation
funktioniere nicht: Alle vier Reiter zeigten dieselbe Farbe. **Das war
falsch.** Die Messungen liefen über `javascript_tool` in einem isolierten
Kontext, in dem selbst ein `!important`-Inline-Stil nicht ankam — die Werte
waren wertlos. Aufgefallen ist es nur, weil das Ergebnis *technisch
unmöglich* war: Einen Wert, den `!important` nicht ändert, gibt es im Browser
nicht. Der Screenshot zeigte dann eindeutig, dass die Regel greift.
*Merksatz: Wenn eine Messung etwas Unmögliches behauptet, ist zuerst die
Messung verdächtig, nicht der Code.* Größenangaben aus derselben Quelle haben
sich mit den Screenshots gedeckt und sind belastbar; die Farbwerte wurden
verworfen und über die Tokens nachgerechnet.

**Ungetestet bleibt** die neue Sortierlogik in `suche()` — sie ist im Browser
verifiziert, aber es gibt weiterhin keine Frontend-Testumgebung (siehe AP19).

## AP21 — Testumgebung für die Oberfläche (2026-08-30)

Die letzte offene Lücke: Das Frontend hatte **keine Tests**. Bei jeder Runde
stand am Ende „im Browser verifiziert" — was für einen Durchgang reicht, aber
nichts festhält. Die Sortierlogik aus AP20 war das jüngste Beispiel.

**Eingerichtet:** eigene Vitest-Umgebung unter `web/` (jsdom,
`@vue/test-utils`), `npm run test:web`, ein Schritt in der Werkbank. **Bewusst
getrennt** von der Server-Suite: Die läuft gegen eine echte Datenbank, diese
gegen gar nichts. Müsste jeder Frontend-Test erst Postgres hochfahren, führte
sie niemand mehr aus.

**20 Tests in drei Dateien:**
- `bestand-suche.test.ts` — die Reihenfolge der Treffer. Reine Ziffern werden
  numerisch sortiert, Präfix-Treffer zuerst, und die Zahl als **Zahl**
  verglichen (sonst käme 10100 vor 10011). Textsuche bleibt unangetastet.
- `bestand-pflege.test.ts` — dass ein neu angelegter Ort, Regalplatz oder
  ein Schlagwort sofort im geladenen Bestand steht („automatisch hinterlegt",
  Julius' Vorgabe) und beim Ändern **ersetzt** statt verdoppelt wird. Dazu
  der Fall, der sonst still schiefgeht: Ein gelöschtes Schlagwort muss auch
  **an den Geräten** verschwinden.
- `orte-anlegen.test.ts` — die Ansicht selbst: kein Formular ohne
  `stammdaten.pflegen`, kein Absenden bei leerem Namen, die Dublettenwarnung
  erscheint und **blockiert nicht**, und eine leere Adresse geht als `null`
  hinaus statt als leerer Text.

**Alle drei gegengeprüft:** Sortierung ausgebaut → 3 Tests rot.
Rechteprüfung und Dublettenwarnung ausgebaut → 2 Tests rot. Danach
zurückgenommen: grün.

**Zwei Fallen beim Aufsetzen:**
1. **Der erste Testlauf war rot — und der Fehler lag im Test.** `10015`
   enthält „1001" ebenfalls als Präfix und gehört in die Erwartung. Die Suite
   hat ihren ersten eigenen Fehler sofort gemeldet.
2. **jsdom löst bei einem Klick auf `type="submit"` kein `submit` aus**,
   anders als jeder echte Browser. Zwei Tests schlugen deshalb fehl, obwohl
   der Code stimmte; sie senden das Formular jetzt direkt ab.

**Nachgezogen:** ESLint prüft `web/tests/` mit, und die Typprüfung erfasst
die Testdateien — vorher deckte `include` nur `src/` ab, ein Typfehler im Test
wäre also niemandem aufgefallen. *Gegengeprüft mit einem eingeschmuggelten
Typfehler.* `vitest.config.ts` bleibt bewusst außen vor: vitest bringt eine
eigene Vite-Fassung mit, deren Plugin-Typen mit der rolldown-basierten
Projekt-Vite kollidieren — ein Konflikt zweier Fremdpakete, den das Projekt
nicht zu lösen hat.

**Stand: 377 Tests** (357 Server, 20 Oberfläche), 23 Schutzregeln, ESLint,
beide Typprüfungen und die Oberflächenprüfung grün.

## AP22 — Zustandsfotos und die vollständige Liste (2026-08-30)

Zwei von drei Vorschlägen aus der Durchsicht umgesetzt. **Der dritte wurde
zurückgezogen**, siehe unten.

**Zustandsfoto bei der Übergabe.** Der Fall: Ein Gerät kommt beschädigt
zurück, und niemand kann belegen, wie es hinausging — bei Fremdfirmen der
klassische Streitpunkt. In `BuchenView` gibt es jetzt ein freiwilliges Foto,
in der Historie erscheint es bei der zugehörigen Buchung.

*Der Unterbau stand schon vollständig:* `dateien.buchung_id` gibt es samt
Fremdschlüssel seit AP8, die Upload-Route nimmt das Feld entgegen, die
Datenschicht speichert es. Es fehlte allein die Bedienung — dieselbe Sorte
Lücke wie bei den Standorten. **Die Oberflächenprüfung fand sie nicht**, weil
sie Routen prüft, keine Parameter: `POST /dateien` wird ja aufgerufen, nur
ohne `buchung_id`. Eine Grenze des Werkzeugs, die man kennen muss.

**Reihenfolge und Fehlerfall sind Absicht:** Das Bild geht **nach** der
Buchung hinaus (es hängt an ihr, also muss sie zuerst existieren), und ein
gescheiterter Upload wirft die Buchung **nicht** um — der Bestand ist die
Hauptsache, das Bild eine Beigabe.

**Drei Fehler, die erst die Abnahme zutage förderte:**

1. **Die Warnung war unsichtbar.** Scheitert der Upload, erschien die Meldung
   nur im Formular — das nach dem Buchen sofort dem Fertig-Bildschirm weicht.
   Der Benutzer hätte das Foto für gespeichert gehalten. *Ein Test hat das
   gefunden, bevor es jemand im Betrieb tat.*
2. **Das Zustandsfoto wurde zum Titelbild des Geräts.** Das erste Foto eines
   Geräts wird von selbst zum Titelbild (damit die Liste nicht grau bleibt) —
   mit Übergabefotos hieße das: Ein Gerät trägt fortan den Schnappschuss vom
   Hänger im Regen als Aushängeschild. Im Browser gesehen, sonst nirgends.
   Jetzt ausgenommen, **und ebenso Schadensfotos** — auch ein Riss im Gehäuse
   ist kein Portrait des Geräts.
3. **Der erste Fix war halb.** Die Zählung „gibt es schon ein Foto?" rechnete
   das Zustandsfoto weiter mit — ein Gerät, bei dem zuerst ein Übergabefoto
   entstand, hätte **nie mehr** ein Titelbild bekommen. Der Test, den ich für
   Fehler 2 geschrieben hatte, deckte es sofort auf.

**Das Formular wurde dabei zu lang.** Mit dem Foto-Feld als eigener Zeile
rutschte der „Ausgeben"-Knopf auf gängigen Handys **unter die
Navigationsleiste** (34 px Überlappung bei 375×812, 2 px bei 390×844) — der
Hauptweg brauchte plötzlich einen Scrollvorgang. Beschriftung und Knopf
stehen jetzt in einer Zeile; nachgemessen: 25 px Luft.

**„Derzeit draußen" sagt jetzt, dass es mehr gibt.** Die Übersicht schnitt
nach zwölf Einträgen ab, ohne Hinweis — bei vierzig ausgegebenen Geräten sah
man zwölf und hielt das für alles. Jetzt steht die Zahl in der Überschrift
(„12 von 40"), und der letzte Eintrag führt zur vollständigen Liste. Dafür
nimmt die Geräteansicht den Filter aus der Adresse entgegen
(`/geraete?status=ausgegeben`) — eine zweite Liste zu bauen, die dasselbe
zeigt, wäre doppelte Pflege.

**Zurückgezogen: der Index auf den Prüfungen.** Der Vorschlag beruhte auf
einem **falschen Tabellennamen** — gemessen wurde `pruefungen`, die es nicht
gibt; die Tabelle heißt `geraet_pruefungen` und hat drei Indizes, darunter
einen passenden. Für die Fristenliste bleibt ein Sortierschritt, der bei
realistischen Datenmengen nicht ins Gewicht fällt (alle Abfragen unter 13 ms).
Ein weiterer Index brächte nichts und verteuerte jedes Schreiben.
*Ein Befund ist nur so gut wie der Name, den man abgefragt hat.*

**Stand: 385 Tests** (361 Server, 24 Oberfläche), 23 Schutzregeln, ESLint,
beide Typprüfungen und die Oberflächenprüfung grün.

## AP23 — Sammelbuchung, Pakete, Zubehör (2026-08-31)

Drei Dinge, die denselben Alltag betreffen: das Bestücken eines Transporters.

**Sammelbuchung.** Zehn Geräte auf dieselbe Baustelle waren zehnmal derselbe
Durchlauf — **dreißig Handgriffe**. Jetzt: Schalter „Mehrere sammeln" im
Scanner, alles einlesen, einmal Ziel und Person wählen, einmal bestätigen.

**`POST /buchungen/sammel` bucht alles oder nichts** in einer Transaktion.
Eine halb ausgeführte Sammelbuchung hinterließe einen Bestand, den niemand
mehr erklären kann — welche fünf der zehn sind jetzt draußen? Die Meldung
nennt das Gerät beim Namen („ZUB-Minibagger 1,8 t (97254): Dieses Gerät ist
bereits ausgegeben."), es wird aus der Liste genommen, der Rest geht durch.
Die Sperren werden **nach Id sortiert** geholt, sonst blockieren sich zwei
gleichzeitige Sammelbuchungen mit überlappenden Geräten gegenseitig.

**Zubehör fährt mit.** Das Datenmodell kennt es seit AP8
(`geraete.gehoert_zu_id`), **beim Buchen wurde es nie berücksichtigt** — wer
den Bagger ausgab, ließ die Löffel im Bestand stehen, obwohl sie auf dem
Hänger lagen. Jetzt wird es vorgeschlagen: **vorangehakt** (der Regelfall)
und **abwählbar** (manchmal bleibt der Löffel da). Auch bei der
Einzelbuchung; geht Zubehör mit, wird daraus intern eine Sammelbuchung —
sonst könnte der Bagger draußen stehen und der Löffel laut System im Lager.

**Pakete** (Migration 011, `pakete` + `paket_geraete`): benannte
Zusammenstellungen für den wiederkehrenden Fall — zur Estrich-Baustelle
fahren immer dieselben acht Geräte. **Ein Paket hält keinen eigenen
Bestand**, es zeigt nur auf Geräte; wo etwas steht, sagt allein das Gerät.
Zwei Wahrheiten darüber liefen unweigerlich auseinander. Ein Gerät darf in
mehreren Paketen stecken, und „Paket ausgeben" ist ein **Vorschlag**: Es
füllt die Sammelliste, gebucht wird, was tatsächlich mitfährt.

**Zwei Fehler, die nur die Tests gefunden haben:**

1. **Jedes `POST /pakete` antwortete mit 404** — obwohl das Paket entstand.
   `legePaketAn` las die neue Zeile mit `findePaket()` **innerhalb** der
   offenen Transaktion, aber über `db()` statt `tx`: dort ist sie noch nicht
   sichtbar. Im Betrieb hätte der Benutzer einen Fehler gesehen, es erneut
   versucht — und wäre an der Namensdublette hängengeblieben. Jetzt erst
   committen, dann lesen (dasselbe Muster wie `buche()`).
2. **Meine erste Gegenprobe blieb grün.** Der Test für „alles oder nichts"
   hing an der zufälligen UUID-Reihenfolge: Lag das defekte Gerät vorn, war
   ohnehin nichts gebucht — auch ohne Transaktionsklammer. Jetzt werden drei
   Geräte angelegt, nach Id sortiert und das **letzte** auf defekt gesetzt;
   damit sind garantiert zwei gebucht, bevor der Fehler auftritt.
   *Merksatz aus AP12, hier zum zweiten Mal bestätigt: Eine Gegenprobe, die
   grün bleibt, ist ein Befund über den Test.*

**Und einer, der beim Schreiben auffiel:** Bei der Einzelbuchung mit Zubehör
nahm ich `buchungen[0]` als „eigene" Buchung fürs Zustandsfoto — der Server
sortiert aber nach Id, das Bild hätte am Löffel statt am Bagger gehangen.
Jetzt wird die Buchung dieses Geräts gezielt herausgesucht.

**Im Browser abgenommen** (390×844): Sammelmodus ein, zwei Geräte per
Handeingabe eingelesen, **eines doppelt gescannt und nicht verdoppelt**;
Zubehör des Baggers automatisch angeboten und vorangehakt; den
Hydraulikhammer abgewählt → **3 Geräte gebucht**, der Hammer blieb
verfügbar; in der Datenbank **3 Buchungen mit 0 ms Zeitspanne** (eine
Transaktion). Paket angelegt, zwei Geräte zugeordnet, „Paket ausgeben" →
Liste gefüllt samt Zubehör. Erneutes Ausgeben der bereits ausgegebenen
Geräte → Fehlermeldung mit Namen und Nummer, **kein einziges gebucht**.

**Stand: 407 Tests** (377 Server, 30 Oberfläche), 23 Schutzregeln, ESLint,
beide Typprüfungen und die Oberflächenprüfung grün.

**Bewusst nicht gebaut:** kein Paket-Bestand (ein Paket sagt nie, wo es
„ist"), kein Zubehör von Zubehör (eine Ebene, wie das Datenmodell), keine
Teilbuchung.

## Nächster Schritt

**Kamera-Abnahme am echten Etikett** mit iPad und Android — braucht die
HTTPS-Adresse, steht also erst nach dem ersten Aufsetzen an. Protokoll:
`docs/scanner-abnahme.md`.

Danach: Bestand erfassen (Import oder einzeln), Etiketten für Geräte ohne
Aufkleber drucken.

## Konventionen

- Deutsch in Doku, Kommentaren, UI und Commit-Messages; englische Bezeichner im Code,
  wo üblich. Fachbegriffe der Domäne (`geraete`, `buchungen`, `standorte`) auf Deutsch.
- Vor jedem Commit: `npx tsc --noEmit`, `npm run lint`, `npm test`, ab Frontend
  zusätzlich `npm --prefix web run pruefe` (vue-tsc).
  *Nicht `npx vue-tsc`: Das zieht eine fremde Version aus dem Netz und meldet
  einen `baseUrl`-Fehler, den das Projekt mit seiner eigenen Fassung nicht hat.*
- **Kein Push ohne ausdrückliche Aufforderung.** `.claude/` und `.env` nie committen.
- Migrationen forward-only, nummeriert, idempotent. Buchungen sind append-only —
  die Datenbank verweigert `UPDATE` und `DELETE` per Rule.
