/**
 * Durchlauf gegen die laufende Anwendung: der Weg auf der Baustelle.
 * Scannen, ausgeben, umbuchen, mit Schaden zurücknehmen.
 *
 *   node scripts/durchlauf-buchen.mjs <benutzername> <passwort>
 */

import http from "node:http";

const [, , BENUTZER, PASSWORT] = process.argv;
if (!BENUTZER || !PASSWORT) {
  console.error("Aufruf: node scripts/durchlauf-buchen.mjs <benutzername> <passwort>");
  process.exit(2);
}

const PORT = Number(process.env.API_PORT ?? 3000);
let cookie = null;
let fehler = 0;

function anfrage(pfad, { methode = "GET", koerper } = {}) {
  return new Promise((fertig, schief) => {
    const daten = koerper ? JSON.stringify(koerper) : null;
    const kopf = {};
    if (daten) {
      kopf["Content-Type"] = "application/json";
      kopf["Content-Length"] = Buffer.byteLength(daten);
    }
    if (cookie) kopf["Cookie"] = cookie;
    const anf = http.request(
      { host: "127.0.0.1", port: PORT, path: pfad, method: methode, headers: kopf },
      (a) => {
        let t = "";
        a.on("data", (x) => (t += x));
        a.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(t);
          } catch { /* kein JSON */ }
          fertig({ status: a.statusCode, kopf: a.headers, text: t, json });
        });
      },
    );
    anf.on("error", schief);
    if (daten) anf.write(daten);
    anf.end();
  });
}

async function schritt(was, fn) {
  try {
    const meldung = await fn();
    console.log(`  OK   ${was}${meldung ? "  — " + meldung : ""}`);
  } catch (e) {
    fehler++;
    console.log(`  FEHL ${was}\n       ${e instanceof Error ? e.message : e}`);
  }
}

const behaupte = (b, t) => {
  if (!b) throw new Error(t);
};

console.log("\nDurchlauf: der Weg auf der Baustelle\n");

await schritt("anmelden", async () => {
  const a = await anfrage("/api/auth/login", {
    methode: "POST",
    koerper: { kennung: BENUTZER, passwort: PASSWORT },
  });
  behaupte(a.status === 200, `Status ${a.status}: ${a.text}`);
  cookie = (a.kopf["set-cookie"]?.[0] ?? "").split(";")[0];
  return a.json.benutzer.anzeigename;
});

const marke = "BUCHUNG-" + Date.now().toString().slice(-6);
let lagerId, baustelleId, zweiteId, regalId, regalCode, geraetId, nummer, ichId;

await schritt("Vorbereitung: Orte, Regal, Gerät", async () => {
  ichId = (await anfrage("/api/auth/me")).json.benutzer.id;

  lagerId = (await anfrage("/api/standorte", {
    methode: "POST",
    koerper: { name: `${marke} Bauhof`, typ: "lager" },
  })).json.id;

  baustelleId = (await anfrage("/api/standorte", {
    methode: "POST",
    koerper: { name: `${marke} Lindengasse`, typ: "baustelle" },
  })).json.id;

  zweiteId = (await anfrage("/api/standorte", {
    methode: "POST",
    koerper: { name: `${marke} Ahornweg`, typ: "baustelle" },
  })).json.id;

  const regal = (await anfrage("/api/lagerplaetze", {
    methode: "POST",
    koerper: { standort_id: lagerId, bezeichnung: `${marke} Regal A1` },
  })).json;
  regalId = regal.id;
  regalCode = regal.barcode;

  const g = (await anfrage("/api/geraete", {
    methode: "POST",
    koerper: { bezeichnung: `${marke} Rüttelplatte`, standort_id: lagerId },
  })).json;
  geraetId = g.id;
  nummer = g.inventarnummer;
  return `Gerät ${nummer}, Regal ${regalCode}`;
});

await schritt("Etikett scannen — Gerät erkannt, Ausgabe angeboten", async () => {
  const a = await anfrage(`/api/scan/${nummer}`);
  behaupte(a.status === 200, `Status ${a.status}: ${a.text}`);
  behaupte(a.json.typ === "geraet", `typ ${a.json.typ}`);
  const arten = a.json.aktionen.map((x) => x.art);
  behaupte(arten.includes("ausgabe"), "Ausgabe wird nicht angeboten");
  return `${a.json.geraet.bezeichnung} → ${arten.join(", ")}`;
});

await schritt("auf die Baustelle ausgeben", async () => {
  const a = await anfrage("/api/buchungen", {
    methode: "POST",
    koerper: {
      geraet_id: geraetId,
      art: "ausgabe",
      nach_standort_id: baustelleId,
      empfaenger_id: ichId,
      geplante_rueckgabe: "2020-01-01", // absichtlich in der Vergangenheit
    },
  });
  behaupte(a.status === 201, `Status ${a.status}: ${a.text}`);
  behaupte(a.json.geraet.status === "ausgegeben", `Status ${a.json.geraet.status}`);
  return `${a.json.geraet.standort}, bei ${a.json.geraet.nutzer}`;
});

await schritt("erneut scannen — jetzt wird Rücknahme angeboten, keine Ausgabe", async () => {
  const a = await anfrage(`/api/scan/${nummer}`);
  const arten = a.json.aktionen.map((x) => x.art);
  behaupte(arten.includes("ruecknahme"), "Rücknahme fehlt");
  behaupte(!arten.includes("ausgabe"), "Ausgabe wird trotzdem angeboten");
  return arten.join(", ");
});

await schritt("zweites Ausgeben wird abgewiesen", async () => {
  const a = await anfrage("/api/buchungen", {
    methode: "POST",
    koerper: {
      geraet_id: geraetId,
      art: "ausgabe",
      nach_standort_id: zweiteId,
      empfaenger_id: ichId,
    },
  });
  behaupte(a.status === 409, `Status ${a.status} statt 409`);
  return a.json.error;
});

await schritt("überfällige Rückgabe wird erkannt", async () => {
  const a = await anfrage("/api/buchungen/offen");
  const zeile = a.json.find((z) => z.geraet_id === geraetId);
  behaupte(zeile, "Gerät fehlt in der Liste der ausgegebenen");
  behaupte(zeile.ueberfaellig === true, "Überfälligkeit nicht erkannt");
  return `seit ${zeile.tage} Tagen bei ${zeile.empfaenger}, überfällig`;
});

await schritt("auf die zweite Baustelle umbuchen", async () => {
  const a = await anfrage("/api/buchungen", {
    methode: "POST",
    koerper: {
      geraet_id: geraetId,
      art: "umbuchung",
      nach_standort_id: zweiteId,
      empfaenger_id: ichId,
    },
  });
  behaupte(a.status === 201, `Status ${a.status}: ${a.text}`);
  return a.json.geraet.standort;
});

await schritt("mit Ausfallschaden zurücknehmen — Gerät wird gesperrt", async () => {
  const a = await anfrage("/api/buchungen", {
    methode: "POST",
    koerper: {
      geraet_id: geraetId,
      art: "ruecknahme",
      nach_standort_id: lagerId,
      nach_lagerplatz_id: regalId,
      ausfall: true,
      notiz: "Motor läuft unrund",
    },
  });
  behaupte(a.status === 201, `Status ${a.status}: ${a.text}`);
  behaupte(a.json.geraet.status === "defekt", `Status ${a.json.geraet.status}`);
  return "defekt, im Regal";
});

await schritt("defektes Gerät lässt sich nicht ausgeben", async () => {
  const a = await anfrage("/api/buchungen", {
    methode: "POST",
    koerper: {
      geraet_id: geraetId,
      art: "ausgabe",
      nach_standort_id: baustelleId,
      empfaenger_id: ichId,
    },
  });
  behaupte(a.status === 409, `Status ${a.status} statt 409`);
  return a.json.error;
});

await schritt("Scan zeigt den Grund und bietet keine Buchung mehr an", async () => {
  const a = await anfrage(`/api/scan/${nummer}`);
  const arten = a.json.aktionen.map((x) => x.art);
  // Buchen geht nicht mehr. Auch "korrektur" erscheint nicht mehr: Der Knopf
  // "Bestand berichtigen" führte auf einen Weg, den der Server gar nicht
  // annimmt (buchungsSchema kennt die Art nicht), und ist entfernt. Die
  // Gegenbuchung läuft nur noch über die Schnittstelle.
  for (const gesperrt of ["ausgabe", "ruecknahme", "umbuchung"]) {
    behaupte(!arten.includes(gesperrt), `"${gesperrt}" wird trotzdem angeboten`);
  }
  behaupte(a.json.hinweis, "kein Hinweis, warum nichts geht");
  return a.json.hinweis;
});

await schritt("Regal scannen — zeigt, was drinliegt", async () => {
  const a = await anfrage(`/api/scan/${regalCode}`);
  behaupte(a.status === 200, `Status ${a.status}`);
  behaupte(a.json.typ === "lagerplatz", `typ ${a.json.typ}`);
  behaupte(a.json.geraete.some((g) => g.id === geraetId), "Gerät fehlt im Regal");
  return `${a.json.lagerplatz.bezeichnung}: ${a.json.geraete.length} Gerät(e)`;
});

await schritt("Historie ist lückenlos und in der richtigen Reihenfolge", async () => {
  const a = await anfrage(`/api/geraete/${geraetId}/historie`);
  const arten = a.json.map((z) => z.art);
  behaupte(
    JSON.stringify(arten) === JSON.stringify(["ruecknahme", "umbuchung", "ausgabe"]),
    `Reihenfolge: ${arten.join(", ")}`,
  );
  behaupte(a.json.every((z) => z.erfasser), "bei einer Zeile fehlt, wer sie erfasst hat");
  return arten.join(" ← ");
});

await schritt("Bestand berichtigen (nur Admin, mit Begründung)", async () => {
  const ohne = await anfrage("/api/buchungen/korrektur", {
    methode: "POST",
    koerper: { geraet_id: geraetId, neuer_status: "verfuegbar", begruendung: "" },
  });
  behaupte(ohne.status === 400, `ohne Begründung: Status ${ohne.status} statt 400`);

  const mit = await anfrage("/api/buchungen/korrektur", {
    methode: "POST",
    koerper: {
      geraet_id: geraetId,
      neuer_status: "verfuegbar",
      nach_standort_id: lagerId,
      begruendung: "Motor war nur abgesoffen, Gerät ist wieder in Ordnung.",
    },
  });
  behaupte(mit.status === 201, `Status ${mit.status}: ${mit.text}`);
  behaupte(mit.json.geraet.status === "verfuegbar", `Status ${mit.json.geraet.status}`);

  const hist = await anfrage(`/api/geraete/${geraetId}/historie`);
  behaupte(hist.json.length === 4, `${hist.json.length} Zeilen statt 4`);
  return "korrigiert, die alte Buchung bleibt in der Historie stehen";
});

console.log(
  fehler === 0 ? "\nDer ganze Weg funktioniert.\n" : `\n${fehler} Schritt(e) fehlgeschlagen.\n`,
);
process.exit(fehler === 0 ? 0 : 1);
