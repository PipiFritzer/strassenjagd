// Straßenjagd: scavenger hunt in Google Street View.
// Players search in Google Maps (app or second tab) and hand in a Street View
// link and/or a screenshot. Devices share the game over a free public MQTT
// broker: no account, no key, nothing to set up.
//
// Topics (all retained, under the game code):
//   <code>/game        game settings and phase, written by the host
//   <code>/p/<uid>     one document per player: name, finds, votes
//   <code>/img/<id>    optional screenshot per find

import { generateTerms, START_SPOTS } from './terms.js';
import { parseStreetViewLink, isMapsLink, openUrl, embedUrl, randomStreetViewUrl } from './streetview.js';
import { createNet } from './net.js';

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
function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } catch (_) { return null; }
  return null;
}
const loadJson = key => { try { return JSON.parse(store(key) || 'null'); } catch (_) { return null; } };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomId = n => Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const statusText = s => ({ lobby: 'wartet', hunt: 'läuft', review: 'Auswertung', done: 'beendet' }[s] || s);
const errText = e => (e && (e.code || e.message)) || 'unbekannter Fehler';
const extLink = (href, text, cls) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', class: cls || null, text });
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const numOrNull = v => (typeof v === 'number' && isFinite(v) ? v : null);

/* ---------------- state ---------------- */
const params = new URLSearchParams(location.search);
const BROKER_OVERRIDE = params.get('broker'); // for local testing only
const net = createNet();
const S = {
  uid: store('sj-uid') || (() => { const id = 'u' + randomId(10).toLowerCase(); store('sj-uid', id); return id; })(),
  nick: store('sj-nick') || '',
  online: false,
  code: null,
  game: null,
  docs: {},       // uid -> player document as received
  me: null,       // my own player document (source of truth for my writes)
  imgs: {},       // find id -> data URL
  players: [], finds: [], votes: [],
  unsubs: [],
  joining: false,
  pasteTarget: null
};
const gameQuery = code => '?spiel=' + code + '&b=' + net.brokerIndex + (BROKER_OVERRIDE ? '&broker=' + encodeURIComponent(BROKER_OVERRIDE) : '');
const isHost = () => S.game && S.game.hostId === S.uid;
const nameOf = id => (S.players.find(p => p.id === id) || {}).nick || 'Jemand';
const myFind = i => S.finds.find(f => f.uid === S.uid && f.term === i);
const findId = (uid, term) => uid + '_' + term;

// Turns the raw player documents into the lists the views use.
function derive() {
  const docs = { ...S.docs };
  if (S.me) docs[S.uid] = S.me;
  const terms = S.game ? S.game.terms.length : 0;
  S.players = Object.entries(docs).filter(([, d]) => d && d.nick)
    .map(([id, d]) => ({ id, nick: str(d.nick, 24), joinedAt: d.joinedAt || 0, done: !!d.done }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
  S.finds = [];
  S.votes = [];
  for (const [uid, d] of Object.entries(docs)) {
    if (!d || !d.nick) continue;
    for (const [k, f] of Object.entries(d.finds || {})) {
      const term = Number(k);
      if (!Number.isInteger(term) || term < 0 || term >= terms || !f) continue;
      S.finds.push({
        id: findId(uid, term), uid, term,
        link: str(f.link, 800), lat: numOrNull(f.lat), lng: numOrNull(f.lng),
        heading: numOrNull(f.heading) || 0, pitch: numOrNull(f.pitch) || 0, fov: numOrNull(f.fov) || 75,
        pano: str(f.pano, 120), streetView: f.streetView !== false, hasImg: !!f.hasImg
      });
    }
    S.votes.push({ id: uid, v: d.v || {}, s: d.s || {} });
  }
}

/* ---------------- connection ---------------- */
net.onStatus(status => {
  S.online = status === 'online';
  const m = $('#mode');
  m.textContent = status === 'online' ? 'Verbunden' : status === 'offline' ? 'Offline – verbinde neu …' : 'Verbinde …';
  m.classList.toggle('online', S.online);
  m.classList.toggle('error', status === 'offline');
  if (S.online && S.code && S.me) publishMe(); // make sure the latest state is out after a reconnect
});

/* ---------------- game subscriptions ---------------- */
function leaveTopics() { S.unsubs.forEach(u => u()); S.unsubs = []; }
function closeGame() {
  // After the end, everyone removes their own retained data from the public server.
  if (S.game && S.game.status === 'done' && S.me) {
    for (const k of Object.keys(S.me.finds || {})) if (S.me.finds[k].hasImg) net.publish(`${S.code}/img/${findId(S.uid, k)}`, '', true).catch(() => {});
    net.publish(`${S.code}/p/${S.uid}`, '', true).catch(() => {});
    if (isHost()) net.publish(`${S.code}/game`, '', true).catch(() => {});
    store('sj-me-' + S.code, null);
    store('sj-host-' + S.code, null);
  }
  leaveTopics();
  Object.assign(S, { code: null, game: null, docs: {}, me: null, imgs: {}, players: [], finds: [], votes: [], joining: false });
  history.replaceState(null, '', location.pathname + (BROKER_OVERRIDE ? '?broker=' + encodeURIComponent(BROKER_OVERRIDE) : ''));
  render();
}
// Subscribes to a game; resolves true once its settings arrive, false after the timeout.
function openGame(code, timeoutMs = 5000) {
  leaveTopics();
  S.code = code;
  S.game = null; S.docs = {}; S.imgs = {};
  S.me = loadJson('sj-me-' + code);
  let resolveFound;
  const found = new Promise(r => { resolveFound = r; });
  S.unsubs.push(net.subscribe(`${code}/game`, text => {
    if (!text) { if (S.game) { toast('Die Spielleitung hat das Spiel beendet.'); S.game = null; closeGame(); } return; }
    let g;
    try { g = JSON.parse(text); } catch (_) { return; }
    // ignore echoes of older versions (e.g. our own previous publish arriving late)
    if (S.game && S.game.code === g.code && (g.rev || 0) < (S.game.rev || 0)) return;
    S.game = g;
    resolveFound(true);
    derive(); render();
  }));
  S.unsubs.push(net.subscribe(`${code}/p/+`, (text, topic) => {
    const uid = topic.split('/').pop();
    if (!text) delete S.docs[uid];
    else { try { S.docs[uid] = JSON.parse(text); } catch (_) { return; } }
    // adopt my own retained document if this device lost its copy
    if (uid === S.uid && !S.me && S.docs[uid]) S.me = S.docs[uid];
    derive(); render();
  }));
  S.unsubs.push(net.subscribe(`${code}/img/+`, (text, topic) => {
    const id = topic.split('/').pop();
    if (text) S.imgs[id] = text; else delete S.imgs[id];
    render();
  }));
  history.replaceState(null, '', location.pathname + gameQuery(code));
  setTimeout(() => resolveFound(false), timeoutMs);
  render();
  return found;
}

/* ---------------- publishing ---------------- */
let gameTimer = 0, meTimer = 0;
function publishGame() {
  store('sj-host-' + S.code, JSON.stringify(S.game));
  derive(); render();
  const body = JSON.stringify(S.game);
  clearTimeout(gameTimer);
  gameTimer = setTimeout(() => net.publish(`${S.code}/game`, body, true).catch(e => toast('Senden fehlgeschlagen: ' + errText(e))), 50);
}
function publishMe() {
  if (!S.code || !S.me) return;
  store('sj-me-' + S.code, JSON.stringify(S.me));
  derive(); render();
  const body = JSON.stringify(S.me);
  clearTimeout(meTimer);
  meTimer = setTimeout(() => net.publish(`${S.code}/p/${S.uid}`, body, true).catch(e => toast('Senden fehlgeschlagen: ' + errText(e))), 80);
}
function updateGame(patch) { S.game = { ...S.game, ...patch, rev: (S.game.rev || 0) + 1 }; publishGame(); }
function updateMe(fn) { S.me = JSON.parse(JSON.stringify(S.me)); fn(S.me); publishMe(); }

/* ---------------- actions ---------------- */
function readNick() {
  const v = ($('#nick') && $('#nick').value.trim()) || S.nick;
  if (!v) { toast('Bitte gib zuerst deinen Namen ein.'); return null; }
  S.nick = v.slice(0, 24);
  store('sj-nick', S.nick);
  return S.nick;
}
async function ensureOnline() {
  if (S.online) return;
  await net.connect(Number(params.get('b')) || 0, BROKER_OVERRIDE);
}
async function createGame() {
  const nick = readNick(); if (!nick) return;
  await ensureOnline();
  const count = +$('#count').value, level = $('#level').value, minutes = +$('#minutes').value;
  const { terms, letter } = generateTerms(count, level, $('#letter').checked);
  const code = randomId(5);
  openGame(code, 0);
  S.game = { code, hostId: S.uid, hostNick: nick, status: 'lobby', terms, letter, minutes, createdAt: Date.now(), endsAt: 0, reviewIdx: 0 };
  S.me = { nick, joinedAt: Date.now(), done: false, finds: {}, v: {}, s: {} };
  publishGame();
  publishMe();
}
async function joinGame(rawCode) {
  const nick = readNick(); if (!nick) return;
  const code = (rawCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) { toast('Der Spielcode hat 5 Zeichen.'); return; }
  S.joining = true; render();
  try {
    await ensureOnline();
    let ok = await openGame(code);
    if (!ok && !BROKER_OVERRIDE) {
      // the game may live on the other server
      const other = net.brokerIndex === 0 ? 1 : 0;
      await net.connect(other);
      ok = await openGame(code);
    }
    if (!ok) { toast('Kein Spiel mit dem Code ' + code + ' gefunden.'); closeGame(); return; }
    S.me = S.me || S.docs[S.uid] || { nick, joinedAt: Date.now(), done: false, finds: {}, v: {}, s: {} };
    updateMe(me => { me.nick = nick; });
  } finally { S.joining = false; render(); }
}
const startHunt = () => updateGame({ status: 'hunt', endsAt: S.game.minutes ? Date.now() + S.game.minutes * 60000 : 0 });
const startReview = () => updateGame({ status: 'review', reviewIdx: 0 });
const finishGame = () => updateGame({ status: 'done' });
const setDone = v => updateMe(me => { me.done = v; });

function saveFind(i, patch) {
  updateMe(me => {
    const prev = (me.finds || {})[i] || {};
    const next = { link: '', lat: null, lng: null, heading: 0, pitch: 0, fov: 75, pano: '', streetView: true, hasImg: false, ...prev, ...patch };
    me.finds = me.finds || {};
    if (!next.link && !next.hasImg) delete me.finds[i]; else me.finds[i] = next;
  });
}
function saveLink(i, raw) {
  const link = (raw || '').trim();
  if (!link) { saveFind(i, { link: '', lat: null, lng: null, pano: '' }); return; }
  if (!/^https:\/\//.test(link)) { toast('Bitte den ganzen Link einfügen (beginnt mit https://).'); return; }
  const sv = parseStreetViewLink(link) || {};
  saveFind(i, { link, lat: sv.lat ?? null, lng: sv.lng ?? null, heading: sv.heading ?? 0, pitch: sv.pitch ?? 0, fov: sv.fov ?? 75, pano: sv.pano || '', streetView: sv.streetView !== false });
  toast(sv.lat != null && sv.streetView === false ? 'Gespeichert. Das ist ein Karten-Link, nicht Street View. Öffne Street View und kopier den Link dort.'
    : sv.lat != null ? 'Fund gespeichert.' : 'Link gespeichert. Tipp: Ein Screenshot dazu hilft bei der Auswertung.');
}
async function saveImage(i, file) {
  if (!file || !file.type.startsWith('image/')) { toast('Bitte ein Bild wählen.'); return; }
  try {
    const data = await compress(file);
    const id = findId(S.uid, i);
    S.imgs[id] = data;
    await net.publish(`${S.code}/img/${id}`, data, true);
    saveFind(i, { hasImg: true });
    toast('Bild gespeichert.');
  } catch (e) { toast('Bild konnte nicht gesendet werden: ' + errText(e)); }
}
function removeFind(i) {
  const f = (S.me.finds || {})[i];
  if (f && f.hasImg) { net.publish(`${S.code}/img/${findId(S.uid, i)}`, '', true).catch(() => {}); delete S.imgs[findId(S.uid, i)]; }
  updateMe(me => { delete me.finds[i]; });
}

// Screenshots are shrunk to small JPEGs so they travel quickly through the public server.
async function compress(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  let max = 1100;
  for (let round = 0; round < 6; round++) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.72, 0.6, 0.5]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 120000) return d; }
    max = Math.round(max * 0.75);
  }
  throw new Error('Bild zu groß');
}

// Paste anywhere during the hunt: a Maps link or a screenshot lands on the term under the pointer
// (or the first open one).
document.addEventListener('paste', e => {
  if (!S.game || S.game.status !== 'hunt' || !S.me) return;
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

// Votes live in the voter's own player document.
function myVotes() { return { v: { ...((S.me && S.me.v) || {}) }, s: { ...((S.me && S.me.s) || {}) } }; }
function vote(id, kind) {
  updateMe(me => {
    me.v = me.v || {}; me.s = me.s || {};
    if (kind === 'star') { if (me.s[id]) delete me.s[id]; else me.s[id] = true; }
    else { const val = kind === 'ok' ? 1 : -1; if (me.v[id] === val) delete me.v[id]; else me.v[id] = val; }
  });
}

/* ---------------- scoring ---------------- */
function tally(f) {
  let ok = 0, bad = 0, stars = 0;
  for (const v of S.votes) {
    if (v.id === f.uid) continue; // own votes do not count
    const x = v.v[f.id];
    if (x === 1) ok++; else if (x === -1) bad++;
    if (v.s[f.id]) stars++;
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
  if (S.joining) view = [el('p', { class: 'muted', text: 'Suche Spiel …' })];
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
      el('button', { class: 'primary', text: 'Beitreten', onclick: () => joinGame(S.code).catch(e => toast('Fehler: ' + errText(e))) }),
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
function inviteLink() { return location.origin + location.pathname + gameQuery(S.code); }
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
    f && f.hasImg && S.imgs[f.id] ? el('img', { class: 'thumb', src: S.imgs[f.id], alt: 'Dein Bild für ' + t }) : null,
    el('div', { class: 'row' },
      fileInput,
      el('button', { class: 'small ghost', type: 'button', text: f && f.hasImg ? 'Bild ersetzen' : 'Bild hinzufügen', onclick: () => fileInput.click() }),
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
      el('button', { class: 'small', disabled: i === 0, text: '← Zurück', onclick: () => updateGame({ reviewIdx: i - 1 }) }),
      i < S.game.terms.length - 1
        ? el('button', { class: 'primary', text: 'Nächster Begriff →', onclick: () => updateGame({ reviewIdx: i + 1 }) })
        : el('button', { class: 'sign', text: 'Ergebnis zeigen', onclick: finishGame }))
      : el('span', { class: 'muted', text: 'Die Spielleitung blättert weiter.' }));
  const cards = finds.length ? el('div', { class: 'subs' }, finds.map(f => findCard(f, mv))) : el('p', { class: 'empty', text: 'Diesen Begriff hat niemand gefunden.' });
  return [statusBar(), nav, cards,
    el('p', { class: 'muted', text: 'Ein Fund gilt, solange nicht mehr Leute „Gilt nicht“ als „Gilt“ sagen. Eigene Stimmen zählen nicht.' })];
}
function findVisual(f) {
  const img = f.hasImg && S.imgs[f.id];
  if (img) return el('img', { class: 'shot', src: img, alt: 'Fund von ' + nameOf(f.uid), onclick: () => lightbox(img) });
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
  // Time is up: every open device switches to review (same value, so races are harmless).
  if (!left && !autoFired && S.game.status === 'hunt') {
    autoFired = true;
    toast('Zeit um! Auf zur Auswertung.');
    updateGame({ status: 'review', reviewIdx: 0 });
  }
  if (left) autoFired = false;
}
setInterval(tick, 1000);

/* ---------------- start ---------------- */
(async () => {
  render();
  try {
    await net.connect(Number(params.get('b')) || 0, BROKER_OVERRIDE);
  } catch (_) {
    $('#mode').textContent = 'Keine Verbindung';
    $('#mode').classList.add('error');
    toast('Keine Verbindung zum Spielserver. Prüf dein Internet und lade die Seite neu.');
    return;
  }
  const code = (params.get('spiel') || '').toUpperCase();
  // Returning player (e.g. after a reload or coming back from the Maps app): rejoin directly.
  if (/^[A-Z0-9]{5}$/.test(code) && (loadJson('sj-me-' + code) || loadJson('sj-host-' + code))) {
    const ok = await openGame(code);
    if (!ok) closeGame();
  }
  render();
})();
