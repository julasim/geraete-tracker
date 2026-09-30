/** Fotos und Dokumente je Gerät. */

import { db } from "../db/client.js";
import { NichtGefunden } from "../api/fehler.js";
import { loescheDatei } from "../api/upload.js";

export interface Datei {
  id: string;
  geraet_id: string;
  schaden_id: string | null;
  buchung_id: string | null;
  art: "foto" | "dokument";
  dateiname: string;
  pfad: string;
  mime: string;
  groesse: number;
  titel: string | null;
  ist_titelbild: boolean;
  sort_order: number;
  hochgeladen_am: Date;
  hochgeladen_von: string | null;
  hochgeladen_von_name?: string | null;
}

const FELDER = () => db()`
  d.id, d.geraet_id, d.schaden_id, d.buchung_id, d.art, d.dateiname, d.pfad,
  d.mime, d.groesse, d.titel, d.ist_titelbild, d.sort_order,
  d.hochgeladen_am, d.hochgeladen_von, b.anzeigename AS hochgeladen_von_name`;

export async function listeDateien(geraetId: string): Promise<Datei[]> {
  return db()<Datei[]>`
    SELECT ${FELDER()} FROM dateien d
      LEFT JOIN benutzer b ON b.id = d.hochgeladen_von
     WHERE d.geraet_id = ${geraetId}
     ORDER BY d.art, d.ist_titelbild DESC, d.sort_order, d.hochgeladen_am`;
}

export async function findeDatei(id: string): Promise<Datei> {
  const zeilen = await db()<Datei[]>`
    SELECT ${FELDER()} FROM dateien d
      LEFT JOIN benutzer b ON b.id = d.hochgeladen_von
     WHERE d.id = ${id}`;
  if (!zeilen[0]) throw new NichtGefunden("Datei");
  return zeilen[0];
}

export async function speichereDatei(eintrag: {
  geraet_id: string;
  schaden_id?: string | null;
  buchung_id?: string | null;
  art: "foto" | "dokument";
  dateiname: string;
  pfad: string;
  mime: string;
  groesse: number;
  titel?: string | null;
  hochgeladen_von: string;
}): Promise<Datei> {
  // Das erste Bild eines Geräts wird von selbst zum Titelbild — sonst
  // bliebe die Liste grau, bis jemand daran denkt, eines auszuwählen.
  //
  // NICHT aber ein Bild, das einen Vorgang zeigt statt des Geräts: das
  // Zustandsfoto einer Übergabe (`buchung_id`) und das Schadensfoto
  // (`schaden_id`). Beide halten einen Moment fest — ein Gerät am Hänger im
  // Regen, einen Riss im Gehäuse. Als Aushängeschild in der Geräteliste
  // wäre das falsch.
  //
  // Die Zählung muss dieselbe Ausnahme kennen: Sonst bekäme ein Gerät, bei
  // dem zuerst ein Übergabefoto entstand, NIE mehr ein Titelbild — der
  // Zähler stünde auf 1, obwohl es kein Gerätefoto gibt. Beim Einbau genau
  // so gebaut; ein Test hat es aufgedeckt.
  const [vorhanden] = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM dateien
     WHERE geraet_id = ${eintrag.geraet_id} AND art = 'foto'
       AND buchung_id IS NULL AND schaden_id IS NULL`;
  const istErstes =
    eintrag.art === "foto" &&
    !eintrag.buchung_id &&
    !eintrag.schaden_id &&
    (vorhanden?.n ?? 0) === 0;

  const zeilen = await db()<{ id: string }[]>`
    INSERT INTO dateien (geraet_id, schaden_id, buchung_id, art, dateiname, pfad,
                         mime, groesse, titel, ist_titelbild, hochgeladen_von)
    VALUES (${eintrag.geraet_id}, ${eintrag.schaden_id ?? null}, ${eintrag.buchung_id ?? null},
            ${eintrag.art}, ${eintrag.dateiname}, ${eintrag.pfad}, ${eintrag.mime},
            ${eintrag.groesse}, ${eintrag.titel ?? null}, ${istErstes},
            ${eintrag.hochgeladen_von})
    RETURNING id`;

  return findeDatei(zeilen[0]!.id);
}

/** Macht ein Bild zum Titelbild und nimmt dem bisherigen die Rolle ab. */
export async function setzeTitelbild(dateiId: string): Promise<void> {
  const datei = await findeDatei(dateiId);
  await db().begin(async (tx) => {
    // Erst abwählen, dann setzen — sonst schlägt der eindeutige Index zu.
    await tx`UPDATE dateien SET ist_titelbild = FALSE
              WHERE geraet_id = ${datei.geraet_id} AND ist_titelbild`;
    await tx`UPDATE dateien SET ist_titelbild = TRUE WHERE id = ${dateiId}`;
  });
}

export async function entferneDatei(id: string): Promise<void> {
  const datei = await findeDatei(id);
  await db()`DELETE FROM dateien WHERE id = ${id}`;
  // Erst aus der Datenbank, dann von der Platte: Bleibt eine verwaiste
  // Datei liegen, kostet das Speicher. Bliebe umgekehrt ein Eintrag ohne
  // Datei stehen, liefe die Anzeige in einen Fehler.
  await loescheDatei(datei.pfad);

  // War es das Titelbild, rückt das nächste Foto nach.
  if (datei.ist_titelbild) {
    const [naechstes] = await db()<{ id: string }[]>`
      SELECT id FROM dateien
       WHERE geraet_id = ${datei.geraet_id} AND art = 'foto'
       ORDER BY sort_order, hochgeladen_am LIMIT 1`;
    if (naechstes) await db()`UPDATE dateien SET ist_titelbild = TRUE WHERE id = ${naechstes.id}`;
  }
}

