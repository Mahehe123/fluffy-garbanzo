# GOLAZO — World Cup 2026 prediction game for friends.
# Zero dependencies: Python 3.9+ stdlib only. Storage = data.json next to this file.
# Run: python server.py   (PORT env var optional, default 8090)
import json
import os
import sys
import threading
import time
import urllib.request

# Windows consoles often default to cp1252, which can't print emoji
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import re
import secrets
import unicodedata
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", 8090))
BASE = Path(__file__).resolve().parent
DATA_FILE = BASE / "data.json"
PUBLIC_DIR = BASE / "public"

# ---------------- seed fixtures (real WC2026 schedule, times in UTC) ----------------
SEED_MATCHES = [
    ("A", "Mexico", "South Africa", "2026-06-11T19:00:00Z"),
    ("A", "South Korea", "Czech Republic", "2026-06-12T02:00:00Z"),
    ("B", "Canada", "Bosnia & Herzegovina", "2026-06-12T19:00:00Z"),
    ("D", "USA", "Paraguay", "2026-06-13T01:00:00Z"),
    ("B", "Qatar", "Switzerland", "2026-06-13T19:00:00Z"),
    ("C", "Brazil", "Morocco", "2026-06-13T22:00:00Z"),
    ("C", "Haiti", "Scotland", "2026-06-14T01:00:00Z"),
    ("D", "Australia", "Turkey", "2026-06-14T04:00:00Z"),
    ("E", "Germany", "Curacao", "2026-06-14T17:00:00Z"),
    ("F", "Netherlands", "Japan", "2026-06-14T20:00:00Z"),
    ("E", "Ivory Coast", "Ecuador", "2026-06-14T23:00:00Z"),
    ("F", "Sweden", "Tunisia", "2026-06-15T02:00:00Z"),
    ("H", "Spain", "Cape Verde", "2026-06-15T16:00:00Z"),
    ("G", "Belgium", "Egypt", "2026-06-15T19:00:00Z"),
    ("H", "Saudi Arabia", "Uruguay", "2026-06-15T22:00:00Z"),
    ("G", "Iran", "New Zealand", "2026-06-16T01:00:00Z"),
    ("I", "France", "Senegal", "2026-06-16T19:00:00Z"),
    ("I", "Iraq", "Norway", "2026-06-16T22:00:00Z"),
    ("J", "Argentina", "Algeria", "2026-06-17T01:00:00Z"),
    ("J", "Austria", "Jordan", "2026-06-17T04:00:00Z"),
    ("K", "Portugal", "DR Congo", "2026-06-17T17:00:00Z"),
    ("L", "England", "Croatia", "2026-06-17T20:00:00Z"),
    ("L", "Ghana", "Panama", "2026-06-17T23:00:00Z"),
    ("K", "Uzbekistan", "Colombia", "2026-06-18T02:00:00Z"),
    ("A", "Czech Republic", "South Africa", "2026-06-18T16:00:00Z"),
    ("B", "Switzerland", "Bosnia & Herzegovina", "2026-06-18T19:00:00Z"),
    ("B", "Canada", "Qatar", "2026-06-18T22:00:00Z"),
    ("A", "Mexico", "South Korea", "2026-06-19T01:00:00Z"),
    ("D", "USA", "Australia", "2026-06-19T19:00:00Z"),
    ("C", "Scotland", "Morocco", "2026-06-19T22:00:00Z"),
    ("C", "Brazil", "Haiti", "2026-06-20T00:30:00Z"),
    ("D", "Turkey", "Paraguay", "2026-06-20T03:00:00Z"),
    ("F", "Netherlands", "Sweden", "2026-06-20T17:00:00Z"),
    ("E", "Germany", "Ivory Coast", "2026-06-20T20:00:00Z"),
]

# ---------------- scoring config (hardest -> easiest) ----------------
POINTS = {
    "exact": 10,        # exact final score
    "first": 8,         # your first-goalscorer pick scores the opening goal
    "margin": 5,        # right outcome AND right goal difference (not exact)
    "anytime": 4,       # your anytime-scorer pick scores at any point
    "outcome": 2,       # just the right result (win/draw/win)
    "perfectBonus": 5,  # exact score + first scorer both correct
    "champion": 30,     # tournament winner
    "goldenBoot": 20,   # top scorer of the tournament
}

MIME = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
}

# ---------------- storage ----------------
db = {}


def load():
    global db
    if DATA_FILE.exists():
        db = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        return
    db = {
        "settings": {
            "adminPass": "golazo2026",
            "autoFetch": True,  # poll ESPN for finished results every 30 min
            # champion + golden boot picks lock when the group stage ends
            "tournamentDeadline": "2026-06-28T00:00:00Z",
            "champion": "",
            "goldenBoot": "",
        },
        "players": {},   # key -> {name, pin, token, champion, goldenBoot}
        "matches": [
            {"id": f"m{i + 1}", "group": g, "home": h, "away": a, "kickoff": k, "result": None}
            for i, (g, h, a, k) in enumerate(SEED_MATCHES)
        ],
        "predictions": {},  # matchId -> playerKey -> {home, away, scorer, firstScorer}
    }
    save()


def save():
    DATA_FILE.write_text(json.dumps(db, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------- helpers ----------------
def norm(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().strip()


def name_match(a, b):
    """Forgiving player-name matching: 'mbappe' == 'Kylian Mbappé' == 'K. Mbappe'."""
    a, b = norm(a), norm(b)
    if not a or not b:
        return False
    if a == b:
        return True
    last_a, last_b = a.split()[-1], b.split()[-1]
    return last_a == last_b or a in b or b in a


def player_by_token(token):
    if not token:
        return None
    for key, p in db["players"].items():
        if p["token"] == token:
            return {"key": key, **p}
    return None


def parse_iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def is_locked(match):
    return datetime.now(timezone.utc) >= parse_iso(match["kickoff"])


def sign(n):
    return (n > 0) - (n < 0)


def score_match(pred, result):
    if not pred or not result:
        return None
    s = {"outcome": 0, "margin": 0, "exact": 0, "anytime": 0, "first": 0, "bonus": 0, "total": 0}
    pred_sign = sign(pred["home"] - pred["away"])
    res_sign = sign(result["home"] - result["away"])
    exact = pred["home"] == result["home"] and pred["away"] == result["away"]
    if exact:
        s["exact"] = POINTS["exact"]
    elif pred_sign == res_sign and pred["home"] - pred["away"] == result["home"] - result["away"]:
        s["margin"] = POINTS["margin"]
    elif pred_sign == res_sign:
        s["outcome"] = POINTS["outcome"]
    scorers = result.get("scorers") or []
    if pred.get("scorer") and any(name_match(pred["scorer"], x) for x in scorers):
        s["anytime"] = POINTS["anytime"]
    first_hit = pred.get("firstScorer") and result.get("firstScorer") and name_match(pred["firstScorer"], result["firstScorer"])
    if first_hit:
        s["first"] = POINTS["first"]
    if exact and first_hit:
        s["bonus"] = POINTS["perfectBonus"]
    s["total"] = sum(v for k, v in s.items() if k != "total")
    return s


def tournament_points(p):
    pts = 0
    if db["settings"]["champion"] and p.get("champion") and norm(p["champion"]) == norm(db["settings"]["champion"]):
        pts += POINTS["champion"]
    if db["settings"]["goldenBoot"] and p.get("goldenBoot") and name_match(p["goldenBoot"], db["settings"]["goldenBoot"]):
        pts += POINTS["goldenBoot"]
    return pts


def leaderboard():
    rows = []
    for key, p in db["players"].items():
        total = exact = firsts = played = 0
        for m in db["matches"]:
            sc = score_match(db["predictions"].get(m["id"], {}).get(key), m["result"])
            if not sc:
                continue
            played += 1
            total += sc["total"]
            if sc["exact"]:
                exact += 1
            if sc["first"]:
                firsts += 1
        total += tournament_points(p)
        rows.append({"name": p["name"], "total": total, "exact": exact, "firsts": firsts, "played": played})
    rows.sort(key=lambda r: (-r["total"], -r["exact"], -r["firsts"], r["name"]))
    return rows


# ---------------- ESPN auto-fetch ----------------
ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates={dates}"
ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event={id}"
ESPN_TEAMS = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams"
ESPN_ROSTER = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/{id}/roster"

# ESPN team names (normed) -> our fixture names (normed)
TEAM_ALIASES = {
    "czechia": "czech republic",
    "united states": "usa",
    "bosnia-herzegovina": "bosnia & herzegovina",
    "bosnia and herzegovina": "bosnia & herzegovina",
    "turkiye": "turkey",
    "cote d'ivoire": "ivory coast",
    "cabo verde": "cape verde",
    "ir iran": "iran",
    "korea republic": "south korea",
    "congo dr": "dr congo",
    "democratic republic of the congo": "dr congo",
}


def espn_team(name):
    n = norm(name)
    return TEAM_ALIASES.get(n, n)


def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (golazo predictor)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def get_espn_team_ids():
    """Team name (normed) -> ESPN team id, fetched once and cached in data.json."""
    ids = db.setdefault("espnTeamIds", {})
    if not ids:
        data = http_json(ESPN_TEAMS)
        for t in data["sports"][0]["leagues"][0]["teams"]:
            ids[espn_team(t["team"]["displayName"])] = t["team"]["id"]
        save()
    return ids


def api_squad(body, query):
    """26-man squad for a team (for the golden-boot picker). Cached forever —
    squads are final once the tournament starts."""
    team = query.get("team", "")
    key = espn_team(team)
    squads = db.setdefault("squads", {})
    if key in squads:
        return 200, {"team": team, "players": squads[key]}
    try:
        team_id = get_espn_team_ids().get(key)
        if not team_id:
            return 404, {"error": f"ESPN doesn't know a team called {team}."}
        data = http_json(ESPN_ROSTER.format(id=team_id))
        players = [{
            "name": (a.get("fullName") or "").strip(),
            "pos": (a.get("position") or {}).get("abbreviation", ""),
            "jersey": a.get("jersey", ""),
        } for a in data.get("athletes") or []]
        players = [p for p in players if p["name"]]
        if not players:
            return 502, {"error": "ESPN returned an empty squad."}
        squads[key] = players
        save()
        return 200, {"team": team, "players": players}
    except Exception as e:  # noqa: BLE001 — client falls back to free-text entry
        return 502, {"error": f"Squad fetch failed: {e}"}


def goals_from_summary(event_id):
    """Goal scorers in chronological order. Own goals become 'Own Goal' (match
    nobody's pick), shootout kicks are excluded."""
    d = http_json(ESPN_SUMMARY.format(id=event_id))
    out = []
    for ev in d.get("keyEvents") or []:
        type_text = ((ev.get("type") or {}).get("text") or "").lower()
        is_og = "own goal" in type_text or ev.get("ownGoal")
        is_goal = type_text.startswith("goal") or type_text == "penalty - scored"
        if not (is_goal or is_og):
            continue
        if ((ev.get("period") or {}).get("number") or 1) >= 5:
            continue  # penalty shootout — doesn't add goals
        if is_og:
            out.append("Own Goal")
            continue
        names = [p.get("athlete", {}).get("displayName") for p in ev.get("participants") or [] if p.get("athlete")]
        out.append(names[0] if names else "Unknown")
    return out


def fetch_results():
    """Pull recent results from ESPN's public scoreboard. Fills in results for
    finished matches that don't have one yet (manual admin entry always wins),
    and corrects kickoff times for unplayed matches. Returns a change log."""
    updated = []
    now = datetime.now(timezone.utc)
    dates = f"{now - timedelta(days=2):%Y%m%d}-{now + timedelta(days=1):%Y%m%d}"
    data = http_json(ESPN_SCOREBOARD.format(dates=dates))
    for ev in data.get("events") or []:
        comp = (ev.get("competitions") or [{}])[0]
        sides = {c.get("homeAway"): c for c in comp.get("competitors") or []}
        if "home" not in sides or "away" not in sides:
            continue
        home_name = espn_team(sides["home"]["team"]["displayName"])
        away_name = espn_team(sides["away"]["team"]["displayName"])
        when = parse_iso(ev["date"])
        m = next((x for x in db["matches"]
                  if espn_team(x["home"]) == home_name and espn_team(x["away"]) == away_name
                  and abs(parse_iso(x["kickoff"]) - when) < timedelta(hours=30)), None)
        if not m:
            continue
        if not m["result"]:
            kickoff = when.strftime("%Y-%m-%dT%H:%M:%SZ")
            if m["kickoff"] != kickoff:
                m["kickoff"] = kickoff
                updated.append(f"kickoff time synced: {m['home']} v {m['away']}")
        status = (((comp.get("status") or ev.get("status") or {}).get("type")) or {}).get("name", "")
        if status == "STATUS_FULL_TIME" and not m["result"]:
            scorers = goals_from_summary(ev["id"])
            first = next((s for s in scorers if s not in ("Own Goal", "Unknown")), "")
            m["result"] = {
                "home": int(sides["home"].get("score") or 0),
                "away": int(sides["away"].get("score") or 0),
                "scorers": scorers, "firstScorer": first, "auto": True,
            }
            updated.append(f"result: {m['home']} {m['result']['home']}–{m['result']['away']} {m['away']}")
    if updated:
        save()
    return updated


# Polling is windowed: ESPN only gets called between the day's first kickoff and
# ~30 min after the last match could finish, never overnight. MATCH_DURATION covers
# a 90-min game (~2h real time), extra time + pens (~3h), plus the 30-min buffer.
MATCH_DURATION = timedelta(hours=3, minutes=30)
FETCH_ACTIVE_COOLDOWN = 15 * 60    # while a match is in play / just finished
FETCH_CATCHUP_COOLDOWN = 60 * 60   # mop-up for results missed while server slept

_last_fetch = 0.0
_fetch_lock = threading.Lock()


def fetch_cooldown(now=None):
    """Returns the polling cooldown if a fetch makes sense right now, else None."""
    now = now or datetime.now(timezone.utc)
    cooldown = None
    for m in db["matches"]:
        if m["result"]:
            continue
        ko = parse_iso(m["kickoff"])
        if ko <= now <= ko + MATCH_DURATION:
            return FETCH_ACTIVE_COOLDOWN
        if now > ko + MATCH_DURATION:
            cooldown = FETCH_CATCHUP_COOLDOWN
    return cooldown


def maybe_fetch():
    """Fetch results if we're inside a match window and the cooldown has passed.
    Called from the background loop AND on page loads, so it also works on free
    hosts (e.g. Render) that put the server to sleep between visits."""
    global _last_fetch
    if not db["settings"].get("autoFetch", True):
        return
    cooldown = fetch_cooldown()
    if cooldown is None or time.time() - _last_fetch < cooldown:
        return
    if not _fetch_lock.acquire(blocking=False):
        return  # another request is already fetching
    try:
        _last_fetch = time.time()
        for line in fetch_results():
            print("auto-fetch:", line, flush=True)
    except Exception as e:  # noqa: BLE001 — network hiccups must not break page loads
        print("auto-fetch error:", repr(e), flush=True)
    finally:
        _fetch_lock.release()


def auto_fetch_loop():
    while True:
        maybe_fetch()  # no-op outside match windows — the check itself is free
        time.sleep(300)


# ---------------- API handlers ----------------
def api_join(body, query):
    name = str(body.get("name", "")).strip()[:24]
    pin = str(body.get("pin", "")).strip()
    if not name or not re.fullmatch(r"\d{4}", pin):
        return 400, {"error": "Need a name and a 4-digit PIN."}
    key = norm(name)
    existing = db["players"].get(key)
    if existing:
        if existing["pin"] != pin:
            return 403, {"error": "That name is taken and the PIN does not match."}
        return 200, {"token": existing["token"], "name": existing["name"]}
    token = secrets.token_hex(16)
    db["players"][key] = {"name": name, "pin": pin, "token": token, "champion": "", "goldenBoot": ""}
    save()
    return 200, {"token": token, "name": name}


def api_state(body, query):
    maybe_fetch()  # keeps results fresh on hosts that sleep between visits
    me = player_by_token(query.get("token", ""))
    matches = []
    for m in sorted(db["matches"], key=lambda x: x["kickoff"]):
        locked = is_locked(m) or bool(m["result"])  # a posted result locks the match too
        preds = db["predictions"].get(m["id"], {})
        out = {"id": m["id"], "group": m["group"], "home": m["home"], "away": m["away"],
               "kickoff": m["kickoff"], "locked": locked, "result": m["result"]}
        if me and me["key"] in preds:
            out["mine"] = preds[me["key"]]
        if locked:
            # After kickoff everyone's picks go public — that's the banter.
            rows = []
            for k, p in preds.items():
                player = db["players"].get(k, {"name": k})
                rows.append({"name": player["name"], **p, "points": score_match(p, m["result"])})
            rows.sort(key=lambda r: -(r["points"]["total"] if r["points"] else 0))
            out["all"] = rows
        matches.append(out)
    locked_t = datetime.now(timezone.utc) >= parse_iso(db["settings"]["tournamentDeadline"])
    return 200, {
        "me": {"name": me["name"], "champion": me.get("champion", ""), "goldenBoot": me.get("goldenBoot", ""),
               "goldenBootTeam": me.get("goldenBootTeam", "")} if me else None,
        "matches": matches,
        "leaderboard": leaderboard(),
        "points": POINTS,
        "tournament": {
            "deadline": db["settings"]["tournamentDeadline"],
            "locked": locked_t,
            "champion": db["settings"]["champion"],
            "goldenBoot": db["settings"]["goldenBoot"],
            "picks": [
                {"name": p["name"], "champion": p.get("champion", ""), "goldenBoot": p.get("goldenBoot", "")}
                for p in db["players"].values()
            ] if locked_t else None,
        },
    }


def api_predict(body, query):
    me = player_by_token(body.get("token"))
    if not me:
        return 401, {"error": "Join the game first."}
    m = next((x for x in db["matches"] if x["id"] == body.get("matchId")), None)
    if not m:
        return 404, {"error": "Unknown match."}
    if is_locked(m) or m["result"]:
        return 403, {"error": "Too late — the match has kicked off! ⏱️"}
    home, away = body.get("home"), body.get("away")
    if not isinstance(home, int) or not isinstance(away, int) or not (0 <= home <= 15) or not (0 <= away <= 15):
        return 400, {"error": "Scores must be whole numbers between 0 and 15."}
    db["predictions"].setdefault(m["id"], {})[me["key"]] = {
        "home": home, "away": away,
        "scorer": str(body.get("scorer", "")).strip()[:40],
        "firstScorer": str(body.get("firstScorer", "")).strip()[:40],
    }
    save()
    return 200, {"ok": True}


def api_tournament(body, query):
    me = player_by_token(body.get("token"))
    if not me:
        return 401, {"error": "Join the game first."}
    if datetime.now(timezone.utc) >= parse_iso(db["settings"]["tournamentDeadline"]):
        return 403, {"error": "Tournament picks are locked."}
    db["players"][me["key"]]["champion"] = str(body.get("champion", "")).strip()[:40]
    db["players"][me["key"]]["goldenBoot"] = str(body.get("goldenBoot", "")).strip()[:40]
    db["players"][me["key"]]["goldenBootTeam"] = str(body.get("goldenBootTeam", "")).strip()[:40]
    save()
    return 200, {"ok": True}


def api_admin_result(body, query):
    if body.get("adminPass") != db["settings"]["adminPass"]:
        return 403, {"error": "Wrong admin password."}
    m = next((x for x in db["matches"] if x["id"] == body.get("matchId")), None)
    if not m:
        return 404, {"error": "Unknown match."}
    if body.get("clear"):
        m["result"] = None
        save()
        return 200, {"ok": True}
    home, away = body.get("home"), body.get("away")
    if not isinstance(home, int) or not isinstance(away, int) or home < 0 or away < 0:
        return 400, {"error": "Bad score."}
    scorers = [s.strip() for s in str(body.get("scorers", "")).split(",") if s.strip()]
    m["result"] = {
        "home": home, "away": away, "scorers": scorers,
        "firstScorer": str(body.get("firstScorer", "")).strip() or (scorers[0] if scorers else ""),
    }
    save()
    return 200, {"ok": True}


def api_admin_match(body, query):
    if body.get("adminPass") != db["settings"]["adminPass"]:
        return 403, {"error": "Wrong admin password."}
    if body.get("id"):
        m = next((x for x in db["matches"] if x["id"] == body["id"]), None)
        if not m:
            return 404, {"error": "Unknown match."}
        if body.get("delete"):
            db["matches"] = [x for x in db["matches"] if x["id"] != body["id"]]
            db["predictions"].pop(body["id"], None)
            save()
            return 200, {"ok": True}
        for field in ("home", "away", "group", "kickoff"):
            if body.get(field):
                m[field] = body[field]
        save()
        return 200, {"ok": True}
    if not body.get("home") or not body.get("away") or not body.get("kickoff"):
        return 400, {"error": "Need home, away, kickoff."}
    next_n = max([int(x["id"][1:]) for x in db["matches"]] + [0]) + 1
    match = {"id": f"m{next_n}", "group": str(body.get("group") or "KO"),
             "home": body["home"], "away": body["away"], "kickoff": body["kickoff"], "result": None}
    db["matches"].append(match)
    save()
    return 200, {"ok": True, "id": match["id"]}


def api_admin_fetch(body, query):
    if body.get("adminPass") != db["settings"]["adminPass"]:
        return 403, {"error": "Wrong admin password."}
    try:
        updated = fetch_results()
    except Exception as e:  # noqa: BLE001 — surface network errors to the admin
        return 502, {"error": f"ESPN fetch failed: {e}"}
    return 200, {"ok": True, "updated": updated}


def api_admin_backup(body, query):
    """Download the whole game as a JSON file (free hosts can lose the disk on
    redeploys — take a backup after big matchdays)."""
    if query.get("pass") != db["settings"]["adminPass"]:
        return 403, {"error": "Wrong admin password."}
    return 200, db


def api_admin_restore(body, query):
    if body.get("adminPass") != db["settings"]["adminPass"]:
        return 403, {"error": "Wrong admin password."}
    data = body.get("data")
    if not isinstance(data, dict) or not all(k in data for k in ("settings", "players", "matches", "predictions")):
        return 400, {"error": "That doesn't look like a GOLAZO backup file."}
    db.clear()
    db.update(data)
    save()
    return 200, {"ok": True, "players": len(db["players"]), "matches": len(db["matches"])}


def api_admin_player(body, query):
    """Remove a player and all their predictions (typo accounts, gatecrashers)."""
    if body.get("adminPass") != db["settings"]["adminPass"]:
        return 403, {"error": "Wrong admin password."}
    key = norm(body.get("player", ""))
    if key not in db["players"]:
        return 404, {"error": "No player by that name."}
    if not body.get("delete"):
        return 400, {"error": "Only delete is supported."}
    name = db["players"][key]["name"]
    del db["players"][key]
    for preds in db["predictions"].values():
        preds.pop(key, None)
    save()
    return 200, {"ok": True, "deleted": name}


def api_admin_awards(body, query):
    if body.get("adminPass") != db["settings"]["adminPass"]:
        return 403, {"error": "Wrong admin password."}
    db["settings"]["champion"] = str(body.get("champion", "")).strip()
    db["settings"]["goldenBoot"] = str(body.get("goldenBoot", "")).strip()
    save()
    return 200, {"ok": True}


ROUTES = {
    ("POST", "/api/join"): api_join,
    ("GET", "/api/state"): api_state,
    ("POST", "/api/predict"): api_predict,
    ("POST", "/api/tournament"): api_tournament,
    ("GET", "/api/squad"): api_squad,
    ("POST", "/api/admin/player"): api_admin_player,
    ("POST", "/api/admin/result"): api_admin_result,
    ("POST", "/api/admin/match"): api_admin_match,
    ("POST", "/api/admin/fetch"): api_admin_fetch,
    ("GET", "/api/admin/backup"): api_admin_backup,
    ("POST", "/api/admin/restore"): api_admin_restore,
    ("POST", "/api/admin/awards"): api_admin_awards,
}


# ---------------- server ----------------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # keep the console quiet

    def _json(self, code, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle(self, method):
        url = urlparse(self.path)
        route = ROUTES.get((method, url.path))
        if route:
            try:
                body = {}
                if method == "POST":
                    length = int(self.headers.get("Content-Length", 0) or 0)
                    raw = self.rfile.read(min(length, 1_000_000)) if length else b""
                    if raw:
                        # Browsers send UTF-8; some CLI clients send latin-1
                        try:
                            body = json.loads(raw.decode("utf-8"))
                        except UnicodeDecodeError:
                            body = json.loads(raw.decode("latin-1"))
                query = {k: v[0] for k, v in parse_qs(url.query).items()}
                code, payload = route(body, query)
                return self._json(code, payload)
            except Exception as e:  # noqa: BLE001 — report any handler failure as a 500
                print("ERROR:", repr(e), flush=True)
                return self._json(500, {"error": "Server error."})
        if method != "GET":
            return self._json(404, {"error": "Not found."})
        # static files
        rel = "index.html" if url.path == "/" else url.path.lstrip("/")
        file = (PUBLIC_DIR / rel).resolve()
        if not str(file).startswith(str(PUBLIC_DIR)) or not file.is_file():
            self.send_response(404)
            self.end_headers()
            return self.wfile.write(b"Not found")
        data = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(file.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


if __name__ == "__main__":
    load()
    threading.Thread(target=auto_fetch_loop, daemon=True).start()
    print(f"\n  ⚽ GOLAZO is running:  http://localhost:{PORT}")
    print(f"  Friends on your wifi can use your LAN IP, e.g. http://<your-ip>:{PORT}")
    print(f"  Admin password: {db['settings']['adminPass']}  (change it in data.json)\n")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
