/* GOLAZO — World Cup 2026 prediction game for friends.
 * Zero dependencies: Node 18+ built-ins only. Storage = data.json next to this file.
 * Run: node server.js   (PORT env var optional, default 8090)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8090;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------------- seed fixtures (real WC2026 schedule, times in UTC) ---------------- */
const SEED_MATCHES = [
  ['A', 'Mexico', 'South Africa', '2026-06-11T21:35:00Z'],
  ['A', 'South Korea', 'Czech Republic', '2026-06-12T00:35:00Z'],
  ['B', 'Canada', 'Bosnia & Herzegovina', '2026-06-12T19:00:00Z'],
  ['D', 'USA', 'Paraguay', '2026-06-13T01:00:00Z'],
  ['B', 'Qatar', 'Switzerland', '2026-06-13T19:00:00Z'],
  ['C', 'Brazil', 'Morocco', '2026-06-13T22:00:00Z'],
  ['C', 'Haiti', 'Scotland', '2026-06-14T01:00:00Z'],
  ['D', 'Australia', 'Turkey', '2026-06-14T04:00:00Z'],
  ['E', 'Germany', 'Curacao', '2026-06-14T17:00:00Z'],
  ['F', 'Netherlands', 'Japan', '2026-06-14T20:00:00Z'],
  ['E', 'Ivory Coast', 'Ecuador', '2026-06-14T23:00:00Z'],
  ['F', 'Sweden', 'Tunisia', '2026-06-15T02:00:00Z'],
  ['H', 'Spain', 'Cape Verde', '2026-06-15T16:00:00Z'],
  ['G', 'Belgium', 'Egypt', '2026-06-15T19:00:00Z'],
  ['H', 'Saudi Arabia', 'Uruguay', '2026-06-15T22:00:00Z'],
  ['G', 'Iran', 'New Zealand', '2026-06-16T01:00:00Z'],
  ['I', 'France', 'Senegal', '2026-06-16T19:00:00Z'],
  ['I', 'Iraq', 'Norway', '2026-06-16T22:00:00Z'],
  ['J', 'Argentina', 'Algeria', '2026-06-17T01:00:00Z'],
  ['J', 'Austria', 'Jordan', '2026-06-17T04:00:00Z'],
  ['K', 'Portugal', 'DR Congo', '2026-06-17T17:00:00Z'],
  ['L', 'England', 'Croatia', '2026-06-17T20:00:00Z'],
  ['L', 'Ghana', 'Panama', '2026-06-17T23:00:00Z'],
  ['K', 'Uzbekistan', 'Colombia', '2026-06-18T02:00:00Z'],
  ['A', 'Czech Republic', 'South Africa', '2026-06-18T16:00:00Z'],
  ['B', 'Switzerland', 'Bosnia & Herzegovina', '2026-06-18T19:00:00Z'],
  ['B', 'Canada', 'Qatar', '2026-06-18T22:00:00Z'],
  ['A', 'Mexico', 'South Korea', '2026-06-19T01:00:00Z'],
  ['D', 'USA', 'Australia', '2026-06-19T19:00:00Z'],
  ['C', 'Scotland', 'Morocco', '2026-06-19T22:00:00Z'],
  ['C', 'Brazil', 'Haiti', '2026-06-20T00:30:00Z'],
  ['D', 'Turkey', 'Paraguay', '2026-06-20T03:00:00Z'],
  ['F', 'Netherlands', 'Sweden', '2026-06-20T17:00:00Z'],
  ['E', 'Germany', 'Ivory Coast', '2026-06-20T20:00:00Z'],
];

/* ---------------- scoring config (hardest -> easiest) ---------------- */
const POINTS = {
  exact: 10,        // exact final score
  first: 8,         // your first-goalscorer pick scores the opening goal
  margin: 5,        // right outcome AND right goal difference (not exact)
  anytime: 4,       // your anytime-scorer pick scores at any point
  outcome: 2,       // just the right result (win/draw/win)
  perfectBonus: 5,  // exact score + first scorer both correct
  champion: 30,     // tournament winner
  goldenBoot: 20,   // top scorer of the tournament
};

/* ---------------- storage ---------------- */
let db;
function load() {
  if (fs.existsSync(DATA_FILE)) {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return;
  }
  db = {
    settings: {
      adminPass: 'golazo2026',
      // champion + golden boot picks lock when the group stage ends
      tournamentDeadline: '2026-06-28T00:00:00Z',
      champion: '',     // filled by admin when the cup is decided
      goldenBoot: '',   // filled by admin at tournament end
    },
    players: {},      // key -> {name, pin, token, champion, goldenBoot}
    matches: SEED_MATCHES.map(([group, home, away, kickoff], i) => ({
      id: 'm' + (i + 1), group, home, away, kickoff, result: null,
      // result: {home, away, scorers: ["name", ...], firstScorer: "name"}
    })),
    predictions: {},  // matchId -> playerKey -> {home, away, scorer, firstScorer}
  };
  save();
}
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

/* ---------------- helpers ---------------- */
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Forgiving player-name matching: "mbappe" == "Kylian Mbappé" == "K. Mbappe"
function nameMatch(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const lastA = a.split(/\s+/).pop(), lastB = b.split(/\s+/).pop();
  return lastA === lastB || a.includes(b) || b.includes(a);
}

function playerByToken(token) {
  if (!token) return null;
  const key = Object.keys(db.players).find((k) => db.players[k].token === token);
  return key ? { key, ...db.players[key] } : null;
}

function isLocked(match) {
  return Date.now() >= new Date(match.kickoff).getTime();
}

function scoreMatch(pred, result) {
  if (!pred || !result) return null;
  const s = { outcome: 0, margin: 0, exact: 0, anytime: 0, first: 0, bonus: 0, total: 0 };
  const predSign = Math.sign(pred.home - pred.away);
  const resSign = Math.sign(result.home - result.away);
  const exact = pred.home === result.home && pred.away === result.away;
  if (exact) s.exact = POINTS.exact;
  else if (predSign === resSign && pred.home - pred.away === result.home - result.away) s.margin = POINTS.margin;
  else if (predSign === resSign) s.outcome = POINTS.outcome;
  const scorers = result.scorers || [];
  if (pred.scorer && scorers.some((x) => nameMatch(pred.scorer, x))) s.anytime = POINTS.anytime;
  const firstHit = pred.firstScorer && result.firstScorer && nameMatch(pred.firstScorer, result.firstScorer);
  if (firstHit) s.first = POINTS.first;
  if (exact && firstHit) s.bonus = POINTS.perfectBonus;
  s.total = s.outcome + s.margin + s.exact + s.anytime + s.first + s.bonus;
  return s;
}

function tournamentPoints(p) {
  let pts = 0;
  if (db.settings.champion && p.champion && norm(p.champion) === norm(db.settings.champion)) pts += POINTS.champion;
  if (db.settings.goldenBoot && p.goldenBoot && nameMatch(p.goldenBoot, db.settings.goldenBoot)) pts += POINTS.goldenBoot;
  return pts;
}

function leaderboard() {
  return Object.entries(db.players).map(([key, p]) => {
    let total = 0, exact = 0, firsts = 0, played = 0;
    for (const m of db.matches) {
      const sc = scoreMatch((db.predictions[m.id] || {})[key], m.result);
      if (!sc) continue;
      played++;
      total += sc.total;
      if (sc.exact) exact++;
      if (sc.first) firsts++;
    }
    total += tournamentPoints(p);
    return { name: p.name, total, exact, firsts, played };
  }).sort((a, b) => b.total - a.total || b.exact - a.exact || b.firsts - a.firsts || a.name.localeCompare(b.name));
}

/* ---------------- request plumbing ---------------- */
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

/* ---------------- API ---------------- */
const routes = {
  /* Join (or log back in): name + 4-digit pin. Returns a token the client stores. */
  'POST /api/join': async (req, body) => {
    const name = String(body.name || '').trim().slice(0, 24);
    const pin = String(body.pin || '').trim();
    if (!name || !/^\d{4}$/.test(pin)) return [400, { error: 'Need a name and a 4-digit PIN.' }];
    const key = norm(name);
    const existing = db.players[key];
    if (existing) {
      if (existing.pin !== pin) return [403, { error: 'That name is taken and the PIN does not match.' }];
      return [200, { token: existing.token, name: existing.name }];
    }
    const token = crypto.randomBytes(16).toString('hex');
    db.players[key] = { name, pin, token, champion: '', goldenBoot: '' };
    save();
    return [200, { token, name }];
  },

  /* Full game state for the requesting player. */
  'GET /api/state': async (req, body, query) => {
    const me = playerByToken(query.token);
    const now = Date.now();
    const matches = db.matches
      .slice()
      .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
      .map((m) => {
        const locked = isLocked(m) || !!m.result; // a posted result locks the match too
        const preds = db.predictions[m.id] || {};
        const out = { id: m.id, group: m.group, home: m.home, away: m.away, kickoff: m.kickoff, locked, result: m.result };
        if (me && preds[me.key]) out.mine = preds[me.key];
        if (locked) {
          // After kickoff everyone's picks go public — that's the banter.
          out.all = Object.entries(preds).map(([k, p]) => ({
            name: (db.players[k] || { name: k }).name,
            ...p,
            points: scoreMatch(p, m.result),
          })).sort((a, b) => ((b.points && b.points.total) || 0) - ((a.points && a.points.total) || 0));
        }
        return out;
      });
    const tournamentLocked = now >= new Date(db.settings.tournamentDeadline).getTime();
    return [200, {
      me: me ? { name: me.name, champion: me.champion, goldenBoot: me.goldenBoot } : null,
      matches,
      leaderboard: leaderboard(),
      points: POINTS,
      tournament: {
        deadline: db.settings.tournamentDeadline,
        locked: tournamentLocked,
        champion: db.settings.champion,
        goldenBoot: db.settings.goldenBoot,
        // Picks are public once locked
        picks: tournamentLocked
          ? Object.values(db.players).map((p) => ({ name: p.name, champion: p.champion, goldenBoot: p.goldenBoot }))
          : null,
      },
    }];
  },

  /* Save a match prediction. Rejected once the match kicks off. */
  'POST /api/predict': async (req, body) => {
    const me = playerByToken(body.token);
    if (!me) return [401, { error: 'Join the game first.' }];
    const m = db.matches.find((x) => x.id === body.matchId);
    if (!m) return [404, { error: 'Unknown match.' }];
    if (isLocked(m) || m.result) return [403, { error: 'Too late — the match has kicked off! ⏱️' }];
    const home = Number(body.home), away = Number(body.away);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home > 15 || away > 15) {
      return [400, { error: 'Scores must be whole numbers between 0 and 15.' }];
    }
    db.predictions[m.id] = db.predictions[m.id] || {};
    db.predictions[m.id][me.key] = {
      home, away,
      scorer: String(body.scorer || '').trim().slice(0, 40),
      firstScorer: String(body.firstScorer || '').trim().slice(0, 40),
    };
    save();
    return [200, { ok: true }];
  },

  /* Champion + golden boot picks. Locked at the tournament deadline. */
  'POST /api/tournament': async (req, body) => {
    const me = playerByToken(body.token);
    if (!me) return [401, { error: 'Join the game first.' }];
    if (Date.now() >= new Date(db.settings.tournamentDeadline).getTime()) {
      return [403, { error: 'Tournament picks are locked.' }];
    }
    db.players[me.key].champion = String(body.champion || '').trim().slice(0, 40);
    db.players[me.key].goldenBoot = String(body.goldenBoot || '').trim().slice(0, 40);
    save();
    return [200, { ok: true }];
  },

  /* Admin: enter (or correct) a final result. Scoring is computed on the fly, so
   * editing a result automatically re-scores everyone. */
  'POST /api/admin/result': async (req, body) => {
    if (body.adminPass !== db.settings.adminPass) return [403, { error: 'Wrong admin password.' }];
    const m = db.matches.find((x) => x.id === body.matchId);
    if (!m) return [404, { error: 'Unknown match.' }];
    if (body.clear) { m.result = null; save(); return [200, { ok: true }]; }
    const home = Number(body.home), away = Number(body.away);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
      return [400, { error: 'Bad score.' }];
    }
    const scorers = String(body.scorers || '').split(',').map((s) => s.trim()).filter(Boolean);
    m.result = { home, away, scorers, firstScorer: String(body.firstScorer || '').trim() || (scorers[0] || '') };
    save();
    return [200, { ok: true }];
  },

  /* Admin: add a fixture (knockouts!) or edit one (kickoff time corrections). */
  'POST /api/admin/match': async (req, body) => {
    if (body.adminPass !== db.settings.adminPass) return [403, { error: 'Wrong admin password.' }];
    if (body.id) {
      const m = db.matches.find((x) => x.id === body.id);
      if (!m) return [404, { error: 'Unknown match.' }];
      if (body.delete) { db.matches = db.matches.filter((x) => x.id !== body.id); delete db.predictions[body.id]; save(); return [200, { ok: true }]; }
      if (body.home) m.home = body.home;
      if (body.away) m.away = body.away;
      if (body.group) m.group = body.group;
      if (body.kickoff) m.kickoff = body.kickoff;
      save();
      return [200, { ok: true }];
    }
    if (!body.home || !body.away || !body.kickoff) return [400, { error: 'Need home, away, kickoff.' }];
    const id = 'm' + (Math.max(0, ...db.matches.map((x) => Number(x.id.slice(1)) || 0)) + 1);
    db.matches.push({ id, group: String(body.group || 'KO'), home: body.home, away: body.away, kickoff: body.kickoff, result: null });
    save();
    return [200, { ok: true, id }];
  },

  /* Admin: declare the champion + golden boot at the end of the tournament. */
  'POST /api/admin/awards': async (req, body) => {
    if (body.adminPass !== db.settings.adminPass) return [403, { error: 'Wrong admin password.' }];
    db.settings.champion = String(body.champion || '').trim();
    db.settings.goldenBoot = String(body.goldenBoot || '').trim();
    save();
    return [200, { ok: true }];
  },
};

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = routes[req.method + ' ' + url.pathname];
  if (route) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const query = Object.fromEntries(url.searchParams);
      const [code, payload] = await route(req, body, query);
      return json(res, code, payload);
    } catch (e) {
      console.error(e);
      return json(res, 500, { error: 'Server error.' });
    }
  }
  // static files
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.join(PUBLIC_DIR, path.normalize(file).replace(/^([.][.][/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

load();
server.listen(PORT, () => {
  console.log(`\n  ⚽ GOLAZO is running:  http://localhost:${PORT}`);
  console.log(`  Friends on your wifi can use your LAN IP, e.g. http://<your-ip>:${PORT}`);
  console.log(`  Admin password: ${db.settings.adminPass}  (change it in data.json)\n`);
});
