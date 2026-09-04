/**
 * Was an den Server geht, wenn gebucht wird.
 *
 * Reine Funktionen ohne Vue: Der Körper einer Buchung sah an vier Stellen
 * gleich aus, wurde aber viermal von Hand zusammengesetzt — und lief
 * auseinander. Der auffälligste Fall: `BuchenView` und `BuchenDialog` ließen
 * beim Weg mit Zubehör den Feldnamen `ausfall` einfach weg, ohne dass es
 * jemand sah.
 *
 * **Der Gewinn ist nicht die Zeilenzahl.** Netto spart dieser Umbau kaum
 * etwas; die vier `buchen()` bleiben vier, weil ihre Ausgänge wirklich
 * verschieden sind (eigene Bestätigungsseite, offener Dialog mit
 * Foto-Warnung, Zähler, Ereignis nach oben). Der Gewinn ist, dass eine Regel
 * nur noch an einer Stelle steht und die fünf Fehler aus AP25 nicht
 * wiederkehren können, weil es die vier Kopien nicht mehr gibt, in denen sie
 * saßen.
 */
import { api } from "@/api";
import type { Buchung, Buchungsart, Geraet } from "@/typen";

export interface Buchungsangaben {
  art: Buchungsart;
  standortId: string;
  lagerplatzId: string;
  /** Aus `useEmpfaenger().empfaengerFelder` — Konto oder Freitext, nie beides. */
  empfaenger: { empfaenger_id: string | null; empfaenger_freitext: string | null };
  rueckgabe: string;
  notiz: string;
}

/**
 * Die Angaben, die für jedes Gerät des Vorgangs gleich sind.
 *
 * Leere Zeichenketten werden zu `null`: In der Datenbank ist „nicht
 * angegeben" etwas anderes als ein leerer Text, und die Buchungszeile lässt
 * sich später nicht mehr berichtigen.
 */
export function buchungsRumpf(a: Buchungsangaben) {
  return {
    art: a.art,
    nach_standort_id: a.standortId || null,
    nach_lagerplatz_id: a.lagerplatzId || null,
    ...a.empfaenger,
    geplante_rueckgabe: a.rueckgabe || null,
    notiz: a.notiz || null,
  };
}

/** Ein Gerät, ein Aufruf. */
export function sendeEinzelbuchung(
  geraetId: string,
  angaben: Buchungsangaben,
): Promise<{ geraet: Geraet; buchung: Buchung }> {
  return api.post<{ geraet: Geraet; buchung: Buchung }>("/buchungen", {
    ...buchungsRumpf(angaben),
    geraet_id: geraetId,
  });
}

/**
 * Mehrere Geräte in EINER Transaktion — alles oder nichts.
 *
 * Auch der Weg „ein Gerät plus sein Zubehör" läuft hierüber: Sonst könnte der
 * Bagger draußen stehen und der Löffel laut System im Lager, weil ein zweiter
 * Aufruf scheiterte.
 *
 * **Bewusst keine Abkürzung „nur ein Gerät → `/buchungen`".** `bucheMehrere`
 * stellt der Fehlermeldung den Gerätenamen voran („Rüttelplatte (10011): …"),
 * `buche()` nicht — und `SammelPanel` erkennt das schuldige Gerät allein an
 * diesem Anfang wieder. Bei genau einem gesammelten Gerät bliebe es sonst in
 * der Auswahl stehen, und der nächste Versuch scheiterte an derselben Stelle.
 */
export function sendeSammelbuchung(
  geraetIds: string[],
  angaben: Buchungsangaben,
): Promise<{ geraete: Geraet[]; buchungen: Buchung[] }> {
  return api.post<{ geraete: Geraet[]; buchungen: Buchung[] }>("/buchungen/sammel", {
    ...buchungsRumpf(angaben),
    geraet_ids: geraetIds,
  });
}

/**
 * „Gerät ist defekt" bei der Rücknahme — als Schadensmeldung, nicht als
 * Sperrflag an der Buchung.
 *
 * Julius' Entscheidung, und sie löst zwei Dinge auf einmal:
 *
 * 1. **Das Flag ging bei Zubehör verloren.** `bucheMehrere` reicht die
 *    Angaben unverändert an jedes Gerät weiter — `ausfall` hätte den Löffel
 *    mitgesperrt. Deshalb ließen beide Ansichten es beim Sammelweg
 *    stillschweigend weg: Der Bagger kam kaputt zurück, stand auf
 *    `verfuegbar` und wurde am nächsten Morgen wieder ausgegeben. Genau der
 *    Fall, den der Schalter verhindern soll.
 * 2. **Ein per Buchung gesperrtes Gerät kommt schwer wieder frei.** Es
 *    entsteht dabei kein Schadensdatensatz; `aendereSchaden` kann es also
 *    nicht freigeben, und es braucht jemanden mit `buchungen.korrigieren`.
 *    Eine Schadensmeldung lässt sich dagegen normal erledigen — und der
 *    letzte erledigte Schaden gibt das Gerät von selbst wieder frei.
 *
 * `src/data/schaeden.ts` setzt den Zustand auf `defekt`, sobald das Gerät
 * nicht mehr `ausgegeben` ist. Nach der Rücknahme trifft das zu — deshalb
 * erst buchen, dann melden.
 *
 * Verlangt `schaeden.melden`; wer das Recht nicht hat, sieht den Schalter
 * gar nicht erst.
 */
/**
 * Ein Gerät kommt kaputt zurück.
 *
 * Warum als **Schadensmeldung** und nicht als `ausfall` an der Buchung:
 * Ein per Buchung gesperrtes Gerät hat keinen Schadensdatensatz — die
 * Automatik „letzten Schaden erledigt → wieder verfügbar" greift dann nicht,
 * und nur jemand mit `buchungen.korrigieren` bekommt es wieder frei. Über
 * den Schaden geht es den normalen Weg. Beim Sammelweg kommt hinzu, dass
 * `bucheMehrere` den Rumpf unverändert an JEDES Gerät weiterreicht: Ein
 * `ausfall` darin sperrte den Löffel mit dem Bagger.
 *
 * **Der Preis, bewusst bezahlt:** Früher lief das Sperren in derselben
 * Transaktion wie die Buchung, unter `FOR UPDATE`. Jetzt sind es zwei
 * Aufrufe, und dazwischen steht das Gerät kurz auf `verfuegbar`. Gibt es in
 * diesem Fenster ein anderer aus, greift die Regel in
 * `src/data/schaeden.ts` nicht mehr (sie sperrt nur, was nicht ausgegeben
 * ist) — der Schaden wird angelegt, das Gerät bleibt draußen und weiter
 * ausgebbar. Das Fenster ist zwei HTTP-Aufrufe breit und braucht zwei
 * Benutzer am selben Gerät im selben Moment; bei fünf bis zehn Benutzern und
 * 200 Maschinen ist das unwahrscheinlich, aber nicht unmöglich. Wer es
 * schließen will, braucht eine Serverroute, die Rücknahme und Ausfallschaden
 * in einer Transaktion erledigt — ein eigenes Arbeitspaket, keine
 * Nachbesserung hier.
 */
export function meldeDefekt(
  geraetId: string,
  buchungId: string | null,
  notiz: string,
): Promise<{ geraet: Geraet }> {
  const vermerk = notiz.trim();
  return api.post<{ geraet: Geraet }>(`/geraete/${geraetId}/schaeden`, {
    beschreibung: vermerk
      ? `Bei der Rücknahme als defekt gemeldet: ${vermerk}`
      : "Bei der Rücknahme als defekt gemeldet.",
    schwere: "ausfall",
    // Der Schaden hängt an der Rücknahme, mit der er auffiel — sonst steht
    // später eine Meldung ohne Vorgang da.
    buchung_id: buchungId,
  });
}
