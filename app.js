/* GOLAZO frontend — vanilla JS, no build step */

const FLAGS = {
  'mexico': '🇲🇽', 'south africa': '🇿🇦', 'south korea': '🇰🇷', 'czech republic': '🇨🇿',
  'canada': '🇨🇦', 'bosnia & herzegovina': '🇧🇦', 'usa': '🇺🇸', 'paraguay': '🇵🇾',
  'qatar': '🇶🇦', 'switzerland': '🇨🇭', 'brazil': '🇧🇷', 'morocco': '🇲🇦',
  'haiti': '🇭🇹', 'scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'australia': '🇦🇺', 'turkey': '🇹🇷',
  'germany': '🇩🇪', 'curacao': '🇨🇼', 'netherlands': '🇳🇱', 'japan': '🇯🇵',
  'ivory coast': '🇨🇮', 'ecuador': '🇪🇨', 'sweden': '🇸🇪', 'tunisia': '🇹🇳',
  'spain': '🇪🇸', 'cape verde': '🇨🇻', 'belgium': '🇧🇪', 'egypt': '🇪🇬',
  'saudi arabia': '🇸🇦', 'uruguay': '🇺🇾', 'iran': '🇮🇷', 'new zealand': '🇳🇿',
  'france': '🇫🇷', 'senegal': '🇸🇳', 'iraq': '🇮🇶', 'norway': '🇳🇴',
  'argentina': '🇦🇷', 'algeria': '🇩🇿', 'austria': '🇦🇹', 'jordan': '🇯🇴',
  'portugal': '🇵🇹', 'dr congo': '🇨🇩', 'england': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'croatia': '🇭🇷',
  'ghana': '🇬🇭', 'panama': '🇵🇦', 'uzbekistan': '🇺🇿', 'colombia': '🇨🇴',
};
const flag = (t) => FLAGS[t.toLowerCase()] || '🏳️';

/* Windows doesn't render flag emoji, so prefer flagcdn images with emoji fallback */
const CODES = {
  'mexico': 'mx', 'south africa': 'za', 'south korea': 'kr', 'czech republic': 'cz',
  'canada': 'ca', 'bosnia & herzegovina': 'ba', 'usa': 'us', 'paraguay': 'py',
  'qatar': 'qa', 'switzerland': 'ch', 'brazil': 'br', 'morocco': 'ma',
  'haiti': 'ht', 'scotland': 'gb-sct', 'australia': 'au', 'turkey': 'tr',
  'germany': 'de', 'curacao': 'cw', 'netherlands': 'nl', 'japan': 'jp',
  'ivory coast': 'ci', 'ecuador': 'ec', 'sweden': 'se', 'tunisia': 'tn',
  'spain': 'es', 'cape verde': 'cv', 'belgium': 'be', 'egypt': 'eg',
  'saudi arabia': 'sa', 'uruguay': 'uy', 'iran': 'ir', 'new zealand': 'nz',
  'france': 'fr', 'senegal': 'sn', 'iraq': 'iq', 'norway': 'no',
  'argentina': 'ar', 'algeria': 'dz', 'austria': 'at', 'jordan': 'jo',
  'portugal': 'pt', 'dr congo': 'cd', 'england': 'gb-eng', 'croatia': 'hr',
  'ghana': 'gh', 'panama': 'pa', 'uzbekistan': 'uz', 'colombia': 'co',
};
function flagHtml(team) {
  const k = team.toLowerCase();
  const code = CODES[k];
  if (!code) return flag(team);
  return `<img class="flagimg" src="https://flagcdn.com/56x42/${code}.png" alt="" onerror="this.outerHTML='${flag(team)}'">`;
}

let state = null;
let tab = 'matches';
const token = () => localStorage.getItem('golazo_token') || '';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = ''), 2600);
}

async function api(path, body) {
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {};
  const r = await fetch(path, opts);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}

async function refresh() {
  state = await api('/api/state?token=' + encodeURIComponent(token()));
  if (!state.me) {
    localStorage.removeItem('golazo_token');
    $('#joinScreen').classList.remove('hidden');
    $('#app').classList.add('hidden');
    $('#tabs').classList.add('hidden');
    return;
  }
  $('#joinScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#tabs').classList.remove('hidden');
  const lead = state.leaderboard[0];
  $('#headerSub').textContent = lead && lead.total > 0
    ? `👑 ${lead.name} leads with ${lead.total} pts`
    : 'World Cup 2026 · predictions with the lads';
  render();
}

/* ---------------- rendering ---------------- */
function render() {
  const v = $('#view');
  if (tab === 'matches') v.innerHTML = renderMatches();
  if (tab === 'table') v.innerHTML = renderTable();
  if (tab === 'picks') v.innerHTML = renderPicks();
  if (tab === 'rules') v.innerHTML = renderRules();
  if (tab === 'admin') v.innerHTML = renderAdmin();
  wire();
}

function fmtDay(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function countdown(iso) {
  let ms = new Date(iso) - Date.now();
  if (ms <= 0) return '';
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
  return '🔒 locks in ' + (d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`);
}

function renderMatches() {
  let html = '', lastDay = '';
  for (const m of state.matches) {
    const day = fmtDay(m.kickoff);
    if (day !== lastDay) { html += `<div class="day-head">${day}</div>`; lastDay = day; }
    html += matchCard(m);
  }
  return html || '<p class="muted">No fixtures yet.</p>';
}

function matchCard(m) {
  const mine = m.mine;
  let status, mid;
  if (m.result) {
    status = `<span class="chip done">FT</span>`;
    mid = `<div class="score-mid">${m.result.home} – ${m.result.away}</div>`;
  } else if (m.locked) {
    status = `<span class="chip live">IN PLAY / AWAITING RESULT</span>`;
    mid = `<div class="score-mid"><span class="vs">vs</span></div>`;
  } else {
    status = `<span class="chip">Group ${esc(m.group)}</span>`;
    mid = `<div class="score-mid">
      <input type="number" min="0" max="15" inputmode="numeric" id="h_${m.id}" value="${mine ? mine.home : ''}" placeholder="–">
      :
      <input type="number" min="0" max="15" inputmode="numeric" id="a_${m.id}" value="${mine ? mine.away : ''}" placeholder="–">
    </div>`;
  }

  let body = '';
  if (!m.locked) {
    body = `
      <div class="scorer-row">
        <div><label>First goalscorer (8 pts)</label>
          <input id="f_${m.id}" placeholder="e.g. Mbappé" value="${esc(mine?.firstScorer)}"></div>
        <div><label>Anytime scorer (4 pts)</label>
          <input id="s_${m.id}" placeholder="e.g. Vinícius" value="${esc(mine?.scorer)}"></div>
      </div>
      <div class="actions">
        <button class="primary" data-save="${m.id}">${mine ? 'Update pick' : 'Lock it in'}</button>
        ${mine ? '<span class="saved-note">✓ saved</span>' : ''}
        <span class="countdown">${countdown(m.kickoff)}</span>
      </div>`;
  } else {
    const rows = (m.all || []).map((p) => {
      const pts = p.points;
      const detail = [];
      if (pts) {
        if (pts.exact) detail.push('exact!');
        else if (pts.margin) detail.push('margin');
        else if (pts.outcome) detail.push('outcome');
        if (pts.first) detail.push('1st scorer');
        else if (pts.anytime) detail.push('scorer');
        if (pts.bonus) detail.push('PERFECT +5');
      }
      const picks = `${p.home}–${p.away}` +
        (p.firstScorer ? ` · 1st: ${esc(p.firstScorer)}` : '') +
        (p.scorer ? ` · any: ${esc(p.scorer)}` : '');
      const ptHtml = pts
        ? `<span class="pts ${pts.total ? 'good' : 'zero'}">${pts.total ? '+' + pts.total : '0'}${detail.length ? ' · ' + detail.join(', ') : ''}</span>`
        : '<span class="pts zero">…</span>';
      return `<div class="reveal-row"><span class="who">${esc(p.name)}</span><span class="pick">${picks}</span>${ptHtml}</div>`;
    }).join('');
    body = `
      ${m.result && m.result.scorers.length ? `<div class="result-line">⚽ ${m.result.scorers.map(esc).join(', ')} (first: ${esc(m.result.firstScorer)})${m.result.auto ? ' · 📡 auto' : ''}</div>` : ''}
      <div class="reveal">${rows || '<span class="muted">Nobody predicted this one. Cowards.</span>'}</div>`;
  }

  return `
  <div class="match" id="card_${m.id}">
    <div class="match-top">${status}<span>${fmtTime(m.kickoff)} your time</span></div>
    <div class="teams">
      <div class="team"><span class="flag">${flagHtml(m.home)}</span><span class="tname">${esc(m.home)}</span></div>
      ${mid}
      <div class="team"><span class="flag">${flagHtml(m.away)}</span><span class="tname">${esc(m.away)}</span></div>
    </div>
    ${body}
  </div>`;
}

function teamList() {
  const set = new Set();
  for (const m of state.matches) { set.add(m.home); set.add(m.away); }
  return [...set].sort();
}

/* squad cache + dropdown filler for the golden-boot picker */
const squadCache = {};
async function loadSquad(team, selectEl, selectedName) {
  selectEl.disabled = true;
  selectEl.innerHTML = '<option value="">loading squad…</option>';
  try {
    if (!squadCache[team]) squadCache[team] = await api('/api/squad?team=' + encodeURIComponent(team));
    const players = squadCache[team].players;
    const groups = { G: '🧤 Goalkeepers', D: '🛡️ Defenders', M: '⚙️ Midfielders', F: '🎯 Forwards' };
    let html = '<option value="">— pick a player —</option>';
    for (const [pos, label] of Object.entries(groups)) {
      const inPos = players.filter((p) => p.pos === pos);
      if (!inPos.length) continue;
      html += `<optgroup label="${label}">` + inPos.map((p) =>
        `<option value="${esc(p.name)}" ${p.name === selectedName ? 'selected' : ''}>${esc(p.name)}${p.jersey ? ' · #' + esc(p.jersey) : ''}</option>`).join('') + '</optgroup>';
    }
    const ungrouped = players.filter((p) => !groups[p.pos]);
    if (ungrouped.length) html += ungrouped.map((p) => `<option value="${esc(p.name)}" ${p.name === selectedName ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    selectEl.innerHTML = html;
    selectEl.disabled = false;
    return true;
  } catch (e) {
    selectEl.innerHTML = '<option value="">squad unavailable — type the name instead</option>';
    return false;
  }
}

function renderTable() {
  const medals = ['🥇', '🥈', '🥉'];
  const rows = state.leaderboard.map((p, i) => `
    <div class="lb-row ${p.name === state.me.name ? 'me' : ''}">
      <span class="lb-rank">${medals[i] || i + 1}</span>
      <span class="lb-name">${esc(p.name)}</span>
      <span class="lb-pts">${p.total}</span>
      <span class="lb-extra">${p.exact}× exact · ${p.firsts}× 1st</span>
    </div>`).join('');
  return `
    <div class="lb">
      <div class="lb-row head"><span>#</span><span>Player</span><span style="text-align:right">Pts</span><span style="text-align:right">Hits</span></div>
      ${rows || '<div class="lb-row"><span></span><span class="muted">No players yet</span></div>'}
    </div>
    <p class="muted" style="margin-top:10px;text-align:center">Ties broken by exact scores, then first-scorer hits.</p>`;
}

function renderPicks() {
  const t = state.tournament;
  const lockedNote = t.locked
    ? `<p class="muted">Picks locked ${fmtDay(t.deadline)}. Everyone's cards are on the table:</p>`
    : `<p class="muted">You can change these until <b>${fmtDay(t.deadline)}</b>. Champion = ${state.points.champion} pts, Golden Boot = ${state.points.goldenBoot} pts.</p>`;
  let body;
  if (t.locked) {
    body = (t.picks || []).map((p) => `
      <div class="reveal-row">
        <span class="who">${esc(p.name)}</span>
        <span class="pick">🏆 ${esc(p.champion) || '—'} · 👟 ${esc(p.goldenBoot) || '—'}</span>
      </div>`).join('');
    if (t.champion) body += `<p style="margin-top:12px">🏆 Champion: <b>${esc(t.champion)}</b> · 👟 Golden Boot: <b>${esc(t.goldenBoot)}</b></p>`;
  } else {
    const teamOpts = (sel) => '<option value="">— pick a country —</option>' + teamList().map((t) =>
      `<option value="${esc(t)}" ${t === sel ? 'selected' : ''}>${flag(t)} ${esc(t)}</option>`).join('');
    body = `
      <div class="field"><label>🏆 Who lifts the trophy? (${state.points.champion} pts)</label>
        <select id="pickChampion">${teamOpts(state.me.champion)}</select></div>
      <div class="field"><label>👟 Golden Boot — top scorer (${state.points.goldenBoot} pts). Pick the country first:</label>
        <select id="pickBootTeam">${teamOpts(state.me.goldenBootTeam)}</select></div>
      <div class="field">
        <select id="pickBoot" disabled><option value="">— pick a country first —</option></select>
        <input id="pickBootText" class="hidden" placeholder="Type the player's name" value="${esc(state.me.goldenBoot)}" style="margin-top:8px">
        <p class="muted" style="margin-top:6px"><a href="#" id="pickBootManual" style="color:inherit">Player not in the list? Type it manually</a></p>
      </div>
      <button class="primary" id="savePicks">Save tournament picks</button>`;
  }
  return `
    <div class="panel">
      <h3>⭐ Tournament picks</h3>
      ${lockedNote}
      ${body}
    </div>
    <div class="panel">
      <h3>Signed in as ${esc(state.me.name)}</h3>
      <button class="small" id="logoutBtn" style="margin-top:8px">Log out</button>
    </div>`;
}

function renderRules() {
  const P = state.points;
  return `
    <div class="panel">
      <h3>📜 How to win</h3>
      <p class="muted">Hardest calls pay the most. Score parts stack — a perfect card on one match is worth ${P.exact + P.first + P.anytime + P.perfectBonus} pts.</p>
      <table class="rules-table">
        <tr class="hard"><td>🎯 Exact final score</td><td>${P.exact}</td></tr>
        <tr class="hard"><td>⚽ First goalscorer</td><td>${P.first}</td></tr>
        <tr><td>📏 Right outcome + right goal margin</td><td>${P.margin}</td></tr>
        <tr><td>🥅 Anytime scorer</td><td>${P.anytime}</td></tr>
        <tr><td>✅ Just the right outcome (W/D/W)</td><td>${P.outcome}</td></tr>
        <tr class="hard"><td>💎 PERFECT bonus (exact score + first scorer)</td><td>+${P.perfectBonus}</td></tr>
        <tr class="hard"><td>🏆 Champion (locked end of groups)</td><td>${P.champion}</td></tr>
        <tr class="hard"><td>👟 Golden Boot (locked end of groups)</td><td>${P.goldenBoot}</td></tr>
      </table>
      <p class="muted" style="margin-top:12px">
        Exact / margin / outcome don't stack with each other — you get the best one you hit.
        Scorer picks lock at kickoff with the rest. Everyone's picks go public at kickoff. 90 minutes + stoppage only (extra time counts in knockouts, pens don't add goals — winner on pens counts as the "win").
        Player names are matched loosely — "mbappe" matches "Kylian Mbappé" — so don't sweat the spelling.
      </p>
    </div>`;
}

function renderAdmin() {
  const opts = state.matches.map((m) =>
    `<option value="${m.id}">${esc(m.home)} v ${esc(m.away)} (${fmtDay(m.kickoff)})${m.result ? ' ✓FT' : ''}</option>`).join('');
  return `
    <div class="panel">
      <h3>📡 Auto-fetch results</h3>
      <p class="muted">Results fill in by themselves: the server checks ESPN every 15 minutes — but only from the day's first kickoff until ~30 min after the last match finishes, never overnight. Use this button if you can't wait.</p>
      <div class="field"><label>Admin password</label><input id="admPass" type="password" placeholder="admin password"></div>
      <button class="primary" id="admFetch">Fetch results from ESPN now</button>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="small" id="admBackup" style="flex:1">💾 Download backup</button>
        <button class="small" id="admRestore" style="flex:1">♻️ Restore backup</button>
        <input type="file" id="admRestoreFile" accept=".json,application/json" class="hidden">
      </div>
      <p class="muted" style="margin-top:8px">On free hosting, grab a backup after each matchday — restoring it brings every player, pick and point back.</p>
    </div>
    <div class="panel">
      <h3>🛠️ Enter a result manually</h3>
      <p class="muted">For corrections or if ESPN is down. Manual entry wins over auto-fetch, and editing re-scores everyone automatically.</p>
      <div class="field"><label>Match</label><select id="admMatch">${opts}</select></div>
      <div class="field"><label>Final score (home : away)</label>
        <div style="display:flex;gap:8px">
          <input id="admHome" type="number" min="0" inputmode="numeric" placeholder="home" style="width:50%">
          <input id="admAway" type="number" min="0" inputmode="numeric" placeholder="away" style="width:50%">
        </div></div>
      <div class="field"><label>All scorers, comma-separated (in order)</label><input id="admScorers" placeholder="Mbappé, Mbappé, Saka"></div>
      <div class="field"><label>First scorer (defaults to first name above)</label><input id="admFirst" placeholder="Mbappé"></div>
      <button class="primary" id="admSave">Save result & score it 🧮</button>
    </div>
    <div class="panel">
      <h3>➕ Add a fixture (knockouts)</h3>
      <div class="field"><label>Home / Away</label>
        <div style="display:flex;gap:8px">
          <input id="admNewHome" placeholder="Home team" style="width:50%">
          <input id="admNewAway" placeholder="Away team" style="width:50%">
        </div></div>
      <div class="field"><label>Stage label</label><input id="admNewGroup" placeholder="R32 / QF / Final" value="KO"></div>
      <div class="field"><label>Kickoff (your local time)</label><input id="admNewKick" type="datetime-local"></div>
      <button class="primary" id="admAdd">Add fixture</button>
    </div>
    <div class="panel">
      <h3>👥 Manage players</h3>
      <p class="muted">Deleting a player removes them and all their predictions. No undo (well — except restoring a backup).</p>
      <div class="field"><label>Player</label>
        <select id="admPlayer">${state.leaderboard.map((p) => `<option value="${esc(p.name)}">${esc(p.name)} (${p.total} pts)</option>`).join('')}</select></div>
      <button class="primary" id="admDelPlayer" style="background:var(--red);color:#fff">Delete player 🗑️</button>
    </div>
    <div class="panel">
      <h3>🏅 Final awards</h3>
      <p class="muted">Set these once at the end of the tournament — champion & golden boot points pay out instantly.</p>
      <div class="field"><label>Champion</label><input id="admChampion" placeholder="e.g. Argentina"></div>
      <div class="field"><label>Golden Boot winner</label><input id="admBoot" placeholder="e.g. Haaland"></div>
      <button class="primary" id="admAwards">Declare awards</button>
    </div>`;
}

/* ---------------- event wiring ---------------- */
function wire() {
  document.querySelectorAll('[data-save]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.save;
      const home = $('#h_' + id).value, away = $('#a_' + id).value;
      if (home === '' || away === '') return toast('Fill in both scores first ⚽', true);
      try {
        await api('/api/predict', {
          token: token(), matchId: id,
          home: Number(home), away: Number(away),
          firstScorer: $('#f_' + id).value,
          scorer: $('#s_' + id).value,
        });
        toast('Prediction locked in 🔥');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });

  const sp = $('#savePicks');
  if (sp) {
    const bootTeam = $('#pickBootTeam'), bootSel = $('#pickBoot'), bootText = $('#pickBootText');
    const manualOn = () => { bootText.classList.remove('hidden'); bootSel.classList.add('hidden'); };
    // restore: load the squad for the saved country, or fall back to manual text
    if (state.me.goldenBootTeam) {
      loadSquad(state.me.goldenBootTeam, bootSel, state.me.goldenBoot).then((ok) => {
        if (ok && state.me.goldenBoot && bootSel.value !== state.me.goldenBoot) manualOn();
        if (!ok && state.me.goldenBoot) manualOn();
      });
    } else if (state.me.goldenBoot) {
      manualOn(); // legacy free-text pick with no country saved
    }
    bootTeam.onchange = () => {
      bootText.classList.add('hidden');
      bootSel.classList.remove('hidden');
      if (bootTeam.value) loadSquad(bootTeam.value, bootSel, '').then((ok) => { if (!ok) manualOn(); });
      else { bootSel.disabled = true; bootSel.innerHTML = '<option value="">— pick a country first —</option>'; }
    };
    $('#pickBootManual').onclick = (e) => { e.preventDefault(); manualOn(); bootText.focus(); };
    sp.onclick = async () => {
      const goldenBoot = bootText.classList.contains('hidden') ? bootSel.value : bootText.value;
      try {
        await api('/api/tournament', {
          token: token(),
          champion: $('#pickChampion').value,
          goldenBoot,
          goldenBootTeam: bootTeam.value,
        });
        toast('Tournament picks saved 🏆');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }

  const lo = $('#logoutBtn');
  if (lo) lo.onclick = () => { localStorage.removeItem('golazo_token'); location.reload(); };

  const admFetch = $('#admFetch');
  if (admFetch) admFetch.onclick = async () => {
    admFetch.disabled = true;
    admFetch.textContent = 'Fetching…';
    try {
      const r = await api('/api/admin/fetch', { adminPass: $('#admPass').value });
      toast(r.updated.length ? `Updated: ${r.updated.length} ⚡` : 'Nothing new from ESPN yet');
      await refresh();
    } catch (e) { toast(e.message, true); }
    admFetch.disabled = false;
    admFetch.textContent = 'Fetch results from ESPN now';
  };

  const admBackup = $('#admBackup');
  if (admBackup) admBackup.onclick = () => {
    if (!$('#admPass').value) return toast('Type the admin password first', true);
    const a = document.createElement('a');
    a.href = '/api/admin/backup?pass=' + encodeURIComponent($('#admPass').value);
    a.download = 'golazo-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
  };

  const admRestore = $('#admRestore');
  if (admRestore) admRestore.onclick = () => {
    if (!$('#admPass').value) return toast('Type the admin password first', true);
    $('#admRestoreFile').click();
  };
  const admRestoreFile = $('#admRestoreFile');
  if (admRestoreFile) admRestoreFile.onchange = async () => {
    const file = admRestoreFile.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const r = await api('/api/admin/restore', { adminPass: $('#admPass').value, data });
      toast(`Restored: ${r.players} players, ${r.matches} matches ♻️`);
      await refresh();
    } catch (e) { toast(e.message, true); }
    admRestoreFile.value = '';
  };

  const admSave = $('#admSave');
  if (admSave) admSave.onclick = async () => {
    try {
      await api('/api/admin/result', {
        adminPass: $('#admPass').value, matchId: $('#admMatch').value,
        home: Number($('#admHome').value), away: Number($('#admAway').value),
        scorers: $('#admScorers').value, firstScorer: $('#admFirst').value,
      });
      toast('Result saved — leaderboard updated 🧮');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };

  const admAdd = $('#admAdd');
  if (admAdd) admAdd.onclick = async () => {
    try {
      const kick = $('#admNewKick').value;
      await api('/api/admin/match', {
        adminPass: $('#admPass') ? $('#admPass').value : '',
        home: $('#admNewHome').value, away: $('#admNewAway').value,
        group: $('#admNewGroup').value,
        kickoff: kick ? new Date(kick).toISOString() : '',
      });
      toast('Fixture added 📅');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };

  const admDelPlayer = $('#admDelPlayer');
  if (admDelPlayer) admDelPlayer.onclick = async () => {
    const who = $('#admPlayer').value;
    if (!who) return toast('No player selected', true);
    if (!confirm(`Delete ${who} and all their predictions? This can't be undone.`)) return;
    try {
      const r = await api('/api/admin/player', { adminPass: $('#admPass').value, player: who, delete: true });
      toast(`${r.deleted} is gone 🗑️`);
      await refresh();
    } catch (e) { toast(e.message, true); }
  };

  const admAwards = $('#admAwards');
  if (admAwards) admAwards.onclick = async () => {
    try {
      await api('/api/admin/awards', {
        adminPass: $('#admPass').value,
        champion: $('#admChampion').value, goldenBoot: $('#admBoot').value,
      });
      toast('Awards declared 🏅');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
}

/* tabs */
document.querySelectorAll('#tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    tab = b.dataset.tab;
    render();
  };
});

/* join */
$('#joinBtn').onclick = async () => {
  try {
    const j = await api('/api/join', { name: $('#joinName').value, pin: $('#joinPin').value });
    localStorage.setItem('golazo_token', j.token);
    toast(`Welcome, ${j.name}! ⚽`);
    await refresh();
  } catch (e) { $('#joinError').textContent = e.message; }
};
$('#joinPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });

/* auto-refresh every 60s so results/leaderboard stay fresh-ish */
setInterval(() => { if (state && state.me) refresh().catch(() => {}); }, 60000);

refresh().catch((e) => {
  $('#joinScreen').classList.remove('hidden');
  console.error(e);
});
