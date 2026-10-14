# Straßenjagd

Schnitzeljagd in Google Street View für mehrere Leute. Die Seite würfelt Begriffe aus
(„Ein Kamel“, „Ein Leuchtturm“ …), alle suchen gleichzeitig direkt im eingebauten
Street View, und am Ende wird wie bei Stadt-Land-Fluss gemeinsam bewertet.

- Street View läuft direkt im Spiel. „Hier gefunden“ speichert genau die aktuelle Ansicht.
- Mitspieler brauchen kein Konto: Link öffnen, Namen eingeben, fertig.
- Timer; wenn die Zeit abläuft, geht es automatisch zur Auswertung.
- In der Auswertung sieht man jeden Fund wieder in Street View und stimmt ab:
  gültiger Fund 10 Punkte, jeder Stern 3 Punkte extra.

## Einrichten (einmalig, etwa 20–30 Minuten)

Du brauchst drei Dinge: einen Google-Maps-Schlüssel, ein Firebase-Projekt für die
gemeinsamen Spieldaten und GitHub Pages als Hosting. Alles hat ein kostenloses Kontingent.

### 1. Website einschalten (GitHub Pages)

1. In diesem Repository auf **Settings → Pages** gehen.
2. Bei „Build and deployment“ als Source **Deploy from a branch** wählen,
   Branch **main**, Ordner **/ (root)**, dann **Save**.
3. Nach ein bis zwei Minuten steht oben die Adresse, z. B.
   `https://DEIN-NAME.github.io/strassenjagd/`. Die brauchst du gleich.

### 2. Google-Maps-Schlüssel

1. <https://console.cloud.google.com/> öffnen und ein neues Projekt anlegen (z. B. „Strassenjagd“).
2. Google verlangt ein Rechnungskonto (Kreditkarte). Für ein paar Runden unter Freunden
   bleibt man normalerweise im kostenlosen Kontingent. Die aktuellen Grenzen stehen auf
   der Preisseite der Google Maps Platform. Tipp: Unter **Abrechnung → Budgets** ein
   Budget mit E-Mail-Warnung (z. B. 1 €) anlegen.
3. **APIs & Dienste → Bibliothek** → „**Maps JavaScript API**“ suchen → **Aktivieren**.
4. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → API-Schlüssel**.
5. Den Schlüssel einschränken (wichtig, weil er öffentlich im Code steht):
   - **Anwendungseinschränkungen:** „Websites“ und eintragen:
     `https://DEIN-NAME.github.io/*` (zum lokalen Testen zusätzlich `http://localhost:*/*`)
   - **API-Einschränkungen:** „Schlüssel einschränken“ → nur **Maps JavaScript API**.
6. Den Schlüssel kopieren.

### 3. Firebase (gemeinsame Spieldaten)

1. <https://console.firebase.google.com/> → **Projekt hinzufügen** (du kannst das Google-Cloud-Projekt
   von oben auswählen). Google Analytics brauchst du nicht.
2. **Build → Authentication → Jetzt starten → Anmeldemethode → Anonym → Aktivieren**.
3. Unter **Authentication → Einstellungen → Autorisierte Domains** deine Domain
   `DEIN-NAME.github.io` hinzufügen.
4. **Build → Firestore Database → Datenbank erstellen**, Standort z. B. `eur3 (europe-west)`,
   im **Produktionsmodus** starten.
5. Im Reiter **Regeln** den Inhalt der Datei [`firestore.rules`](firestore.rules) einfügen
   und **Veröffentlichen**.
6. **Projekteinstellungen** (Zahnrad) → unten **Meine Apps → Web-App hinzufügen** (`</>`),
   Name egal, kein Hosting. Es erscheint ein Block `const firebaseConfig = { … }`.
   Daraus brauchst du `apiKey`, `authDomain`, `projectId` und `appId`.

### 4. Schlüssel eintragen

1. In diesem Repository die Datei [`config.js`](config.js) öffnen und auf den Stift (Bearbeiten) klicken.
2. Den Google-Maps-Schlüssel und die vier Firebase-Werte eintragen.
3. **Commit changes**. Nach einer Minute ist die Website aktuell.

Fertig. Öffne deine Pages-Adresse, gib deinen Namen ein, erstelle ein Spiel und schick
den Link an deine Freunde.

## Spielen

1. Eine Person erstellt ein Spiel (Anzahl Begriffe, Schwierigkeit, Zeitlimit, optional
   Buchstaben-Runde) und schickt den Einladungslink.
2. Alle öffnen den Link, geben ihren Namen ein und treten bei.
3. Die Spielleitung startet. Alle landen an einem zufälligen Ort in Street View.
   Mit „Zufälliger Ort“ springt man woanders hin, über „Karte“ kann man einen Ort antippen.
4. Begriff entdeckt: Blick darauf richten, ranzoomen, beim Begriff „Hier gefunden“ tippen.
5. Zeit um (oder alle fertig): Auswertung. Die Spielleitung blättert durch die Begriffe,
   alle schauen sich die Funde in Street View an und stimmen ab.

Ein Fund gilt, solange nicht mehr Leute „Gilt nicht“ als „Gilt“ sagen; eigene Stimmen zählen nicht.

## Lokal testen

ES-Module brauchen einen Webserver:

```
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen (Domain `localhost` muss beim Maps-Schlüssel und in
Firebase unter „Autorisierte Domains“ erlaubt sein; `localhost` ist dort standardmäßig drin).

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html`, `style.css` | Seite und Gestaltung |
| `app.js` | Spiellogik, Street View, Firebase |
| `terms.js` | Begriffe und Startorte – hier kannst du eigene Begriffe ergänzen |
| `config.js` | deine Schlüssel |
| `firestore.rules` | Zugriffsregeln für die Datenbank |
