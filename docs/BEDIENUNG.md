# Bedienung

Prüffristen im Blick behalten, Etiketten drucken, Benutzer anlegen,
Rollen vergeben.

---

# Was ist fällig?

**Mehr → Prüfungen stehen an → Alle Fristen ansehen** (oder direkt
`/pruefungen`).

Die Liste zeigt in drei Stufen, was ansteht:

| | |
|---|---|
| **Überfällig** | Die Frist ist verstrichen. Das Gerät darf so nicht mehr eingesetzt werden. |
| **Fällig** | Innerhalb der nächsten zwei Wochen. |
| **Bald** | In den nächsten zwei Monaten — Zeit, einen Termin zu machen. |

Ein Tipp auf die Zeile führt zum Gerät; dort wird die Prüfung nach der
Durchführung eingetragen. Die neue Frist rechnet die Anwendung selbst aus dem
Intervall der Prüfart.

Auf der Übersicht steht die Zahl der anstehenden Prüfungen als Kennzahl,
zusammen mit den fünf dringendsten.

> **Was hier nicht auftaucht:** Geräte ohne hinterlegte Prüfart. Geprüft wird
> gegen das, was am Gerät steht — steht dort nichts, weiß die Anwendung von
> keiner Frist. Beim Erfassen also gleich die Prüfart mitgeben.

---

# Etiketten drucken

## Für ein Gerät, das schon erfasst ist

**Mehr → Etiketten drucken → Bogen.** Geräte auswählen, Bogen drucken. Gedruckt
wird die Nummer, die das Gerät bereits trägt — für ein Ersatzetikett, wenn der
alte Aufkleber abgerissen ist. Das alte bleibt gültig; ein Gerät darf mehrere
Etiketten tragen.

## Für Regalplätze

**Mehr → Etiketten drucken → Regalplätze auswählen.** Eigene Liste, eigener
Knopf: Regal-Kennungen beginnen mit `P-` und dürfen nie zwischen die
Gerätenummern geraten — die Datenbank lässt das auch gar nicht zu.

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

---

# Läuft die Datensicherung?

Unter **Mehr → Verwaltung → Datensicherung** steht, wann zuletzt gesichert
wurde. Sichtbar ist das nur mit dem Recht *Benutzer verwalten* — den Zustand
der Anlage geht einen Mitarbeiter auf der Baustelle nichts an.

| Anzeige | Bedeutung |
|---|---|
| Grün, „heute gesichert" | Alles in Ordnung |
| Gelb, „vor 1–2 Tagen" | Noch unkritisch, aber im Auge behalten |
| **Rot, „vor 3 Tagen oder länger"** | Die nächtliche Sicherung läuft nicht mehr |
| **Rot, „letzter Lauf fehlgeschlagen"** | Sie ist gelaufen und abgebrochen |
| **Rot, „noch nie gesichert"** | Der cron-Eintrag fehlt noch |

**Warum das hier steht und nicht in einer Mail:** Diese Anwendung verschickt
bewusst keine Mails — kein Mailserver, kein Passwort, das irgendwo hinterlegt
sein muss. Die Meldung nimmt deshalb den umgekehrten Weg: Sie steht in der
App, und wer sie öffnet, sieht sie.

Ist die Anzeige rot, hilft [`BETRIEB.md`](BETRIEB.md) weiter — dort stehen der
cron-Eintrag und die häufigen Ursachen.

---

# Eine neue Baustelle anlegen

Zwei Wege, je nachdem, wo Sie gerade sind. Beide brauchen das Recht
*Stammdaten pflegen*.

**Beim Buchen** — der übliche Fall: Sie geben ein Gerät aus, die Baustelle
steht noch nicht in der Liste. Unter der Auswahl „Wohin geht das Gerät?"
tippen Sie auf **„Baustelle ist noch nicht dabei"**, tragen den Namen ein und
bestätigen mit **Anlegen und wählen**. Die Baustelle ist damit angelegt,
sofort ausgewählt, und Sie buchen weiter. Kein Umweg über die Verwaltung.

**Unter „Orte"** — wenn Sie mehrere auf einmal einrichten: **„Neue Baustelle
anlegen"**, dann Name, Art und optional die Adresse. Nach dem Speichern bleibt
das Formular offen und die Art stehen, sodass die nächste gleich folgen kann.

Einmal angelegt, steht eine Baustelle **überall** zur Auswahl, ohne dass
irgendetwas neu geladen werden muss.

**Wenn ein Hinweis erscheint** („Es gibt bereits ‚Bauhof Nord'."), prüfen Sie
kurz, ob es derselbe Ort ist. Der Hinweis hält Sie nicht auf — es kann ja eine
zweite Baustelle in derselben Straße sein. Er soll nur verhindern, dass mit
der Zeit „Lindengasse", „Lindengasse 14" und „lindengasse" nebeneinander
stehen und sich der Bestand auf drei Orte verteilt, die dasselbe meinen.

**Eine Baustelle wird nie gelöscht, sondern stillgelegt** — ihr Name steht in
jeder Buchung, die dorthin ging, und die Historie muss stimmen. Stillgelegte
Orte verschwinden aus den Auswahlfeldern.

*Lagerplätze, Schlagworte und Prüfarten lassen sich derzeit noch nicht in der
Oberfläche anlegen — dafür braucht es die Schnittstelle. Siehe
[`BETRIEB.md`](BETRIEB.md).*
