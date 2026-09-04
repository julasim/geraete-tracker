# Bedienung

Prüffristen im Blick behalten, Etiketten drucken, Benutzer anlegen,
Rollen vergeben.

---

# Am Computer sieht alles anders aus

Das ist Absicht. Die Anwendung kennt **zwei Haltungen**:

- **Schmaler als 1024 Pixel** (Handy, iPad hochkant): eine Spalte,
  Navigation unten, große Tippziele. Gebaut für eine Hand mit
  Arbeitshandschuh.
- **Ab 1024 Pixel** (Computer, iPad quer): eine schwarze Leiste links mit
  allen Bereichen, daneben eine dichte Tabelle. Gebaut für Maus, Tastatur
  und Vergleichen.

Dieselben Daten, dieselben Regeln — nur die Dichte unterscheidet sich. Es
gibt **keinen Umschalter**: Was Sie sehen, hängt allein an der Fensterbreite.
Wer ein Fenster schmaler zieht, bekommt die Handy-Ansicht.

**Scannen gibt es nur am Handy.** Die Kamera braucht eine gesicherte
Verbindung und eine Hand am Etikett; am Schreibtisch steht deshalb nur ein
Hinweis darauf.

## Mehrere Geräte am Computer ausgeben

In der Geräteliste hat jede Zeile links ein Kästchen. Sobald eines
angehakt ist, klappt rechts die **Sammelausgabe** auf: Ziel, Person,
geplante Rückgabe, Notiz — einmal für alle.

Das Kästchen oben in der Kopfzeile wählt alle **sichtbaren** Zeilen. Sichtbar
heißt: was Suche und Filter gerade übrig lassen — nicht der ganze Bestand.

Diese Auswahl ist **dieselbe** wie der Sammelmodus des Scanners am Handy.
Wer unterwegs sechs Geräte einscannt und sich dann an den Rechner setzt,
findet sie dort wieder.

> **Alles oder nichts.** Scheitert ein einziges Gerät — weil es defekt oder
> schon ausgegeben ist — bucht der Server **keines**. Die Meldung nennt das
> Gerät beim Namen; nehmen Sie es aus der Auswahl und buchen Sie erneut.

## Ausgeben ohne Seitenwechsel

Am Computer öffnet sich zum Buchen ein Fenster über der Liste, statt die
Seite zu wechseln. Die Liste dahinter bleibt stehen; nach dem Buchen sind
Sie wieder dort, wo Sie waren. **Escape** oder ein Klick daneben bricht ab.

Am Handy bleibt es bei der eigenen Seite mit Bestätigung — dort ist für ein
Fenster kein Platz.

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

## Einen Ort ändern oder aus dem Verkehr ziehen

Tippen Sie unter **Orte** auf den Ort, dann auf **Ort bearbeiten**. Dort lassen
sich Name und Adresse ändern — oder der Ort **stilllegen**, wenn die Baustelle
abgeschlossen ist. Stehen dort noch Geräte, sagt die Rückfrage, wie viele: Sie
bleiben eingetragen, der Ort ist nur nicht mehr auswählbar.

## Regalplätze

Im aufgeklappten Ort auf **Regalplatz**, dann die Bezeichnung eintragen
(„Regal C3"). **Die Kennung vergibt das System** (`P-0001`, `P-0002`, …) — sie
wird als Etikett aufs Regal geklebt und ist beim Scannen die Antwort auf „was
steht in diesem Regal?". Umbenennen geht jederzeit; die Kennung bleibt dabei
unangetastet, weil das Etikett ja klebt.

## Mehrere Geräte auf einmal buchen

Beim Bestücken eines Transporters gehen oft zehn Geräte auf dieselbe
Baustelle. Dafür gibt es den Sammelmodus:

1. Im **Scanner** oben **„Mehrere sammeln"** anhaken.
2. Alle Geräte nacheinander scannen (oder die Nummern eintippen). Jedes
   landet in einer Liste statt auf der Gerätekarte — **zweimal gescannt
   schadet nicht**, es zählt einmal.
3. Unten **Ausgeben**, *Zurücknehmen* oder *Umbuchen* wählen.
4. Ziel und Person **einmal** angeben, dann bestätigen.

Ein Gerät wieder aus der Liste nehmen: **Entfernen** in der Zeile.

**Alles oder nichts.** Lässt sich eines der Geräte nicht buchen — weil es
etwa als defekt gemeldet ist —, wird **keines** gebucht. Die Meldung nennt
das Gerät mit Namen und Nummer; nehmen Sie es aus der Liste, dann geht der
Rest durch. Das ist Absicht: Ein halb gebuchter Transporter hinterlässt einen
Bestand, den hinterher niemand mehr erklären kann.

## Zubehör

Hat ein Gerät Zubehör hinterlegt — etwa Löffel zum Bagger —, wird es beim
Buchen **vorgeschlagen und ist vorangehakt**. Der Regelfall ist, dass es
mitfährt. Bleibt ein Teil im Lager, haken Sie es einfach ab; dann bleibt es
auch im System dort.

Ohne diesen Vorschlag stünde der Löffel weiter im Lager, während er in
Wahrheit auf der Baustelle liegt — und der Bestand wäre falsch.

*Zubehör wird am Gerät hinterlegt: Gerät öffnen → Bearbeiten → „Gehört zu".*

## Pakete

Fahren zu einer Baustellenart immer dieselben Geräte mit, fassen Sie sie
unter **Mehr → Pakete** zusammen — etwa „Estrich komplett".

* **Neues Paket** anlegen, dann Geräte über die Suche zuordnen.
* **Paket ausgeben** füllt die Sammelliste mit allen Geräten des Pakets
  (samt deren Zubehör) und führt direkt zur Buchung.

Ein Paket ist dabei ein **Vorschlag**, keine feste Einheit: Was gerade nicht
mitfährt, nehmen Sie vor dem Buchen aus der Liste. Ein Paket sagt auch nie,
wo etwas steht — das sagt immer das Gerät selbst. Ein Gerät darf in mehreren
Paketen stecken.

*Pakete anlegen und ändern darf, wer das Recht **Stammdaten pflegen** hat;
ausgeben darf sie jeder.*

## Ein Foto bei der Übergabe

Beim Ausgeben, Zurücknehmen und Umbuchen gibt es unter **Zustand festhalten**
die Möglichkeit, ein Bild aufzunehmen. Es ist **freiwillig** — wer im Regen
am Hänger steht, soll nicht fotografieren müssen.

Sinnvoll ist es vor allem, wenn ein Gerät an eine **Fremdfirma** geht: Kommt
es beschädigt zurück, lässt sich sonst nicht belegen, wie es hinausging.

Das Bild hängt an der **Buchung**, nicht am Gerät — es zeigt einen Zeitpunkt,
keinen Dauerzustand. Sie finden es später in der Geräteakte im Verlauf, bei
genau dieser Buchung. Aus demselben Grund wird ein Übergabefoto **nie** zum
Titelbild des Geräts: Dort gehört ein Bild hin, das die Maschine zeigt.

*Scheitert die Übertragung — etwa im Funkloch —, ist die Buchung trotzdem
gespeichert. Sie bekommen dann einen Hinweis, dass nur das Foto fehlt.*

## Was ist gerade draußen?

Unter **Mehr** zeigt der Abschnitt *Derzeit draußen* die zwölf zuletzt
ausgegebenen Geräte mit Ort, Empfänger und der Zahl der Tage. Steht die
Überschrift auf „12 von 40", gibt es mehr: Der letzte Eintrag der Liste führt
zur vollständigen Aufstellung.

**Wer hat ein bestimmtes Gerät?** Auch die Suche in der Geräteliste hilft —
sie durchsucht neben Bezeichnung und Nummer auch **Standort und Nutzer**. Ein
Name im Suchfeld zeigt also, was diese Person derzeit hat.

## Schlagworte und Prüfarten

Unter **Mehr → Schlagworte und Prüfarten**.

**Schlagworte** sind die einzige Einteilung des Bestands — es gibt bewusst
keine festen Kategorien. Ein Gerät kann beliebig viele tragen. Vor dem Löschen
steht, an wie vielen Geräten eines hängt; verschwindet es, verschwindet es auch
dort.

**Prüfarten** sind wiederkehrende Prüfungen und ihr Abstand (jährlich,
halbjährlich …). Aus ihnen entsteht die Fristenliste unter *Was ist fällig?*;
das Fälligkeitsdatum rechnet der Server aus der zuletzt eingetragenen Prüfung.
Sie richten sie einmal beim Aufsetzen ein.
