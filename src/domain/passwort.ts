/**
 * Passwortregeln und Hashing.
 *
 * Reine Fachlogik, ohne Datenbank und ohne HTTP — dadurch einzeln testbar.
 *
 * Grundhaltung: Länge schlägt Zeichensalat. Erzwungene Sonderzeichen führen
 * erfahrungsgemäß zu "Sommer2026!" auf einem Zettel am Bildschirm, während
 * eine lange Passphrase sowohl merkbar als auch schwer zu raten ist.
 */

import { createHash, randomBytes } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { LEAK_PRUEFUNG, PASSWORT_MIN_LAENGE } from "../config.js";

/**
 * argon2id. Anders als bcrypt braucht das Verfahren absichtlich viel
 * Arbeitsspeicher — dadurch hilft einem Angreifer auch eine Grafikkarte kaum.
 * 64 MB und 3 Durchgänge kosten den Server ~100 ms je Versuch.
 */
const ARGON: Parameters<typeof argonHash>[1] = {
  memoryCost: 65_536, // 64 MB
  timeCost: 3,
  parallelism: 1,
};

export async function hashePasswort(klartext: string): Promise<string> {
  return argonHash(klartext, ARGON);
}

export async function pruefePasswort(klartext: string, hash: string): Promise<boolean> {
  try {
    return await argonVerify(hash, klartext, ARGON);
  } catch {
    // Kaputter oder fremdformatiger Hash: nicht als Treffer werten.
    return false;
  }
}

/**
 * Vergleichs-Hash für Anmeldeversuche auf Konten, die es gar nicht gibt.
 *
 * Ohne ihn wäre der Weg "Konto unbekannt" spürbar schneller als "Passwort
 * falsch" — und an dieser Zeitdifferenz ließe sich ablesen, welche Konten
 * existieren. Ein Angreifer sammelt dann erst in Ruhe gültige Namen.
 *
 * Der Hash wird beim ersten Bedarf einmal aus einem Zufallswert berechnet.
 * Ein fest im Quelltext stehender Hash wäre verlockend, aber fehleranfällig:
 * stimmt er nicht exakt, bricht verify() sofort ab, statt zu rechnen — der
 * Schutz wäre still wirkungslos.
 */
let blindHash: Promise<string> | null = null;

export async function blindPruefung(klartext: string): Promise<void> {
  blindHash ??= argonHash(randomBytes(32).toString("hex"), ARGON);
  await pruefePasswort(klartext, await blindHash);
}

export interface RegelBefund {
  ok: boolean;
  fehler: string[];
}

/** Formale Regeln, ohne Netzzugriff. */
export function pruefeRegeln(klartext: string, kennung?: string): RegelBefund {
  const fehler: string[] = [];

  if (klartext.length < PASSWORT_MIN_LAENGE) {
    fehler.push(`Das Passwort muss mindestens ${PASSWORT_MIN_LAENGE} Zeichen lang sein.`);
  }
  if (klartext.length > 200) {
    fehler.push("Das Passwort darf höchstens 200 Zeichen lang sein.");
  }
  if (klartext.trim().length === 0) {
    fehler.push("Das Passwort darf nicht nur aus Leerzeichen bestehen.");
  }
  if (kennung && klartext.toLowerCase().includes(kennung.toLowerCase())) {
    fehler.push("Das Passwort darf den Benutzernamen nicht enthalten.");
  }
  if (/^(.)\1+$/.test(klartext)) {
    fehler.push("Das Passwort darf nicht aus einem einzigen wiederholten Zeichen bestehen.");
  }

  return { ok: fehler.length === 0, fehler };
}

/**
 * Abgleich gegen bekannte geleakte Passwörter über Have I Been Pwned.
 *
 * Nach dem k-Anonymity-Verfahren: gesendet werden nur die ersten fünf Zeichen
 * des SHA-1-Hashes, zurück kommt eine Liste aller Endungen dazu. Das Passwort
 * selbst — und auch sein vollständiger Hash — verlässt den Server nie.
 *
 * Fällt der Dienst aus, gilt das Passwort als unauffällig. Ein nicht
 * erreichbarer Fremddienst darf niemanden daran hindern, sein Passwort zu
 * ändern; der Vorfall wird protokolliert.
 */
export async function istGeleakt(
  klartext: string,
): Promise<{ geleakt: boolean; treffer: number; geprueft: boolean }> {
  if (!LEAK_PRUEFUNG) return { geleakt: false, treffer: 0, geprueft: false };

  const sha1 = createHash("sha1").update(klartext, "utf8").digest("hex").toUpperCase();
  const praefix = sha1.slice(0, 5);
  const rest = sha1.slice(5);

  try {
    const antwort = await fetch(`https://api.pwnedpasswords.com/range/${praefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "geraete-tracker" },
      signal: AbortSignal.timeout(4000),
    });
    if (!antwort.ok) return { geleakt: false, treffer: 0, geprueft: false };

    for (const zeile of (await antwort.text()).split("\n")) {
      const [endung, anzahl] = zeile.trim().split(":");
      if (endung === rest) {
        const treffer = Number(anzahl ?? 0);
        // Padding-Einträge kommen mit 0 zurück und zählen nicht.
        if (treffer > 0) return { geleakt: true, treffer, geprueft: true };
      }
    }
    return { geleakt: false, treffer: 0, geprueft: true };
  } catch {
    return { geleakt: false, treffer: 0, geprueft: false };
  }
}
