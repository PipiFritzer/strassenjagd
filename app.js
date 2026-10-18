// Straßenjagd: scavenger hunt in Google Street View.
// Players search in Google Maps (app or second tab) and hand in a Street View
// link and/or a screenshot. Firebase (anonymous auth + Firestore on the free
// Spark plan) keeps the shared game state. No Google Maps API key is used.

import { CONFIG } from './config.js';
import { generateTerms, START_SPOTS } from './terms.js';
import { parseStreetViewLink, isMapsLink, openUrl, embedUrl, randomStreetViewUrl } from './streetview.js';

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
const extLink = (href, text, cls) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', class: cls || null, text });

/* ---------------- setup check ---------------- */
const configured = !/HIER_|DEIN-PROJEKT/.test(CONFIG.firebase.apiKey + CONFIG.firebase.projectId + CONFIG.firebase.appId);
if (!configured) {
  $('#mode').textContent = 'Nicht eingerichtet';
  $('#mode').classList.add('error');
  $('#screen').append(el('section', { class: 'panel setup' },
    el('h2', { text: 'Fast fertig: Firebase-Daten eintragen' }),
    el('p', {}, 'In ', el('code', { text: 'config.js' }), ' fehlen noch die Firebase-Daten. Die Anleitung steht in der ', el('code', { text: 'README.md' }), ' unter „Einrichten“.')));
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
  myVotes: null,
  pasteTarget: null
};
const isHost = () => S.game && S.game.hostId === S.uid;
const nameOf = id => (S.players.find(p => p.id === id) || {}).nick || 'Jemand';
const gamePath = (...rest) => ['games', S.code, ...rest].join('/');
const myFind = i => S.finds.find(f => f.uid === S.uid && f.term === i);

/* ---------------- game subscriptions ---------------- */
function closeGame() {
  S.unsubs.forEach(u => u());
  S.unsubs = [];
  Object.assign(S, { code: null, game: null, players: [], finds: [], votes: [], myVotes: null });
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
    if (!snap.exists()) { toast('Dieses Spiel gibt es nicht (mehr).'); closeGame(); return; }
    S.game = snap.data();
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

async function saveFind(i, patch) {
  const prev = myFind(i) || {};
  const body = { uid: S.uid, term: i, link: '', img: '', lat: null, lng: null, heading: 0, pitch: 0, fov: 75, pano: '', streetView: true, at: Date.now(), ...stripMeta(prev), ...patch };
  if (!body.link && !body.img) { await removeFind(i); return; }
  try { await setDoc(doc(db, gamePath('finds', S.uid + '_' + i)), body); }
  catch (e) { toast('Speichern fehlgeschlagen: ' + errText(e)); throw e; }
}
function stripMeta(f) { const { id, ...rest } = f; return rest; }
async function saveLink(i, raw) {
  const link = (raw || '').trim();
  if (!link) { await saveFind(i, { link: '', lat: null, lng: null, pano: '' }); return; }
  if (!/^https:\/\//.test(link)) { toast('Bitte den ganzen Link einfügen (beginnt mit https://).'); return; }
  const sv = parseStreetViewLink(link) || {};
  await saveFind(i, { link, lat: sv.lat ?? null, lng: sv.lng ?? null, heading: sv.heading ?? 0, pitch: sv.pitch ?? 0, fov: sv.fov ?? 75, pano: sv.pano || '', streetView: sv.streetView !== false });
  toast(sv.lat != null && sv.streetView === false ? 'Gespeichert. Das ist ein Karten-Link, nicht Street View. Öffne Street View und kopier den Link dort.' : sv.lat != null ? 'Fund gespeichert.' : 'Link gespeichert. Tipp: Ein Screenshot dazu hilft bei der Auswertung.');
}
async function saveImage(i, file) {
  if (!file || !file.type.startsWith('image/')) { toast('Bitte ein Bild wählen.'); return; }
  try { await saveFind(i, { img: await compress(file) }); toast('Bild gespeichert.'); }
  catch (e) { if (!e.code) toast('Bild konnte nicht verarbeitet werden.'); }
}
const removeFind = i => deleteDoc(doc(db, gamePath('finds', S.uid + '_' + i)));

// Screenshots are shrunk to JPEG data URLs well below Firestore's 1 MiB document limit.
async function compress(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  let max = 1400;
  for (let round = 0; round < 5; round++) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.8, 0.68, 0.56]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 450000) return d; }
    max = Math.round(max * 0.75);
  }
  throw new Error('too large');
}

// Paste anywhere during the hunt: a Maps link or a screenshot lands on the term under the pointer
// (or the first open one).
document.addEventListener('paste', e => {
  if (!S.game || S.game.status !== 'hunt') return;
  const item = [...(e.clipboardData ? e.clipboardData.items : [])].find(x => x.type.startsWith('image/'));
  const text = e.clipboardData ? e.clipboardData.getData('text').trim() : '';
  const inField = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (!item && (inField || !isMapsLink(text))) return;
  e.preventDefault();
  let i = S.pasteTarget;
  if (i == null) i = S.game.terms.findIndex((_, k) => !myFind(k));
  if (i < 0) i = 0;
  if (item) saveImage(i, item.getAsFile()); else saveLink(i, text);
});

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
let raf = 0;
function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
// Iframes are reused across renders so Street View embeds do not reload on every update.
const frameCache = new Map();
function draw() {
  const screen = $('#screen');
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
  else if (status === 'hunt') view = viewHunt();
  else if (status === 'review') view = viewReview();
  else view = viewResults();
  screen.replaceChildren(...view);

  for (const [id, v] of Object.entries(keep)) {
    const i = document.getElementById(id);
    if (i && !i.dataset.fresh) { if (i.type === 'checkbox') i.checked = v; else i.value = v; }
  }
  if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
  tick();
}

function viewStart() {
  const invited = (new URLSearchParams(location.search).get('spiel') || '').toUpperCase();
  const nick = el('div', { class: 'field' },
    el('label', { class: 'lbl', for: 'nick', text: 'Dein Name' }),
    el('input', { type: 'text', id: 'nick', maxlength: '24', placeholder: 'z. B. Kim', value: S.nick }));
  const join = el('section', { class: 'panel' },
    el('h2', { text: invited ? 'Du bist eingeladen' : 'Spiel beitreten' }),
    invited ? null : el('p', { class: 'muted', text: 'Gib den Code ein, den du bekommen hast.' }),
    el('div', { class: 'row' },
      el('div', { class: 'field' }, el('label', { class: 'lbl', for: 'code', text: 'Spielcode' }),
        el('input', { type: 'text', id: 'code', class: 'code', maxlength: '5', value: invited, autocomplete: 'off' })),
      el('button', { class: 'sign', style: 'align-self:flex-end', text: 'Beitreten', onclick: () => joinGame($('#code').value).catch(e => toast('Fehler: ' + errText(e))) })));
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
    el('li', { text: 'Beim Start sehen alle die Begriffe. Gesucht wird in Google Maps: als App auf dem Handy oder in einem zweiten Tab.' }),
    el('li', { text: 'Gefunden? In Street View auf „Teilen → Link kopieren“ tippen (am PC: Adresszeile kopieren) und den Link beim Begriff einfügen. Ein Screenshot dazu ist optional.' }),
    el('li', { text: 'Ist die Zeit um, geht es automatisch zur Auswertung: Begriff für Begriff seht ihr alle Funde und stimmt ab.' }),
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

function viewHunt() {
  const me = S.players.find(p => p.id === S.uid) || {};
  const timeUp = S.game.endsAt && Date.now() >= S.game.endsAt;
  const allDone = S.players.length > 0 && S.players.every(p => p.done);
  const spot = randomStreetViewUrl(START_SPOTS);
  const bar = statusBar(el('div', { class: 'row' },
    el('span', { class: 'timer', id: 'timer', text: S.game.endsAt ? '' : '∞' }),
    extLink('https://www.google.com/maps', 'Google Maps öffnen', 'btn small'),
    extLink(spot.url, 'Zufälliger Ort', 'btn small sign')));
  const cards = S.game.terms.map((t, i) => termCard(t, i));
  const foot = el('section', { class: 'panel' },
    el('div', { class: 'row' },
      el('button', { class: me.done ? 'ghost' : 'primary', text: me.done ? 'Doch weitersuchen' : 'Ich bin fertig', onclick: () => setDone(!me.done) }),
      (isHost() || timeUp || allDone) ? el('button', { class: 'sign', text: 'Zur Auswertung', onclick: startReview }) : null),
    el('p', { class: 'muted', text: 'So gibst du ab: In Street View „Teilen → Link kopieren“ (am PC die Adresszeile), dann hier beim Begriff einfügen. Ein Screenshot dazu ist optional, du kannst ihn auch einfach mit Strg+V einfügen.' }));
  return [bar, el('div', { class: 'hunt' }, cards), foot];
}
function termCard(t, i) {
  const f = myFind(i);
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: e => saveImage(i, e.target.files[0]) });
  const hasCoords = f && f.lat != null;
  const state = !f ? 'Noch offen'
    : f.link && hasCoords ? 'Gefunden · Ort erkannt'
    : f.link ? 'Gefunden · Kurzlink gespeichert'
    : 'Gefunden · nur Bild';
  return el('div', { class: 'term' + (f ? ' found' : ''), onmouseenter: () => { S.pasteTarget = i; }, onfocusin: () => { S.pasteTarget = i; } },
    el('div', { class: 'ort' }, el('div', {}, el('small', { text: 'Begriff ' + (i + 1) }), t)),
    el('span', { class: 'state', text: state }),
    el('div', { class: 'linkrow' },
      el('input', { type: 'text', inputmode: 'url', id: 'link-' + i, placeholder: 'Street-View-Link einfügen', value: (f && f.link) || '', autocomplete: 'off',
        onchange: e => saveLink(i, e.target.value), onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } }),
      el('button', { class: 'small', type: 'button', text: 'Einfügen', title: 'Link aus der Zwischenablage einfügen', onclick: () => pasteFromClipboard(i) })),
    f && f.img ? el('img', { class: 'thumb', src: f.img, alt: 'Dein Bild für ' + t }) : null,
    el('div', { class: 'row' },
      fileInput,
      el('button', { class: 'small ghost', type: 'button', text: f && f.img ? 'Bild ersetzen' : 'Bild hinzufügen', onclick: () => fileInput.click() }),
      f && (f.link || f.lat != null) ? extLink(openUrl(f), 'Prüfen', 'btn small ghost') : null,
      f ? el('button', { class: 'small ghost', type: 'button', text: 'Löschen', onclick: () => removeFind(i) }) : null));
}
async function pasteFromClipboard(i) {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) { toast('Die Zwischenablage ist leer.'); return; }
    const input = $('#link-' + i); if (input) input.value = text;
    await saveLink(i, text);
  } catch (_) {
    toast('Einfügen nicht erlaubt. Tipp lange ins Feld und wähle „Einfügen“.');
    const input = $('#link-' + i); if (input) input.focus();
  }
}

function reviewIndex() { return Math.min(S.game.reviewIdx || 0, S.game.terms.length - 1); }
function viewReview() {
  const i = reviewIndex();
  const finds = S.finds.filter(f => f.term === i).sort((a, b) => nameOf(a.uid).localeCompare(nameOf(b.uid)));
  const mv = myVotes();
  const nav = el('div', { class: 'row', style: 'justify-content:space-between' },
    el('div', { class: 'ort big', style: 'flex:1 1 280px' }, el('div', {}, el('small', { text: `Begriff ${i + 1} von ${S.game.terms.length}` }), S.game.terms[i])),
    isHost() ? el('div', { class: 'row' },
      el('button', { class: 'small', disabled: i === 0, text: '← Zurück', onclick: () => updGame({ reviewIdx: i - 1 }) }),
      i < S.game.terms.length - 1
        ? el('button', { class: 'primary', text: 'Nächster Begriff →', onclick: () => updGame({ reviewIdx: i + 1 }) })
        : el('button', { class: 'sign', text: 'Ergebnis zeigen', onclick: finishGame }))
      : el('span', { class: 'muted', text: 'Die Spielleitung blättert weiter.' }));
  const cards = finds.length ? el('div', { class: 'subs' }, finds.map(f => findCard(f, mv))) : el('p', { class: 'empty', text: 'Diesen Begriff hat niemand gefunden.' });
  return [statusBar(), nav, cards,
    el('p', { class: 'muted', text: 'Ein Fund gilt, solange nicht mehr Leute „Gilt nicht“ als „Gilt“ sagen. Eigene Stimmen zählen nicht.' })];
}
function findVisual(f) {
  if (f.img) return el('img', { class: 'shot', src: f.img, alt: 'Fund von ' + nameOf(f.uid), onclick: () => lightbox(f.img) });
  const src = embedUrl(f);
  if (src) {
    let frame = frameCache.get(f.id + src);
    if (!frame) {
      frame = el('iframe', { class: 'shot', src, loading: 'lazy', title: 'Street View: Fund von ' + nameOf(f.uid), allowfullscreen: true, referrerpolicy: 'no-referrer-when-downgrade' });
      frameCache.set(f.id + src, frame);
    }
    return frame;
  }
  return el('a', { class: 'shot placeholder', href: openUrl(f), target: '_blank', rel: 'noopener noreferrer' },
    el('span', { class: 'pin', 'aria-hidden': 'true' }), el('strong', { text: 'In Street View ansehen' }), el('span', { class: 'muted', text: 'öffnet Google Maps' }));
}
function findCard(f, mv) {
  const t = tally(f);
  const own = f.uid === S.uid;
  return el('article', { class: 'sub' + (t.valid ? '' : ' invalid') },
    findVisual(f),
    el('div', { class: 'body' },
      el('div', { class: 'who' }, el('h3', { text: nameOf(f.uid) }), el('span', { class: 'verdict ' + (t.valid ? 'ok' : 'bad'), text: (t.valid ? 'gilt' : 'gilt nicht') + ` · ${t.ok}✓ ${t.bad}✗ ${t.stars}★` })),
      f.link || f.lat != null ? extLink(openUrl(f), 'In Google Maps öffnen', 'btn small') : null,
      own ? el('p', { class: 'muted', text: 'Dein Fund. Die anderen stimmen ab.' }) : el('div', { class: 'vote' },
        el('button', { class: 'small' + (mv.v[f.id] === 1 ? ' on-ok' : ''), 'aria-pressed': String(mv.v[f.id] === 1), text: '✓ Gilt', onclick: () => vote(f.id, 'ok') }),
        el('button', { class: 'small' + (mv.v[f.id] === -1 ? ' on-bad' : ''), 'aria-pressed': String(mv.v[f.id] === -1), text: '✗ Gilt nicht', onclick: () => vote(f.id, 'bad') }),
        el('button', { class: 'small' + (mv.s[f.id] ? ' on-star' : ''), 'aria-pressed': String(!!mv.s[f.id]), text: '★ Toller Fund', onclick: () => vote(f.id, 'star') }))));
}
function lightbox(src) {
  const lb = el('div', { class: 'lightbox', role: 'dialog', 'aria-label': 'Großansicht', onclick: () => lb.remove() }, el('img', { src, alt: '' }));
  document.body.append(lb);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const lb = $('.lightbox'); if (lb) lb.remove(); } });

function viewResults() {
  const board = scoreboard();
  const best = S.finds.map(f => ({ f, t: tally(f) })).filter(x => x.t.stars > 0).sort((a, b) => b.t.stars - a.t.stars).slice(0, 6);
  return [statusBar(), el('section', { class: 'panel' },
    el('h2', { text: board[0] ? board[0].nick + ' gewinnt die Straßenjagd' : 'Ergebnis' }),
    el('div', { class: 'tablewrap' }, el('table', { class: 'score' },
      el('thead', {}, el('tr', {}, ['#', 'Name', 'Funde', 'Sterne', 'Punkte'].map(h => el('th', { text: h })))),
      el('tbody', {}, board.map((r, k) => el('tr', { class: k === 0 ? 'first' : '' },
        el('td', { class: 'mono', text: (k + 1) + '.' }), el('td', { text: r.nick }),
        el('td', { class: 'n', text: `${r.found} / ${S.game.terms.length}` }), el('td', { class: 'n', text: r.stars }), el('td', { class: 'n', text: r.pts })))))),
    el('div', { class: 'row' }, el('button', { class: 'primary', text: 'Neues Spiel', onclick: closeGame }))),
    best.length ? el('section', { class: 'panel' }, el('h2', { text: 'Schönste Funde' }), el('div', { class: 'subs' }, best.map(({ f, t }) =>
      el('article', { class: 'sub' }, findVisual(f), el('div', { class: 'body' },
        el('div', { class: 'who' }, el('h3', { text: S.game.terms[f.term] }), el('span', { class: 'verdict ok', text: t.stars + '★' })),
        el('p', { class: 'muted', text: nameOf(f.uid) }),
        f.link || f.lat != null ? extLink(openUrl(f), 'In Google Maps öffnen', 'btn small') : null))))) : null];
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
