#!/usr/bin/env python3
"""Tiny local server for the AKF trivia booth.

- Serves this folder on http://localhost:8787 (needed so two windows can talk and the camera is allowed).
- Optional: forwards the "Ask AI" question parser to NVIDIA's free NIM API. Browsers can't call
  that API directly, so it goes through here. The key comes from the request (Setup > AI helper settings),
  or from NVIDIA_API_KEY in the environment or in a private .env file next to this script (never committed).
  It is never logged or sent anywhere except NVIDIA.
Everything else works with no internet at all.
"""
import http.server, json, os, socketserver, sqlite3, time, urllib.request, urllib.error

PORT = int(os.environ.get("PORT", "8787"))
NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
ROOT = os.path.dirname(os.path.abspath(__file__))


def load_env_file():
    """NVIDIA_API_KEY=... (and other KEY=VALUE lines) from ROOT/.env, without overriding the real environment."""
    try:
        with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


load_env_file()

# ---- the question-set library: one small SQLite file next to this script (git-ignored), nothing to install ----
DB_PATH = os.environ.get("AKF_DB", os.path.join(ROOT, "questions.db"))
MAX_BODY = 4 * 1024 * 1024


def db():
    con = sqlite3.connect(DB_PATH, timeout=5)
    con.execute("CREATE TABLE IF NOT EXISTS sets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, questions TEXT NOT NULL,"
                " created REAL NOT NULL, updated REAL NOT NULL)")
    return con


def set_row(r, full=False):
    qs = json.loads(r[2])
    out = {"id": r[0], "name": r[1], "count": len(qs), "created": r[3], "updated": r[4]}
    if full:
        out["questions"] = qs
    return out


def valid_questions(qs):
    return isinstance(qs, list) and len(qs) <= 2000 and all(isinstance(q, dict) and isinstance(q.get("q"), str) for q in qs)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "application/javascript", ".js": "application/javascript",
                      ".wasm": "application/wasm", ".task": "application/octet-stream"}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        # cross-origin isolation -> SharedArrayBuffer -> multi-threaded onnxruntime-web (yolo-pose.js)
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _local(self):
        """only this booth on this computer: request addressed to localhost (blocks DNS-rebinding tricks)"""
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        return host in ("localhost", "127.0.0.1", "[::1]")

    def _body(self):
        n = int(self.headers.get("Content-Length", "0"))
        if n > MAX_BODY:
            raise ValueError("too big")
        return json.loads(self.rfile.read(n) or b"{}")

    def _set_id(self):
        tail = self.path.split("?")[0].rstrip("/").split("/")[3:]          # /api/sets/<id>
        return int(tail[0]) if tail and tail[0].isdigit() else None

    def do_GET(self):
        if self.path.startswith("/api/health"):
            return self._json(200, {"ok": True, "envKey": bool(os.environ.get("NVIDIA_API_KEY")), "db": True})
        if self.path.startswith("/api/sets"):
            if not self._local():
                return self._json(403, {"error": "forbidden"})
            sid = self._set_id()
            with db() as con:
                if sid is None:
                    rows = con.execute("SELECT id, name, questions, created, updated FROM sets ORDER BY updated DESC").fetchall()
                    return self._json(200, [set_row(r) for r in rows])
                r = con.execute("SELECT id, name, questions, created, updated FROM sets WHERE id = ?", (sid,)).fetchone()
                return self._json(200, set_row(r, True)) if r else self._json(404, {"error": "no such set"})
        return super().do_GET()

    def do_DELETE(self):
        if not self.path.startswith("/api/sets") or not self._local():
            return self._json(403, {"error": "forbidden"})
        sid = self._set_id()
        if sid is None:
            return self._json(400, {"error": "which set?"})
        with db() as con:
            con.execute("DELETE FROM sets WHERE id = ?", (sid,))
        return self._json(200, {"ok": True})

    def do_POST(self):
        if self.path.startswith("/api/sets"):
            ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if not self._local() or ctype != "application/json":
                return self._json(403, {"error": "forbidden"})
            try:
                body = self._body()
            except Exception:
                return self._json(400, {"error": "bad json"})
            name, qs, sid = str(body.get("name") or "").strip()[:120], body.get("questions"), body.get("id")
            if not name or not valid_questions(qs):
                return self._json(400, {"error": "need a name and a list of questions"})
            now = time.time()
            with db() as con:
                if isinstance(sid, int) and con.execute("SELECT 1 FROM sets WHERE id = ?", (sid,)).fetchone():
                    con.execute("UPDATE sets SET name = ?, questions = ?, updated = ? WHERE id = ?", (name, json.dumps(qs), now, sid))
                else:
                    sid = con.execute("INSERT INTO sets (name, questions, created, updated) VALUES (?, ?, ?, ?)",
                                      (name, json.dumps(qs), now, now)).lastrowid
            return self._json(200, {"id": sid})
        if not self.path.startswith("/api/parse"):
            return self._json(404, {"error": "not found"})
        # only this app may use the AI proxy: a JSON request (other websites can't send one without the browser asking first)
        # addressed to this computer (blocks DNS-rebinding tricks), so nobody else can spend the NVIDIA key's quota
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if host not in ("localhost", "127.0.0.1", "[::1]") or ctype != "application/json":
            return self._json(403, {"error": "forbidden"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
        except Exception:
            return self._json(400, {"error": "bad json"})
        key = body.get("key") or os.environ.get("NVIDIA_API_KEY", "")
        if not key:
            return self._json(401, {"error": "no key"})
        payload = {k: body[k] for k in ("model", "messages", "temperature", "max_tokens", "chat_template_kwargs") if k in body}
        req = urllib.request.Request(NIM_URL, data=json.dumps(payload).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "Accept": "application/json",
                                              "Authorization": "Bearer " + key})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
                self.send_response(r.status)
        except urllib.error.HTTPError as e:
            data = e.read() or b"{}"
            self.send_response(e.code)
        except Exception as e:
            return self._json(502, {"error": "could not reach NVIDIA: " + type(e).__name__})
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 256          # a page load opens many connections at once; the default of 5 made some get reset


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as s:
        print(f"AKF trivia booth running: http://localhost:{PORT}/host.html   (Ctrl+C to stop)")
        try:
            s.serve_forever()
        except KeyboardInterrupt:
            pass
