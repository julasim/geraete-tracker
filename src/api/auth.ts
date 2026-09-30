/**
 * Anmeldung: Token ausstellen, prüfen, Rechte durchsetzen.
 *
 * Abweichung von PATIO, bewusst: Das Token liegt in einem httpOnly-Cookie,
 * nicht im localStorage. Zwei Gründe — ein eingeschleustes Skript kann es
 * nicht auslesen, und Server-Sent-Events kämen sonst nicht ohne ein eigenes
 * Ticket-System aus (PATIO brauchte dafür src/api/sse-tickets.ts).
 */

import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import jwt from "jsonwebtoken";
import { COOKIE_SECURE, JWT_SECRET, SESSION_TAGE } from "../config.js";
import { findeNachId, type Benutzer } from "../data/benutzer.js";
import { KeinRecht, NichtAngemeldet } from "./fehler.js";
import { rechteVonRolle } from "../data/rollen.js";
import { hatRecht, RECHT_TEXT, type Recht } from "../domain/rechte.js";

export const COOKIE_NAME = "gt_sitzung";

interface TokenInhalt {
  sub: string; // Benutzer-ID
  tv: number; // token_version zum Zeitpunkt der Ausstellung
}

/** Was die Middleware für nachgelagerte Routen bereitstellt. */
export type AppEnv = {
  Variables: {
    benutzer: Benutzer;
    /** Die Rechte der Rolle, bei jeder Anfrage frisch aufgelöst. */
    rechte: Recht[];
  };
};

export function stelleTokenAus(benutzer: Pick<Benutzer, "id" | "token_version">): string {
  const inhalt: TokenInhalt = { sub: benutzer.id, tv: benutzer.token_version };
  return jwt.sign(inhalt, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: `${SESSION_TAGE}d`,
  });
}

function pruefeToken(token: string): TokenInhalt {
  const inhalt = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
  if (typeof inhalt === "string" || !inhalt.sub || typeof inhalt.sub !== "string") {
    throw new Error("Token ohne gültigen Inhalt");
  }
  return { sub: inhalt.sub, tv: Number((inhalt as jwt.JwtPayload).tv ?? 0) };
}

export function setzeSitzungsCookie(c: Context, token: string): void {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true, // für Skripte im Browser unsichtbar
    secure: COOKIE_SECURE, // nur über HTTPS (in der Entwicklung abschaltbar)
    sameSite: "Strict", // deckt CSRF bei einer einzelnen Domain ab
    path: "/",
    maxAge: SESSION_TAGE * 24 * 60 * 60,
  });
}

export function loescheSitzungsCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: "/", secure: COOKIE_SECURE, sameSite: "Strict" });
}

/**
 * Prüft die Anmeldung und legt den Benutzer für die Route bereit.
 *
 * Entscheidend: Rolle, Aktiv-Zustand und token_version werden bei JEDER
 * Anfrage frisch aus der Datenbank gelesen, nie aus dem Token übernommen.
 * Dadurch wirken Herabstufung, Deaktivierung und "alle Sitzungen beenden"
 * sofort — sonst behielte ein ausgestelltes Token bis zu 30 Tage lang seine
 * Rechte, auch das eines verlorenen Handys.
 */
export async function anmeldungPruefen(c: Context, next: Next): Promise<Response | void> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) throw new NichtAngemeldet();

  let inhalt: TokenInhalt;
  try {
    inhalt = pruefeToken(token);
  } catch {
    loescheSitzungsCookie(c);
    throw new NichtAngemeldet("Anmeldung abgelaufen oder ungültig.");
  }

  const benutzer = await findeNachId(inhalt.sub);
  if (!benutzer) {
    loescheSitzungsCookie(c);
    throw new NichtAngemeldet("Konto nicht mehr vorhanden.");
  }
  if (!benutzer.aktiv) {
    loescheSitzungsCookie(c);
    throw new NichtAngemeldet("Konto ist deaktiviert.");
  }
  if (benutzer.token_version !== inhalt.tv) {
    loescheSitzungsCookie(c);
    throw new NichtAngemeldet("Anmeldung wurde beendet. Bitte neu anmelden.");
  }

  c.set("benutzer", benutzer);

  // Die Rechte kommen aus der Rolle — bei JEDER Anfrage frisch, ohne
  // Zwischenspeicher. Nimmt jemand einem Konto ein Recht, wirkt das sofort
  // und nicht erst, wenn irgendwo ein Zwischenspeicher abläuft.
  c.set("rechte", await rechteVonRolle(benutzer.rolle));

  // Gleitende Verlängerung: wer die App benutzt, meldet sich nie neu an;
  // ein 30 Tage unbenutztes Gerät fällt heraus. Neu ausgestellt wird nur
  // gelegentlich, nicht bei jeder Anfrage — sonst schriebe jeder Klick ein
  // neues Cookie.
  const alter = restlaufzeitTage(token);
  if (alter !== null && alter < SESSION_TAGE - 1) {
    setzeSitzungsCookie(c, stelleTokenAus(benutzer));
  }

  await next();
}

function restlaufzeitTage(token: string): number | null {
  try {
    const inhalt = jwt.decode(token) as jwt.JwtPayload | null;
    if (!inhalt?.exp) return null;
    return (inhalt.exp * 1000 - Date.now()) / 86_400_000;
  } catch {
    return null;
  }
}

/**
 * Verlangt ein bestimmtes Recht. Setzt anmeldungPruefen voraus.
 *
 * Wird als Middleware in die Route gehängt:
 *   geraeteRouten.post("/geraete", darf("geraete.pflegen"), ...)
 *
 * Die Fehlermeldung nennt, was gefehlt hat — nicht aus Höflichkeit, sondern
 * damit niemand rätselt, warum ein Knopf nicht wirkt. Wer angemeldet ist,
 * erfährt damit nichts, was er nicht ohnehin über die Rollenverwaltung
 * sehen könnte.
 */
export function darf(recht: Recht) {
  return async function pruefeRecht(c: Context, next: Next): Promise<Response | void> {
    const benutzer = c.get("benutzer") as Benutzer | undefined;
    if (!benutzer) throw new NichtAngemeldet();

    const rechte = (c.get("rechte") as Recht[] | undefined) ?? [];
    if (!hatRecht(rechte, recht)) {
      throw new KeinRecht(
        `Dafür fehlt die Berechtigung: ${RECHT_TEXT[recht].titel}. ` +
          `Ihre Rolle erlaubt das nicht.`,
      );
    }
    await next();
  };
}

/** Die Rechte des angemeldeten Benutzers. */
export function rechteVon(c: Context): Recht[] {
  return (c.get("rechte") as Recht[] | undefined) ?? [];
}

/** Prüft ein Recht, ohne zu werfen — für Routen, die je nach Recht anders antworten. */
export function hatRechtImKontext(c: Context, recht: Recht): boolean {
  return hatRecht(rechteVon(c), recht);
}

/** Der angemeldete Benutzer. Wirft, wenn die Middleware nicht gelaufen ist. */
export function angemeldet(c: Context): Benutzer {
  const benutzer = c.get("benutzer") as Benutzer | undefined;
  if (!benutzer) throw new NichtAngemeldet();
  return benutzer;
}
