/**
 * Zugriff auf Benutzerkonten. Alles, was Passwörter, Sperren und
 * Sitzungsgültigkeit betrifft, geht durch diese Datei.
 */

import { randomInt } from "node:crypto";
import { db } from "../db/client.js";

export interface Benutzer {
  id: string;
  benutzername: string;
  email: string | null;
  anzeigename: string;
  /** Verweist auf rollen.id — seit Migration 009 frei erweiterbar. */
  rolle: string;
  aktiv: boolean;
  token_version: number;
  fehlversuche: number;
  gesperrt_bis: Date | null;
  passwort_wechsel_noetig: boolean;
  letzter_login: Date | null;
}

/** Benutzer mit Hash — bleibt in der Fachschicht, geht nie nach außen. */
export interface BenutzerMitHash extends Benutzer {
  passwort_hash: string;
}

/**
 * Die öffentlichen Spalten — absichtlich ohne passwort_hash, damit der Hash
 * nicht versehentlich in einer Antwort landet.
 *
 * Als Funktion, nicht als Konstante: ein auf Modulebene gebautes Fragment
 * würde beim bloßen Import schon eine Datenbankverbindung aufbauen und
 * dasselbe Query-Objekt mehrfach verwenden.
 */
const felder = () => db()`
  id, benutzername, email, anzeigename, rolle, aktiv, token_version,
  fehlversuche, gesperrt_bis, passwort_wechsel_noetig, letzter_login`;

/**
 * Sucht ein Konto anhand der eingegebenen Kennung — Benutzername ODER E-Mail.
 * Enthält die Eingabe ein @, wird sie als E-Mail behandelt.
 *
 * CITEXT in der Datenbank sorgt dafür, dass Groß-/Kleinschreibung egal ist.
 */
export async function findeFuerAnmeldung(kennung: string): Promise<BenutzerMitHash | null> {
  const sauber = kennung.trim();
  if (!sauber) return null;

  const zeilen = sauber.includes("@")
    ? await db()<BenutzerMitHash[]>`
        SELECT ${felder()}, passwort_hash FROM benutzer WHERE email = ${sauber}`
    : await db()<BenutzerMitHash[]>`
        SELECT ${felder()}, passwort_hash FROM benutzer WHERE benutzername = ${sauber}`;

  return zeilen[0] ?? null;
}

/**
 * Lädt ein Konto für die Middleware. Wird bei JEDER Anfrage aufgerufen —
 * dadurch wirken Rollenwechsel, Deaktivierung und Sitzungswiderruf sofort
 * und nicht erst, wenn das Token abläuft.
 */
export async function findeNachId(id: string): Promise<Benutzer | null> {
  const zeilen = await db()<Benutzer[]>`SELECT ${felder()} FROM benutzer WHERE id = ${id}`;
  return zeilen[0] ?? null;
}

/** Nach erfolgreicher Anmeldung: Zähler zurücksetzen, Zeitstempel merken. */
export async function vermerkeAnmeldung(id: string): Promise<void> {
  await db()`
    UPDATE benutzer
       SET letzter_login = NOW(), fehlversuche = 0, gesperrt_bis = NULL, updated_at = NOW()
     WHERE id = ${id}`;
}

/**
 * Nach einem Fehlversuch: Zähler erhöhen und ab der Grenze sperren.
 * Gibt den neuen Stand zurück, damit der Aufrufer die Wartezeit berechnen kann.
 */
export async function vermerkeFehlversuch(
  id: string,
  grenze: number,
  sperrMinuten: number,
): Promise<{ fehlversuche: number; gesperrt_bis: Date | null }> {
  const zeilen = await db()<{ fehlversuche: number; gesperrt_bis: Date | null }[]>`
    UPDATE benutzer
       SET fehlversuche = fehlversuche + 1,
           gesperrt_bis = CASE
             WHEN fehlversuche + 1 >= ${grenze}
             THEN NOW() + (${sperrMinuten} || ' minutes')::interval
             ELSE gesperrt_bis
           END,
           updated_at = NOW()
     WHERE id = ${id}
     RETURNING fehlversuche, gesperrt_bis`;
  return zeilen[0] ?? { fehlversuche: 0, gesperrt_bis: null };
}

/**
 * Beendet alle Anmeldungen eines Kontos, indem token_version erhöht wird.
 * Wird auch bei Passwortwechsel, Rollenwechsel und Deaktivierung gerufen —
 * ein ausgestelltes Token gilt sonst bis zum Ablauf weiter.
 */
export async function beendeAlleSitzungen(id: string): Promise<number> {
  const zeilen = await db()<{ token_version: number }[]>`
    UPDATE benutzer SET token_version = token_version + 1, updated_at = NOW()
     WHERE id = ${id} RETURNING token_version`;
  return zeilen[0]?.token_version ?? 0;
}

export async function setzePasswort(
  id: string,
  hash: string,
  wechselNoetig = false,
): Promise<void> {
  await db()`
    UPDATE benutzer
       SET passwort_hash = ${hash},
           passwort_geaendert_am = NOW(),
           passwort_wechsel_noetig = ${wechselNoetig},
           token_version = token_version + 1,   -- alle anderen Geräte fliegen raus
           fehlversuche = 0,
           gesperrt_bis = NULL,
           updated_at = NOW()
     WHERE id = ${id}`;
}

// ── Protokoll der Anmeldeversuche ──────────────────────────────────────────

export type Anmeldegrund = "ok" | "passwort_falsch" | "unbekannt" | "gesperrt" | "inaktiv";

export async function protokolliereAnmeldung(eintrag: {
  kennung: string;
  ip: string | null;
  erfolg: boolean;
  grund: Anmeldegrund;
  userAgent?: string;
}): Promise<void> {
  await db()`
    INSERT INTO anmeldeversuche (kennung, ip, erfolg, grund, user_agent)
    VALUES (${eintrag.kennung.slice(0, 200)}, ${eintrag.ip}, ${eintrag.erfolg},
            ${eintrag.grund}, ${eintrag.userAgent?.slice(0, 256) ?? null})`;
}

/** Fehlversuche einer IP im angegebenen Zeitfenster — für die Bremse. */
export async function fehlversucheVonIp(ip: string, minuten: number): Promise<number> {
  const zeilen = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM anmeldeversuche
     WHERE ip = ${ip} AND erfolg = FALSE
       AND zeitpunkt > NOW() - (${minuten} || ' minutes')::interval`;
  return zeilen[0]?.n ?? 0;
}

// ── Verwaltung (AP10) ───────────────────────────────────────────────────────

import { NichtGefunden, RegelFehler } from "../api/fehler.js";
import { hashePasswort } from "../domain/passwort.js";
import { rechteVonRolle } from "./rollen.js";

/**
 * Wie viele handlungsfähige Verwaltungskonten gibt es — außer diesem einen?
 *
 * "Handlungsfähig" heißt: aktiv UND mit dem Recht, Benutzer zu verwalten.
 * Ein deaktiviertes Konto mit allen Rechten nützt niemandem.
 */
async function andereVerwalterAktiv(ausserId: string): Promise<number> {
  const zeilen = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM benutzer b JOIN rollen r ON r.id = b.rolle
     WHERE b.id <> ${ausserId}
       AND b.aktiv
       AND 'benutzer.verwalten' = ANY(r.rechte)`;
  return zeilen[0]?.n ?? 0;
}

/**
 * Wirft, wenn eine Änderung das letzte handlungsfähige Verwaltungskonto
 * beseitigen würde.
 *
 * DER kritische Schutz dieses Arbeitspakets: Ohne ihn könnte sich Julius
 * selbst aussperren, und die App wäre nur noch über die Kommandozeile am
 * Mini-PC zu retten.
 */
async function pruefeLetzterVerwalter(
  betroffenId: string,
  neu: { rolle?: string; aktiv?: boolean },
): Promise<void> {
  const betroffen = await findeNachId(betroffenId);
  if (!betroffen) return;

  const hatteRecht = (await rechteVonRolle(betroffen.rolle)).includes("benutzer.verwalten");
  if (!hatteRecht) return; // war ohnehin kein Verwalter — nichts zu verlieren

  const bleibtVerwalter =
    (neu.aktiv ?? betroffen.aktiv) &&
    (await rechteVonRolle(neu.rolle ?? betroffen.rolle)).includes("benutzer.verwalten");
  if (bleibtVerwalter) return;

  if ((await andereVerwalterAktiv(betroffenId)) === 0) {
    throw new RegelFehler(
      `"${betroffen.anzeigename}" ist das letzte Konto, das Benutzer verwalten darf. ` +
        `Ohne ein solches Konto käme niemand mehr an die Benutzerverwaltung. ` +
        `Bitte zuerst ein zweites Konto mit dieser Berechtigung anlegen.`,
    );
  }
}

/**
 * Vier zufällige Wörter als Einmalpasswort.
 *
 * Vorlesbar am Telefon und über den Bauhof hinweg — anders als eine
 * Zeichenfolge aus dem Zufallsgenerator, bei der man dreimal nachfragt,
 * ob das ein großes I oder eine Eins war.
 */
const WOERTER = [
  "Anker", "Balken", "Beton", "Bagger", "Dachs", "Eisen", "Esche", "Fichte",
  "Ferse", "Giebel", "Granit", "Hammer", "Hafer", "Insel", "Kiesel", "Kran",
  "Lehm", "Linde", "Mörtel", "Nagel", "Norden", "Otter", "Pflug", "Quarz",
  "Rabe", "Riegel", "Sattel", "Schiefer", "Traufe", "Ulme", "Vogel", "Wiese",
  "Winkel", "Zange", "Ziegel", "Zirbe",
];

export function erzeugeEinmalpasswort(): string {
  const teile: string[] = [];
  for (let i = 0; i < 4; i++) teile.push(WOERTER[randomInt(WOERTER.length)]!);
  // Zwei Ziffern am Ende, damit die Mindestlänge sicher erreicht wird und
  // das Passwort nicht in einer Wörterbuchliste steht.
  return teile.join("-") + "-" + String(randomInt(10, 100));
}

export async function legeBenutzerAn(daten: {
  benutzername: string;
  anzeigename: string;
  email?: string | null;
  rolle: string;
}): Promise<{ benutzer: Benutzer; einmalpasswort: string }> {
  const benutzername = daten.benutzername.trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(benutzername)) {
    throw new RegelFehler(
      "Der Benutzername braucht 3 bis 40 Zeichen: Buchstaben, Ziffern, Punkt, " +
        "Bindestrich oder Unterstrich.",
    );
  }
  const anzeigename = daten.anzeigename.trim();
  if (!anzeigename) throw new RegelFehler("Der Anzeigename fehlt.");

  const email = daten.email?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RegelFehler("Die E-Mail-Adresse sieht nicht gültig aus.");
  }

  const [schon] = await db()`SELECT id FROM benutzer WHERE benutzername = ${benutzername}`;
  if (schon) throw new RegelFehler(`Den Benutzernamen "${benutzername}" gibt es bereits.`);

  const einmalpasswort = erzeugeEinmalpasswort();

  const [neu] = await db()<{ id: string }[]>`
    INSERT INTO benutzer (benutzername, email, passwort_hash, anzeigename, rolle,
                          passwort_wechsel_noetig)
    VALUES (${benutzername}, ${email}, ${await hashePasswort(einmalpasswort)},
            ${anzeigename}, ${daten.rolle}, TRUE)
    RETURNING id`;

  const benutzer = await findeNachId(neu!.id);
  return { benutzer: benutzer!, einmalpasswort };
}

export async function aendereBenutzer(
  id: string,
  daten: { anzeigename?: string; email?: string | null; rolle?: string; aktiv?: boolean },
  akteurId: string,
): Promise<Benutzer> {
  const alt = await findeNachId(id);
  if (!alt) throw new NichtGefunden("Benutzer");

  const aendertRolle = daten.rolle !== undefined && daten.rolle !== alt.rolle;
  const aendertAktiv = daten.aktiv !== undefined && daten.aktiv !== alt.aktiv;

  // Selbstschutz: Am eigenen Konto lassen sich Rolle und Zustand nicht
  // ändern — auch dann nicht, wenn es andere Verwalter gibt. Wer sich
  // herabstufen will, lässt es von jemand anderem tun. So kann ein
  // Fehlgriff nie die eigene Handlungsfähigkeit kosten.
  if (id === akteurId && (aendertRolle || aendertAktiv)) {
    throw new RegelFehler(
      "Am eigenen Konto lassen sich Rolle und Zustand nicht ändern. " +
        "Bitte von einem anderen Konto mit Benutzerverwaltung erledigen.",
    );
  }

  if (aendertRolle || aendertAktiv) {
    await pruefeLetzterVerwalter(id, {
      ...(daten.rolle !== undefined ? { rolle: daten.rolle } : {}),
      ...(daten.aktiv !== undefined ? { aktiv: daten.aktiv } : {}),
    });
  }

  await db()`
    UPDATE benutzer SET
      anzeigename = ${daten.anzeigename?.trim() || alt.anzeigename},
      email       = ${daten.email === undefined ? alt.email : daten.email?.trim() || null},
      rolle       = ${daten.rolle ?? alt.rolle},
      aktiv       = ${daten.aktiv ?? alt.aktiv},
      updated_at  = NOW()
    WHERE id = ${id}`;

  // Ein Rollenwechsel beendet die Sitzungen des Betroffenen. Er soll sich
  // neu anmelden und merken, dass sich etwas geändert hat — statt in
  // unerklärliche Fehlermeldungen zu laufen.
  if (aendertRolle) await beendeAlleSitzungen(id);

  return (await findeNachId(id))!;
}

export async function setzePasswortZurueck(
  id: string,
  akteurId: string,
): Promise<{ einmalpasswort: string }> {
  const konto = await findeNachId(id);
  if (!konto) throw new NichtGefunden("Benutzer");
  if (id === akteurId) {
    throw new RegelFehler(
      "Das eigene Passwort wird über „Passwort ändern“ gewechselt, nicht über das Zurücksetzen.",
    );
  }

  const einmalpasswort = erzeugeEinmalpasswort();
  // setzePasswort erhöht token_version und erzwingt den Wechsel beim
  // nächsten Anmelden — beides ist hier genau richtig.
  await setzePasswort(id, await hashePasswort(einmalpasswort), true);
  return { einmalpasswort };
}

/**
 * Die Liste mit Rolle und Zustand — nur für die Benutzerverwaltung.
 *
 * Die Spalten stehen hier ausgeschrieben mit Präfix "b.", nicht über
 * felder(): Sowohl "benutzer" als auch "rollen" haben eine Spalte "id",
 * und ohne Präfix wäre die Abfrage mehrdeutig.
 */
export async function listeBenutzerVoll(): Promise<
  (Benutzer & { rollenname: string })[]
> {
  return db()<(Benutzer & { rollenname: string })[]>`
    SELECT b.id, b.benutzername, b.email, b.anzeigename, b.rolle, b.aktiv,
           b.token_version, b.fehlversuche, b.gesperrt_bis,
           b.passwort_wechsel_noetig, b.letzter_login,
           r.name AS rollenname
      FROM benutzer b JOIN rollen r ON r.id = b.rolle
     ORDER BY b.aktiv DESC, b.anzeigename`;
}

/** Die abgespeckte Liste für die Personenauswahl beim Buchen. */
export async function listeBenutzerKurz(): Promise<
  { id: string; anzeigename: string; aktiv: boolean }[]
> {
  return db()`
    SELECT id, anzeigename, aktiv FROM benutzer
     WHERE aktiv ORDER BY anzeigename`;
}
