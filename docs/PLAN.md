# Geräte-Tracker — Web-Anwendung für Baustellengeräte mit Barcode

Stand 2026-08-16. **Bewusst klein gehalten:** ~200 Maschinen, eine Handvoll Mitarbeiter.

> **Dieser Plan ist das Dokument von vor dem Bau.** Er ist an drei Stellen von
> der Umsetzung überholt worden; wo das der Fall ist, steht es im Text. Der
> aktuelle Stand steht in [`../CLAUDE.md`](../CLAUDE.md), der Betrieb in
> [`BETRIEB.md`](BETRIEB.md).
>
> 1. **Kein Cloudflare-Tunnel** (Entscheidung vom 2026-08-21). Der Eingang ist
>    **Caddy**, der das Zertifikat selbst holt — entweder von Let's Encrypt
>    (Portfreigabe am Router) oder selbst ausgestellt fürs Büro-Netz. Damit
>    entfallen auch die Cloudflare-Funktionen aus Kapitel 12: Herkunftsfilter,
>    Bot-Abwehr und die vorgelagerte Ratenbegrenzung. Die Anmeldebremse in der
>    Anwendung bleibt und war ohnehin die tragende Schicht.
> 2. **AP10 ist die Benutzerverwaltung geworden**, nicht das Deployment. Der
>    Betrieb kam als AP11, das Nummernregister als AP12, der Eingang als AP13.
>    Danach folgten noch AP14 (ESLint), AP15 (Fristenliste, Health-Check),
>    AP16 (Prüfkette bei jedem Push, sichtbarer Sicherungsstand) und AP17
>    (Abnahme des ganzen Pakets) — der Plan kennt sie nicht, weil sie sich
>    erst aus dem Gebauten ergaben.
> 3. **Ein Nummernregister** war nicht vorgesehen. Ohne es hätte die Vergabe
>    Nummern ausgegeben, die auf noch nicht erfassten Maschinen kleben.

---

# 1. Kontext

Julius verwaltet rund **200 Baumaschinen und Geräte**, die bereits mit klassischen 1D-Strichcode-Etiketten beklebt sind. Es gibt kein System, das festhält, welches Gerät auf welcher Baustelle steht und wer es dorthin gebracht hat. Folge: Suchen, Doppelanschaffungen, verschwundene Geräte, keine Nachweise über fällige Prüfungen.

Ziel ist eine **Web-Anwendung** für Handy und iPad, die den Barcode über die Kamera liest — Handeingabe der Nummer gleichrangig daneben — und daraus eine lückenlose Ausgabe-/Rücknahme-Historie erzeugt.

### Entscheidungen aus den Rückfragen

| Frage | Entscheidung |
|---|---|
| Datenbank | **PostgreSQL 16** (Qdrant war ein Missverständnis — Vektor-DB, hier ungeeignet) |
| Sprache | **TypeScript** durchgängig |
| Betrieb | Eigener **Mini-PC**, erreichbar über öffentliche Internetadresse mit Login |
| Barcode | **1D-Strichcodes**, bereits vorhanden |
| Scannen | **Handy-/iPad-Kamera** + Handeingabe |
| Offline | **Nicht nötig** |
| Umfang v1 | Ausgabe/Rücknahme · Stammdaten & Standort-Übersicht · Prüf-/Wartungstermine · Schadensmeldung mit Foto |
| Anmeldung | **E-Mail oder Benutzername + Passwort**, kein zweiter Faktor |
| Sitzungsdauer | 30 Tage, verlängernd, zentral widerrufbar |
| Herkunft | **Ganz Europa offen** |
| Größenordnung | ~200 Geräte, ~5–10 Benutzer → **kein Bedarf für Paginierung, Volltextindizes, Caching** |

### Was die Größe für den Entwurf bedeutet

Bei 200 Zeilen liefert Postgres jede Abfrage in Millisekunden. Deshalb bewusst **weggelassen**: Cursor-Paginierung, GIN-/Trigram-Indizes, Redis, Zustands-Caching im Frontend, Micro-Optimierung. Die Geräteliste wird **komplett** geladen und im Browser gefiltert — das ist bei dieser Menge schneller als jede serverseitige Filterung und spart eine Menge Code.

**Nicht** weggelassen wird die Sorgfalt an drei Stellen, weil dort Fehler teuer sind: die Buchungslogik (falscher Bestand ist schlimmer als kein Bestand), die Anmeldung (die App steht offen im Internet), und der Scanner (funktioniert er nicht, benutzt niemand die App).

### Ort

`C:\Users\juliu\Documents\Claude\apps\geraete-tracker\` — eigenes Git-Repo, eigene `CLAUDE.md`, eine Zeile in der Workspace-Landkarte. Patio ist ausdrücklich „Planungswerkzeug fürs Büro — nicht für die Baustelle" (Kopfkommentar `apps/patio/src/index.ts`); der Tracker erbt den **Stack**, nicht die Codebasis.

---

# 2. Das Projektrisiko: der Scanner

Alles andere im Stack ist bei Ihnen erprobt. Der Scanner nicht — im gesamten Workspace gibt es **keinen einzigen** Treffer für `BarcodeDetector`, `zxing`, `quagga` oder `getUserMedia`.

**Kamera erzwingt echtes HTTPS.** `getUserMedia()` läuft nur im *secure context*. Das selbstsignierte `local_certs`-Muster aus `apps/patio/docker/Caddyfile` reicht **nicht** — Safari verweigert die Kamera trotz akzeptiertem Zertifikat. Ihre öffentliche Adresse ist damit technische Voraussetzung, nicht Komfort. (`http://localhost` gilt in der Entwicklung als sicher.)

**iOS hat keine `BarcodeDetector`-API.** Auf Android/Chrome gibt es sie, auf iPhone/iPad nicht. Also zweigleisig hinter einer Fassade: nativ wo vorhanden, sonst **`zxing-wasm`** (~1 MB, lokal gebündelt — kein CDN, Konsequenz aus dem Google-Fonts-Befund in `rag-os-app-lokal`).

**1D ist mit der Kamera unzuverlässiger als QR.** Code128 braucht Schärfe über die volle Etikettenbreite; verschmutzt, gewölbt oder im Gegenlicht fällt die Erkennung durch. Gegenmaßnahmen: Handeingabe gleichrangig · ein Code gilt erst nach zwei übereinstimmenden Lesungen (verhindert Zifferndreher, die still das falsche Gerät buchen) · Taschenlampe wo möglich · **mehrere Barcodes je Gerät** erlaubt (Ersatzetikett entwertet das alte nicht) · nach 10 s ohne Treffer blendet sich die Handeingabe von selbst ein.

**AP1 entscheidet über den Rest.** Wegwerf-Testseite, echte Etiketten, echtes iPad. Unter ~70 % Trefferquote wird ein **Bluetooth-Handscanner** zum Hauptweg (40–120 €, meldet sich als Tastatur). Dieser Rückfallweg kostet nichts extra: `useScanner()` liefert ohnehin nur einen String, und das Handeingabefeld nimmt die Tastatureingabe des Scanners direkt entgegen.

---

# 3. Stack

Geerbt von `apps/patio` — bewusst identisch, damit Sie nichts Neues lernen müssen.

| Schicht | Wahl | Vorbild |
|---|---|---|
| Laufzeit | Node 24, TypeScript ESM, `strict: true` | `apps/patio/tsconfig.json` |
| Backend | **Hono 4** + `@hono/node-server` | `apps/patio/src/api/server.ts` |
| DB | **postgres.js**, Tagged-Template-SQL, **kein ORM** | `apps/patio/src/db/client.ts` |
| Migrationen | Plain SQL `NNN_name.sql`, `_migrations`, Auto-Migrate | `apps/patio/src/db/migrate.ts` |
| Auth | argon2id + JWT im **httpOnly-Cookie** | Kapitel 5 |
| Frontend | Vue 3.5 `<script setup>`, Vite, Pinia, vue-router, Tailwind v4 | `apps/patio/web/` |
| Tests | Vitest, `app.request()` gegen die echte Hono-App | `apps/patio/tests/` |
| Betrieb | Docker Compose: postgres + app + caddy + cloudflared | Kapitel 10 |

**Drei bewusste Abweichungen von Patio:**

**a) JWT im httpOnly-Cookie statt localStorage.** Patio musste wegen `localStorage` ein Einmal-Ticket-System für SSE bauen (`src/api/sse-tickets.ts`), weil `EventSource` keine Header setzen kann. Das Cookie erledigt beides — und ein eingeschleustes Skript kann das Token nicht auslesen. Bei einer öffentlich erreichbaren App wiegt das schwer.

**b) `ApiError`-Klasse im Frontend.** Patios `web/src/api.ts` wirft `new Error(text)`; der Statuscode geht verloren. Hier von Anfang an `class ApiError extends Error { status; body }`.

**c) Mobile-first.** Patios 3-Spalten-Shell ist Büro-Oberfläche. Hier eine Spalte, untere Tab-Leiste, Tippziele ≥ 48 px.

**Abhängigkeiten.** Backend: `hono`, `@hono/node-server`, `postgres`, `@node-rs/argon2`, `jsonwebtoken`, `zod`, `dotenv`, `pdfkit` + `bwip-js` (Etiketten). Frontend: `vue`, `vue-router`, `pinia`, `zxing-wasm`, `tailwindcss`. Bewusst **nicht**: `sharp` (Fotos werden im Browser per Canvas verkleinert — spart eine native Abhängigkeit im Docker-Build und Mobilfunkdaten), kein Redis, kein ORM.

---

# 4. Datenmodell

Kern ist eine **append-only Buchungshistorie**. Der aktuelle Zustand des Geräts ist abgeleitet und wird in **derselben Transaktion** mitgeschrieben. Eine Historienzeile wird nie geändert oder gelöscht.

```
src/db/migrations/
  001_basis.sql        Extensions (citext) + benutzer + anmeldeversuche
  002_stammdaten.sql   schlagworte, standorte, lagerplaetze
  003_geraete.sql      geraete + geraete_barcodes + geraet_schlagworte
  004_buchungen.sql    buchungen + Änderungssperre
  005_pruef_schaden.sql pruefarten, geraet_pruefungen, schaeden
  006_seed.sql         nur ein Lager-Standort (KEIN Standardkonto,
                       KEINE vorgegebenen Schlagworte oder Prüfarten)
```

### Nachträge aus den Rückfragen vom 16.08.2026

**Barcode-Format steht fest: Code 128, fünfstellig, fortlaufend ab 10001.** Über die
Foto-Prüfung bestimmt (siehe `scanner-abnahme.md`). Der Leser wird auf dieses eine Format
festgelegt. Code 128 trägt eine Prüfsumme im Symbol — halb gelesene Codes werden verworfen
statt falsch interpretiert.

**Einteilung über frei vergebbare Schlagworte statt fester Kategorien.** Julius legt Begriffe
selbst an und hängt einem Gerät beliebig viele an („Bagger" + „Mietgerät" + „Führerschein
nötig"). Ersetzt die ursprünglich geplante `kategorien`-Tabelle durch eine n:m-Beziehung.
**Nichts wird vorgegeben** — auch keine Prüfarten, die legt er selbst an, wenn er weiß welche.

**Eigene Lagerplatzverwaltung mit Regal-Etiketten.** Plätze sind eigene Datensätze mit eigenem
Barcode. Ablauf beim Einlagern: Gerät scannen → Platz scannen → fertig, ohne Tippen.

> **Getrennter Nummernkreis, strukturell erzwungen.** Platz-Etiketten tragen ein Präfix
> (`P-0001`), Geräte reine Ziffern (`10001`). Damit kann ein gescannter Code niemals
> mehrdeutig sein. `/scan/:code` antwortet deshalb mit `typ: "geraet" | "lagerplatz" |
> "unbekannt"` — die Oberfläche entscheidet danach, was sie anzeigt.

**Nur Einzelgeräte, keine Mengen.** Jedes Ding hat sein eigenes Etikett und genau einen Ort.
Mengen-Artikel („50 Schalungsanker") sind ausdrücklich nicht Teil von Version 1.

```sql
-- 001 — Anmeldung wahlweise über Benutzername ODER E-Mail
CREATE TABLE benutzer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benutzername CITEXT UNIQUE NOT NULL,
  email        CITEXT UNIQUE,
  passwort_hash TEXT NOT NULL,                    -- argon2id
  anzeigename  TEXT NOT NULL,
  rolle        TEXT NOT NULL DEFAULT 'mitarbeiter'
               CHECK (rolle IN ('admin','mitarbeiter')),
  aktiv        BOOLEAN NOT NULL DEFAULT TRUE,
  -- Sitzungswiderruf: +1 bei Logout-überall, Passwortwechsel,
  -- Rollenwechsel, Deaktivierung → alte Token gelten sofort nicht mehr
  token_version INT NOT NULL DEFAULT 1,
  fehlversuche INT NOT NULL DEFAULT 0,
  gesperrt_bis TIMESTAMPTZ,
  passwort_wechsel_noetig BOOLEAN NOT NULL DEFAULT TRUE,
  letzter_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE anmeldeversuche (
  id BIGSERIAL PRIMARY KEY,
  zeitpunkt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kennung CITEXT, ip INET,
  erfolg BOOLEAN NOT NULL,
  grund TEXT                    -- 'passwort_falsch'|'gesperrt'|'inaktiv'|'ok'
);
CREATE INDEX anmeldeversuche_ip_zeit ON anmeldeversuche(ip, zeitpunkt DESC);

-- 002 — Schlagworte: frei anlegbar, ein Gerät kann beliebig viele tragen
CREATE TABLE schlagworte (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name CITEXT UNIQUE NOT NULL,
  farbe TEXT,                            -- optionaler Farbpunkt in der Liste
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE standorte (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  typ  TEXT NOT NULL CHECK (typ IN ('lager','baustelle','werkstatt','extern')),
  adresse TEXT, notiz TEXT,
  aktiv BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX standorte_name_aktiv ON standorte (lower(name)) WHERE aktiv;

-- Lagerplätze: eigene Datensätze mit eigenem Etikett (Präfix "P-"),
-- damit ein gescannter Code nie mehrdeutig ist.
CREATE TABLE lagerplaetze (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standort_id UUID NOT NULL REFERENCES standorte(id) ON DELETE CASCADE,
  bezeichnung TEXT NOT NULL,             -- "Regal C3", "Container 2"
  barcode CITEXT UNIQUE,                 -- "P-0001"; NULL = Platz ohne Etikett
  typ TEXT NOT NULL DEFAULT 'regal'
      CHECK (typ IN ('regal','fach','container','freiflaeche')),
  notiz TEXT,
  aktiv BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX lagerplaetze_standort ON lagerplaetze(standort_id) WHERE aktiv;
-- Präfix erzwingen: sonst könnte ein Platz die Nummer eines Geräts bekommen
ALTER TABLE lagerplaetze ADD CONSTRAINT lagerplaetze_barcode_praefix
  CHECK (barcode IS NULL OR barcode ~ '^P-');

-- 003
CREATE TABLE geraete (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventarnummer TEXT UNIQUE,            -- = Barcode-Nummer, fünfstellig ab 10001
  bezeichnung TEXT NOT NULL,
  hersteller TEXT, modell TEXT, seriennummer TEXT,
  anschaffungsdatum DATE, anschaffungswert NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'verfuegbar'
    CHECK (status IN ('verfuegbar','ausgegeben','wartung','defekt','ausgemustert')),
  aktueller_standort_id  UUID REFERENCES standorte(id),
  aktueller_lagerplatz_id UUID REFERENCES lagerplaetze(id) ON DELETE SET NULL,
  aktueller_nutzer_id    UUID REFERENCES benutzer(id),
  foto_pfad TEXT, notiz TEXT,
  rev INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by UUID REFERENCES benutzer(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by UUID REFERENCES benutzer(id)
);
CREATE INDEX geraete_status ON geraete(status);
-- Kein Volltextindex: bei 200 Zeilen genügt ILIKE, das Filtern passiert ohnehin im Browser.

-- Ein Gerät, mehrere Etiketten. Ersatzetikett ohne Entwertung des alten.
CREATE TABLE geraete_barcodes (
  barcode CITEXT PRIMARY KEY,
  geraet_id UUID NOT NULL REFERENCES geraete(id) ON DELETE CASCADE,
  aktiv BOOLEAN NOT NULL DEFAULT TRUE,
  erfasst_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX geraete_barcodes_geraet ON geraete_barcodes(geraet_id);
-- Gegenstück zur Platz-Regel: Gerätecodes dürfen NICHT mit "P-" beginnen
ALTER TABLE geraete_barcodes ADD CONSTRAINT geraete_barcodes_kein_platz
  CHECK (barcode !~* '^P-');

-- Schlagworte: n:m, ein Gerät trägt beliebig viele
CREATE TABLE geraet_schlagworte (
  geraet_id    UUID NOT NULL REFERENCES geraete(id) ON DELETE CASCADE,
  schlagwort_id UUID NOT NULL REFERENCES schlagworte(id) ON DELETE CASCADE,
  PRIMARY KEY (geraet_id, schlagwort_id)
);
CREATE INDEX geraet_schlagworte_wort ON geraet_schlagworte(schlagwort_id);

-- 004 — APPEND-ONLY
CREATE TABLE buchungen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geraet_id UUID NOT NULL REFERENCES geraete(id) ON DELETE RESTRICT,
  art TEXT NOT NULL CHECK (art IN ('ausgabe','ruecknahme','umbuchung','korrektur')),
  von_standort_id   UUID REFERENCES standorte(id),
  nach_standort_id  UUID REFERENCES standorte(id),
  nach_lagerplatz_id UUID REFERENCES lagerplaetze(id),   -- beim Einlagern gescannt
  empfaenger_id UUID REFERENCES benutzer(id),
  empfaenger_freitext TEXT,          -- Subunternehmer ohne Konto
  erfasst_von UUID NOT NULL REFERENCES benutzer(id),
  zeitpunkt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  geplante_rueckgabe DATE, notiz TEXT
);
CREATE INDEX buchungen_geraet_zeit ON buchungen(geraet_id, zeitpunkt DESC);

-- Historie hart schützen: die DB verweigert Änderung und Löschung, selbst wenn
-- irgendwo im Code versehentlich ein UPDATE steht.
CREATE RULE buchungen_kein_update AS ON UPDATE TO buchungen DO INSTEAD NOTHING;
CREATE RULE buchungen_kein_delete AS ON DELETE TO buchungen DO INSTEAD NOTHING;

-- 005
CREATE TABLE pruefarten (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL, intervall_monate INT NOT NULL
);
CREATE TABLE geraet_pruefungen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geraet_id UUID NOT NULL REFERENCES geraete(id) ON DELETE CASCADE,
  pruefart_id UUID NOT NULL REFERENCES pruefarten(id) ON DELETE RESTRICT,
  geprueft_am DATE NOT NULL,
  naechste_faellig DATE NOT NULL,      -- rechnet der Server, nicht der Client
  ergebnis TEXT NOT NULL CHECK (ergebnis IN ('bestanden','maengel','durchgefallen')),
  pruefer TEXT, notiz TEXT,
  erfasst_von UUID REFERENCES benutzer(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX pruefungen_faellig ON geraet_pruefungen(naechste_faellig);

CREATE TABLE schaeden (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geraet_id UUID NOT NULL REFERENCES geraete(id) ON DELETE CASCADE,
  buchung_id UUID REFERENCES buchungen(id),
  gemeldet_von UUID NOT NULL REFERENCES benutzer(id),
  gemeldet_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  beschreibung TEXT NOT NULL,
  schwere TEXT NOT NULL CHECK (schwere IN ('gering','mittel','ausfall')),
  status TEXT NOT NULL DEFAULT 'offen'
         CHECK (status IN ('offen','in_reparatur','erledigt')),
  foto_pfade TEXT[] NOT NULL DEFAULT '{}',
  erledigt_am TIMESTAMPTZ
);
```

Konventionen wie in Patio (Vorbild `046_positionen.sql`): Kommentarkopf mit Begründung, `IF NOT EXISTS`-Guards, forward-only, kein Down.

### Zustandsautomat Gerät

```
                 ausgabe                    ruecknahme
  verfuegbar ─────────────► ausgegeben ─────────────────► verfuegbar
      │  ▲                       │                            ▲
      │  │                       │ ruecknahme mit             │
      │  │                       │ schwere='ausfall'          │
      │  │                       ▼                            │
      │  └───────────────────  defekt ──► wartung ────────────┘
      │        (repariert)                  (fertig)
      │
      └──────────────► ausgemustert   (Endzustand, nur Admin)

  umbuchung: ausgegeben → ausgegeben (nur Standort/Empfänger ändert sich)
```

Serverseitig erzwungen: `ausgabe` nur aus `verfuegbar` (sonst 409) · `ruecknahme` und `umbuchung` nur aus `ausgegeben` · `korrektur` aus jedem Zustand, nur Admin, mit Pflichtbegründung. Eine fällige Prüfung **blockiert nicht**, warnt aber sichtbar — das Rechtsrisiko ist Julius' Entscheidung, nicht die der Software.

### Der kritischste Codepfad

`SELECT … FOR UPDATE` sperrt die Zeile, damit zwei gleichzeitige Scans nicht beide ausgeben dürfen:

```ts
await db.begin(async (tx) => {
  const [g] = await tx`SELECT * FROM geraete WHERE id = ${geraetId} FOR UPDATE`;
  if (!g) throw new NichtGefunden("Gerät");
  pruefeUebergang(g.status, art);            // reine Funktion → wirft 409
  const [b] = await tx`INSERT INTO buchungen (…) VALUES (…) RETURNING *`;
  await tx`UPDATE geraete SET status = ${neuerStatus},
             aktueller_standort_id = ${nachStandort},
             aktueller_nutzer_id = ${empfaenger},
             rev = rev + 1, updated_at = NOW(), updated_by = ${akteur}
           WHERE id = ${geraetId}`;
  return b;
});
```

`pruefeUebergang()` liegt in `src/domain/status.ts` — ohne DB einzeln testbar, wie Patios `mayReceive()` im Event-Bus.

---

# 5. Sicherheit

Die App steht offen im Internet. Niemand darf ohne gültige Zugangsdaten hinein, und ein Passwort darf nicht erratbar sein. **Die Anmeldung selbst bleibt schlicht: E-Mail oder Benutzername plus Passwort, sonst nichts.** Der Schutz sitzt hinter der Maske und kostet Ihre Mitarbeiter keinen Handgriff.

### 5.1 Warum Passwortraten scheitert

- **argon2id** (`@node-rs/argon2`, 64 MB, 3 Durchgänge): ein Rateversuch kostet **58 ms** (auf Julius' Rechner nachgemessen) und dabei 64 MB Arbeitsspeicher. Anders als bei bcrypt hilft **auch eine Grafikkarte kaum**, weil das Verfahren absichtlich viel Speicher braucht. Selbst bei gestohlener Datenbank wären die Passwörter nicht in vertretbarer Zeit rückrechenbar. *(Patio nutzt bcrypt — im Firmennetz vertretbar, hier nehme ich das stärkere Verfahren.)*
- **Wachsende Verzögerung** ab dem 3. Fehlversuch: 1 s, 2 s, 4 s, 8 s … Für einen Vertipper unmerklich, für ein Rateprogramm tödlich.
- **Kontosperre** nach 10 Fehlversuchen für 15 Minuten. Damit bleiben höchstens ~40 Versuche pro Stunde und Konto.
- **Ratenbegrenzung** getrennt nach IP und nach Konto.
- ~~**Cloudflare davor:** Herkunftsfilter, Bot-Abwehr, vorgelagerte Ratenbegrenzung.~~ **Entfallen** (2026-08-21, kein Tunnel). War ausdrücklich als „nicht tragend" eingestuft — die Punkte darüber wirken unabhängig davon und sind alle gebaut. Wer die vorgelagerte Filterung dennoch will, kommt um einen Dienst davor nicht herum.
- **Kein Rückschluss, welche Konten existieren:** bei unbekannter Kennung rechnet der Server trotzdem einen Vergleichs-Hash und antwortet gleich lange mit derselben Meldung.

Praktisch heißt das: Bei ~40 Versuchen pro Stunde ist selbst eine kurze Passphrase aus vier gewöhnlichen Wörtern nicht in menschlichen Zeiträumen zu raten. Der realistische Angriffsweg ist ein **anderswo wiederverwendetes** Passwort — dagegen wirkt 5.2.

### 5.2 Passwörter und erstes Konto

- **Mindestens 12 Zeichen**, keine Zwangs-Sonderzeichen. Länge schlägt Zeichensalat, und komplizierte Regeln enden erfahrungsgemäß bei `Sommer2026!` auf einem Zettel am Bildschirm.
- **Abgleich gegen bekannte geleakte Passwörter** über die *k-Anonymity*-Schnittstelle von Have I Been Pwned: es gehen nur die ersten fünf Zeichen eines Hashes hinaus, das Passwort selbst verlässt den Server **nie**. Fällt der Dienst aus, wird trotzdem gespeichert und protokolliert — keine Betriebsblockade.
- **Kein Standardpasswort.** Das erste Admin-Konto entsteht per Kommandozeile auf dem Server (`npm run benutzer:anlegen`). Es gibt zu keinem Zeitpunkt ein `admin/admin`. *(Patio hat einen ungeschützten Setup-Pfad unter `/api/setup` — den baue ich hier bewusst nicht.)*
- Erster Login jedes neuen Kontos **erzwingt Passwortwechsel**.
- Ein Admin kann Passwörter zurücksetzen (Einmalpasswort + erzwungener Wechsel). Keine „Passwort vergessen"-Selbstbedienung per E-Mail — bei fünf bis zehn Leuten ist der Zuruf ans Büro der sicherere Weg.

**Kein zweiter Faktor** — Ihre Entscheidung, wird so gebaut. Die Abwägung dahinter trägt: 2FA schützt vor allem gegen ein gestohlenes oder wiederverwendetes Passwort, nicht gegen Raten. Was Sie in Kauf nehmen: wer ein Admin-Passwort in die Hände bekommt, hat vollen Zugriff. Deshalb bleiben erzwungener Wechsel, Leak-Abgleich, das Protokoll der Anmeldeversuche und der sofortige Widerruf im Plan. Nachrüstbar bleibt es ohne Umbau: die Login-Route wird so geschnitten, dass ein zweiter Schritt später einfach dazukommt, und Patio hat funktionierenden TOTP-Code (`apps/patio/src/api/totp.ts`), der dort nur nie eingebunden wurde.

### 5.3 Sitzung

- JWT im Cookie: `httpOnly` · `Secure` · `SameSite=Strict` · 30 Tage, bei Nutzung still verlängert. Wer die App regelmäßig benutzt, meldet sich nie neu an; ein 30 Tage unbenutztes Handy fällt heraus.
- **Sofort widerrufbar:** das Token trägt `token_version`, die Middleware vergleicht sie bei **jeder** Anfrage mit der Datenbank. Logout-überall, Passwortwechsel, Rollenwechsel oder Deaktivierung machen alle bestehenden Sitzungen augenblicklich ungültig. Genau hier scheitern viele JWT-Systeme — ein Token ohne Widerruf gilt bis zum Ablauf, egal was passiert.
- **Handy verloren:** Konto deaktivieren, der Zugang ist binnen Sekunden tot.
- Rolle wird **immer frisch aus der Datenbank** gelesen, nie aus dem Token (Patio-Muster, `auth.ts:457`).
- `SameSite=Strict` deckt CSRF bei einer einzelnen Domain ab; ein zusätzliches Double-Submit-Token spare ich mir bei dieser Größe.

### 5.4 Standard ist „gesperrt"

`app.use("/api/*", authMiddleware)` läuft **vor** allen Routen. Ausnahmen stehen in einer kurzen, ausdrücklichen Liste — nicht umgekehrt:

| Ohne Anmeldung | Warum |
|---|---|
| `POST /api/auth/login` | sonst käme niemand hinein |
| `GET /api/health` | Container-Healthcheck; liefert nur `{ok, version}`, keine Interna |
| statische Dateien der Oberfläche | enthalten keine Daten; ohne Cookie zeigt die App sofort den Login |

Ein neuer Endpunkt ist damit automatisch geschützt — Vergessen führt zur Sperre, nicht zum Leck. Ein Test zählt alle registrierten Routen und schlägt fehl, sobald eine ohne Eintrag in der Ausnahmeliste ohne Anmeldung antwortet.

**Fotos sind kein Sonderfall:** Uploads liegen **nicht** im statisch ausgelieferten Ordner, sondern werden über `GET /api/fotos/:id` mit Anmeldeprüfung gestreamt. Sonst wären Baustellenfotos über eine geratene URL öffentlich — ein Fehler, den man leicht macht und schwer bemerkt.

### 5.5 Der Rest

- **Sicherheits-Header** (in Caddy): HSTS · **CSP erzwingend, nicht nur berichtend** (`default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` für zxing, `frame-ancestors 'none'`) · `nosniff` · `Permissions-Policy: camera=(self)`. *Patio fährt CSP im Report-Only-Modus — hier von Anfang an scharf, weil Nachschärfen erfahrungsgemäß nie passiert.*
- **Eingaben** mit `zod` validiert. SQL ausschließlich über die Tagged-Templates von postgres.js → Parameterbindung erzwungen, SQL-Injection strukturell ausgeschlossen.
- **Uploads:** ≤ 5 MB, nur jpeg/png/webp, Typ an den **Magic Bytes** geprüft (nicht am Dateinamen), Name durch UUID ersetzt, Ablage außerhalb des statischen Ordners.
- **Fehlermeldungen** ohne Stacktrace, SQL oder Pfade. Details ins Log.
- **Datenbank von außen unerreichbar:** kein `ports:` in der Compose-Datei, nur internes Docker-Netz.
- ~~**Kein offener Port am Router** — der Cloudflare-Tunnel baut von innen nach außen auf.~~ **Überholt:** Ohne Tunnel braucht der Weg aus dem Internet eine Portfreigabe (80/443 auf den Mini-PC). Wer keinen offenen Port will, betreibt die Anwendung nur im Büro-Netz oder legt ein VPN davor.
- `npm audit` im Pre-Push-Hook, `gitleaks` (Konfiguration aus `apps/patio/.gitleaks.toml`), `.env` nie im Repo.

---

# 6. Rollen

Zwei statt drei — bei dieser Größe braucht es keine Zwischenstufe.

| Rolle | Darf |
|---|---|
| `mitarbeiter` | Scannen · ausgeben · zurücknehmen · umbuchen · Schaden melden · **alles lesen** |
| `admin` | zusätzlich: Geräte/Standorte/Kategorien/Barcodes pflegen · Prüfungen eintragen · Etiketten drucken · Benutzerverwaltung · Korrekturbuchungen · Ausmusterung · Export |

Jeder darf **alles sehen** — die Frage „wo ist der Rüttler?" muss jeder beantworten können. Geschützt ist nur das Verändern von Stammdaten.

---

# 7. API

Alle Routen unter `/api`, alles geschützt außer den drei Ausnahmen aus 5.4.

| Methode | Pfad | Rolle | Zweck |
|---|---|---|---|
| POST | `/auth/login` | – | Kennung (E-Mail **oder** Benutzername) + Passwort → Cookie |
| POST | `/auth/logout` · `/auth/logout-alle` | jede | einzeln bzw. alle Geräte |
| GET | `/auth/me` | jede | Benutzer, Rolle, `passwort_wechsel_noetig` |
| POST | `/auth/passwort` | jede | altes Passwort nötig, Leak-Abgleich |
| **GET** | **`/scan/:code`** | jede | **Wichtigster Endpunkt.** Antwortet mit `typ`: `geraet` (samt Standort, Lagerplatz, Nutzer, offenen Schäden, Prüfstatus und **erlaubten Folgeaktionen**), `lagerplatz` (samt darin liegender Geräte) oder `unbekannt` → Frontend bietet „anlegen?" |
| GET | `/geraete` | jede | **komplette Liste** (200 Zeilen), Filtern passiert im Browser |
| GET | `/geraete/:id` · `/geraete/:id/historie` | jede | Detail, Buchungen |
| POST/PATCH | `/geraete` · `/geraete/:id` | admin | anlegen/ändern, `rev`-Konfliktschutz → 409 |
| POST | `/geraete/:id/foto` | admin | multipart |
| POST/DELETE | `/geraete/:id/barcodes` · `/…/:code` | admin | Ersatzetikett, deaktivieren statt löschen |
| POST | `/geraete/:id/ausmustern` | admin | |
| **POST** | **`/buchungen`** | jede | ausgabe / ruecknahme / umbuchung |
| POST | `/buchungen/korrektur` | admin | Pflichtbegründung |
| GET | `/buchungen/offen` | jede | alles Ausgegebene, nach Dauer sortiert |
| GET/POST/PATCH | `/standorte` · `/schlagworte` | lesen jede · schreiben admin |
| GET | `/standorte/:id/bestand` | jede | „Was steht hier?" |
| GET/POST/PATCH | `/lagerplaetze` · `/lagerplaetze/:id` | lesen jede · schreiben admin |
| GET | `/lagerplaetze/:id/bestand` | jede | „Was liegt in diesem Regal?" |
| POST | `/etiketten/plaetze` | admin | Regal-Etiketten als PDF (`P-0001` …) |
| GET/POST | `/pruefarten` | lesen jede · schreiben admin |
| POST | `/geraete/:id/pruefungen` | admin | Server rechnet `naechste_faellig` |
| GET | `/pruefungen/faellig` | jede | Ampel |
| GET/POST/PATCH | `/schaeden` · `/schaeden/:id` | melden jede · bearbeiten admin |
| POST | `/schaeden/:id/fotos` | jede | |
| GET | `/dashboard` | jede | alle Kennzahlen in einem Aufruf |
| GET | `/fotos/:id` | jede | **mit Anmeldeprüfung**, nicht statisch |
| GET/POST/PATCH | `/benutzer` · `/benutzer/:id` | admin | inkl. Passwort zurücksetzen |
| GET | `/export/bestand.csv` · `/export/historie.csv` | admin | |
| POST | `/etiketten` | admin | PDF |
| GET | `/sicherheit/anmeldeversuche` | admin | fehlgeschlagene Anmeldungen |
| GET | `/health` | **–** | nur `{ok, version}` |

---

# 8. Ordnerstruktur

```
apps/geraete-tracker/
├── CLAUDE.md  package.json  tsconfig.json  vitest.config.ts
├── .env.example  .gitignore  .gitleaks.toml  Dockerfile  docker-compose.yml
├── docker/Caddyfile
├── docs/     scanner-abnahme.md · DEPLOY.md · BEDIENUNG.md
├── scripts/  db-migrate.ts · benutzer-anlegen.ts · backup.sh
├── src/
│   ├── index.ts        Boot: env prüfen → DB-Health → Migrate → startApi()
│   ├── config.ts       alle Tunables als Konstanten (Patio-Muster)
│   ├── logger.ts       JSONL, mit Geheimnis-Filter
│   ├── db/             client.ts · migrate.ts · migrations/*.sql
│   ├── domain/         ← reine Logik, DB-frei, leicht testbar
│   │   ├── status.ts   pruefeUebergang(), erlaubteAktionen()
│   │   ├── pruefung.ts naechsteFaelligkeit(), ampel()
│   │   ├── barcode.ts  normalisiere()
│   │   └── passwort.ts regeln(), leakAbgleich()
│   ├── data/           geraete · buchungen · stammdaten · benutzer ·
│   │                   pruefungen · schaeden · index.ts
│   ├── api/
│   │   ├── server.ts   Hono-App, Middleware-Kette, Mounting
│   │   ├── auth.ts     argon2, JWT, Cookie, authMiddleware, adminGuard
│   │   ├── bremse.ts   Verzögerung, Ratenbegrenzung, Kontosperre
│   │   ├── fehler.ts   KonfliktFehler, NichtGefunden, RegelFehler
│   │   ├── upload.ts   Magic-Bytes-Prüfung, UUID-Namen
│   │   └── routes/     auth · scan · geraete · buchungen · stammdaten ·
│   │                   pruefungen · schaeden · dashboard · fotos ·
│   │                   benutzer · export · etiketten
│   └── types.ts        geteilte Typen (vom Frontend importiert)
├── web/src/
│   ├── main.ts  App.vue  router.ts    (Guard: ohne Anmeldung → /login)
│   ├── api.ts          request<T>(), ApiError, 401 → /login
│   ├── stores/         auth.ts · daten.ts (Geräte/Standorte einmal laden)
│   ├── composables/    useScanner.ts · useFoto.ts · useConfirm.ts
│   ├── components/     AppShell · TabBar · GeraetKarte · StatusChip ·
│   │                   ScannerSucher · BarcodeEingabe · StandortWahl ·
│   │                   PersonWahl · FotoAufnahme · AmpelPunkt
│   ├── views/          Login · PasswortWechsel · Scan · GeraetDetail ·
│   │                   Ausgeben · Zuruecknehmen · GeraeteListe ·
│   │                   GeraetBearbeiten · StandortListe · StandortDetail ·
│   │                   Faellig · Schaeden · Dashboard · Benutzer
│   └── styles/         tokens.css · shell.css
└── tests/              flach, api-<bereich>-<aspekt>.test.ts
```

---

# 9. Scanner und Oberfläche

### 9.1 `useScanner()`

Die einzige Stelle, die von Kameras weiß:

```ts
export type ScanQuelle = "kamera" | "hand" | "hardware";
export function useScanner() {
  // status: 'aus'|'startet'|'laeuft'|'kein_zugriff'|'nicht_unterstuetzt'
  // start(videoEl), stop(), toggleTaschenlampe(), onCode(cb)
}
```

1. `getUserMedia({ video: { facingMode: {ideal:"environment"}, width: {ideal:1920} } })` — hohe Auflösung, weil 1D Detail braucht
2. `window.BarcodeDetector` vorhanden und meldet `code_128`? → nativer Weg. Sonst `zxing-wasm` per dynamischem Import
3. Leseschleife über `requestAnimationFrame`, gedrosselt auf ~10 Bilder/s — mehr bringt nichts und heizt das Telefon
4. **Doppelbestätigung** über einen 2er-Ringpuffer; erst bei zwei gleichen Lesungen feuert `onCode`, dann `navigator.vibrate(60)` und ein Ton — bei Sonne aufs Display sieht man nichts
5. Nach dem Treffer Schleife anhalten, sonst scannt die App im Hintergrund die nächste Buchung an

**Beim Verlassen der Ansicht** (`onScopeDispose`) `track.stop()` für **jeden** Track und die rAF-Schleife abräumen. Sonst bleibt die Kameraleuchte an, der Akku leert sich, und iOS verweigert beim nächsten Aufruf den Zugriff.

**Handeingabe** (`BarcodeEingabe.vue`): `inputmode="numeric"`, Trefferliste ab 3 Zeichen aus der bereits geladenen Geräteliste (kein Serveraufruf nötig). **Dasselbe Feld ist der Hardware-Scanner-Eingang** — ein Bluetooth-Gerät tippt hinein und schließt mit Enter ab.

**Normalisierung** (`src/domain/barcode.ts`, serverseitig): Leerzeichen weg, Großschreibung, führende Nullen. Ein getipptes `01234` und ein gescanntes `1234` müssen dasselbe Gerät finden.

### 9.2 Die zwei Bildschirme, an denen alles hängt

**Scannen → Gerätekarte.** Sucher füllt den Schirm, oben ein schmaler Balken „Nummer eintippen". Nach dem Lesen sofort die Karte: Foto, Bezeichnung, großer farbiger Status, darunter ein Satz in Klartext — „steht seit 12 Tagen auf *Baustelle Lindengasse*, ausgegeben von *Meier*". Warnungen (Prüfung überfällig, offener Schaden) als roter Balken **darüber**. Dann genau die Aktionen, die der Zustand erlaubt — ein ausgegebenes Gerät zeigt „Zurücknehmen" und „Umbuchen", kein „Ausgeben". Welche das sind, sagt der Server, damit Oberfläche und Regelwerk nicht auseinanderlaufen.

**Ausgeben in zwei Tippern.** Standort und Person vorbelegt (zuletzt gewählt zuerst), beides änderbar. Bestätigungsseite, die mit Handschuhen und bei Sonne lesbar ist, von dort direkt „Nächstes Gerät scannen" — Serienausgabe ist der Normalfall beim Bestücken eines Transporters.

Unbekannter Barcode → „Gerät mit dieser Nummer anlegen" (nur Admin; Mitarbeiter sehen „nicht erfasst — bitte im Büro melden").

### 9.3 Regeln

Tippziele ≥ 48 px, Hauptaktionen im unteren Bildschirmdrittel · untere Tab-Leiste **Scannen · Geräte · Standorte · Mehr** · Statusfarben zusätzlich durch Symbol und Wort unterschieden (Sonnenlicht, Farbsehschwäche) · keine Emojis (Patio-Konvention) · Farben nur über CSS-Variablen aus `tokens.css`, Light und Dark · Systemschriften, kein Web-Font-Nachladen · Rückmeldung auf jede Buchung binnen 100 ms.

**Keine Live-Aktualisierung über SSE in Version 1.** Bei fünf bis zehn Nutzern reicht es, beim Öffnen einer Ansicht neu zu laden. Das spart den Event-Bus, die geteilte `EventSource` und den `flush_interval`-Sonderfall im Proxy. Nachrüstbar, wenn es im Alltag stört.

---

# 10. Arbeitspakete

Zehn statt zwanzig. Jedes endet mit grünem `npx tsc --noEmit`, grünen Tests und einem Commit. **Kein Push ohne Aufforderung.**

| AP | Inhalt |
|---|---|
| **AP1** | **Scanner-Machbarkeit.** Wegwerf-Testseite (`zxing-wasm` + `BarcodeDetector`) über temporären HTTPS-Tunnel. Julius scannt ~15 echte Etiketten mit iPad und Handy, darunter schmutzige, gewölbte, im Gegenlicht. Ergebnis in `docs/scanner-abnahme.md`: Trefferquote, Lesedauer, Codeformat, Stellenzahl. **Abbruchkriterium < ~70 % → Handscanner wird Hauptweg.** Entscheidet über alles Weitere |
| **AP2** | **Gerüst + Datenbank.** Repo, TS-Config, ESLint/Prettier/Husky, Vitest, `.env.example`, `.gitignore` inkl. `.claude/`. Migrationen 001–006, `db/client.ts` + `db/migrate.ts` von Patio übernommen, `npm run db:migrate`, Seed **ohne Standardkonto**, `scripts/benutzer-anlegen.ts` |
| **AP3** | **Anmeldung & Absicherung** (Kapitel 5). argon2id, JWT im httpOnly-Cookie mit `token_version`, `authMiddleware` (Rolle und Version frisch aus der DB), `adminGuard`, wachsende Verzögerung, Kontosperre, Ratenbegrenzung, gleichlange Antwort bei unbekanntem Konto, Passwortregeln + Leak-Abgleich. Dazu die Hono-Middleware-Kette: **Standard-gesperrt mit kurzer Ausnahmeliste** + Abdeckungstest, erzwingende CSP, `app.onError` ohne Interna, `/api/health`, SPA-Auslieferung |
| **AP4** | **Stammdaten-API.** CRUD Geräte/Kategorien/Standorte/Barcodes, Zod-Schemata, `rev`-Konfliktschutz, Rollenprüfung je Route |
| **AP5** | **Buchungs-API — die Herzkammer.** `pruefeUebergang()` als reine Funktion, `FOR UPDATE`-Transaktion, Historie, Korrekturbuchung, `/scan/:barcode` mit erlaubten Aktionen. Dichteste Testabdeckung des Projekts |
| **AP6** | **Frontend-Grundgerüst + Scanner.** Vite/Vue/Pinia/Router mit Anmelde-Guard, `api.ts` mit `ApiError`, Login + erzwungener Passwortwechsel, mobile-first Shell mit TabBar, `tokens.css`, PWA-Manifest. Dann `useScanner()` nach 9.1, `ScannerSucher.vue`, `BarcodeEingabe.vue` |
| **AP7** | **Scan-Flow.** Gerätekarte, Ausgeben, Zurücknehmen, Umbuchen, Bestätigung, „Nächstes scannen", unbekannter Barcode → anlegen. **Hier entscheidet sich die Alltagstauglichkeit — mit echten Daumen testen, nicht mit der Maus.** Ab hier ist die App im Alltag benutzbar |
| **AP8** | **Listen, Prüfungen, Schäden.** Geräteliste mit Filtern (im Browser), Detail mit Historie, Standort-Ansicht, Dashboard. Prüfarten + Prüfung eintragen + Ampelliste + **Warnung auf der Gerätekarte beim Scannen**. Schadensmeldung mit Foto (`useFoto()` verkleinert im Browser, Server prüft Magic Bytes, Auslieferung nur mit Anmeldung, `ausfall` sperrt das Gerät) |
| **AP9** | **Benutzerverwaltung, Etiketten, Export.** Konten anlegen/deaktivieren/Passwort zurücksetzen, „alle Sitzungen beenden", Ansicht der fehlgeschlagenen Anmeldungen. `bwip-js` + `pdfkit` für Etiketten im **vorhandenen** Codeformat (aus AP1), Bogenlayout. CSV-Export Bestand und Historie |
| **AP10** | *(tatsächlich gebaut als AP11 und AP13; AP10 wurde die Benutzerverwaltung)* **Deployment & Abnahme.** Compose (postgres + app + caddy, **kein** `ports:` bei App und DB), Dockerfile Multi-Stage, `USER node`, Foto-Ordner `chown 1000:1000`. Cloudflare-Tunnel, Europa offen, Bot-Abwehr, Ratenbegrenzung auf Login. `pg_dump`-Backup per Timer plus **einmal echt durchgespieltem Rückspielweg**. Sicherheitsabnahme (Kapitel 12), Kamera-Abnahme auf iPad und Android, `docs/BEDIENUNG.md`, `CLAUDE.md`, Landkarten-Zeile |

**Reihenfolge.** AP1 steht allein. AP2–AP5 sind Fundament ohne sichtbares Ergebnis — die Absicherung (AP3) kommt **vor** der ersten Fachfunktion, weil sie nachträglich einzuziehen erfahrungsgemäß nie sauber gelingt. **Nach AP7 ist die App echt benutzbar** und sollte im Alltag mitlaufen, während AP8–AP9 nachkommen. AP10 gern vorziehen, sobald etwas Vorzeigbares steht: die Kamera braucht ohnehin HTTPS.

---

# 11. Betrieb

### `.env`

```ini
NODE_ENV=production
API_PORT=3000
APP_HOSTNAME=geraete.example.at

DATABASE_URL=postgres://tracker:…@postgres:5432/tracker
POSTGRES_USER=tracker
POSTGRES_PASSWORD=…
POSTGRES_DB=tracker
DB_AUTO_MIGRATE=true

JWT_SECRET=…                  # ≥ 32 Zeichen, sonst Boot-Abbruch
COOKIE_SECURE=true            # in Entwicklung false
SESSION_TAGE=30

PASSWORT_MIN_LAENGE=12
LEAK_PRUEFUNG=true
SPERRE_NACH_VERSUCHEN=10
SPERRE_MINUTEN=15

DATA_PATH=/data
UPLOAD_MAX_MB=5
LOG_LEVEL=info
```

Alle Werte werden **einmal** in `src/config.ts` gelesen und als Konstanten exportiert (Patio-Muster). Fehlt ein Pflichtwert oder ist `JWT_SECRET` zu kurz, bricht der Start ab — mit klarer Meldung, nicht mit einem Folgefehler drei Schichten tiefer.

### Compose

Vier Dienste in einem internen Bridge-Netz. **Weder `app` noch `postgres` haben `ports:`** — nur `expose`. `caddy` bindet ausschließlich an `127.0.0.1`, weil `cloudflared` lokal ansetzt. Volumes: `postgres_data`, `caddy_data`, Bind-Mount `${DATA_PATH}` für Fotos.

**Stolperstein aus Ihrem Playbook:** Der Container läuft als `node` (uid 1000). Der Foto-Ordner braucht auf dem Host `chown -R 1000:1000`, sonst scheitern Uploads mit `EACCES` — möglicherweise leise.

### Caddyfile

```caddyfile
{$APP_HOSTNAME} {
    encode gzip zstd
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains"
        X-Content-Type-Options    "nosniff"
        Referrer-Policy           "same-origin"
        Permissions-Policy        "camera=(self), geolocation=(), microphone=()"
        -Server
    }
    reverse_proxy app:3000
}
```

*(Ohne SSE entfällt der `flush_interval -1`-Matcher, den Patio braucht. Kommt Live-Aktualisierung später dazu, muss er ergänzt werden — sonst puffert Caddy den Strom tot.)*

### Erreichbarkeit

~~**Cloudflare Tunnel:**~~ **Entfallen** (2026-08-21). Stattdessen **Caddy** als einziger Eingang: Er holt das Zertifikat selbst — von Let's Encrypt, wenn eine öffentliche Domain samt Portfreigabe (80/443) vorhanden ist, sonst stellt er eines für den Betrieb im Büro-Netz aus. Das gültige Zertifikat bleibt Voraussetzung für die Kamera. Was mit dem Tunnel wegfällt: Der Mini-PC ist beim Weg über das Internet **nicht mehr unsichtbar**, sein Port 443 ist scanbar. Die Anmeldung dahinter ist darauf ausgelegt (siehe oben), aber die Angriffsfläche ist größer als mit Tunnel oder VPN.

### Sicherung

`pg_dump` täglich per systemd-Timer, 30 Stände rollierend, plus `tar` über den Fotoordner. **Der Rückspielweg wird in AP10 einmal echt durchgespielt** — ein nie geprüftes Backup ist kein Backup.

---

# 12. Tests und Abnahme

Vitest, flach in `tests/`, Integrationstests über `app.request()` gegen die echte Hono-App (Patio-Muster, kein laufender Server nötig).

```
domain-status.test.ts        Zustandsautomat, ohne DB
domain-barcode.test.ts       Normalisierung, führende Nullen
domain-pruefung.test.ts      Fälligkeit, Monatsenden, Schaltjahr
api-auth-login.test.ts       falsches Passwort, unbekanntes Konto:
                             gleiche Meldung UND gleiche Dauer
api-auth-bremse.test.ts      Verzögerung wächst, Sperre nach 10 Versuchen
api-auth-sitzung.test.ts     token_version-Widerruf, Deaktivierung wirkt sofort
api-auth-abdeckung.test.ts   ← zählt ALLE Routen: jede ohne Eintrag in der
                               Ausnahmeliste MUSS ohne Cookie 401 liefern
api-scan.test.ts             bekannt, unbekannt, zweiter Barcode
api-geraete-crud.test.ts     inkl. rev-Konflikt → 409 und Rechtefälle
api-buchungen-regeln.test.ts ← dichteste Abdeckung
api-buchungen-unveraenderlich.test.ts   UPDATE/DELETE bleibt wirkungslos
api-pruefungen.test.ts · api-schaeden.test.ts
api-upload.test.ts           zu groß, falscher Typ trotz .jpg-Namen,
                             Foto ohne Anmeldung → 401
helpers/db-fixture.ts
```

**Ausdrücklich zu prüfen:** zweimal ausgeben schlägt fehl · Rücknahme ohne Ausgabe schlägt fehl · `defekt` blockiert die Ausgabe · Historie bleibt lückenlos · `UPDATE buchungen` bleibt wirkungslos · Transaktionsabbruch hinterlässt keinen halben Zustand · zwei gleichzeitige Ausgaben desselben Geräts: genau eine gewinnt.

**Falle aus Patio, hier vermieden:** dort überspringt Vitest ohne `DATABASE_URL` ~290 DB-Tests **still** und meldet trotzdem grün. `helpers/db-fixture.ts` bekommt den umgekehrten Ansatz: fehlt die Test-DB, bricht die Suite **laut** ab.

### Abnahme von Hand (AP10)

**Sicherheit** — 1. API-Adresse ohne Cookie → 401, keine Daten · 2. Foto-Pfad ohne Anmeldung → 401 · 3. Mitarbeiter-Cookie gegen Admin-Route → 403 · 4. Cookie im Browser-Werkzeug auslesbar? → nein · 5. Token manipuliert (Rolle auf admin) → abgewiesen · 6. Konto deaktiviert bei offener Sitzung → nächste Anfrage 401 · 7. 200 falsche Passwörter → Sperre greift, Antwortzeit steigt sichtbar · 8. echter vs. erfundener Benutzername → identische Meldung und Dauer · 9. Portscan der Büro-IP von außen → kein offener Port · 10. `npm audit` und `gitleaks` ohne Befund.

**Fachlich** — Gerät anlegen → Etikett drucken → aufkleben → **scannen** → auf Baustelle ausgeben → Prüfung mit vergangener Fälligkeit eintragen → beim nächsten Scan erscheint die Warnung → mit Schaden `ausfall` zurücknehmen → Gerät ist `defekt` und nicht mehr ausgebbar (409) → Historie zeigt alle Schritte lückenlos in richtiger Reihenfolge.

**Betrieb** — Zugriff über **Mobilfunk** (nicht WLAN) mit Kamera · Mini-PC neu starten, alles kommt von selbst hoch · Backup in leere Datenbank einspielen, Bestand vollständig.

**Scanner** — nicht automatisierbar: echte Etiketten, iPad und Android, drinnen und in praller Sonne, Bedienung mit Arbeitshandschuhen.

---

# 13. Offene Punkte für Julius

1. **Produktname** für App und Ordner — bis dahin `geraete-tracker`.
2. **Etiketten-Format:** welcher Codetyp (Code128? EAN-13? Code39?) und wie viele Stellen. Ein Foto eines Etiketts genügt und wird für AP1 ohnehin gebraucht — es bestimmt Scanner-Konfiguration *und* Etikettendruck in AP9.
3. **Mini-PC:** Betriebssystem, Docker vorhanden, läuft er durch?
4. **Domain:** welche Adresse soll die App bekommen, liegt sie schon bei Cloudflare?
5. **Prüfarten:** welche wiederkehrenden Prüfungen gibt es tatsächlich, in welchem Intervall (für den Seed in AP2).
6. **Ausgabe an Fremde:** gehen Geräte an Subunternehmer ohne Konto? `empfaenger_freitext` ist dafür vorgesehen — wenn nie, fliegt das Feld raus.
