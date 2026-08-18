#!/usr/bin/env python3
"""Serve LAG over HTTP and HTTPS, plus a local room relay for seeker/hider sync."""
import json
import secrets
import socket
import ssl
import subprocess
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
CERT = ROOT / "certs" / "cert.pem"
KEY = ROOT / "certs" / "key.pem"
LOG = ROOT / "access.log"
ROOM_FILE = ROOT / ".rooms.json"

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ROOM_TTL = 48 * 3600
MAX_ROOMS = 200
MAX_EVENTS = 250

LOCK = threading.Lock()
ROOMS = {}


def now():
    return time.time()


def lan_addresses():
    found = []
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        found.append(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in found:
                found.append(ip)
    except OSError:
        pass
    usable = []
    for ip in found:
        if ip.startswith("127.") or ip.startswith("169.254."):
            continue
        usable.append(ip)
    return usable


def ensure_certs():
    CERT.parent.mkdir(parents=True, exist_ok=True)
    if CERT.exists() and KEY.exists():
        return True
    sans = ["DNS:localhost", "IP:127.0.0.1"]
    try:
        host = socket.gethostname()
        if host:
            sans.append("DNS:" + host)
    except OSError:
        pass
    for ip in lan_addresses():
        sans.append("IP:" + ip)
    conf = CERT.parent / "openssl.cnf"
    conf.write_text(
        "[req]\n"
        "distinguished_name = req\n"
        "x509_extensions = v3\n"
        "prompt = no\n"
        "[req]\n"
        "CN = LAG Hide and Seek\n"
        "[v3]\n"
        "subjectAltName = %s\n" % ",".join(sans),
        encoding="utf-8",
    )
    try:
        subprocess.run(
            [
                "openssl", "req", "-x509", "-newkey", "rsa:2048", "-sha256",
                "-days", "825", "-nodes",
                "-keyout", str(KEY),
                "-out", str(CERT),
                "-subj", "/CN=LAG Hide and Seek",
                "-addext", "subjectAltName=" + ",".join(sans),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as err:
        print("could not create TLS certs:", err, flush=True)
        return False
    print("created self-signed cert for %s" % ", ".join(sans), flush=True)
    return CERT.exists() and KEY.exists()


TLS_ON = False
HTTPS_PORT = 8878
HTTP_PORT = 8877


def new_code():
    for _ in range(40):
        code = "".join(secrets.choice(ALPHABET) for _ in range(6))
        if code not in ROOMS:
            return code
    raise RuntimeError("could not allocate room code")


def new_token():
    return secrets.token_urlsafe(16)


def public_room(room):
    t = now()
    seekers = [p for p in room["players"] if p["role"] == "seeker"]
    hiders = [p for p in room["players"] if p["role"] == "hider"]
    return {
        "code": room["code"],
        "seq": room["seq"],
        "created": room["created"],
        "meta": room["meta"],
        "phase": room.get("phase") or "lobby",
        "seekers": len(seekers),
        "hiders": len(hiders),
        "seekerOnline": any(t - p["seen"] < 20 for p in seekers),
        "hiderOnline": any(t - p["seen"] < 20 for p in hiders),
        "pendingQuestion": room.get("pendingQuestion"),
        "lastAnswer": room.get("lastAnswer"),
        "activeCurses": room.get("activeCurses") or [],
        "timer": room.get("timer") or {},
        "bannedQuestions": room.get("bannedQuestions") or [],
        "disabledCategory": room.get("disabledCategory"),
        "overflowingLeft": room.get("overflowingLeft") or 0,
        "handCount": room.get("handCount") or 0,
        "deckLeft": room.get("deckLeft") or 0,
        "maxHand": room.get("maxHand") or 6,
        "log": (room.get("log") or [])[-40:],
        "move": room.get("move"),
        "seekerLocs": [
            {"lat": p["loc"]["lat"], "lng": p["loc"]["lng"], "acc": p["loc"].get("acc"), "at": (p.get("locAt") or 0) * 1000}
            for p in seekers if p.get("loc") and t - (p.get("locAt") or 0) < 180
        ],
    }


def persist():
    slim = []
    t_ms = int(now() * 1000)
    for room in ROOMS.values():
        if room.get("ended"):
            continue
        copy = {k: v for k, v in room.items() if k != "event"}
        ans = copy.get("lastAnswer")
        if isinstance(ans, dict) and ans.get("photo") and t_ms - int(ans.get("at") or 0) > 15 * 60 * 1000:
            ans = dict(ans)
            ans["photo"] = None
            copy["lastAnswer"] = ans
        slim.append(copy)
    try:
        ROOM_FILE.write_text(json.dumps(slim), encoding="utf-8")
    except OSError:
        pass


def load_rooms():
    if not ROOM_FILE.exists():
        return
    try:
        data = json.loads(ROOM_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(data, list):
        return
    for raw in data:
        if not isinstance(raw, dict) or not raw.get("code"):
            continue
        raw["event"] = threading.Event()
        ROOMS[raw["code"]] = raw


def present_players(room):
    t = now()
    living = []
    for p in room.get("players") or []:
        if p.get("left") or p.get("departed"):
            continue
        if t - (p.get("seen") or 0) >= 300:
            continue
        living.append(p)
    return living


def should_wipe(room):
    if not room:
        return True
    if room.get("ended"):
        return True
    if not (room.get("players") or []):
        return True
    return False


def should_wipe_on_leave(room):
    return should_wipe(room)


def prune():
    t = now()
    dead = [
        c for c, r in ROOMS.items()
        if r.get("ended") or t - r.get("touched", 0) > ROOM_TTL or not (r.get("players") or [])
    ]
    for c in dead:
        ROOMS.pop(c, None)


def touch(room):
    room["touched"] = now()
    room["seq"] = int(room.get("seq") or 0) + 1
    ev = room.get("event")
    if ev:
        ev.set()
        room["event"] = threading.Event()


def player_by_token(room, token):
    for p in room["players"]:
        if p["token"] == token:
            return p
    return None


def append_log(room, entry):
    item = dict(entry)
    item["at"] = int(now() * 1000)
    item["id"] = "e-%s-%s" % (item["at"], secrets.token_hex(2))
    room.setdefault("log", []).append(item)
    room["log"] = room["log"][-40:]
    room.setdefault("events", []).append(item)
    room["events"] = room["events"][-MAX_EVENTS:]


def create_room(meta):
    prune()
    if len(ROOMS) >= MAX_ROOMS:
        oldest = sorted(ROOMS.values(), key=lambda r: r.get("touched", 0))[0]
        ROOMS.pop(oldest["code"], None)
    code = new_code()
    token = new_token()
    room = {
        "code": code,
        "seq": 1,
        "created": now(),
        "touched": now(),
        "meta": {
            "size": (meta or {}).get("size") or "L",
            "units": (meta or {}).get("units") or "mi",
            "presetName": (meta or {}).get("presetName") or "Map",
            "presetId": (meta or {}).get("presetId"),
        },
        "phase": "lobby",
        "players": [{"role": "seeker", "token": token, "seen": now()}],
        "pendingQuestion": None,
        "lastAnswer": None,
        "activeCurses": [],
        "timer": {},
        "bannedQuestions": [],
        "disabledCategory": None,
        "overflowingLeft": 0,
        "handCount": 0,
        "deckLeft": 0,
        "maxHand": 6,
        "move": None,
        "log": [],
        "events": [],
        "event": threading.Event(),
    }
    ROOMS[code] = room
    persist()
    return room, token


def apply_event(room, player, etype, payload):
    payload = payload if isinstance(payload, dict) else {}
    player["seen"] = now()

    if etype == "ping":
        loc = payload.get("loc")
        if isinstance(loc, dict) and player["role"] == "seeker" and loc.get("lat") is not None:
            prev = player.get("loc") or {}
            moved = (round(prev.get("lat", 0), 5) != round(float(loc["lat"]), 5)
                     or round(prev.get("lng", 0), 5) != round(float(loc["lng"]), 5))
            player["loc"] = {"lat": float(loc["lat"]), "lng": float(loc["lng"]), "acc": loc.get("acc")}
            player["locAt"] = now()
            if moved:
                room["seq"] += 1
        return

    if etype == "meta":
        room["meta"].update({k: payload[k] for k in ("size", "units", "presetName", "presetId") if k in payload})
        return

    if etype == "phase":
        room["phase"] = payload.get("phase") or room["phase"]
        return

    if etype == "timer":
        incoming = dict(payload or {})
        incoming.setdefault("pauseVotes", {"seeker": False, "hider": False})
        incoming.setdefault("resumeVotes", {"seeker": False, "hider": False})
        room["timer"] = incoming
        return

    if etype == "timer.vote":
        action = payload.get("action")
        role = player.get("role")
        if action not in ("pause", "resume") or role not in ("seeker", "hider"):
            raise ValueError("Invalid timer vote.")
        timer = dict(room.get("timer") or {})
        pause_votes = dict(timer.get("pauseVotes") or {"seeker": False, "hider": False})
        resume_votes = dict(timer.get("resumeVotes") or {"seeker": False, "hider": False})
        has_hider = any(p.get("role") == "hider" for p in room.get("players") or [])
        tnow = int(now() * 1000)
        if action == "pause":
            if not timer.get("running"):
                room["timer"] = timer
                return
            pause_votes[role] = True
            resume_votes[role] = False
            if pause_votes.get("seeker") and (pause_votes.get("hider") or not has_hider):
                if timer.get("phase") == "hiding" and timer.get("hideStartedAt"):
                    timer["hideElapsedMs"] = max(0, tnow - int(timer["hideStartedAt"]))
                if timer.get("phase") == "seeking" and timer.get("seekStartedAt"):
                    timer["seekElapsedMs"] = max(0, tnow - int(timer["seekStartedAt"]))
                timer["running"] = False
                timer["hideStartedAt"] = None
                timer["seekStartedAt"] = None
                pause_votes = {"seeker": False, "hider": False}
                resume_votes = {"seeker": False, "hider": False}
        else:
            if timer.get("running") or timer.get("phase") in (None, "idle"):
                room["timer"] = timer
                return
            resume_votes[role] = True
            pause_votes[role] = False
            if resume_votes.get("seeker") and (resume_votes.get("hider") or not has_hider):
                timer["running"] = True
                if timer.get("phase") == "hiding":
                    timer["hideStartedAt"] = tnow - int(timer.get("hideElapsedMs") or 0)
                elif timer.get("phase") == "seeking":
                    timer["seekStartedAt"] = tnow - int(timer.get("seekElapsedMs") or 0)
                pause_votes = {"seeker": False, "hider": False}
                resume_votes = {"seeker": False, "hider": False}
        timer["pauseVotes"] = pause_votes
        timer["resumeVotes"] = resume_votes
        room["timer"] = timer
        return

    if etype == "question.ask":
        if room.get("pendingQuestion"):
            raise ValueError("A question is already waiting for an answer.")
        q = {
            "id": payload.get("id") or ("q-" + secrets.token_hex(4)),
            "kind": payload.get("kind"),
            "title": payload.get("title") or "Question",
            "detail": payload.get("detail") or "",
            "cost": payload.get("cost") or "",
            "draw": payload.get("draw") or 0,
            "keep": payload.get("keep") or 0,
            "options": payload.get("options") or [],
            "hint": payload.get("hint") or "",
            "apply": payload.get("apply") or {},
            "askedAt": int(now() * 1000),
            "deadline": payload.get("deadline"),
            "askedBy": player["role"],
        }
        room["pendingQuestion"] = q
        room["lastAnswer"] = None
        append_log(room, {"kind": "question", "title": q["title"], "detail": "Asked · waiting for hider"})
        return

    if etype == "question.cancel":
        pending = room.get("pendingQuestion")
        if pending and (not payload.get("id") or payload.get("id") == pending.get("id")):
            append_log(room, {"kind": "question", "title": pending.get("title") or "Question", "detail": "Withdrawn"})
            room["pendingQuestion"] = None
        return

    if etype in ("question.answer", "question.veto", "question.randomize"):
        pending = room.get("pendingQuestion")
        if not pending:
            raise ValueError("No question is waiting.")
        if payload.get("id") and payload.get("id") != pending.get("id"):
            raise ValueError("That question is no longer active.")
        answer = {
            "questionId": pending["id"],
            "via": "answer" if etype == "question.answer" else ("veto" if etype == "question.veto" else "randomize"),
            "answer": payload.get("answer") or "",
            "note": payload.get("note") or "",
            "photo": payload.get("photo") or None,
            "apply": pending.get("apply") or {},
            "kind": pending.get("kind"),
            "title": pending.get("title"),
            "cost": pending.get("cost"),
            "draw": pending.get("draw") or 0,
            "keep": pending.get("keep") or 0,
            "at": int(now() * 1000),
        }
        room["lastAnswer"] = answer
        room["pendingQuestion"] = None
        if etype == "question.veto":
            append_log(room, {"kind": "powerup", "title": pending.get("title") or "Question", "detail": "Vetoed — no answer, no cards"})
        elif etype == "question.randomize":
            append_log(room, {"kind": "powerup", "title": pending.get("title") or "Question", "detail": "Randomized — pick another in this category"})
        else:
            append_log(room, {"kind": "answer", "title": pending.get("title") or "Question", "detail": answer["answer"]})
        if room.get("disabledCategory"):
            room["disabledCategory"] = None
        return

    if etype == "curse.play":
        curse = {
            "id": payload.get("id") or ("c-" + secrets.token_hex(3)),
            "cardId": payload.get("cardId"),
            "name": payload.get("name") or "Curse",
            "effect": payload.get("effect") or "",
            "blocksQuestions": bool(payload.get("blocksQuestions")),
            "blocksTransit": bool(payload.get("blocksTransit")),
            "bonusNote": payload.get("bonusNote") or "",
            "playedAt": int(now() * 1000),
        }
        active = room.get("activeCurses") or []
        blocking = curse["blocksQuestions"] or curse["blocksTransit"]
        if blocking and any(c.get("blocksQuestions") or c.get("blocksTransit") for c in active):
            raise ValueError("A curse that blocks questions or transit is already active.")
        active.append(curse)
        room["activeCurses"] = active
        if payload.get("overflowingLeft"):
            room["overflowingLeft"] = int(payload["overflowingLeft"])
        if payload.get("disabledCategory"):
            room["disabledCategory"] = payload["disabledCategory"]
        if payload.get("bannedQuestions"):
            room["bannedQuestions"] = payload["bannedQuestions"]
        append_log(room, {"kind": "curse", "title": curse["name"], "detail": curse["effect"]})
        return

    if etype == "curse.proof":
        if player.get("role") != "seeker":
            raise ValueError("Only seekers can send curse proof.")
        cid = payload.get("id")
        curse = next((c for c in (room.get("activeCurses") or []) if c.get("id") == cid), None)
        if not curse:
            raise ValueError("That curse is not active.")
        if not payload.get("photo"):
            raise ValueError("Send a photo proving you completed the curse.")
        curse["proof"] = {
            "photo": payload.get("photo"),
            "note": payload.get("note") or "",
            "at": int(now() * 1000),
        }
        append_log(room, {"kind": "curse", "title": curse.get("name") or "Curse", "detail": "Seekers sent proof"})
        return

    if etype == "curse.reject":
        if player.get("role") != "hider":
            raise ValueError("Only the hider can reject curse proof.")
        cid = payload.get("id")
        curse = next((c for c in (room.get("activeCurses") or []) if c.get("id") == cid), None)
        if not curse:
            raise ValueError("That curse is not active.")
        curse["proof"] = None
        append_log(room, {"kind": "curse", "title": curse.get("name") or payload.get("name") or "Curse", "detail": "Proof rejected"})
        return

    if etype == "curse.clear":
        if player.get("role") != "hider":
            raise ValueError("Only the hider can confirm a curse is cleared.")
        cid = payload.get("id")
        room["activeCurses"] = [c for c in (room.get("activeCurses") or []) if c.get("id") != cid]
        append_log(room, {"kind": "curse", "title": payload.get("name") or "Curse", "detail": "Cleared"})
        return

    if etype == "leave":
        if payload.get("soft"):
            player["departed"] = True
        else:
            room["players"] = [p for p in room["players"] if p.get("token") != player.get("token")]
        if should_wipe_on_leave(room):
            room["ended"] = True
        return

    if etype == "powerup.play":
        name = payload.get("name") or "Powerup"
        append_log(room, {"kind": "powerup", "title": name, "detail": payload.get("detail") or "Played"})
        if payload.get("maxHand"):
            room["maxHand"] = int(payload["maxHand"])
        if payload.get("move"):
            room["move"] = payload["move"]
            room["phase"] = "moving"
        return

    if etype == "cards.sync":
        if "handCount" in payload:
            room["handCount"] = int(payload["handCount"])
        if "deckLeft" in payload:
            room["deckLeft"] = int(payload["deckLeft"])
        if "maxHand" in payload:
            room["maxHand"] = int(payload["maxHand"])
        if "overflowingLeft" in payload:
            room["overflowingLeft"] = int(payload["overflowingLeft"])
        return

    if etype == "spotty":
        room["disabledCategory"] = payload.get("category")
        return

    if etype == "note":
        append_log(room, {"kind": "note", "title": payload.get("title") or "Note", "detail": payload.get("detail") or ""})
        return

    raise ValueError("Unknown event: %s" % etype)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def log_message(self, fmt, *args):
        line = "%s - %s\n" % (self.address_string(), fmt % args)
        print(line, end="", flush=True)
        try:
            with LOG.open("a") as fh:
                fh.write(line)
        except OSError:
            pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api("GET", parsed)
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api("POST", parsed)
            return
        self.send_error(404)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 400_000:
            raise ValueError("payload too large")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def send_json(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api(self, method, parsed):
        parts = [p for p in parsed.path.split("/") if p]
        if parts[:2] == ["api", "rooms"]:
            with LOCK:
                prune()
        try:
            if method == "GET" and parts == ["api", "health"]:
                self.send_json(200, {
                    "ok": True,
                    "rooms": len(ROOMS),
                    "lan": lan_addresses(),
                    "port": self.server.server_address[1],
                    "https": TLS_ON,
                    "httpsPort": HTTPS_PORT,
                    "httpPort": HTTP_PORT,
                })
                return

            if method == "POST" and parts == ["api", "rooms"]:
                meta = self.read_json()
                with LOCK:
                    room, token = create_room(meta)
                    snap = public_room(room)
                self.send_json(200, {"code": room["code"], "token": token, "role": "seeker", "room": snap})
                return

            if len(parts) >= 3 and parts[0] == "api" and parts[1] == "rooms":
                code = parts[2].upper()
                with LOCK:
                    room = ROOMS.get(code)
                if not room:
                    self.send_json(404, {"error": "No game with that code."})
                    return

                if method == "POST" and parts[3:] == ["join"]:
                    body = self.read_json()
                    role = body.get("role") or "hider"
                    if role not in ("hider", "seeker"):
                        self.send_json(400, {"error": "Role must be hider or seeker."})
                        return
                    token = new_token()
                    with LOCK:
                        room["players"].append({"role": role, "token": token, "seen": now()})
                        touch(room)
                        persist()
                        snap = public_room(room)
                    self.send_json(200, {"code": code, "token": token, "role": role, "room": snap})
                    return

                if method == "GET" and len(parts) == 3:
                    qs = parse_qs(parsed.query or "")
                    since = int((qs.get("since") or ["0"])[0] or 0)
                    wait = (qs.get("wait") or ["0"])[0] == "1"
                    if wait:
                        with LOCK:
                            seq = room.get("seq") or 0
                            ev = room.get("event")
                        if seq <= since and ev:
                            ev.wait(20)
                    with LOCK:
                        if code not in ROOMS:
                            self.send_json(404, {"error": "No game with that code."})
                            return
                        snap = public_room(room)
                        events = [e for e in (room.get("events") or []) if (e.get("at") or 0) > since]
                    self.send_json(200, {"room": snap, "events": events})
                    return

                if method == "POST" and len(parts) == 3:
                    body = self.read_json()
                    token = body.get("token")
                    etype = body.get("type")
                    payload = body.get("payload") or {}
                    with LOCK:
                        player = player_by_token(room, token)
                        if not player:
                            self.send_json(403, {"error": "This device is not in that game."})
                            return
                        try:
                            apply_event(room, player, etype, payload)
                        except ValueError as err:
                            self.send_json(400, {"error": str(err)})
                            return
                        if room.get("ended"):
                            ROOMS.pop(code, None)
                            persist()
                            self.send_json(200, {"room": {"code": code, "ended": True}})
                            return
                        if etype != "ping":
                            touch(room)
                            persist()
                        snap = public_room(room)
                    self.send_json(200, {"room": snap})
                    return

            self.send_json(404, {"error": "Not found"})
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Invalid JSON"})
        except ValueError as err:
            self.send_json(400, {"error": str(err)})
        except Exception as err:
            self.send_json(500, {"error": str(err)})


def serve(port, tls=False):
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    if tls:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        label = "https"
    else:
        label = "http"
    print("%s://0.0.0.0:%s" % (label, port), flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    load_rooms()
    TLS_ON = ensure_certs()
    threading.Thread(target=serve, args=(HTTP_PORT, False), daemon=True).start()
    if TLS_ON:
        for ip in ["127.0.0.1"] + lan_addresses():
            print("https://%s:%s" % (ip, HTTPS_PORT), flush=True)
        serve(HTTPS_PORT, True)
    else:
        print("no TLS certs — HTTP only on %s" % HTTP_PORT, flush=True)
        threading.Event().wait()
