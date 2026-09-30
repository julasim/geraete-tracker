/**
 * Hilfen für Tests: Konten anlegen, anmelden, Cookie weiterreichen.
 */

import { db } from "../../src/db/client.js";
import { hashePasswort } from "../../src/domain/passwort.js";
import { app } from "../../src/api/server.js";
import { COOKIE_NAME } from "../../src/api/auth.js";

const TEST_PASSWORT = "Kranfahrt-Ziegel-Winter-7742";

export interface TestKonto {
  id: string;
  benutzername: string;
  passwort: string;
}

/** Legt ein frisches Konto an. Der Name bekommt einen Zufallsanteil. */
export async function legeKontoAn(opts?: {
  /** Kennung einer Rolle aus der Tabelle `rollen` (seit AP10 frei). */
  rolle?: string;
  aktiv?: boolean;
  email?: string;
  passwort?: string;
}): Promise<TestKonto> {
  const benutzername = `test-${Math.random().toString(36).slice(2, 10)}`;
  const passwort = opts?.passwort ?? TEST_PASSWORT;
  const hash = await hashePasswort(passwort);

  const zeilen = await db()<{ id: string }[]>`
    INSERT INTO benutzer (benutzername, email, passwort_hash, anzeigename, rolle, aktiv,
                          passwort_wechsel_noetig)
    VALUES (${benutzername}, ${opts?.email ?? null}, ${hash}, ${"Test " + benutzername},
            ${opts?.rolle ?? "mitarbeiter"}, ${opts?.aktiv ?? true}, FALSE)
    RETURNING id`;

  return { id: zeilen[0]!.id, benutzername, passwort };
}

/** Entfernt ein Testkonto samt seiner Anmeldeversuche. */
export async function raeumeKontoAuf(konto: TestKonto): Promise<void> {
  await db()`DELETE FROM anmeldeversuche WHERE kennung = ${konto.benutzername}`;
  await db()`DELETE FROM benutzer WHERE id = ${konto.id}`;
}

/** Meldet an und gibt das Sitzungs-Cookie zurück (oder null bei Fehlschlag). */
export async function meldeAn(
  kennung: string,
  passwort: string,
): Promise<{ status: number; cookie: string | null; koerper: unknown }> {
  const antwort = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kennung, passwort }),
  });
  const koerper = await antwort.json().catch(() => null);
  const gesetzt = antwort.headers.get("set-cookie");
  const cookie = gesetzt?.includes(COOKIE_NAME) ? (gesetzt.split(";")[0] ?? null) : null;
  return { status: antwort.status, cookie, koerper };
}

/** Anfrage mit Sitzungs-Cookie. */
export async function mitCookie(
  pfad: string,
  cookie: string | null,
  init: RequestInit = {},
): Promise<Response> {
  const kopf = new Headers(init.headers);
  if (cookie) kopf.set("Cookie", cookie);
  return app.request(pfad, { ...init, headers: kopf });
}

/** Setzt Sperre und Fehlversuche eines Kontos zurück. */
export async function entsperre(id: string): Promise<void> {
  await db()`UPDATE benutzer SET fehlversuche = 0, gesperrt_bis = NULL WHERE id = ${id}`;
}
