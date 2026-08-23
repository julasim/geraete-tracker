/** Die Datentypen, wie sie die API liefert. */

export type GeraetStatus =
  | "verfuegbar"
  | "ausgegeben"
  | "wartung"
  | "defekt"
  | "ausgemustert";

export type Buchungsart = "ausgabe" | "ruecknahme" | "umbuchung" | "korrektur";

export interface Benutzer {
  id: string;
  benutzername: string;
  anzeigename: string;
  email: string | null;
  /** Kennung der Rolle. Seit AP10 frei — es gibt eigene Rollen. */
  rolle: string;
}

/**
 * Die volle Sicht auf ein Konto. Kommt nur mit dem Recht
 * `benutzer.verwalten`; ohne das liefert `GET /benutzer` nur `BenutzerKurz`.
 */
export interface BenutzerVoll extends Benutzer {
  rollenname: string;
  aktiv: boolean;
  passwort_wechsel_noetig: boolean;
  fehlversuche: number;
  gesperrt_bis: string | null;
  letzter_login: string | null;
}

export interface BenutzerKurz {
  id: string;
  anzeigename: string;
  aktiv: boolean;
}

export interface Rolle {
  id: string;
  name: string;
  beschreibung: string | null;
  rechte: string[];
  ist_vorgabe: boolean;
  sort_order: number;
  anzahl_benutzer?: number;
}

export interface RechtInfo {
  id: string;
  titel: string;
  erklaerung: string;
  gruppe: string;
}

export interface RechteKatalog {
  rechte: RechtInfo[];
  gruppen: { gruppe: string; rechte: string[] }[];
}

export interface Schlagwort {
  id: string;
  name: string;
  farbe: string | null;
  sort_order?: number;
}

export interface Standort {
  id: string;
  name: string;
  typ: "lager" | "baustelle" | "werkstatt" | "extern";
  adresse: string | null;
  notiz: string | null;
  aktiv: boolean;
}

export interface Lagerplatz {
  id: string;
  standort_id: string;
  bezeichnung: string;
  barcode: string | null;
  typ: "regal" | "fach" | "container" | "freiflaeche";
  notiz: string | null;
  aktiv: boolean;
}

export interface Geraet {
  id: string;
  inventarnummer: string | null;
  bezeichnung: string;
  hersteller: string | null;
  modell: string | null;
  seriennummer: string | null;
  anschaffungsdatum: string | null;
  anschaffungswert: string | null;
  status: GeraetStatus;
  aktueller_standort_id: string | null;
  aktueller_lagerplatz_id: string | null;
  aktueller_nutzer_id: string | null;
  foto_pfad: string | null;
  notiz: string | null;
  rev: number;
  standort: string | null;
  lagerplatz: string | null;
  nutzer: string | null;
  schlagworte: Schlagwort[];
  offene_schaeden: number;
  betriebsstunden: string | null;
  gehoert_zu_id: string | null;
  gehoert_zu: string | null;
  titelbild_id: string | null;
  zubehoer: { id: string; bezeichnung: string; inventarnummer: string | null; status: GeraetStatus }[];
}

export interface Datei {
  id: string;
  geraet_id: string;
  art: "foto" | "dokument";
  dateiname: string;
  mime: string;
  groesse: number;
  titel: string | null;
  ist_titelbild: boolean;
  hochgeladen_am: string;
  hochgeladen_von_name: string | null;
}

export interface Pruefart {
  id: string;
  name: string;
  intervall_monate: number;
  notiz: string | null;
  aktiv: boolean;
}

export interface Pruefung {
  id: string;
  pruefart: string;
  geprueft_am: string;
  naechste_faellig: string;
  ergebnis: "bestanden" | "maengel" | "durchgefallen";
  pruefer: string | null;
  notiz: string | null;
}

export type Ampel = "ueberfaellig" | "faellig" | "bald" | "ok";

export interface FaelligePruefung {
  geraet_id: string;
  inventarnummer: string | null;
  bezeichnung: string;
  status: GeraetStatus;
  pruefart: string;
  geprueft_am: string;
  naechste_faellig: string;
  tage_bis_faellig: number;
  ampel: Ampel;
}

export interface Schaden {
  id: string;
  geraet_id: string;
  geraet?: string;
  inventarnummer?: string | null;
  gemeldet_von_name: string;
  gemeldet_am: string;
  beschreibung: string;
  schwere: "gering" | "mittel" | "ausfall";
  status: "offen" | "in_reparatur" | "erledigt";
  erledigt_am: string | null;
  erledigt_notiz: string | null;
}

export const SCHWERE_TEXT: Record<Schaden["schwere"], string> = {
  gering: "Gering",
  mittel: "Mittel",
  ausfall: "Ausfall",
};

export const SCHADEN_STATUS_TEXT: Record<Schaden["status"], string> = {
  offen: "Offen",
  in_reparatur: "In Reparatur",
  erledigt: "Erledigt",
};

export interface Buchung {
  id: string;
  geraet_id: string;
  art: Buchungsart;
  von_standort: string | null;
  nach_standort: string | null;
  nach_lagerplatz: string | null;
  empfaenger: string | null;
  erfasser: string;
  zeitpunkt: string;
  geplante_rueckgabe: string | null;
  notiz: string | null;
}

export interface Aktion {
  art: Buchungsart;
  text: string;
  hauptaktion: boolean;
}

export interface Warnung {
  art: "pruefung" | "schaden";
  text: string;
}

/** Antwort von GET /api/scan/:code — vier mögliche Ausgänge. */
export type ScanErgebnis =
  | {
      typ: "geraet";
      code: string;
      geraet: Geraet;
      aktionen: Aktion[];
      hinweis: string | null;
      letzteBuchung: Buchung | null;
      warnungen: Warnung[];
    }
  | {
      typ: "lagerplatz";
      code: string;
      lagerplatz: Lagerplatz;
      geraete: { id: string; inventarnummer: string | null; bezeichnung: string; status: string }[];
    }
  | { typ: "mehrdeutig"; code: string; geraete: Geraet[]; hinweis: string }
  | {
      typ: "unbekannt";
      code: string;
      grund: "unlesbar" | "geraet_nicht_erfasst" | "platz_nicht_erfasst";
      anlegbar?: boolean;
      hinweis: string;
    };

export interface OffeneAusgabe {
  geraet_id: string;
  inventarnummer: string | null;
  bezeichnung: string;
  standort: string | null;
  empfaenger: string | null;
  seit: string;
  tage: number;
  geplante_rueckgabe: string | null;
  ueberfaellig: boolean;
}

export const STATUS_TEXT: Record<GeraetStatus, string> = {
  verfuegbar: "Verfügbar",
  ausgegeben: "Ausgegeben",
  wartung: "In Wartung",
  defekt: "Defekt",
  ausgemustert: "Ausgemustert",
};
