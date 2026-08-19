/** Rollen und ihre Rechte. */

import { db } from "../db/client.js";
import { NichtGefunden, RegelFehler } from "../api/fehler.js";
import { istRecht, type Recht } from "../domain/rechte.js";

export interface Rolle {
  id: string;
  name: string;
  beschreibung: string | null;
  rechte: Recht[];
  ist_vorgabe: boolean;
  sort_order: number;
  /** Wie viele Konten diese Rolle tragen — für die Anzeige und die Löschsperre. */
  anzahl_benutzer?: number;
}

export async function listeRollen(): Promise<Rolle[]> {
  return db()<Rolle[]>`
    SELECT r.id, r.name, r.beschreibung, r.rechte, r.ist_vorgabe, r.sort_order,
           (SELECT count(*)::int FROM benutzer b WHERE b.rolle = r.id) AS anzahl_benutzer
      FROM rollen r
     ORDER BY r.sort_order, r.name`;
}

export async function findeRolle(id: string): Promise<Rolle> {
  const zeilen = await db()<Rolle[]>`
    SELECT id, name, beschreibung, rechte, ist_vorgabe, sort_order
      FROM rollen WHERE id = ${id}`;
  if (!zeilen[0]) throw new NichtGefunden("Rolle");
  return zeilen[0];
}

/**
 * Die Rechte einer Rolle.
 *
 * Wird bei JEDER Anfrage gerufen und bewusst nicht zwischengespeichert:
 * Nimmt jemand einem Konto ein Recht, muss das sofort wirken — nicht erst,
 * wenn ein Zwischenspeicher abläuft oder ein zweiter Container neu startet.
 * Die Abfrage trifft einen Primärschlüssel und kostet nichts.
 */
export async function rechteVonRolle(rolleId: string): Promise<Recht[]> {
  const zeilen = await db()<{ rechte: string[] }[]>`
    SELECT rechte FROM rollen WHERE id = ${rolleId}`;
  return (zeilen[0]?.rechte ?? []).filter(istRecht);
}

function pruefeRechte(rechte: string[]): Recht[] {
  const unbekannt = rechte.filter((r) => !istRecht(r));
  if (unbekannt.length) {
    throw new RegelFehler(`Unbekannte Rechte: ${unbekannt.join(", ")}`);
  }
  return rechte as Recht[];
}

export async function legeRolleAn(daten: {
  id: string;
  name: string;
  beschreibung?: string | null;
  rechte: string[];
}): Promise<Rolle> {
  const id = daten.id.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(id)) {
    throw new RegelFehler(
      "Die Kennung darf nur Kleinbuchstaben, Ziffern, Bindestrich und Unterstrich enthalten " +
        "und muss mit einem Buchstaben beginnen.",
    );
  }
  const name = daten.name.trim();
  if (!name) throw new RegelFehler("Die Rolle braucht einen Namen.");

  const [schon] = await db()`SELECT id FROM rollen WHERE id = ${id}`;
  if (schon) throw new RegelFehler(`Es gibt bereits eine Rolle mit der Kennung "${id}".`);

  const rechte = pruefeRechte(daten.rechte);

  const zeilen = await db()<Rolle[]>`
    INSERT INTO rollen (id, name, beschreibung, rechte, ist_vorgabe, sort_order)
    VALUES (${id}, ${name}, ${daten.beschreibung ?? null}, ${rechte}, FALSE, 100)
    RETURNING id, name, beschreibung, rechte, ist_vorgabe, sort_order`;
  return zeilen[0]!;
}

export async function aendereRolle(
  id: string,
  daten: { name?: string; beschreibung?: string | null; rechte?: string[] },
): Promise<Rolle> {
  const alt = await findeRolle(id);

  // Mitgelieferte Rollen lassen sich umbenennen, aber ihre Rechte bleiben —
  // sonst könnte man der Verwaltung das Recht "benutzer.verwalten" nehmen
  // und sich damit auf einem Umweg selbst aussperren.
  if (alt.ist_vorgabe && daten.rechte) {
    throw new RegelFehler(
      `"${alt.name}" ist eine mitgelieferte Rolle — ihre Rechte lassen sich nicht ändern. ` +
        `Für eine abweichende Zusammenstellung bitte eine eigene Rolle anlegen.`,
    );
  }

  const rechte = daten.rechte ? pruefeRechte(daten.rechte) : alt.rechte;

  // Derselbe Aussperr-Schutz, nur auf dem zweiten Weg: Eine EIGENE Rolle mit
  // "benutzer.verwalten" darf dieses Recht nicht verlieren, solange sie das
  // letzte ist, das es trägt. Ohne diese Prüfung ließe sich der Schutz aus
  // `benutzer.ts` einfach umgehen — nicht am Konto, sondern an dessen Rolle.
  // (Beim Bau aufgefallen, als die Gegenprobe zeigte, dass der Schutz am
  // Konto über die API gar nicht auslösbar ist.)
  const verliertVerwaltung =
    alt.rechte.includes("benutzer.verwalten") && !rechte.includes("benutzer.verwalten");
  if (verliertVerwaltung) {
    const [uebrig] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n
        FROM benutzer b JOIN rollen r ON r.id = b.rolle
       WHERE b.aktiv AND b.rolle <> ${id}
         AND 'benutzer.verwalten' = ANY(r.rechte)`;
    if ((uebrig?.n ?? 0) === 0) {
      throw new RegelFehler(
        `"${alt.name}" ist die letzte Rolle, mit der jemand Benutzer verwalten kann. ` +
          `Nimmt man ihr dieses Recht, käme niemand mehr an die Benutzerverwaltung. ` +
          `Bitte zuerst einem anderen Konto diese Berechtigung geben.`,
      );
    }
  }

  const zeilen = await db()<Rolle[]>`
    UPDATE rollen SET
      name         = ${daten.name?.trim() || alt.name},
      beschreibung = ${daten.beschreibung === undefined ? alt.beschreibung : daten.beschreibung},
      rechte       = ${rechte},
      updated_at   = NOW()
    WHERE id = ${id}
    RETURNING id, name, beschreibung, rechte, ist_vorgabe, sort_order`;
  return zeilen[0]!;
}

export async function loescheRolle(id: string): Promise<void> {
  const rolle = await findeRolle(id);

  if (rolle.ist_vorgabe) {
    throw new RegelFehler(`"${rolle.name}" ist eine mitgelieferte Rolle und bleibt bestehen.`);
  }

  const [belegt] = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM benutzer WHERE rolle = ${id}`;
  if ((belegt?.n ?? 0) > 0) {
    throw new RegelFehler(
      `Die Rolle "${rolle.name}" ist ${belegt!.n} Konto/Konten zugewiesen. ` +
        `Bitte diese zuerst auf eine andere Rolle umstellen.`,
    );
  }

  await db()`DELETE FROM rollen WHERE id = ${id}`;
}
