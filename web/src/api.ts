/**
 * Zugriff auf die API.
 *
 * Abweichung von PATIO, bewusst: Dort wirft `request()` ein nacktes
 * `new Error(text)` — der Statuscode geht verloren, und jede
 * Konfliktbehandlung wird zum Vergleich von Zeichenketten. Hier gibt es
 * `ApiError` mit `status` und dem gesamten Antwortkörper.
 *
 * Ein Token wird nirgends mitgeführt: Die Anmeldung steckt in einem
 * httpOnly-Cookie, das der Browser von selbst mitschickt.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Jemand anderes hat inzwischen gespeichert. */
  get istKonflikt(): boolean {
    return this.status === 409 && this.body.konflikt === true;
  }

  /** Fachliche Regel verletzt, z.B. Ausgabe eines defekten Geräts. */
  get istRegelbruch(): boolean {
    return this.status === 409 && this.body.konflikt !== true;
  }

  get istNichtAngemeldet(): boolean {
    return this.status === 401;
  }

  get istOhneRecht(): boolean {
    return this.status === 403;
  }
}

/** Wird gerufen, wenn die Anmeldung abgelaufen ist. Setzt der Router. */
let beiAbmeldung: (() => void) | null = null;
export function meldeAbmeldungAn(rueckruf: () => void): void {
  beiAbmeldung = rueckruf;
}

async function anfrage<T>(pfad: string, init: RequestInit = {}): Promise<T> {
  const kopf = new Headers(init.headers);
  if (init.body && !kopf.has("Content-Type")) {
    kopf.set("Content-Type", "application/json");
  }

  let antwort: Response;
  try {
    antwort = await fetch(`/api${pfad}`, {
      ...init,
      headers: kopf,
      credentials: "same-origin",
    });
  } catch {
    // Kein Netz, Funkloch, Server aus — unterscheidbar ist das hier nicht,
    // und für den Benutzer macht es auch keinen Unterschied.
    throw new ApiError(0, "Keine Verbindung zum Server. Besteht eine Netzverbindung?");
  }

  if (antwort.status === 204) return undefined as T;

  const text = await antwort.text();
  let daten: unknown = null;
  try {
    daten = text ? JSON.parse(text) : null;
  } catch {
    daten = null;
  }

  if (!antwort.ok) {
    const koerper = (daten ?? {}) as Record<string, unknown>;
    const meldung =
      typeof koerper.error === "string" ? koerper.error : `Fehler ${antwort.status}`;

    if (antwort.status === 401) beiAbmeldung?.();

    throw new ApiError(antwort.status, meldung, koerper);
  }

  return daten as T;
}

export const api = {
  get: <T>(pfad: string) => anfrage<T>(pfad),
  post: <T>(pfad: string, koerper?: unknown) =>
    anfrage<T>(pfad, { method: "POST", body: koerper ? JSON.stringify(koerper) : undefined }),
  patch: <T>(pfad: string, koerper: unknown) =>
    anfrage<T>(pfad, { method: "PATCH", body: JSON.stringify(koerper) }),
  delete: <T>(pfad: string) => anfrage<T>(pfad, { method: "DELETE" }),
};
