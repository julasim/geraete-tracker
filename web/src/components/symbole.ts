/** Die verfügbaren Strich-Symbole. Siehe Symbol.vue. */
export type SymbolName =
  | "scan"
  | "liste"
  | "ort"
  | "mehr"
  | "zurueck"
  | "licht"
  | "suche"
  | "haken"
  | "warnung"
  | "schliessen"
  | "tastatur"
  | "plus"
  | "weiter"
  // ── Ab hier die Symbole der Computer-Oberfläche (Sidebar, Topbar) ──────
  // Feather-Stil wie die übrigen: viewBox 0 0 24 24, nur Striche, keine
  // Flächen. So bleibt ein Symbol bei jeder Größe und in beiden Themen
  // lesbar, ohne dass eine zweite Zeichenlogik nötig wird.
  | "uebersicht"
  | "kalender"
  | "paket"
  | "etikett"
  | "austausch"
  | "einstellungen"
  | "benutzer"
  | "abmelden"
  // ── Aktionen in Kopfzeilen und Karten der Computer-Oberfläche ─────────
  | "stift"
  | "kamera"
  | "drucken"
  | "hoch"
  | "runter"
  | "board";
