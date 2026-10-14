// Straßenjagd: scavenger hunt in Google Street View.
// Firebase (anonymous auth + Firestore) keeps the shared game state,
// the Google Maps JavaScript API provides the embedded Street View.

import { CONFIG } from './config.js';
import { generateTerms, START_SPOTS } from './terms.js';

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
function toast(msg) {
  const t = el('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}
function store(key, value) { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (_) { return null; } return null; }
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const statusText = s => ({ lobby: 'wartet', hunt: 'läuft', review: 'Auswertung', done: 'beendet' }[s] || s);
const errText = e => (e && (e.code || e.message)) || 'unbekannter Fehler';

/* ---------------- setup check ---------------- */
const configured = !/HIER_|DEIN-PROJEKT/.test(CONFIG.googleMapsApiKey + CONFIG.firebase.apiKey + CONFIG.firebase.projectId);
if (!configured) {
  $('#mode').textContent = 'Nicht eingerichtet';
  $('#mode').classList.add('error');
  $('#screen').append(el('section', { class: 'panel setup' },
    el('h2', { text: 'Fast fertig: Schlüssel eintragen' }),
    el('p', {}, 'In ', el('code', { text: 'config.js' }), ' fehlen noch der Google-Maps-Schlüssel und die Firebase-Daten. Die Anleitung steht in der ', el('code', { text: 'README.md' }), ' unter „Einrichten“.')));
  throw new Error('config.js is not filled in');
}

/* ---------------- Firebase (loaded only once config.js is filled in) ---------------- */
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const [{ initializeApp }, { getAuth, signInAnonymously, onAuthStateChanged }, {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot
}] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
const fbApp = initializeApp(CONFIG.firebase);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

/* ---------------- state ---------------- */
const S = {
  uid: null,
  nick: store('sj-nick') || '',
  code: null,
  game: null,
  players: [],
  finds: [],
  votes: [],
  unsubs: [],
  reviewSel: null,       // selected find id during review
  reviewTerm: -1,
  myVotes: null
};
const isHost = () => S.game && S.game.hostId === S.uid;
const nameOf = id => (S.players.find(p => p.id === id) || {}).nick || 'Jemand';
const gamePath = (...rest) => ['games', S.code, ...rest].join('/');
const myFind = i => S.finds.find(f => f.uid === S.uid && f.term === i);

/* ---------------- Google Maps ---------------- */
let mapsReady = null;
function loadMaps() {
  if (mapsReady) return mapsReady;
  mapsReady = new Promise((resolve, reject) => {
    window.__sjMapsReady = () => resolve(window.google.maps);
    window.gm_authFailure = () => { toast('Google Maps lehnt den Schlüssel ab. Prüf den Key und seine Einschränkungen.'); };
    const s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(CONFIG.googleMapsApiKey) +
      '&v=weekly&language=de&loading=async&callback=__sjMapsReady';
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps konnte nicht geladen werden'));
    document.head.append(s);
  });
  return mapsReady;
}

let huntPano = null, reviewPano = null, miniMap = null, svService = null;
const PANO_OPTS = { addressControl: true, showRoadLabels: true, motionTracking: false, motionTrackingControl: false, fullscreenControl: true, zoomControl: true };

let huntPanoReady = null;
function ensureHuntPano() {
  if (!huntPanoReady) huntPanoReady = createHuntPano().catch(e => { huntPanoReady = null; throw e; });
  return huntPanoReady;
}
async function createHuntPano() {
  const maps = await loadMaps();
  svService = new maps.StreetViewService();
  huntPano = new maps.StreetViewPanorama($('#huntPano'), PANO_OPTS);
  miniMap = new maps.Map($('#miniMap'), { center: { lat: 30, lng: 10 }, zoom: 2, streetViewControl: false, mapTypeControl: false, fullscreenControl: false, clickableIcons: false });
  miniMap.setStreetView(huntPano);
  miniMap.addListener('click', e => jumpNear(e.latLng, 3000));
  huntPano.addListener('position_changed', () => { const p = huntPano.getPosition(); if (p && !$('#miniMapWrap').hidden) miniMap.panTo(p); });
  await randomSpot();
  return huntPano;
}
let reviewPanoReady = null;
function ensureReviewPano() {
  if (!reviewPanoReady) reviewPanoReady = loadMaps().then(maps => (reviewPano = new maps.StreetViewPanorama($('#reviewPano'), PANO_OPTS)))
    .catch(e => { reviewPanoReady = null; throw e; });
  return reviewPanoReady;
}
function jumpNear(latLng, radius) {
  return new Promise(resolve => {
    svService.getPanorama({ location: latLng, radius, preference: 'nearest', source: 'outdoor' }, (data, status) => {
      if (status === 'OK' && data && data.location) {
        huntPano.setPano(data.location.pano);
        huntPano.setPov({ heading: Math.floor(Math.random() * 360), pitch: 0 });
        huntPano.setZoom(0);
        huntPano.setVisible(true);
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}
async function randomSpot() {
  for (let attempt = 0; attempt < 6; attempt++) {
    const [name, lat, lng] = START_SPOTS[Math.floor(Math.random() * START_SPOTS.length)];
    const jitter = () => (Math.random() - 0.5) * 0.06;
    if (await jumpNear({ lat: lat + jitter(), lng: lng + jitter() }, 4000)) { toast('Du stehst jetzt irgendwo in ' + name + '.'); return; }
  }
  toast('Kein Street-View-Bild gefunden. Versuch es noch einmal.');
}
$('#randomBtn').addEventListener('click', () => { if (svService) randomSpot(); });
$('#mapToggle').addEventListener('click', () => {
  const w = $('#miniMapWrap'); w.hidden = !w.hidden;
  if (!w.hidden && huntPano && huntPano.getPosition()) { miniMap.setCenter(huntPano.getPosition()); if (miniMap.getZoom() < 12) miniMap.setZoom(14); }
});

/* ---------------- game subscriptions ---------------- */
function closeGame() {
  S.unsubs.forEach(u => u());
  S.unsubs = [];
  Object.assign(S, { code: null, game: null, players: [], finds: [], votes: [], reviewSel: null, reviewTerm: -1, myVotes: null });
  history.replaceState(null, '', location.pathname);
  render();
}
function openGame(code) {
  S.unsubs.forEach(u => u());
  S.unsubs = [];
  S.code = code;
  S.myVotes = null;
  history.replaceState(null, '', location.pathname + '?spiel=' + code);
  const onErr = e => toast('Verbindung gestört: ' + errText(e));
  S.unsubs.push(onSnapshot(doc(db, gamePath()), snap => {
    S.game = snap.exists() ? snap.data() : null;
    if (!snap.exists()) { toast('Dieses Spiel gibt es nicht (mehr).'); closeGame(); return; }
    render();
  }, onErr));
  S.unsubs.push(onSnapshot(collection(db, gamePath('players')), snap => {
    S.players = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    render();
  }, onErr));
  S.unsubs.push(onSnapshot(collection(db, gamePath('finds')), snap => {
    S.finds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, onErr));
  S.unsubs.push(onSnapshot(collection(db, gamePath('votes')), snap => {
    S.votes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, onErr));
}

/* ---------------- actions ---------------- */
function readNick() {
  const v = ($('#nick') && $('#nick').value.trim()) || S.nick;
  if (!v) { toast('Bitte gib zuerst deinen Namen ein.'); return null; }
  S.nick = v.slice(0, 24);
  store('sj-nick', S.nick);
  return S.nick;
}
async function createGame() {
  const nick = readNick(); if (!nick) return;
  const count = +$('#count').value, level = $('#level').value, minutes = +$('#minutes').value;
  const { terms, letter } = generateTerms(count, level, $('#letter').checked);
  let code = newCode();
  for (let i = 0; i < 5 && (await getDoc(doc(db, 'games', code))).exists(); i++) code = newCode();
  await setDoc(doc(db, 'games', code), { code, hostId: S.uid, hostNick: nick, status: 'lobby', terms, letter, minutes, createdAt: Date.now(), endsAt: 0, reviewIdx: 0 });
  await setDoc(doc(db, 'games', code, 'players', S.uid), { nick, joinedAt: Date.now(), done: false });
  openGame(code);
}
async function joinGame(rawCode) {
  const nick = readNick(); if (!nick) return;
  const code = (rawCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) { toast('Der Spielcode hat 5 Zeichen.'); return; }
  const snap = await getDoc(doc(db, 'games', code));
  if (!snap.exists()) { toast('Kein Spiel mit dem Code ' + code + ' gefunden.'); return; }
  await setDoc(doc(db, 'games', code, 'players', S.uid), { nick, joinedAt: Date.now(), done: false });
  openGame(code);
}
const updGame = data => updateDoc(doc(db, gamePath()), data).catch(e => toast('Speichern fehlgeschlagen: ' + errText(e)));
const startHunt = () => updGame({ status: 'hunt', endsAt: S.game.minutes ? Date.now() + S.game.minutes * 60000 : 0 });
const startReview = () => updGame({ status: 'review', reviewIdx: 0 });
const finishGame = () => updGame({ status: 'done' });
const setDone = v => updateDoc(doc(db, gamePath('players', S.uid)), { done: v });

async function markFound(i) {
  if (!huntPano || !huntPano.getPano()) { toast('Street View lädt noch.'); return; }
  const pos = huntPano.getPosition(), pov = huntPano.getPov(), loc = huntPano.getLocation();
  try {
    await setDoc(doc(db, gamePath('finds', S.uid + '_' + i)), {
      uid: S.uid, term: i, pano: huntPano.getPano(),
      lat: pos ? pos.lat() : null, lng: pos ? pos.lng() : null,
      heading: pov.heading || 0, pitch: pov.pitch || 0, zoom: huntPano.getZoom() || 0,
      place: (loc && loc.description) || '', at: Date.now()
    });
    toast('Gespeichert: genau diese Ansicht zählt für „' + S.game.terms[i] + '“.');
  } catch (e) { toast('Speichern fehlgeschlagen: ' + errText(e)); }
}
const removeFind = i => deleteDoc(doc(db, gamePath('finds', S.uid + '_' + i)));
function showFind(pano, f) {
  pano.setPano(f.pano);
  pano.setPov({ heading: f.heading || 0, pitch: f.pitch || 0 });
  pano.setZoom(f.zoom || 0);
  pano.setVisible(true);
}

// Votes: one document per voter, written one at a time.
let voteChain = Promise.resolve();
function myVotes() {
  if (S.myVotes) return S.myVotes;
  const d = S.votes.find(v => v.id === S.uid);
  return { v: { ...((d && d.v) || {}) }, s: { ...((d && d.s) || {}) } };
}
function vote(findId, kind) {
  const mv = myVotes();
  if (kind === 'star') { if (mv.s[findId]) delete mv.s[findId]; else mv.s[findId] = true; }
  else { const val = kind === 'ok' ? 1 : -1; if (mv.v[findId] === val) delete mv.v[findId]; else mv.v[findId] = val; }
  S.myVotes = mv;
  render();
  const body = JSON.parse(JSON.stringify(mv));
  voteChain = voteChain.then(() => setDoc(doc(db, gamePath('votes', S.uid)), body)).catch(e => toast('Stimme nicht gespeichert: ' + errText(e)));
}

/* ---------------- scoring ---------------- */
function tally(f) {
  let ok = 0, bad = 0, stars = 0;
  for (const v of S.votes) {
    if (v.id === f.uid) continue; // own votes do not count
    const x = (v.v || {})[f.id];
    if (x === 1) ok++; else if (x === -1) bad++;
    if ((v.s || {})[f.id]) stars++;
  }
  const valid = bad <= ok;
  return { ok, bad, stars, valid, points: valid ? 10 + 3 * stars : 0 };
}
function scoreboard() {
  return S.players.map(p => {
    let pts = 0, found = 0, stars = 0;
    for (const f of S.finds.filter(x => x.uid === p.id)) { const t = tally(f); if (t.valid) found++; pts += t.points; stars += t.stars; }
    return { ...p, pts, found, stars };
  }).sort((a, b) => b.pts - a.pts || b.found - a.found);
}

/* ---------------- rendering ---------------- */
let raf = 0, huntStageShown = false;
function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
function draw() {
  const screen = $('#screen');
  // keep typed values and focus across re-renders
  const keep = {};
  screen.querySelectorAll('input[id],select[id]').forEach(i => { keep[i.id] = i.type === 'checkbox' ? i.checked : i.value; });
  const focusId = document.activeElement && document.activeElement.id;
  const status = S.game ? S.game.status : null;
  const me = S.players.find(p => p.id === S.uid);

  let view;
  if (!S.uid) view = [el('p', { class: 'muted', text: 'Verbinde …' })];
  else if (!S.code || !S.game) view = viewStart();
  else if (!me && status !== 'done') view = viewJoin();
  else if (status === 'lobby') view = viewLobby();
  else if (status === 'hunt') view = viewHuntTop();
  else if (status === 'review') view = viewReviewTop();
  else view = viewResults();
  screen.replaceChildren(...view);

  for (const [id, v] of Object.entries(keep)) {
    const i = document.getElementById(id);
    if (i) { if (i.type === 'checkbox') i.checked = v; else i.value = v; }
  }
  if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();

  const hunting = !!me && status === 'hunt';
  const reviewing = status === 'review';
  $('#huntStage').hidden = !hunting;
  $('#reviewStage').hidden = !reviewing;
  if (hunting) {
    const wasHidden = !huntStageShown;
    ensureHuntPano().then(p => { if (wasHidden) window.google.maps.event.trigger(p, 'resize'); }).catch(e => toast(errText(e)));
    drawHuntSide();
  }
  huntStageShown = hunting;
  if (reviewing) drawReview();
  tick();
}

function viewStart() {
  const params = new URLSearchParams(location.search);
  const invited = (params.get('spiel') || '').toUpperCase();
  const nick = el('div', { class: 'field' },
    el('label', { class: 'lbl', for: 'nick', text: 'Dein Name' }),
    el('input', { type: 'text', id: 'nick', maxlength: '24', placeholder: 'z. B. Kim', value: S.nick }));
  const join = el('section', { class: 'panel' },
    el('h2', { text: invited ? 'Du bist eingeladen' : 'Spiel beitreten' }),
    invited ? null : el('p', { class: 'muted', text: 'Gib den Code ein, den du bekommen hast.' }),
    el('div', { class: 'row' },
      el('div', { class: 'field' }, el('label', { class: 'lbl', for: 'code', text: 'Spielcode' }),
        el('input', { type: 'text', id: 'code', class: 'code', maxlength: '5', value: invited, autocomplete: 'off' })),
      el('button', { class: 'sign', style: 'align-self:flex-end', text: 'Beitreten', onclick: () => joinGame($('#code').value) })));
  const create = el('form', { class: 'panel', onsubmit: e => { e.preventDefault(); createGame().catch(err => toast('Fehler: ' + errText(err))); } },
    el('h2', { text: 'Neues Spiel' }),
    el('div', { class: 'row' },
      el('div', { class: 'field' }, el('label', { class: 'lbl', for: 'count', text: 'Begriffe' }), select('count', [['5', '5'], ['8', '8'], ['10', '10'], ['12', '12'], ['15', '15']], '8')),
      el('div', { class: 'field' }, el('label', { class: 'lbl', for: 'level', text: 'Schwierigkeit' }), select('level', [['leicht', 'Leicht'], ['mittel', 'Mittel'], ['schwer', 'Schwer'], ['gemischt', 'Gemischt']], 'gemischt')),
      el('div', { class: 'field' }, el('label', { class: 'lbl', for: 'minutes', text: 'Zeitlimit' }), select('minutes', [['10', '10 Min'], ['15', '15 Min'], ['20', '20 Min'], ['30', '30 Min'], ['45', '45 Min'], ['0', 'Ohne']], '20'))),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', id: 'letter' }), 'Buchstaben-Runde: ein paar Begriffe hängen an einem Zufallsbuchstaben, wie bei Stadt-Land-Fluss'),
    el('div', { class: 'row' }, el('button', { class: 'primary', type: 'submit', text: 'Spiel erstellen' })));
  const how = el('section', { class: 'panel' }, el('h2', { text: 'So läuft’s' }), el('ol', { class: 'steps' },
    el('li', { text: 'Eine Person erstellt ein Spiel und schickt den Link an die anderen.' }),
    el('li', { text: 'Beim Start sehen alle die Begriffe und landen in Street View irgendwo auf der Welt.' }),
    el('li', { text: 'Herumlaufen, mit „Zufälliger Ort“ oder der Karte springen. Siehst du einen Begriff, richte den Blick darauf und tippe beim Begriff auf „Hier gefunden“.' }),
    el('li', { text: 'Ist die Zeit um, geht es automatisch zur Auswertung: Begriff für Begriff seht ihr jeden Fund direkt in Street View und stimmt ab.' }),
    el('li', { text: 'Gültiger Fund 10 Punkte, jeder Stern für einen tollen Fund 3 Punkte extra.' })));
  return [el('section', { class: 'panel' }, nick), el('div', { class: 'grid2' }, join, create), how];
}
function select(id, opts, def) { return el('select', { id }, opts.map(([v, t]) => el('option', { value: v, selected: v === def, text: t }))); }

function viewJoin() {
  return [el('section', { class: 'panel' },
    el('h2', { text: 'Spiel ' + S.code + ' beitreten' }),
    el('div', { class: 'field' }, el('label', { class: 'lbl', for: 'nick', text: 'Dein Name' }), el('input', { type: 'text', id: 'nick', maxlength: '24', value: S.nick })),
    el('div', { class: 'row' },
      el('button', { class: 'primary', text: 'Beitreten', onclick: () => joinGame(S.code) }),
      el('button', { class: 'ghost', text: 'Zurück', onclick: closeGame })))];
}

function playerChips() {
  return el('div', { class: 'chips' }, S.players.map(p => {
    const n = S.finds.filter(f => f.uid === p.id).length;
    return el('span', { class: 'chip' + (p.done ? ' done' : '') + (p.id === S.uid ? ' me' : '') },
      el('span', { class: 'dot', 'aria-hidden': 'true' }),
      p.nick + (S.game.status === 'hunt' ? ` · ${n}/${S.game.terms.length}` : '') + (p.done ? ' · fertig' : ''));
  }));
}
function statusBar(extra) {
  return el('div', { class: 'status' },
    el('div', { style: 'display:flex;flex-direction:column;gap:6px;min-width:0' },
      el('span', { class: 'label', text: `Spiel ${S.code} · ${statusText(S.game.status)}` + (S.game.letter ? ' · Buchstabe ' + S.game.letter : '') }),
      playerChips()),
    extra || null);
}
function inviteLink() { return location.origin + location.pathname + '?spiel=' + S.code; }
async function copyInvite() {
  try { await navigator.clipboard.writeText(inviteLink()); toast('Link kopiert. Schick ihn an deine Freunde.'); }
  catch (_) { toast('Kopieren ging nicht. Markier den Link und kopier ihn von Hand.'); }
}

function viewLobby() {
  const canShare = typeof navigator.share === 'function';
  return [statusBar(), el('section', { class: 'panel' },
    el('h2', { text: 'Freunde einladen' }),
    el('div', { class: 'row' }, el('span', { class: 'label', text: 'Spielcode' }), el('span', { class: 'bigcode', text: S.code })),
    el('div', { class: 'share' },
      el('code', { text: inviteLink() }),
      el('button', { class: 'small', text: 'Link kopieren', onclick: copyInvite }),
      canShare ? el('button', { class: 'small', text: 'Teilen …', onclick: () => navigator.share({ title: 'Straßenjagd', text: 'Komm in mein Straßenjagd-Spiel!', url: inviteLink() }).catch(() => {}) }) : null),
    el('p', { text: `${S.game.terms.length} Begriffe sind ausgewürfelt. ${S.game.minutes ? 'Ihr habt ' + S.game.minutes + ' Minuten.' : 'Es gibt kein Zeitlimit.'} Die Begriffe erscheinen beim Start.` }),
    el('div', { class: 'row' },
      isHost() ? el('button', { class: 'sign', text: 'Jagd starten', onclick: startHunt }) : el('span', { class: 'muted', text: (S.game.hostNick || 'Die Spielleitung') + ' startet gleich …' }),
      el('button', { class: 'ghost', text: 'Spiel verlassen', onclick: closeGame })))];
}

function viewHuntTop() {
  const me = S.players.find(p => p.id === S.uid) || {};
  const timeUp = S.game.endsAt && Date.now() >= S.game.endsAt;
  const allDone = S.players.length > 0 && S.players.every(p => p.done);
  return [statusBar(el('div', { class: 'row' },
    el('span', { class: 'timer', id: 'timer', text: S.game.endsAt ? '' : '∞' }),
    el('button', { class: me.done ? 'small ghost' : 'small', text: me.done ? 'Doch weitersuchen' : 'Ich bin fertig', onclick: () => setDone(!me.done) }),
    (isHost() || timeUp || allDone) ? el('button', { class: 'small sign', text: 'Zur Auswertung', onclick: startReview }) : null))];
}
function drawHuntSide() {
  const side = $('#huntSide');
  side.replaceChildren(...S.game.terms.map((t, i) => {
    const f = myFind(i);
    return el('div', { class: 'term' + (f ? ' found' : '') },
      el('div', { class: 'ort' }, el('div', {}, el('small', { text: 'Begriff ' + (i + 1) }), t)),
      el('span', { class: 'state', text: f ? 'Gefunden' + (f.place ? ' · ' + f.place : '') : 'Noch offen' }),
      el('div', { class: 'row' },
        el('button', { class: f ? 'small' : 'small primary', text: f ? 'Diese Ansicht nehmen' : 'Hier gefunden', onclick: () => markFound(i) }),
        f ? el('button', { class: 'small ghost', text: 'Ansehen', onclick: () => showFind(huntPano, f) }) : null,
        f ? el('button', { class: 'small ghost', text: 'Löschen', onclick: () => removeFind(i) }) : null));
  }));
}

function reviewIndex() { return Math.min(S.game.reviewIdx || 0, S.game.terms.length - 1); }
function findsForTerm(i) { return S.finds.filter(f => f.term === i).sort((a, b) => nameOf(a.uid).localeCompare(nameOf(b.uid))); }
function viewReviewTop() {
  const i = reviewIndex();
  return [statusBar(), el('div', { class: 'row', style: 'justify-content:space-between' },
    el('div', { class: 'ort big', style: 'flex:1 1 280px' }, el('div', {}, el('small', { text: `Begriff ${i + 1} von ${S.game.terms.length}` }), S.game.terms[i])),
    isHost() ? el('div', { class: 'row' },
      el('button', { class: 'small', disabled: i === 0, text: '← Zurück', onclick: () => updGame({ reviewIdx: i - 1 }) }),
      i < S.game.terms.length - 1
        ? el('button', { class: 'primary', text: 'Nächster Begriff →', onclick: () => updGame({ reviewIdx: i + 1 }) })
        : el('button', { class: 'sign', text: 'Ergebnis zeigen', onclick: finishGame }))
      : el('span', { class: 'muted', text: 'Die Spielleitung blättert weiter.' }))];
}
async function drawReview() {
  const i = reviewIndex();
  const finds = findsForTerm(i);
  if (S.reviewTerm !== i || !finds.some(f => f.id === S.reviewSel)) { S.reviewTerm = i; S.reviewSel = finds[0] ? finds[0].id : null; S.shownSel = null; }
  const sel = finds.find(f => f.id === S.reviewSel);
  const mv = myVotes();
  $('#reviewEmpty').hidden = !!sel;

  const side = $('#reviewSide');
  const list = finds.map(f => {
    const t = tally(f);
    return el('button', { class: 'find' + (f.id === S.reviewSel ? ' active' : '') + (t.valid ? '' : ' invalid'), onclick: () => { S.reviewSel = f.id; render(); } },
      el('span', {}, el('strong', { text: nameOf(f.uid) }), f.place ? el('span', { class: 'muted', text: ' · ' + f.place }) : null),
      el('span', { class: 'verdict ' + (t.valid ? 'ok' : 'bad'), text: `${t.ok}✓ ${t.bad}✗ ${t.stars}★` }));
  });
  const voteBox = sel ? (sel.uid === S.uid
    ? el('p', { class: 'muted', text: 'Das ist dein Fund. Die anderen stimmen ab.' })
    : el('div', { class: 'panel', style: 'padding:14px;gap:10px' },
      el('h3', { text: 'Zählt der Fund von ' + nameOf(sel.uid) + '?' }),
      el('div', { class: 'vote' },
        el('button', { class: 'small' + (mv.v[sel.id] === 1 ? ' on-ok' : ''), 'aria-pressed': String(mv.v[sel.id] === 1), text: '✓ Gilt', onclick: () => vote(sel.id, 'ok') }),
        el('button', { class: 'small' + (mv.v[sel.id] === -1 ? ' on-bad' : ''), 'aria-pressed': String(mv.v[sel.id] === -1), text: '✗ Gilt nicht', onclick: () => vote(sel.id, 'bad') }),
        el('button', { class: 'small' + (mv.s[sel.id] ? ' on-star' : ''), 'aria-pressed': String(!!mv.s[sel.id]), text: '★ Toller Fund', onclick: () => vote(sel.id, 'star') })))) : null;
  side.replaceChildren(
    finds.length ? el('span', { class: 'label', text: finds.length + (finds.length === 1 ? ' Fund' : ' Funde') }) : el('p', { class: 'empty', text: 'Niemand hat diesen Begriff gefunden.' }),
    ...list, voteBox,
    el('p', { class: 'muted', style: 'font-size:.85rem', text: 'Ein Fund gilt, solange nicht mehr Leute „Gilt nicht“ als „Gilt“ sagen. Eigene Stimmen zählen nicht.' }));

  if (sel && S.shownSel !== sel.id) {
    S.shownSel = sel.id;
    try { showFind(await ensureReviewPano(), sel); } catch (e) { toast(errText(e)); }
  }
}

function viewResults() {
  const board = scoreboard();
  return [statusBar(), el('section', { class: 'panel' },
    el('h2', { text: board[0] ? board[0].nick + ' gewinnt die Straßenjagd' : 'Ergebnis' }),
    el('div', { class: 'tablewrap' }, el('table', { class: 'score' },
      el('thead', {}, el('tr', {}, ['Platz', 'Name', 'Gültige Funde', 'Sterne', 'Punkte'].map(h => el('th', { text: h })))),
      el('tbody', {}, board.map((r, k) => el('tr', { class: k === 0 ? 'first' : '' },
        el('td', { class: 'mono', text: (k + 1) + '.' }), el('td', { text: r.nick }),
        el('td', { class: 'n', text: `${r.found} / ${S.game.terms.length}` }), el('td', { class: 'n', text: r.stars }), el('td', { class: 'n', text: r.pts })))))),
    el('div', { class: 'row' }, el('button', { class: 'primary', text: 'Neues Spiel', onclick: closeGame })))];
}

/* ---------------- timer ---------------- */
let autoFired = false;
function tick() {
  const t = $('#timer');
  if (!t || !S.game || !S.game.endsAt) return;
  const left = Math.max(0, S.game.endsAt - Date.now());
  const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
  t.textContent = left ? `${m}:${String(s).padStart(2, '0')}` : 'Zeit um!';
  t.classList.toggle('late', left < 60000);
  // Time is up: every open client switches to review (same value, so races are harmless).
  if (!left && !autoFired && S.game.status === 'hunt') {
    autoFired = true;
    toast('Zeit um! Auf zur Auswertung.');
    updateDoc(doc(db, gamePath()), { status: 'review', reviewIdx: 0 }).catch(() => { autoFired = false; });
  }
  if (left) autoFired = false;
}
setInterval(tick, 1000);

/* ---------------- start ---------------- */
onAuthStateChanged(auth, user => {
  if (!user) return;
  S.uid = user.uid;
  $('#mode').textContent = 'Verbunden';
  $('#mode').classList.add('online');
  const code = (new URLSearchParams(location.search).get('spiel') || '').toUpperCase();
  if (code && S.nick) {
    // returning player (e.g. after reload): rejoin directly if already in that game
    getDoc(doc(db, 'games', code, 'players', S.uid)).then(snap => { if (snap.exists()) openGame(code); else render(); }).catch(() => render());
  } else {
    render();
  }
});
signInAnonymously(auth).catch(e => {
  $('#mode').textContent = 'Keine Verbindung';
  $('#mode').classList.add('error');
  $('#screen').replaceChildren(el('section', { class: 'panel' },
    el('h2', { text: 'Anmeldung bei Firebase fehlgeschlagen' }),
    el('p', { text: 'Prüf in der Firebase-Konsole, ob „Anonym“ unter Authentication aktiviert ist und ob diese Domain bei „Autorisierte Domains“ steht. Fehler: ' + errText(e) })));
});
render();
