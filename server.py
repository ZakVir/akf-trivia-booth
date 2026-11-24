#!/usr/bin/env python3
"""Tiny local server for the AKF trivia booth.

- Serves this folder on http://localhost:8787 (needed so two windows can talk and the camera is allowed).
- Optional: forwards the "Ask AI" question parser to NVIDIA's free NIM API. Browsers can't call
  that API directly, so it goes through here. Your key is used for that one request and never saved or logged.
Everything else works with no internet at all.
"""
import http.server, json, os, socketserver, urllib.request, urllib.error

PORT = int(os.environ.get("PORT", "8787"))
NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
ROOT = os.path.dirname(os.path.abspath(__file__))


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

    def do_GET(self):
        if self.path.startswith("/api/health"):
            return self._json(200, {"ok": True, "envKey": bool(os.environ.get("NVIDIA_API_KEY"))})
        return super().do_GET()

    def do_POST(self):
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
        payload = {k: body[k] for k in ("model", "messages", "temperature", "max_tokens") if k in body}
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
