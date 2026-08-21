# Bedienung

Etiketten drucken, Benutzer anlegen, Rollen vergeben.

---

# Etiketten drucken

## Für ein Gerät, das schon erfasst ist

**Mehr → Etiketten drucken → Bogen.** Geräte auswählen, Bogen drucken. Gedruckt
wird die Nummer, die das Gerät bereits trägt — für ein Ersatzetikett, wenn der
alte Aufkleber abgerissen ist. Das alte bleibt gültig; ein Gerät darf mehrere
Etiketten tragen.

## Auf Vorrat, für Geräte ohne Aufkleber

**Mehr → Etiketten drucken → Neue Etiketten auf Vorrat.** Stückzahl angeben,
drucken, kleben — erfassen später. Die Ansicht zeigt vorher, welche Nummer als
nächste käme.

**Die Nummern sind ab dem Druck vergeben.** Auch wenn der Bogen im Papierkorb
landet: Eine verlorene Nummer kostet nichts, eine doppelt geklebte kostet die
Verlässlichkeit des ganzen Bestands.

Wenn Sie das Gerät später erfassen, geben Sie die geklebte Nummer einfach an —
sie wartet im System schon darauf.

## Keine Nummer geht zweimal hinaus

Die Anwendung führt ein Register über **jede** Nummer, die ihr je begegnet ist:

| | |
|---|---|
| **vergeben** | Ein Gerät trägt sie |
| **reserviert** | Auf Vorrat gedruckt, Gerät folgt noch |
| **gesehen** | Beim Scannen aufgetaucht, aber kein Gerät dazu |

Die fortlaufende Vergabe überspringt alle drei. Damit kann weder der Druck noch
das Anlegen noch ein Import eine Nummer erwischen, die schon draußen ist.

**Das System lernt beim Scannen dazu.** Scannt jemand ein altes Etikett, das nie
erfasst wurde, merkt sich die Anwendung diese Nummer sofort als belegt — auch
wenn niemand das Gerät gleich anlegt.

> **Was keine Software wissen kann:** ein Etikett, das auf einer Maschine klebt,
> ohne je gescannt, gedruckt oder erfasst worden zu sein. Solange die
> Ersterfassung läuft, kleben solche Aufkleber im Bauhof. Wenn Sie wissen, bis
> zu welcher Nummer die alten Etiketten reichen, tragen Sie den Bereich einmal
> ein — dann ist auch diese Lücke zu. Nötig ist es nicht: Beim ersten Scan
> erfährt die Anwendung ohnehin davon.

---

# Benutzer und Rollen

Wer darf was, und wie kommt ein neuer Mitarbeiter an sein Passwort.

---

## Ein Konto anlegen

1. **Mehr → Benutzer und Rollen → Neu**
2. **Benutzername** vergeben (z. B. `m.huber`) — Buchstaben, Ziffern, Punkt,
   Bindestrich oder Unterstrich, 3 bis 40 Zeichen. Er steht später in der
   Historie jeder Buchung und lässt sich **nicht mehr ändern**.
3. **Name** eintragen (der wird überall angezeigt), E-Mail ist freiwillig.
4. **Rolle** wählen — siehe unten.
5. **Konto anlegen** drücken.

Danach steht ein **Einmalpasswort** auf dem Bildschirm, etwa
`Kran-Rabe-Traufe-Pflug-49`. Es wird **nur an dieser Stelle einmal angezeigt**
und nirgends gespeichert.

**Das Passwort weitergeben:** vorlesen oder aufschreiben. Beim ersten Anmelden
verlangt die App, dass der Mitarbeiter es durch ein eigenes ersetzt — bis dahin
kommt er in keine andere Ansicht.

**Verloren?** Konto öffnen → **Passwort zurücksetzen**. Das alte gilt dann nicht
mehr, und es gibt ein neues Einmalpasswort.

> **Warum kein selbst gewähltes Startpasswort:** Sonst bekämen alle neuen Konten
> „Start2026" — und das stünde dann monatelang in einer Nachricht auf dem Handy.

---

## Die mitgelieferten Rollen

| Rolle | Für wen | Darf |
|---|---|---|
| **Mitarbeiter** | Baustelle | ausgeben, zurücknehmen, umbuchen · Schäden melden · Fotos hinzufügen |
| **Lager und Werkstatt** | Bauhof | zusätzlich: Geräte anlegen und ändern · Standorte, Lagerplätze, Schlagworte · Prüfungen · Schäden erledigen · Dateien verwalten · Etiketten drucken |
| **Verwaltung** | Büro | alles: zusätzlich ausmustern · Bestand berichtigen · Import und Export · Benutzer verwalten |

**Lesen ist kein Recht.** Wer angemeldet ist, sieht den ganzen Bestand — die
Frage „wo ist der Rüttler?" muss jeder beantworten können. Die Rollen
entscheiden nur, wer etwas **ändern** darf.

---

## Eine eigene Rolle bauen

**Mehr → Benutzer und Rollen → Rollen und Rechte → Eigene Rolle anlegen.**
Kennung (kleingeschrieben, ohne Leerzeichen) und Anzeigename vergeben, dann die
Rechte anhaken.

So entsteht etwa eine **reine Leserolle** für die Buchhaltung: anlegen, kein
einziges Häkchen setzen. Wer sie trägt, sieht alles und ändert nichts.

Die drei mitgelieferten Rollen lassen sich **umbenennen**, aber ihre Rechte
bleiben fest — siehe unten.

---

## Wenn jemand geht

Konto öffnen und **„Konto ist aktiv"** abwählen. Nicht löschen: Der Name steht
in jeder Buchung, die die Person je erfasst hat. Ein stillgelegtes Konto kann
sich nicht mehr anmelden, bleibt in der Historie aber lesbar.

---

## Zwei Sperren, die absichtlich im Weg stehen

**Am eigenen Konto lassen sich Rolle und Zustand nicht ändern.** Auch dann
nicht, wenn es andere Verwalter gibt. Wer sich herabstufen will, lässt es von
jemand anderem tun — so kann ein Fehlgriff nie die eigene Handlungsfähigkeit
kosten.

**Es muss immer jemand Benutzer verwalten können.** Die letzte Rolle mit diesem
Recht lässt sich nicht entwerten, und die mitgelieferten Rollen lassen ihre
Rechte gar nicht erst ändern. Ohne diese Sperren wäre die App nach einem
Fehlgriff nur noch über die Kommandozeile am Mini-PC zu retten.

---

## Rechteänderungen wirken sofort

Die Rechte werden bei **jeder** Anfrage frisch aus der Datenbank gelesen — es
gibt keinen Zwischenspeicher, der noch eine Stunde alte Rechte ausliefert.
Ein **Rollenwechsel beendet zusätzlich alle Sitzungen** des Betroffenen: Er muss
sich neu anmelden und merkt dadurch, dass sich etwas geändert hat, statt in
unerklärliche Fehlermeldungen zu laufen.

---

## Das allererste Konto

Das entsteht auf dem Server, nicht im Browser:

```bash
npm run benutzer:anlegen -- --name julius --rolle verwaltung
```

Bewusst kein Einrichtungsassistent im Web: Eine offen erreichbare Seite, an der
sich das erste Konto anlegen lässt, ist ein Wettrennen, das man verlieren kann.
