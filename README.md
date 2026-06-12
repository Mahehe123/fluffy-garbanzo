# ⚽ GOLAZO — World Cup 2026 prediction game

A prediction game for a group of friends. No accounts, no database, no dependencies —
one Node.js file and a JSON file. Built for banter, not for money.

## Run it

```
python server.py
```

(There's an identical Node version too if you prefer: `node server.js`. Same API,
same `data.json` — pick one.)

Open http://localhost:8090. Friends on the same wifi use your LAN IP
(`ipconfig` → IPv4 address → `http://192.168.x.x:8090`).

## Host it for free (so your PC can stay off)

**Render** (render.com) free tier — no credit card, free subdomain, enough hours
to run all month:

1. Push this folder to a GitHub repo (it can be private).
2. On render.com: **New → Web Service**, connect the repo.
3. Settings: Language **Python 3**, build command `pip install -r requirements.txt`,
   start command `python server.py`. Pick the **Free** instance type.
4. Deploy. Your game is at `https://<name>.onrender.com` — share that with the group.

Two free-tier quirks, both handled:

- **It sleeps after 15 min idle.** First visitor after a quiet spell waits ~30–60s
  while it wakes up. Result fetching is triggered by page loads too (not just the
  internal timer), so the moment someone opens the app after a match, scores fill in.
- **The disk is wiped on every redeploy.** `data.json` is the whole game, so after
  each matchday tap **💾 Download backup** in the Admin tab. If the host ever resets,
  **♻️ Restore backup** brings every player, pick and point back in one tap.

(Avoid PythonAnywhere's free tier: it blocks outbound API calls, which kills the
ESPN auto-fetch. If you ever want bulletproof persistence, an Oracle Cloud
always-free VM works too — just more setup.)

## How to play

1. **Join** with a name + 4-digit PIN (the PIN is just so nobody impersonates you).
2. **Predict** each match before kickoff: exact score, first goalscorer, anytime scorer.
3. Picks are **hidden until kickoff**, then everyone's go public on the match card.
4. **Results fill themselves in**: the server checks ESPN's public scoreboard
   every 15 minutes — but only inside the match window (from the day's first
   kickoff until ~30 min after the last match finishes; overnight it does
   nothing). It also checks on page loads, so it works on free hosts that sleep
   between visits. It writes in the score + scorers for finished matches and
   keeps kickoff times in sync. The Admin tab has a "fetch now" button, plus
   manual entry for corrections — manual always wins. Turn polling off with
   `"autoFetch": false` in `data.json`. (Auto-fetch is in the Python server only;
   the Node twin is manual-entry.)
5. **Champion & Golden Boot** picks lock when the group stage ends (June 28).

Default admin password: `golazo2026` — change it in `data.json` (`settings.adminPass`).

## Scoring (hardest → easiest)

| Call | Points |
|---|---|
| 🎯 Exact final score | 10 |
| ⚽ First goalscorer | 8 |
| 📏 Right outcome + right goal margin | 5 |
| 🥅 Anytime scorer | 4 |
| ✅ Right outcome only (win/draw/win) | 2 |
| 💎 Perfect bonus (exact score **and** first scorer) | +5 |
| 🏆 Champion | 30 |
| 👟 Golden Boot | 20 |

Exact / margin / outcome don't stack (best one counts). Scorer points stack on top.
Max from one match: 10 + 8 + 4 + 5 = **27**.

Player-name matching is forgiving: `mbappe` matches `Kylian Mbappé`. Edit point
values in `server.js` (`POINTS` at the top).

## House rules (suggested)

- Result = 90 min + stoppage; knockouts include extra time, pens decide the
  "winner" but don't add goals.
- Own goals count for nobody (auto-fetch records them as "Own Goal"; first-scorer
  points go to the first *proper* goal).
- Admin's word is final. Bribes accepted in beer.

## Data & fixtures

- Group-stage fixtures June 11–20 are pre-seeded with the real schedule (UTC kickoffs,
  shown in each player's local time).
- Add later fixtures and knockout matches from the Admin tab.
- Everything lives in `data.json` — back it up, or hand-edit it if the admin fat-fingers
  something.
