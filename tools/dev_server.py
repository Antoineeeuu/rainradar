#!/usr/bin/env python3
"""
Serveur de test local de RailRadar.

    python3 tools/dev_server.py        puis ouvrir http://localhost:5173

Sert le dossier public/ et imite le relais Netlify /api/idfm en lisant la cle PRIM
dans le fichier .env (voir .env.example). La reponse brute de PRIM est renvoyee telle
quelle : le navigateur la reduit lui-meme (public/js/idfm-transform.js).
"""
import gzip
import http.server
import os
import socketserver
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
PRIM_URL = "https://prim.iledefrance-mobilites.fr/marketplace/estimated-timetable"
CACHE = {"t": 0, "body": None, "status": 200}


def prim_key():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return ""
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line.startswith("PRIM_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=PUBLIC, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] != "/api/idfm":
            return super().do_GET()
        key = prim_key()
        if not key:
            return self._send(200, b'{"error":"no-key"}')
        if time.time() - CACHE["t"] > 180 or CACHE["body"] is None:
            req = urllib.request.Request(PRIM_URL, headers={"apikey": key, "accept": "application/json", "accept-encoding": "gzip"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    body = r.read()
                    if r.headers.get("content-encoding") != "gzip":
                        body = gzip.compress(body, 5)
                    CACHE.update(t=time.time(), body=body, status=200, gz=True)
            except urllib.error.HTTPError as e:
                code = {429: b'{"error":"quota"}', 401: b'{"error":"prim-401"}'}.get(e.code, b'{"error":"prim-%d"}' % e.code)
                CACHE.update(t=time.time(), body=code, status=200 if e.code == 429 else 502, gz=False)
            except Exception:
                CACHE.update(t=time.time(), body=b'{"error":"network"}', status=502, gz=False)
            sys.stderr.write("PRIM %s %d octets\n" % (CACHE["status"], len(CACHE["body"])))
        self._send(CACHE["status"], CACHE["body"], CACHE.get("gz"))

    def _send(self, status, body, gz=False):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if gz:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", port), Handler) as srv:
        print("RailRadar : http://localhost:%d" % port)
        srv.serve_forever()
