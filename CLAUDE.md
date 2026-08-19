# Geräte-Tracker — Baustellengeräte per Barcode verfolgen

Web-Anwendung für Handy und iPad: Baumaschinen mit vorhandenen 1D-Strichcode-Etiketten
scannen, ausgeben, zurücknehmen — mit lückenloser Historie, wer ein Gerät wann auf
welche Baustelle gebracht hat.

**Stand: 2026-08-19 — AP1 bis AP10 fertig.** Anmelden, scannen, ausgeben,
zurücknehmen, umbuchen; Fotos und Dokumente; Prüfungen; Schäden; Zubehör;
Geräte anlegen und bearbeiten, Import/Export als Tabelle, Etikettendruck;
**Benutzerverwaltung in der Oberfläche mit frei zusammenstellbaren Rollen.**
Vollständiger Plan: [`docs/PLAN.md`](docs/PLAN.md),
Bedienung der Benutzerverwaltung: [`docs/BEDIENUNG.md`](docs/BEDIENUNG.md).

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
npm test                                          # 323 Tests
node scripts/rauchtest.mjs <name> <passwort>      # Anmeldung, gegen die laufende App
node scripts/durchlauf.mjs <name> <passwort>      # Büro-Weg: anlegen, etikettieren
node scripts/durchlauf-buchen.mjs <name> <pw>     # Baustellen-Weg: scannen, buchen
node scripts/durchlauf-pflege.mjs <name> <pw>     # Fotos, Prüfungen, Schäden, Zubehör
node scripts/durchlauf-erfassung.mjs <name> <pw>  # Anlegen, Export, Excel-Runde, Import
node scripts/beispieldaten.mjs <name> <pw>        # Bestand zum Ansehen
npx tsx scripts/pruefe-schema.ts                  # 19 Schutzregeln der DB
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
`scripts/pruefe-schema.ts` prüft **19 Schutzregeln am laufenden Schema** — alle grün.

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
2. **`scripts/pruefe-schema.ts` legte ein Konto mit der Rolle `admin` an**, die
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

**Noch nicht gebaut:** Der Betriebsweg. `.env.example` und `docs/PLAN.md`
sprechen von `docker-compose.yml`, Dockerfile, Caddy und Cloudflare-Tunnel —
**davon existiert nichts**. Das ist das nächste Arbeitspaket, nicht ein
vergessener Rest.

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
(postgres + app + caddy + cloudflared).

Geerbt von `../patio` — gleiche Konventionen, damit nichts Neues zu lernen ist.
Drei bewusste Abweichungen: JWT im **httpOnly-Cookie** statt localStorage ·
`ApiError`-Klasse im Frontend statt nacktem `Error` · **mobile-first** statt
3-Spalten-Bürooberfläche.

## Betrieb

Mini-PC im Büro, erreichbar über eine öffentliche Domain per **Cloudflare Tunnel**
(keine Portfreigabe am Router). Das echte HTTPS-Zertifikat ist **technische
Voraussetzung**: `getUserMedia()` gibt die Kamera nur im *secure context* frei —
ein selbstsigniertes Zertifikat reicht nicht, Safari verweigert dann die Kamera.

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

## Nächster Schritt: Deployment

Deployment auf den Mini-PC (Docker Compose, Cloudflare Tunnel, Backup mit
geprüftem Rückspielweg).

**Weiterhin offen und unabhängig davon:** der Kamera-Test am echten Etikett mit
dem iPad. Braucht eine HTTPS-Adresse, siehe `docs/scanner-abnahme.md`.

## Konventionen

- Deutsch in Doku, Kommentaren, UI und Commit-Messages; englische Bezeichner im Code,
  wo üblich. Fachbegriffe der Domäne (`geraete`, `buchungen`, `standorte`) auf Deutsch.
- Vor jedem Commit: `npx tsc --noEmit`, `npm test`, ab Frontend zusätzlich `npx vue-tsc`.
- **Kein Push ohne ausdrückliche Aufforderung.** `.claude/` und `.env` nie committen.
- Migrationen forward-only, nummeriert, idempotent. Buchungen sind append-only —
  die Datenbank verweigert `UPDATE` und `DELETE` per Rule.
