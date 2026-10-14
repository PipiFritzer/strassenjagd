// Term pools and start locations for Straßenjagd.

export const TERMS = {
  leicht: [
    'Ein rotes Auto', 'Ein Fahrrad', 'Ein Hund', 'Ein Briefkasten', 'Eine Ampel', 'Ein Bus', 'Eine Kirche', 'Ein Spielplatz',
    'Ein Zebrastreifen', 'Ein Baum mit gelben Blättern', 'Eine Telefonzelle', 'Ein Taxi', 'Ein Kreisverkehr', 'Eine Brücke',
    'Ein Supermarkt', 'Ein Mensch mit Regenschirm', 'Eine Bank zum Sitzen', 'Ein Feuerwehrauto', 'Ein Lkw', 'Ein Motorrad',
    'Ein Fluss', 'Eine Tankstelle', 'Eine Bushaltestelle', 'Ein Stoppschild', 'Ein Zaun', 'Ein Pferd', 'Ein Strand',
    'Ein Kinderwagen', 'Ein Hochhaus', 'Ein Parkhaus', 'Ein blaues Haus', 'Eine Baustelle', 'Ein Wegweiser'
  ],
  mittel: [
    'Ein Leuchtturm', 'Eine Windmühle', 'Ein Kamel', 'Ein Traktor auf der Straße', 'Ein Eiswagen', 'Eine Straßenbahn',
    'Ein Graffiti mit einem Gesicht', 'Eine Statue auf einem Sockel', 'Ein Riesenrad', 'Ein Boot an Land', 'Ein Wohnmobil',
    'Ein Schild in einer anderen Schrift als Latein', 'Ein Markt mit Ständen', 'Ein Brunnen mit Wasser', 'Ein Schneemann',
    'Eine Hausnummer über 500', 'Ein Oldtimer', 'Eine Schafherde', 'Ein Fußballtor', 'Eine Seilbahn', 'Ein Bahnübergang',
    'Ein Haus mit Strohdach', 'Ein Mensch, der winkt', 'Ein Doppeldeckerbus', 'Eine Moschee', 'Ein Tempel', 'Ein Wasserturm',
    'Ein Schild mit Tier darauf', 'Ein Hund auf einem Balkon', 'Ein Laden mit dem Wort „Pizza“', 'Eine Kuh auf der Straße',
    'Ein Stau', 'Eine Palme neben Schnee'
  ],
  schwer: [
    'Ein Elefant', 'Ein Pinguin', 'Ein Känguru-Warnschild', 'Ein Mensch im Kostüm', 'Ein Auto auf dem Dach', 'Ein Flugzeug am Himmel',
    'Ein Regenbogen', 'Ein Brautpaar', 'Eine Kutsche mit Pferden', 'Ein Panzer oder Militärfahrzeug', 'Ein Heißluftballon',
    'Ein Street-View-Auto im Spiegel', 'Ein Schild, das in die Wüste zeigt', 'Ein Mensch mit Pappmaske', 'Ein umgekipptes Auto',
    'Eine Giraffe', 'Ein Lama', 'Ein Vulkan', 'Ein Gletscher', 'Ein Schiffswrack', 'Ein Mensch auf einem Kamel',
    'Ein Auto, das vollständig in Folie verpackt ist', 'Ein Polarlicht', 'Ein Ortsschild mit nur zwei Buchstaben',
    'Ein Weihnachtsbaum im Sommer', 'Ein Mann mit Leiter auf der Straße', 'Ein Schild mit Entfernung über 1000 km'
  ]
};

const LETTER_TEMPLATES = [
  'Ein Geschäft, dessen Name mit „{L}“ beginnt', 'Ein Ortsschild mit „{L}“ am Anfang', 'Ein Straßenname mit „{L}“ am Anfang',
  'Ein Tier, das mit „{L}“ beginnt', 'Ein Fahrzeug, das mit „{L}“ beginnt'
];
const LETTERS = 'ABDEFGHKLMNPRSTW';

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateTerms(count, level, letterMode) {
  const third = Math.ceil(count / 3);
  const pool = level === 'gemischt'
    ? [...shuffle(TERMS.leicht).slice(0, third), ...shuffle(TERMS.mittel).slice(0, third), ...shuffle(TERMS.schwer).slice(0, third)]
    : TERMS[level];
  let terms = shuffle(pool).slice(0, count);
  let letter = null;
  if (letterMode) {
    letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    const n = Math.min(3, Math.max(1, Math.floor(count / 3)));
    terms = shuffle([...terms.slice(0, count - n), ...shuffle(LETTER_TEMPLATES).slice(0, n).map(t => t.replace('{L}', letter))]);
  }
  return { terms, letter };
}

// Cities with good Street View coverage; the game searches the nearest panorama around them.
export const START_SPOTS = [
  ['Berlin', 52.520, 13.405], ['Hamburg', 53.551, 9.993], ['München', 48.137, 11.575], ['Köln', 50.938, 6.960],
  ['Wien', 48.208, 16.373], ['Zürich', 47.377, 8.541], ['Paris', 48.857, 2.352], ['Lissabon', 38.722, -9.139],
  ['Madrid', 40.417, -3.704], ['Rom', 41.902, 12.496], ['Amsterdam', 52.368, 4.904], ['Kopenhagen', 55.676, 12.568],
  ['Stockholm', 59.329, 18.069], ['Oslo', 59.914, 10.752], ['Reykjavík', 64.147, -21.942], ['Dublin', 53.350, -6.260],
  ['London', 51.507, -0.128], ['Edinburgh', 55.953, -3.188], ['Prag', 50.076, 14.438], ['Krakau', 50.065, 19.945],
  ['Budapest', 47.498, 19.040], ['Athen', 37.984, 23.728], ['Istanbul', 41.008, 28.978], ['New York', 40.758, -73.986],
  ['San Francisco', 37.775, -122.419], ['Los Angeles', 34.052, -118.244], ['Chicago', 41.878, -87.630],
  ['Mexiko-Stadt', 19.433, -99.133], ['Rio de Janeiro', -22.907, -43.173], ['Buenos Aires', -34.604, -58.382],
  ['Santiago de Chile', -33.449, -70.669], ['Kapstadt', -33.925, 18.424], ['Nairobi', -1.292, 36.822],
  ['Tokio', 35.690, 139.692], ['Kyōto', 35.012, 135.768], ['Seoul', 37.567, 126.978], ['Bangkok', 13.756, 100.502],
  ['Singapur', 1.290, 103.852], ['Sydney', -33.869, 151.209], ['Auckland', -36.848, 174.763], ['Toronto', 43.653, -79.383],
  ['Vancouver', 49.283, -123.121], ['Jakarta', -6.209, 106.846], ['Ulaanbaatar', 47.886, 106.906], ['Montevideo', -34.901, -56.164]
];
