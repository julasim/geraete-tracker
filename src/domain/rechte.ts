/**
 * Der Rechte-Katalog.
 *
 * Reine Daten und reine Funktionen, ohne Datenbank — dadurch einzeln testbar
 * und an einer Stelle nachlesbar, wer was darf.
 *
 * Die Liste ist nicht erfunden, sondern aus den 24 Routen abgeleitet, die
 * vor AP10 auf die Rolle "admin" beschränkt waren. Jedes Recht steht für
 * eine Gruppe von Handlungen, die im Betrieb zusammengehören.
 *
 * LESEN IST KEIN RECHT. Wer angemeldet ist, sieht den ganzen Bestand — die
 * Frage "wo ist der Rüttler?" muss jeder beantworten können. Geschützt ist
 * ausschließlich das Verändern.
 */

export const RECHTE = [
  // ── Täglicher Umgang mit Geräten ─────────────────────────────────────
  "buchungen.erfassen",
  "schaeden.melden",
  "dateien.hochladen",

  // ── Bauhof und Werkstatt ─────────────────────────────────────────────
  "geraete.pflegen",
  "stammdaten.pflegen",
  "pruefungen.eintragen",
  "schaeden.bearbeiten",
  "dateien.verwalten",
  "etiketten.drucken",

  // ── Folgenreich: ein Fehlgriff wirkt weit ────────────────────────────
  "geraete.ausmustern",
  "buchungen.korrigieren",
  "daten.austauschen",
  "benutzer.verwalten",
] as const;

export type Recht = (typeof RECHTE)[number];

/** Was ein Recht erlaubt — für die Anzeige in der Rollenverwaltung. */
export const RECHT_TEXT: Record<Recht, { titel: string; erklaerung: string; gruppe: string }> = {
  "buchungen.erfassen": {
    titel: "Geräte ausgeben und zurücknehmen",
    erklaerung: "Ausgeben, Zurücknehmen und Umbuchen auf andere Baustellen.",
    gruppe: "Täglicher Umgang",
  },
  "schaeden.melden": {
    titel: "Schäden melden",
    erklaerung: "Einen Schaden eintragen. Bei Schwere „Ausfall“ wird das Gerät gesperrt.",
    gruppe: "Täglicher Umgang",
  },
  "dateien.hochladen": {
    titel: "Fotos und Dokumente hinzufügen",
    erklaerung: "Bilder aufnehmen und Dateien zu einem Gerät legen.",
    gruppe: "Täglicher Umgang",
  },

  "geraete.pflegen": {
    titel: "Geräte anlegen und bearbeiten",
    erklaerung: "Neue Geräte erfassen, Stammdaten ändern, Etiketten vergeben.",
    gruppe: "Bauhof und Werkstatt",
  },
  "stammdaten.pflegen": {
    titel: "Standorte, Lagerplätze und Schlagworte",
    erklaerung: "Baustellen und Regale anlegen, Einteilungen pflegen.",
    gruppe: "Bauhof und Werkstatt",
  },
  "pruefungen.eintragen": {
    titel: "Prüfungen eintragen",
    erklaerung: "Prüfarten anlegen und durchgeführte Prüfungen erfassen.",
    gruppe: "Bauhof und Werkstatt",
  },
  "schaeden.bearbeiten": {
    titel: "Schäden erledigen",
    erklaerung: "Einen Schaden abschließen und ein gesperrtes Gerät wieder freigeben.",
    gruppe: "Bauhof und Werkstatt",
  },
  "dateien.verwalten": {
    titel: "Dateien verwalten",
    erklaerung: "Fotos löschen und das Titelbild festlegen.",
    gruppe: "Bauhof und Werkstatt",
  },
  "etiketten.drucken": {
    titel: "Etiketten drucken",
    erklaerung: "Barcode-Etiketten für Geräte erzeugen.",
    gruppe: "Bauhof und Werkstatt",
  },

  "geraete.ausmustern": {
    titel: "Geräte ausmustern",
    erklaerung: "Ein Gerät aus dem Bestand nehmen. Es verschwindet aus allen Listen.",
    gruppe: "Folgenreich",
  },
  "buchungen.korrigieren": {
    titel: "Bestand berichtigen",
    erklaerung: "Gegenbuchung bei falschem Bestand — verändert die Historie.",
    gruppe: "Folgenreich",
  },
  "daten.austauschen": {
    titel: "Import und Export",
    erklaerung: "Bestand als Tabelle ein- und auslesen. Ein Import kann viele Geräte auf einmal ändern.",
    gruppe: "Folgenreich",
  },
  "benutzer.verwalten": {
    titel: "Benutzer verwalten",
    erklaerung: "Konten anlegen, Rollen vergeben, Passwörter zurücksetzen.",
    gruppe: "Folgenreich",
  },
};

/** Die Rollen, die mitgeliefert werden. Eigene kommen in der App dazu. */
export interface RollenVorgabe {
  id: string;
  name: string;
  beschreibung: string;
  rechte: Recht[];
  sortOrder: number;
}

const TAEGLICH: Recht[] = ["buchungen.erfassen", "schaeden.melden", "dateien.hochladen"];

const BAUHOF: Recht[] = [
  "geraete.pflegen",
  "stammdaten.pflegen",
  "pruefungen.eintragen",
  "schaeden.bearbeiten",
  "dateien.verwalten",
  "etiketten.drucken",
];

const FOLGENREICH: Recht[] = [
  "geraete.ausmustern",
  "buchungen.korrigieren",
  "daten.austauschen",
  "benutzer.verwalten",
];

export const ROLLEN_VORGABEN: RollenVorgabe[] = [
  {
    id: "mitarbeiter",
    name: "Mitarbeiter",
    beschreibung:
      "Für die Baustelle: scannen, ausgeben, zurücknehmen, Schäden melden. " +
      "Sieht den ganzen Bestand, ändert aber keine Stammdaten.",
    rechte: [...TAEGLICH],
    sortOrder: 10,
  },
  {
    id: "lager",
    name: "Lager und Werkstatt",
    beschreibung:
      "Führt den Bauhof: legt Geräte an, pflegt Standorte und Regale, trägt " +
      "Prüfungen ein, erledigt Schäden, druckt Etiketten.",
    rechte: [...TAEGLICH, ...BAUHOF],
    sortOrder: 20,
  },
  {
    id: "verwaltung",
    name: "Verwaltung",
    beschreibung:
      "Vollzugriff einschließlich Benutzerverwaltung, Import und Export, " +
      "Korrekturbuchungen und Ausmustern.",
    rechte: [...TAEGLICH, ...BAUHOF, ...FOLGENREICH],
    sortOrder: 30,
  },
];

/** Ist ein Wert ein bekanntes Recht? */
export function istRecht(wert: string): wert is Recht {
  return (RECHTE as readonly string[]).includes(wert);
}

/**
 * Darf jemand mit diesen Rechten das Verlangte?
 *
 * Bewusst ohne Sonderfall für eine "Superrolle": Wer alles darf, hat alle
 * Rechte eingetragen. Ein eingebauter Freifahrtschein wäre genau die Art
 * Ausnahme, die man beim nächsten Umbau übersieht.
 */
export function hatRecht(rechte: readonly string[], verlangt: Recht): boolean {
  return rechte.includes(verlangt);
}

/** Alle Rechte, gruppiert — für die Anzeige in der Rollenverwaltung. */
export function rechteNachGruppe(): { gruppe: string; rechte: Recht[] }[] {
  const gruppen = new Map<string, Recht[]>();
  for (const recht of RECHTE) {
    const gruppe = RECHT_TEXT[recht].gruppe;
    if (!gruppen.has(gruppe)) gruppen.set(gruppe, []);
    gruppen.get(gruppe)!.push(recht);
  }
  return [...gruppen].map(([gruppe, rechte]) => ({ gruppe, rechte }));
}
