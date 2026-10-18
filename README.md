# Straßenjagd

Schnitzeljagd in Google Street View für mehrere Leute. Die Seite würfelt Begriffe aus
(„Ein Kamel“, „Ein Leuchtturm“ …), alle suchen gleichzeitig in Google Maps, und am Ende
wird wie bei Stadt-Land-Fluss gemeinsam bewertet.

- **Kostenlos, ohne Kreditkarte.** Gesucht wird im ganz normalen Google Maps (App oder Tab).
  Die Seite nutzt keinen Google-Maps-Schlüssel. Die Spieldaten liegen in Firebase im
  kostenlosen Spark-Tarif, bei dem man gar keine Zahlungsart hinterlegt.
- Mitspieler brauchen kein Konto: Link öffnen, Namen eingeben, fertig.
- Abgeben per Street-View-Link (Teilen → Link kopieren) und/oder Screenshot.
- Timer; wenn die Zeit abläuft, geht es automatisch zur Auswertung.
- Auswertung Begriff für Begriff: gültiger Fund 10 Punkte, jeder Stern 3 Punkte extra.

## Einrichten (einmalig, etwa 10 Minuten)

### 1. Website einschalten (GitHub Pages)

1. In diesem Repository auf **Settings → Pages** gehen.
2. Bei „Build and deployment“ als Source **Deploy from a branch** wählen,
   Branch **main**, Ordner **/ (root)**, dann **Save**.
3. Nach ein bis zwei Minuten ist die Seite unter `https://pipifritzer.github.io/strassenjagd/` erreichbar.

### 2. Firebase (Speicher für die Spieldaten, kostenlos)

1. <https://console.firebase.google.com/> öffnen, mit einem Google-Konto anmelden,
   **Projekt erstellen** → Name `strassenjagd` → Gemini und Google Analytics ausschalten → erstellen.
   Firebase fragt dabei nicht nach einer Zahlungsart. Bleib beim Tarif **Spark** (kein Upgrade auf „Blaze“).
2. **Web-App registrieren:** auf der Projektübersicht das Symbol **`</>`** anklicken,
   Spitzname `strassenjagd`, **kein** Häkchen bei Hosting → **App registrieren**.
   Aus dem angezeigten Block `const firebaseConfig = { … }` brauchst du
   `apiKey`, `authDomain`, `projectId` und `appId`.
3. **Anonyme Anmeldung:** links **Build → Authentication → Jetzt starten →
   Anmeldemethode → Anonym → aktivieren → speichern**.
   Danach im Reiter **Einstellungen → Autorisierte Domains → Domain hinzufügen**:
   `pipifritzer.github.io`
4. **Datenbank:** links **Build → Firestore Database → Datenbank erstellen**
   (Standard-Edition, Standort z. B. `eur3 (europe-west)`, **Produktionsmodus**).
   Danach im Reiter **Regeln** alles ersetzen durch den Inhalt von
   [`firestore.rules`](firestore.rules) → **Veröffentlichen**.

### 3. Werte eintragen

In [`config.js`](config.js) auf den Stift (Bearbeiten) klicken, die vier Firebase-Werte
eintragen und **Commit changes**. Nach einer Minute ist die Website bereit.

## Spielen

1. Eine Person erstellt ein Spiel (Anzahl Begriffe, Schwierigkeit, Zeitlimit, optional
   Buchstaben-Runde) und schickt den Einladungslink.
2. Alle öffnen den Link, geben ihren Namen ein und treten bei. Die Spielleitung startet.
3. Gesucht wird in Google Maps. „Zufälliger Ort“ öffnet Street View in einer zufälligen Stadt.
4. Begriff entdeckt:
   - **Handy (Google-Maps-App):** in Street View auf **Teilen → Link kopieren**, dann im Spiel
     beim Begriff auf **Einfügen** tippen.
   - **PC:** die Adresszeile kopieren und beim Begriff einfügen (oder irgendwo auf der Seite Strg+V).
   - Optional ein Screenshot dazu: **Bild hinzufügen** oder Strg+V.
5. Zeit um (oder alle fertig): Auswertung. Jeder Fund wird gezeigt, mit Knopf
   „In Google Maps öffnen“ zum Nachprüfen. Alle stimmen ab.

Ein Fund gilt, solange nicht mehr Leute „Gilt nicht“ als „Gilt“ sagen; eigene Stimmen zählen nicht.

Hinweis: Links vom PC enthalten den genauen Ort, dann zeigt die Auswertung Street View direkt
an. Kurzlinks aus der App (`maps.app.goo.gl/…`) öffnen den Ort per Knopf. Wer zusätzlich
einen Screenshot abgibt, macht es allen am leichtesten.

## Lokal testen

```
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen (`localhost` ist in Firebase standardmäßig erlaubt).

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html`, `style.css` | Seite und Gestaltung |
| `app.js` | Spiellogik und Firebase |
| `streetview.js` | Street-View-Links auslesen und öffnen |
| `terms.js` | Begriffe und Startorte – hier kannst du eigene Begriffe ergänzen |
| `config.js` | deine Firebase-Werte |
| `firestore.rules` | Zugriffsregeln für die Datenbank |
