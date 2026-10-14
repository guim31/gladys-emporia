# Emporia Vue

## Überblick

Diese Integration bringt die **Emporia-Vue**-Energiemonitore (Vue 2, Vue 3 und ihre
Stromkreissensoren), die **Emporia-Steckdosen** und die **Emporia-Ladestationen** über die
Emporia-Cloud in Gladys — mit demselben Konto wie die Emporia-Energy-App.

- Leistung des ganzen Hauses und jedes Stromkreises (bis zu 16 je Vue), jede Minute aktualisiert.
- Kumulierte Energiezähler (kWh), gesamt und je Stromkreis, aus denen Gladys in seiner
  Energieüberwachung den Verbrauch und die Kosten je halbe Stunde berechnet.
- Solarproduktion und Netzeinspeisung, wenn der Vue für Solar eingerichtet ist.
- Steckdosen: Ein/Aus, Leistung, Energie. Ladestationen: Anschluss- und Ladestatus, Leistung,
  Energie und — nur wenn du es erlaubst — Ein/Aus und Sollstrom.
- Ein Dashboard-Widget, ein Szenen-Auslöser und eine Szenen-Aktion.

Ohne die Hardware entwickelt: Rückmeldungen sind willkommen. Nicht mit Emporia Energy verbunden.

## Voraussetzungen

- Gladys Assistant 5.1.0 oder neuer (Energieverträge und Kostenberechnung kommen mit Gladys 5.2).
- Ein Emporia-Konto mit **E-Mail-Adresse und Passwort**, dessen Geräte in der Emporia-Energy-App
  eingerichtet sind. Konten mit Google- oder Apple-Anmeldung und Konten mit
  Mehr-Faktor-Authentifizierung (MFA) werden nicht unterstützt.
- Internetzugang von Gladys aus: alles läuft über die Emporia-Cloud, es gibt keine lokale API.

## Konfiguration

1. Öffne in Gladys **Integrationen → Von GitHub installieren** und installiere
   `https://github.com/guim31/gladys-emporia`, oder suche **Emporia Vue** im Katalog.
2. Gib die **E-Mail-Adresse** und das **Passwort** deines Emporia-Kontos ein und speichere. Der
   Status wechselt auf _verbunden_, sobald Emporia sie akzeptiert.
3. **Sprache der Funktionsnamen**: standardmäßig Französisch; die Namen werden beim Hinzufügen
   eines Geräts festgelegt.
4. **Steuerung der Ladestationen erlauben**: standardmäßig aus (siehe unten).
5. Öffne den Reiter **Erkennung** und füge die gewünschten Geräte hinzu. Für ein nicht
   hinzugefügtes Gerät wird nichts bei Emporia gelesen.

Das Passwort bleibt in der Konfiguration von Gladys; die Anmelde-Token werden im Volume `/data`
der Integration gespeichert, damit ein Neustart keine neue Anmeldung braucht.

## Geräte

### Emporia Vue

Ein Gladys-Gerät je Vue, benannt wie in der Emporia-App.

| Funktion                                | Typ                                    | Einheit |
| --------------------------------------- | -------------------------------------- | ------- |
| Gesamtleistung                          | energy-sensor / power                  | W       |
| Gesamtindex                             | energy-sensor / index                  | kWh     |
| _Stromkreis_ – Leistung (je Stromkreis) | energy-sensor / power                  | W       |
| _Stromkreis_ – Index (je Stromkreis)    | energy-sensor / index                  | kWh     |
| Nicht erfasste Leistung                 | energy-sensor / power (mit Vorzeichen) | W       |
| Netzleistung (Solar-Vue)                | grid-sensor / power (mit Vorzeichen)   | W       |
| Netzbezugszähler (Solar-Vue)            | energy-sensor / index                  | kWh     |
| Netzeinspeisezähler (Solar-Vue)         | grid-sensor / output-index             | kWh     |
| _Stromkreis_ – Produktion (Solar)       | energy-production-sensor / power       | W       |
| _Stromkreis_ – Produktionsindex         | energy-production-sensor / index       | kWh     |

Die Stromkreise tragen die Namen aus der Emporia-App; ein Stromkreis ohne Namen heißt
„Stromkreis _n_“, und zwei gleichnamige Stromkreise bekommen ihre Nummer. Die _nicht erfasste
Leistung_ ist, was die Stromkreissensoren nicht sehen (Hauptleitung minus Stromkreise).

### Steckdosen

Ein/Aus (steuerbar), Leistung (W) und Energiezähler (kWh).

### Ladestationen

| Funktion           | Werte                                                              |
| ------------------ | ------------------------------------------------------------------ |
| Anschluss          | verfügbar, belegt (Fahrzeug angesteckt), nicht verfügbar, gestört  |
| Ladevorgangsstatus | lädt, Fahrzeug verbunden, pausiert durch Fahrzeug oder Ladestation |
| Ladestation aktiv  | ein/aus                                                            |
| Sollstrom          | von 6 A bis zum Maximum der Ladestation                            |
| Ladeleistung       | W                                                                  |
| Index              | kWh                                                                |

**Die Steuerung der Ladestationen ist standardmäßig aus**: _Ladestation aktiv_ und _Sollstrom_
sind nur lesbar, und ein Befehl wird abgelehnt. Schalte _Steuerung der Ladestationen erlauben_ in
der Konfiguration ein und nutze dann **Aktualisieren** im Reiter Erkennung, um sie steuerbar zu
machen. Ein falscher Befehl kann eine Ladung stoppen, die du am Morgen brauchst: überlege gut,
bevor du sie automatisierst.

## Energieüberwachung und Vorzeichen

Emporia liefert die Energie eines Zeitraums, keinen Zählerstand. Die Integration baut den Index
selbst: die Summe der abgeschlossenen Tage, am Ende jedes Tages bei Emporia nachgelesen, plus die
Energie des laufenden Tages. Der Index entspricht also der Emporia-App, geht nie zurück und holt
die Tage nach, die während eines Stillstands von Gladys verpasst wurden (höchstens 31 Tage). Er
wird alle 5 Minuten aktualisiert und in `/data/energy.json` gespeichert.

Gladys leitet aus jedem Index den Verbrauch je halbe Stunde und die Kosten ab
(Energieüberwachung von Gladys 5.x). Wähle in den Energieeinstellungen den **Gesamtindex** (oder
den **Netzbezugszähler** eines Solar-Vue) als Hauptzähler; die Indizes der Stromkreise,
Steckdosen und Ladestationen werden Unterzähler. Eine Steckdose oder Ladestation an einem
gemessenen Stromkreis wird auch in diesem Stromkreis gezählt: ordne die Hierarchie so, dass sie
nicht doppelt zählt.

Vorzeichen:

- Emporia meldet Erzeugung **negativ**. Ein Stromkreis vom Typ _Solar/Generation_ wird als
  **positive Produktion** veröffentlicht (Leistung und Produktionsindex).
- Bei einem Solar-Vue ist die Hauptleitung der **Netto-Austausch mit dem Netz**: die
  _Netzleistung_ ist beim Bezug positiv und **bei der Einspeisung negativ**. Der Verbrauchsindex
  kommt dann aus dem Netzbezugskanal und die Einspeisung aus dem Einspeisekanal, wenn Emporia sie
  liefert.
- Ein bidirektionaler Stromkreis (eine Batterie…) behält sein Vorzeichen und hat keinen Index, da
  seine Tagessumme negativ sein kann. Ebenso die _nicht erfasste Leistung_.
- Jeder andere Stromkreis wird positiv veröffentlicht, wie die Emporia-App ihn zeigt.

## Widget

**Emporia-Leistung** zeigt die Gesamtleistung eines Vue (live), seine Solarproduktion, falls
vorhanden, und die fünf Stromkreise mit dem höchsten aktuellen Verbrauch, mit ihrem Anteil an der
Gesamtleistung (nicht bei einem Solar-Vue, dessen Hauptleitung ein Netto-Austausch ist). Wähle
den Vue in den Widget-Einstellungen; leer zeigt es den ersten zu Gladys hinzugefügten Vue.

## Szenen-Auslöser

**Emporia-Gerät offline oder zurück**: ein Vue, eine Steckdose oder eine Ladestation hat die
Verbindung zur Emporia-Cloud verloren (oder wiederhergestellt). Offline stoppen die Messungen:
nichts anderes in Gladys sagt es dir. Filter: das Gerät und die Änderung (geht offline / wieder
online). Variablen: Gerätename, neuer Status.

## Szenen-Aktion

**Emporia-Energie des Tages**: liefert für das gewählte Gerät die heute aus dem Netz bezogene
Energie (kWh), die heutige Solarproduktion (kWh), den Stromkreis mit dem höchsten Verbrauch des
Tages und seine Energie sowie die aktuelle Leistung (W). Die Werte stammen aus den letzten
Messungen (höchstens 5 Minuten alt).

Die Konfiguration bietet auch die Schaltfläche **Meine Emporia-Geräte auflisten**, die zeigt, was
das Konto enthält (Vues mit ihrer Anzahl Stromkreise, Steckdosen, Ladestationen).

## Szenen-Beispiele

- **Abendbericht**: jeden Tag um 21:00 → _Emporia-Energie des Tages_ für den Vue → Nachricht
  „Heute: {{energy_today_kwh}} kWh aus dem Netz, {{production_today_kwh}} kWh Solar; vorne:
  {{top_circuit}} ({{top_circuit_kwh}} kWh)“ senden.
- **Vergessenes Gerät**: wenn _Oven – Leistung_ über 1500 W bleibt und niemand zu Hause ist →
  benachrichtigen.
- **Blinde Messung**: wenn der Vue offline geht → Nachricht „Der Emporia Vue meldet nichts mehr,
  prüfe sein WLAN“ senden.
- **Solarüberschuss**: wenn die _Netzleistung_ unter −1500 W fällt (Einspeisung) → die Steckdose
  des Warmwasserbereiters einschalten.

## Aktualisierung und Nutzung der Emporia-API

Die Emporia-API ist nicht öffentlich und hat kein veröffentlichtes Kontingent; die Integration
bleibt nah an dem, was die Emporia-App und die Home-Assistant-Integration tun:

- jede Minute **eine** Anfrage für die Leistung aller Kanäle aller Geräte (`getDeviceListUsages`,
  1-Minuten-Mittelwert) und eine für Steckdosen, Ladestationen und Verbindungsstatus;
- alle 5 Minuten eine Anfrage für die Energie des Tages (und eine je abzuschließendem Tag);
- jede Stunde die Geräteliste (Namen, Stromkreise).

Solange kein Emporia-Gerät zu Gladys hinzugefügt ist, wird nichts gelesen. Nur geänderte Werte
werden an Gladys gesendet, dazu alle 6 Stunden ein unveränderter Wert, damit er nie veraltet
wirkt. Ein abgelehntes Passwort wird nie von selbst erneut versucht, damit das Konto nicht
gesperrt wird.

## Fehlerbehebung

- **„Emporia lehnt diese E-Mail-Adresse oder dieses Passwort ab“**: prüfe sie in der Emporia-App
  und speichere die Konfiguration erneut (das löst den neuen Versuch aus).
- **„Dein Emporia-Konto verlangt einen Schritt…“**: MFA oder erzwungene Passwortänderung. Melde
  dich einmal in der Emporia-App an; ein MFA-Konto ist nicht nutzbar.
- **„Die Emporia-Cloud antwortet nicht“**: die Integration versucht es jede Minute erneut und
  meldet die Rückkehr; prüfe den Internetzugang von Gladys und den Status von Emporia in der App.
- **Ein Stromkreis hat keinen Wert**: Emporia sendet keine Messung für einen unbenutzten Sensor.
  Benenne und richte den Stromkreis in der Emporia-App ein.
- **Namen in der falschen Sprache**: ändere die Sprache, lösche das Gerät und füge es erneut
  hinzu (die Namen werden bei der Erstellung festgelegt).
- Protokolle: die Seite der Integration zeigt sie; `LOG_LEVEL=debug` zeigt jeden Zyklus im
  Detail.

## Einschränkungen

- Ohne die Hardware und ohne Emporia-Konto entwickelt: getestet gegen das veröffentlichte
  Verhalten der API (PyEmVue und sein Simulator), nicht gegen echte Geräte. Rückmeldungen sind
  willkommen.
- Nur Cloud: keine Messung, wenn das Internet oder die Emporia-Cloud ausfällt. Die
  Minutenleistung ist ein 1-Minuten-Mittelwert, kein Momentanwert.
- Der Index wird alle 5 Minuten aktualisiert, in den ersten 30 Minuten nach Mitternacht nicht
  gelesen (die Emporia-API kann noch den Vortag liefern), und ein Stillstand von mehr als 31
  Tagen verliert die Tage davor.
- Bei einem Solar-Vue, für den Emporia keinen Netzbezugskanal liefert, gibt es keinen
  Verbrauchsindex für das ganze Haus (die Stromkreise behalten ihren).
- Konten mit Google-, Apple- oder MFA-Anmeldung werden nicht unterstützt. Emporia-Batterien,
  -Thermostate und -Fahrzeuge werden nicht unterstützt.
- Nicht mit Emporia Energy verbunden; „Emporia“ und „Vue“ sind deren Marken.
