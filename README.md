# Straßenjagd

Schnitzeljagd in Google Street View für mehrere Leute. Die Seite würfelt Begriffe aus
(„Ein Kamel“, „Ein Leuchtturm“ …), alle suchen gleichzeitig in Google Maps, und am Ende
wird wie bei Stadt-Land-Fluss gemeinsam bewertet.

**Spielen:** <https://pipifritzer.github.io/strassenjagd/>

- **Kostenlos, ohne Konto, ohne Einrichtung.** Gesucht wird im normalen Google Maps (App oder Tab).
  Die Geräte tauschen den Spielstand über einen kostenlosen öffentlichen MQTT-Server aus
  (`broker.emqx.io`, Ersatz: `broker.hivemq.com`). Es gibt keinen Schlüssel und nichts, das Geld kosten kann.
- Mitspieler öffnen nur den Einladungslink und geben ihren Namen ein.
- Abgeben per Street-View-Link (Teilen → Link kopieren) und/oder Screenshot.
- Timer; wenn die Zeit abläuft, geht es automatisch zur Auswertung.
- Auswertung Begriff für Begriff: gültiger Fund 10 Punkte, jeder Stern 3 Punkte extra.

## So wird gespielt

1. Eine Person erstellt ein Spiel (Anzahl Begriffe, Schwierigkeit, Zeitlimit, optional
   Buchstaben-Runde) und schickt den Einladungslink.
2. Alle öffnen den Link, geben ihren Namen ein und treten bei. Die Spielleitung startet.
3. Gesucht wird in Google Maps. „Zufälliger Ort“ öffnet Street View in einer zufälligen Stadt.
4. Begriff entdeckt:
   - **Handy (Google-Maps-App):** in Street View auf **Teilen → Link kopieren**, zurück ins Spiel,
     beim Begriff auf **Einfügen** tippen.
   - **PC:** die Adresszeile kopieren und beim Begriff einfügen (oder irgendwo auf der Seite Strg+V).
   - Optional ein Screenshot dazu: **Bild hinzufügen** oder Strg+V.
5. Zeit um (oder alle fertig): Auswertung. Jeder Fund wird gezeigt, mit Knopf
   „In Google Maps öffnen“ zum Nachprüfen. Alle stimmen ab.

Ein Fund gilt, solange nicht mehr Leute „Gilt nicht“ als „Gilt“ sagen; eigene Stimmen zählen nicht.

Wer zwischendurch die Seite schließt oder neu lädt, landet über denselben Link wieder im Spiel.

## Gut zu wissen

- Der Spielstand liegt auf einem öffentlichen Server. Wer den 5-stelligen Code kennt, könnte
  mitlesen. Für ein Spiel unter Freunden ist das egal; schreib nichts Privates hinein.
- Nach dem Ergebnis löscht „Neues Spiel“ die eigenen Daten wieder vom Server.
- Links vom PC enthalten den genauen Ort, dann zeigt die Auswertung Street View direkt an.
  Kurzlinks aus der App (`maps.app.goo.gl/…`) öffnen den Ort per Knopf.

## Lokal testen

```
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html`, `style.css` | Seite und Gestaltung |
| `app.js` | Spiellogik |
| `net.js` | Verbindung zum MQTT-Server |
| `streetview.js` | Street-View-Links auslesen und öffnen |
| `terms.js` | Begriffe und Startorte – hier kannst du eigene Begriffe ergänzen |
| `vendor/mqtt.min.js` | MQTT.js 5.10.1 (MIT-Lizenz, siehe `vendor/mqtt-LICENSE.md`) |
