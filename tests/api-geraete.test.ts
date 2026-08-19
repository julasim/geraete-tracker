/**
 * Geräte: anlegen, ändern, Etiketten, Konfliktschutz.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schliesseDb } from "../src/db/client.js";
import { mitCookie } from "./helpers/konten.js";
import {
  alsAdmin,
  alsMitarbeiter,
  raeumeKontenAuf,
  raeumeTestdatenAuf,
  type Sitzung,
} from "./helpers/stammdaten.js";

let admin: Sitzung;
let mitarbeiter: Sitzung;

beforeAll(async () => {
  await raeumeTestdatenAuf();
  admin = await alsAdmin();
  mitarbeiter = await alsMitarbeiter();
});

afterAll(async () => {
  await raeumeTestdatenAuf();
  await raeumeKontenAuf();
  await schliesseDb();
});

async function sende(pfad: string, sitzung: Sitzung, methode: string, koerper?: unknown) {
  const antwort = await mitCookie(pfad, sitzung.cookie, {
    method: methode,
    headers: { "Content-Type": "application/json" },
    ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
  });
  return { status: antwort.status, daten: await antwort.json().catch(() => null) };
}

/** Legt ein Gerät an und gibt es zurück. */
async function neuesGeraet(zusatz: Record<string, unknown> = {}) {
  const { status, daten } = await sende("/api/geraete", admin, "POST", {
    bezeichnung: "TEST-Rüttelplatte",
    ...zusatz,
  });
  expect(status).toBe(201);
  return daten as { id: string; inventarnummer: string; rev: number; bezeichnung: string };
}

describe("Anlegen", () => {
  it("vergibt von selbst die nächste fünfstellige Nummer", async () => {
    const geraet = await neuesGeraet();
    expect(geraet.inventarnummer).toMatch(/^\d{5}$/);
  });

  it("übernimmt eine vorgegebene Nummer", async () => {
    const geraet = await neuesGeraet({ inventarnummer: "90013", bezeichnung: "TEST-Bagger" });
    expect(geraet.inventarnummer).toBe("90013");
  });

  it("legt zugleich ein Etikett mit derselben Nummer an", async () => {
    const geraet = await neuesGeraet({ inventarnummer: "90021" });
    const { daten } = await sende(`/api/geraete/${geraet.id}/barcodes`, mitarbeiter, "GET");
    expect((daten as { barcode: string }[])[0]!.barcode).toBe("90021");
  });

  it("lehnt eine bereits vergebene Nummer ab", async () => {
    await neuesGeraet({ inventarnummer: "90031" });
    const { status } = await sende("/api/geraete", admin, "POST", {
      bezeichnung: "TEST-Doppelte Nummer",
      inventarnummer: "90031",
    });
    expect(status).toBe(409);
  });

  it("lehnt eine Gerätenummer mit P-Präfix ab", async () => {
    // Sonst kollidierte sie mit dem Nummernkreis der Lagerplätze.
    const { status, daten } = await sende("/api/geraete", admin, "POST", {
      bezeichnung: "TEST-Falscher Kreis",
      inventarnummer: "P-0001",
    });
    expect(status).toBe(409);
    expect((daten as { error: string }).error).toContain("Lagerplätze");
  });

  it("verlangt eine Bezeichnung", async () => {
    const { status } = await sende("/api/geraete", admin, "POST", { bezeichnung: "" });
    expect(status).toBe(400);
  });

  it("lässt Mitarbeiter keine Geräte anlegen", async () => {
    const { status } = await sende("/api/geraete", mitarbeiter, "POST", {
      bezeichnung: "TEST-verboten",
    });
    expect(status).toBe(403);
  });
});

describe("Lesen", () => {
  it("gibt die ganze Liste ohne Paginierung zurück", async () => {
    await neuesGeraet();
    const { status, daten } = await sende("/api/geraete", mitarbeiter, "GET");
    expect(status).toBe(200);
    expect(Array.isArray(daten)).toBe(true);
  });

  it("findet Geräte über die Freitextsuche", async () => {
    await neuesGeraet({ bezeichnung: "TEST-Wacker Neuson Stampfer", hersteller: "Wacker" });
    const { daten } = await sende("/api/geraete?q=Stampfer", mitarbeiter, "GET");
    expect((daten as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("liefert Schlagworte und die Zahl offener Schäden mit", async () => {
    const geraet = await neuesGeraet();
    const { daten } = await sende(`/api/geraete/${geraet.id}`, mitarbeiter, "GET");
    const g = daten as { schlagworte: unknown[]; offene_schaeden: number };
    expect(Array.isArray(g.schlagworte)).toBe(true);
    expect(g.offene_schaeden).toBe(0);
  });

  it("lässt auch Mitarbeiter alles lesen", async () => {
    // "Wo ist der Rüttler?" muss jeder beantworten können.
    const geraet = await neuesGeraet();
    expect((await sende(`/api/geraete/${geraet.id}`, mitarbeiter, "GET")).status).toBe(200);
  });
});

describe("Ändern mit Konfliktschutz", () => {
  it("übernimmt eine Änderung mit der richtigen Fassung", async () => {
    const geraet = await neuesGeraet();
    const { status, daten } = await sende(`/api/geraete/${geraet.id}`, admin, "PATCH", {
      bezeichnung: "TEST-Rüttelplatte groß",
      rev: geraet.rev,
    });
    expect(status).toBe(200);
    expect((daten as { bezeichnung: string; rev: number }).bezeichnung).toBe(
      "TEST-Rüttelplatte groß",
    );
    expect((daten as { rev: number }).rev).toBe(geraet.rev + 1);
  });

  it("weist eine Änderung auf veralteter Fassung ab", async () => {
    // Zwei Leute öffnen dasselbe Gerät, einer speichert zuerst. Der zweite
    // darf die Änderung des ersten nicht stillschweigend überschreiben.
    const geraet = await neuesGeraet();
    const ersterSpeichert = await sende(`/api/geraete/${geraet.id}`, admin, "PATCH", {
      bezeichnung: "TEST-Erster war da",
      rev: geraet.rev,
    });
    expect(ersterSpeichert.status).toBe(200);

    const zweiterSpeichert = await sende(`/api/geraete/${geraet.id}`, admin, "PATCH", {
      bezeichnung: "TEST-Zweiter überschreibt",
      rev: geraet.rev, // dieselbe, inzwischen veraltete Fassung
    });
    expect(zweiterSpeichert.status).toBe(409);

    const konflikt = zweiterSpeichert.daten as { konflikt: boolean; aktuell: { bezeichnung: string } };
    expect(konflikt.konflikt).toBe(true);
    // Der aktuelle Stand kommt mit, damit die Oberfläche zeigen kann,
    // was sich geändert hat.
    expect(konflikt.aktuell.bezeichnung).toBe("TEST-Erster war da");
  });

  it("verlangt die Fassungsnummer überhaupt", async () => {
    const geraet = await neuesGeraet();
    const { status } = await sende(`/api/geraete/${geraet.id}`, admin, "PATCH", {
      bezeichnung: "TEST-ohne rev",
    });
    expect(status).toBe(400);
  });

  it("lässt Mitarbeiter nicht ändern", async () => {
    const geraet = await neuesGeraet();
    const { status } = await sende(`/api/geraete/${geraet.id}`, mitarbeiter, "PATCH", {
      bezeichnung: "TEST-verboten",
      rev: geraet.rev,
    });
    expect(status).toBe(403);
  });
});

describe("Etiketten", () => {
  it("nimmt ein Ersatzetikett auf, ohne das alte zu entwerten", async () => {
    // Der reale Fall: das alte Etikett wird unleserlich, ein neues kommt
    // daneben. Bis das alte abfällt, müssen beide funktionieren.
    const geraet = await neuesGeraet({ inventarnummer: "90041" });
    const ergaenzt = await sende(`/api/geraete/${geraet.id}/barcodes`, admin, "POST", {
      barcode: "90042",
    });
    expect(ergaenzt.status).toBe(201);

    const { daten } = await sende(`/api/geraete/${geraet.id}/barcodes`, admin, "GET");
    const codes = (daten as { barcode: string; aktiv: boolean }[]);
    expect(codes).toHaveLength(2);
    expect(codes.every((c) => c.aktiv)).toBe(true);
  });

  it("lehnt ein Etikett ab, das schon zu einem anderen Gerät gehört", async () => {
    const eins = await neuesGeraet({ inventarnummer: "90051" });
    const zwei = await neuesGeraet({ inventarnummer: "90052" });
    const { status, daten } = await sende(`/api/geraete/${zwei.id}/barcodes`, admin, "POST", {
      barcode: "90051",
    });
    expect(status).toBe(409);
    expect((daten as { error: string }).error).toContain("anderen Gerät");
    expect(eins.id).not.toBe(zwei.id);
  });

  it("lehnt ein Etikett mit P-Präfix ab", async () => {
    const geraet = await neuesGeraet();
    const { status } = await sende(`/api/geraete/${geraet.id}/barcodes`, admin, "POST", {
      barcode: "P-0001",
    });
    expect(status).toBe(409);
  });

  it("legt ein überzähliges Etikett still", async () => {
    const geraet = await neuesGeraet({ inventarnummer: "90061" });
    await sende(`/api/geraete/${geraet.id}/barcodes`, admin, "POST", { barcode: "90062" });
    const { status } = await sende(`/api/geraete/${geraet.id}/barcodes/90061`, admin, "DELETE");
    expect(status).toBe(200);
  });

  it("verweigert das Stilllegen des LETZTEN Etiketts", async () => {
    // Ohne gültiges Etikett wäre das Gerät nicht mehr scanbar — praktisch
    // verschwunden, obwohl es im Bestand steht.
    const geraet = await neuesGeraet({ inventarnummer: "90071" });
    const { status, daten } = await sende(
      `/api/geraete/${geraet.id}/barcodes/90071`,
      admin,
      "DELETE",
    );
    expect(status).toBe(409);
    expect((daten as { error: string }).error).toContain("letzte");
  });
});

describe("Ausmustern", () => {
  it("mustert ein Gerät aus, statt es zu löschen", async () => {
    const geraet = await neuesGeraet();
    const { status, daten } = await sende(`/api/geraete/${geraet.id}/ausmustern`, admin, "POST");
    expect(status).toBe(200);
    expect((daten as { status: string }).status).toBe("ausgemustert");
  });

  it("blendet ausgemusterte Geräte aus der normalen Liste aus", async () => {
    const geraet = await neuesGeraet({ bezeichnung: "TEST-Verschrottet" });
    await sende(`/api/geraete/${geraet.id}/ausmustern`, admin, "POST");

    const normal = await sende("/api/geraete", mitarbeiter, "GET");
    expect((normal.daten as { id: string }[]).some((g) => g.id === geraet.id)).toBe(false);

    const alle = await sende("/api/geraete?alle=true", mitarbeiter, "GET");
    expect((alle.daten as { id: string }[]).some((g) => g.id === geraet.id)).toBe(true);
  });

  it("lässt ein ausgemustertes Gerät nicht mehr bearbeiten", async () => {
    const geraet = await neuesGeraet();
    await sende(`/api/geraete/${geraet.id}/ausmustern`, admin, "POST");
    const { status } = await sende(`/api/geraete/${geraet.id}`, admin, "PATCH", {
      bezeichnung: "TEST-doch noch",
      rev: geraet.rev + 1,
    });
    expect(status).toBe(409);
  });
});
