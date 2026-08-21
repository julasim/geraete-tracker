/**
 * Der Scan-Endpunkt — der meistgenutzte der ganzen Anwendung.
 *
 * Ein gescannter Code kann dreierlei sein, und die Antwort sagt in `typ`,
 * was es war. Möglich ist diese Unterscheidung nur durch die getrennten
 * Nummernkreise: Geräte tragen reine Ziffern, Lagerplätze das Präfix "P-".
 *
 * Die erlaubten Folgeaktionen kommen MIT der Antwort. Würde die Oberfläche
 * sie selbst herleiten, liefen Anzeige und Regelwerk früher oder später
 * auseinander — und der Benutzer tippt auf "Ausgeben", um dann zu erfahren,
 * dass das Gerät defekt ist.
 */

import { Hono } from "hono";
import { angemeldet, hatRechtImKontext, type AppEnv } from "../auth.js";
import { pfadText } from "../pfad.js";
import { codeArt, normalisiere } from "../../domain/barcode.js";
import { erlaubteAktionen, hinweisZuStatus } from "../../domain/status.js";
import { findeGeraetNachCode } from "../../data/geraete.js";
import { bestandAmLagerplatz, findeLagerplatzNachCode } from "../../data/stammdaten.js";
import { historie } from "../../data/buchungen.js";
import { faelligeFuerGeraet } from "../../data/pruefungen.js";
import { merkeGesehen } from "../../data/nummern.js";

export const scanRouten = new Hono<AppEnv>();

scanRouten.get("/scan/:code", async (c) => {
  const roh = pfadText(c, "code", 60);
  const code = normalisiere(roh);
  angemeldet(c);

  // Diese Route entscheidet nichts, sie ANTWORTET nur unterschiedlich — je
  // nachdem, was der Benutzer mit dem Ergebnis anfangen könnte. Die drei
  // Rechte werden deshalb einzeln abgefragt und nicht zu einem "ist Chef"
  // zusammengefasst: Eine eigene Rolle kann genau eines davon tragen.
  const darfGeraetAnlegen = hatRechtImKontext(c, "geraete.pflegen");
  const darfPlatzAnlegen = hatRechtImKontext(c, "stammdaten.pflegen");
  const darfKorrigieren = hatRechtImKontext(c, "buchungen.korrigieren");

  const art = codeArt(code);

  if (art === "unbrauchbar") {
    return c.json(
      {
        typ: "unbekannt" as const,
        code,
        grund: "unlesbar",
        hinweis: "Dieser Code sieht nach keinem Etikett aus. Bitte Nummer von Hand eingeben.",
      },
      404,
    );
  }

  // ── Lagerplatz ──────────────────────────────────────────────────────────
  if (art === "lagerplatz") {
    const platz = await findeLagerplatzNachCode(code);
    if (!platz) {
      return c.json(
        {
          typ: "unbekannt" as const,
          code,
          grund: "platz_nicht_erfasst",
          // Nur die Verwaltung darf anlegen — der Mitarbeiter auf der
          // Baustelle soll nicht raten müssen, was zu tun ist.
          anlegbar: darfPlatzAnlegen,
          hinweis: darfPlatzAnlegen
            ? "Dieser Lagerplatz ist noch nicht erfasst."
            : "Dieser Lagerplatz ist nicht erfasst. Bitte im Büro melden.",
        },
        404,
      );
    }
    return c.json({
      typ: "lagerplatz" as const,
      code,
      lagerplatz: platz,
      geraete: await bestandAmLagerplatz(platz.id),
    });
  }

  // ── Gerät ───────────────────────────────────────────────────────────────
  const { geraet, mehrdeutig } = await findeGeraetNachCode(code);

  // Mehrere Treffer: lieber nachfragen als still das falsche Gerät buchen.
  // Tritt auf, wenn es sowohl "0042" als auch "42" gibt.
  if (mehrdeutig.length) {
    return c.json(
      {
        typ: "mehrdeutig" as const,
        code,
        geraete: mehrdeutig,
        hinweis: "Zu diesem Code passen mehrere Geräte. Bitte auswählen.",
      },
      409,
    );
  }

  if (!geraet) {
    /**
     * Ein Etikett, das die Anwendung nicht kennt, klebt trotzdem auf etwas.
     * Genau so erfährt sie vom Altbestand: Die Nummer wird als belegt
     * vermerkt und danach nie an ein anderes Gerät vergeben.
     *
     * Bewusst still und ohne Fehlerweitergabe — der Scan ist ein
     * Lesevorgang, und ein Fehler beim Mitschreiben darf ihn nicht
     * scheitern lassen. Der Mitarbeiter auf der Baustelle merkt davon nichts.
     */
    void merkeGesehen(code, angemeldet(c).id).catch(() => {});

    return c.json(
      {
        typ: "unbekannt" as const,
        code,
        grund: "geraet_nicht_erfasst",
        anlegbar: darfGeraetAnlegen,
        hinweis: darfGeraetAnlegen
          ? "Dieses Gerät ist noch nicht erfasst. Die Nummer ist ab jetzt reserviert."
          : "Dieses Gerät ist nicht erfasst. Bitte im Büro melden.",
      },
      404,
    );
  }

  const [letzte] = await historie(geraet.id, 1);
  const pruefungen = await faelligeFuerGeraet(geraet.id);

  return c.json({
    typ: "geraet" as const,
    code,
    geraet,
    aktionen: erlaubteAktionen(geraet.status, darfKorrigieren),
    hinweis: hinweisZuStatus(geraet.status),
    letzteBuchung: letzte ?? null,
    // Warnungen gehören auf die Gerätekarte, nicht in eine Liste, die
    // niemand aufmacht: Beim Scannen fällt eine abgelaufene Prüfung auf.
    warnungen: [
      ...pruefungen
        .filter((p) => p.ueberfaellig)
        .map((p) => ({
          art: "pruefung" as const,
          text: `${p.pruefart} war am ${p.naechste_faellig.toLocaleDateString("de-AT")} fällig.`,
        })),
      ...(geraet.offene_schaeden > 0
        ? [
            {
              art: "schaden" as const,
              text:
                geraet.offene_schaeden === 1
                  ? "Für dieses Gerät ist ein Schaden offen."
                  : `Für dieses Gerät sind ${geraet.offene_schaeden} Schäden offen.`,
            },
          ]
        : []),
    ],
  });
});
