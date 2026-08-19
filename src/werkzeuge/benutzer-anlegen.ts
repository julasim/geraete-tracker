/**
 * Legt ein Benutzerkonto auf der Kommandozeile an — der einzige Weg zum
 * ersten Admin-Konto.
 *
 * Bewusst kein Einrichtungsassistent über das Web: eine offen erreichbare
 * Seite, an der sich das erste Konto anlegen lässt, ist ein Wettrennen, das
 * man verlieren kann. Wer auf dem Server eine Kommandozeile hat, ist ohnehin
 * schon drin.
 *
 *   npm run benutzer:anlegen -- --name julius --rolle verwaltung
 *
 * Das Passwort wird abgefragt, nicht als Argument übergeben — Argumente
 * landen in der Shell-Historie und in der Prozessliste.
 */

import "dotenv/config";
import { stdin, stdout } from "node:process";
import { db, schliesseDb, warteAufDb } from "../db/client.js";
import { hashePasswort, istGeleakt, pruefeRegeln } from "../domain/passwort.js";

function argument(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Steuerzeichen als Codes statt als Literale — im Quelltext sichtbar
// und nicht durch Kopieren zerstörbar.
const ZEILENENDE = [10, 13]; // Enter
const STRG_D = 4;
const STRG_C = 3;
const RUECKTASTE = [8, 127];

/**
 * Liest eine Zeile von der Tastatur. Bewusst EINE Funktion für sichtbare und
 * verdeckte Eingaben: zwei verschiedene Lesemechanismen auf demselben stdin
 * kommen sich in die Quere — readline verschluckt Daten, die die zweite
 * Funktion dann vergeblich erwartet.
 *
 * Kommt die Eingabe aus einer Pipe statt von einer Tastatur (Tests), gibt es
 * keinen Rohmodus; die Zeilen kommen dann einfach am Stück.
 */
// Was nach einem Zeilenende im selben Datenblock noch übrig war. Kommt die
// Eingabe aus einer Pipe, liefert stdin alle Zeilen auf einmal — ohne diesen
// Puffer ginge alles nach der ersten Zeile verloren, und die nächste Abfrage
// wartete endlos.
let restPuffer = "";

async function lies(text: string, verdeckt = false): Promise<string> {
  stdout.write(text);

  // Liegt die nächste Zeile schon im Puffer? Dann gar nicht erst lesen.
  const trenner = restPuffer.indexOf("\n");
  if (trenner >= 0) {
    const zeile = restPuffer.slice(0, trenner);
    restPuffer = restPuffer.slice(trenner + 1);
    stdout.write("\n");
    return zeile.replace(/\r$/, "");
  }

  const tastatur = Boolean(stdin.isTTY);
  if (tastatur && verdeckt) stdin.setRawMode(true);

  return new Promise((fertig) => {
    let eingabe = restPuffer;
    restPuffer = "";

    const beenden = (rest: string) => {
      if (tastatur && verdeckt) stdin.setRawMode(false);
      stdin.removeListener("data", zuhoerer);
      stdin.pause();
      restPuffer = rest;
      if (verdeckt || !tastatur) stdout.write("\n");
      fertig(eingabe.replace(/\r$/, ""));
    };

    const zuhoerer = (buffer: Buffer) => {
      for (let i = 0; i < buffer.length; i++) {
        const code = buffer[i]!;
        if (ZEILENENDE.includes(code) || code === STRG_D) {
          return beenden(buffer.subarray(i + 1).toString("utf8"));
        }
        if (code === STRG_C) {
          if (tastatur && verdeckt) stdin.setRawMode(false);
          stdout.write("\nAbgebrochen.\n");
          process.exit(1);
        }
        if (RUECKTASTE.includes(code)) {
          eingabe = eingabe.slice(0, -1);
          continue;
        }
        if (code >= 32) eingabe += String.fromCharCode(code);
      }
    };

    stdin.resume();
    stdin.on("data", zuhoerer);
  });
}

try {
  await warteAufDb(3, 1000);
  const sql = db();

  const benutzername = (argument("name") ?? (await lies("Benutzername: "))).trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(benutzername)) {
    throw new Error(
      "Benutzername: 3 bis 40 Zeichen, erlaubt sind Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.",
    );
  }

  const [schonDa] = await sql`SELECT id FROM benutzer WHERE benutzername = ${benutzername}`;
  if (schonDa) throw new Error(`Es gibt bereits ein Konto "${benutzername}".`);

  const anzeigename =
    (argument("anzeigename") ?? (await lies(`Anzeigename [${benutzername}]: `))).trim() ||
    benutzername;

  const email = (argument("email") ?? (await lies("E-Mail (optional): "))).trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Die E-Mail-Adresse sieht nicht gültig aus.");
  }

  // Welche Rollen es gibt, steht seit AP10 in der Datenbank — nicht mehr im
  // Quelltext. Sonst müsste dieses Skript geändert werden, sobald jemand in
  // der Oberfläche eine eigene Rolle anlegt.
  const rollen = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM rollen ORDER BY sort_order, name`;
  const auswahl = rollen.map((r) => r.id).join("/");

  const rolle =
    (argument("rolle") ?? (await lies(`Rolle (${auswahl}) [verwaltung]: `))).trim() ||
    "verwaltung";
  if (!rollen.some((r) => r.id === rolle)) {
    throw new Error(`Unbekannte Rolle "${rolle}". Verfügbar: ${auswahl}`);
  }

  const passwort = await lies("Passwort (wird nicht angezeigt): ", true);
  const wiederholung = await lies("Passwort wiederholen:           ", true);
  if (passwort !== wiederholung) throw new Error("Die beiden Eingaben stimmen nicht überein.");

  const regeln = pruefeRegeln(passwort, benutzername);
  if (!regeln.ok) throw new Error(regeln.fehler.join("\n  "));

  stdout.write("Prüfe gegen bekannte Passwortlecks … ");
  const leak = await istGeleakt(passwort);
  if (leak.geleakt) {
    throw new Error(
      `\nDieses Passwort taucht in bekannten Datenlecks auf ` +
        `(${leak.treffer.toLocaleString("de-AT")} mal). Bitte ein anderes wählen.`,
    );
  }
  console.log(leak.geprueft ? "unauffällig." : "Dienst nicht erreichbar, übersprungen.");

  stdout.write("Berechne Passwort-Hash … ");
  const start = Date.now();
  const hash = await hashePasswort(passwort);
  console.log(`fertig (${Date.now() - start} ms).`);

  const [neu] = await sql<{ id: string }[]>`
    INSERT INTO benutzer (benutzername, email, passwort_hash, anzeigename, rolle,
                          passwort_wechsel_noetig)
    VALUES (${benutzername}, ${email || null}, ${hash}, ${anzeigename}, ${rolle}, FALSE)
    RETURNING id`;

  console.log(`\nKonto "${benutzername}" angelegt (Rolle ${rolle}, ID ${neu?.id}).\n`);
  await schliesseDb();
  process.exit(0);
} catch (fehler) {
  console.error("\nFehlgeschlagen:", fehler instanceof Error ? fehler.message : fehler, "\n");
  await schliesseDb();
  process.exit(1);
}
