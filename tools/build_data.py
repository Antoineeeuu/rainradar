#!/usr/bin/env python3
"""
RailRadar - generation des donnees statiques (reseau ferre + gares).

Ce script n'est PAS necessaire pour faire fonctionner le site : les fichiers
public/data/rail.json et public/data/stations.json sont deja fournis dans le depot.
Relancez-le seulement pour rafraichir le reseau ou la liste des gares
(par exemple une ou deux fois par an) :

    python3 tools/build_data.py

Sources (open data SNCF, licence ODbL) :
  - Vitesse maximale nominale sur ligne (geometrie + vitesse des voies)
  - Formes des lignes du RFN (complete les lignes exploitees absentes du fichier precedent)
  - tools/patches.geojson : quelques lignes absentes de l'open data SNCF,
    reprises d'OpenStreetMap (c) les contributeurs OpenStreetMap, ODbL
  - Horaires GTFS SNCF (liste et position des gares)

Aucune dependance : Python 3.8+ suffit.
"""
import argparse
import collections
import csv
import heapq
import io
import json
import math
import os
import sys
import urllib.request
import zipfile

URL_VMAX = ("https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/"
            "vitesse-maximale-nominale-sur-ligne/exports/geojson")
URL_RFN = ("https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/"
           "formes-des-lignes-du-rfn/exports/geojson")
URL_GTFS = "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip"

JOIN_NEAR = 8.0      # m : une extremite se raccorde a toutes les voies a moins de 8 m
JOIN_MAX = 60.0      # m : sinon, a la voie la plus proche si elle est a moins de 60 m
SIMPLIFY = 3.0       # m : tolerance de simplification des traces
SNAP_MAX = 700.0     # m : distance max gare -> voie pour considerer la gare "sur le reseau"
SNAP_BAND = 150.0    # m : on garde les voies a moins de (meilleure distance + 150 m)
SNAP_KEEP = 4        # nombre max de voies d'accroche par gare
LINK_MAX = 400e3     # m : portee max des liaisons "hors reseau" (gares etrangeres)
GAP_PAIR = 600.0     # m : deux fins de ligne a moins de 600 m sont reliees (meme gare)
GAP_LINE = 2500.0    # m : une fin de ligne a moins de 2,5 km d'une autre voie y est reliee
CONNECTOR_V = 1      # "vitesse" speciale : raccord penalise dans le calcul d'itineraire

KY = 110574.0


def xy(p):
    return (p[0] * 111320.0 * math.cos(math.radians(p[1])), p[1] * KY)


def hav(a, b):
    r = 6371008.8
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    dp = p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def dseg(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    print("  telechargement", url)
    req = urllib.request.Request(url, headers={"User-Agent": "railradar-build"})
    with urllib.request.urlopen(req, timeout=300) as r, open(path, "wb") as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)


def encode_polyline(coords):
    """Encodage 'Google polyline', precision 5, ordre lat/lon."""
    out = []
    plat = plon = 0
    for lon, lat in coords:
        ilat, ilon = int(round(lat * 1e5)), int(round(lon * 1e5))
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return "".join(out)


def simplify(pts, tol):
    """Douglas-Peucker iteratif sur des points lon/lat (tolerance en metres)."""
    if len(pts) < 3:
        return pts
    P = [xy(p) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        best, bi = 0.0, -1
        for i in range(a + 1, b):
            d, _ = dseg(P[i], P[a], P[b])
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


class UF:
    def __init__(self):
        self.p = []

    def make(self):
        self.p.append(len(self.p))
        return len(self.p) - 1

    def find(self, a):
        p = self.p
        while p[a] != a:
            p[a] = p[p[a]]
            a = p[a]
        return a

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.p[max(a, b)] = min(a, b)


def clean(coords):
    ll = [(c[0], c[1]) for c in coords]
    return [p for i, p in enumerate(ll) if i == 0 or p != ll[i - 1]]


def load_vmax(path):
    out = []
    for f in json.load(open(path, encoding="utf-8"))["features"]:
        g = f.get("geometry")
        if not g or g["type"] != "LineString":
            continue
        try:
            v = int(float(f["properties"].get("v_max") or 0))
        except ValueError:
            v = 0
        ll = clean(g["coordinates"])
        if len(ll) >= 2:
            out.append((ll, v if v > 0 else 60, 0))
    return out


def load_lines(path, speed, keep=lambda props: True):
    out = []
    for f in json.load(open(path, encoding="utf-8"))["features"]:
        g = f.get("geometry")
        if not g or not keep(f.get("properties") or {}):
            continue
        parts = [g["coordinates"]] if g["type"] == "LineString" else \
            g["coordinates"] if g["type"] == "MultiLineString" else []
        v = (f.get("properties") or {}).get("v") or speed
        for part in parts:
            ll = clean(part)
            if len(ll) >= 2:
                out.append((ll, int(v)))
    return out


def add_uncovered(base, cand, tol, origin, min_len=120.0):
    """Ajoute a `base` les portions de `cand` situees a plus de `tol` metres du reseau existant."""
    G = 100.0
    grid = collections.defaultdict(list)
    for sec in base:
        P = [xy(p) for p in sec[0]]
        for i in range(len(P) - 1):
            (x1, y1), (x2, y2) = P[i], P[i + 1]
            for gx in range(int(min(x1, x2) // G), int(max(x1, x2) // G) + 1):
                for gy in range(int(min(y1, y2) // G), int(max(y1, y2) // G) + 1):
                    grid[(gx, gy)].append((P[i], P[i + 1]))

    def covered(p):
        gx, gy = int(p[0] // G), int(p[1] // G)
        for ax in (-1, 0, 1):
            for ay in (-1, 0, 1):
                for a, b in grid.get((gx + ax, gy + ay), ()):
                    if dseg(p, a, b)[0] <= tol:
                        return True
        return False

    added = []
    for ll, v in cand:
        P = [xy(p) for p in ll]
        n = len(P) - 1
        unc = []
        for i in range(n):
            # un segment est "couvert" si son milieu et ses quarts sont proches du reseau
            ok = all(covered((P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t))
                     for t in (0.25, 0.5, 0.75))
            unc.append(not ok)
        i = 0
        while i < n:
            if not unc[i]:
                i += 1
                continue
            j = i
            while j + 1 < n and unc[j + 1]:
                j += 1
            length = sum(hav(ll[k], ll[k + 1]) for k in range(i, j + 1))
            if length >= min_len:
                added.append((ll[max(0, i - 1):min(n, j + 2) + 1], v, origin))
            i = j + 1
    km = sum(hav(sec[0][k], sec[0][k + 1]) for sec in added for k in range(len(sec[0]) - 1)) / 1000
    base.extend(added)
    return len(added), km


def find_connectors(node_ll, edges):
    """Comble les petits trous de l'open data : relie les fins de ligne proches entre elles
    (vitesse normale) ou a la voie voisine la plus proche (raccord penalise)."""
    deg = collections.Counter()
    own = {}
    for ei, e in enumerate(edges):
        for n in (e["a"], e["b"]):
            deg[n] += 1
            own[n] = ei
    dead = [n for n in range(len(node_ll)) if deg[n] == 1]
    dxy = {n: xy(node_ll[n]) for n in dead}
    out = []
    paired = set()
    for n in dead:
        best = (GAP_PAIR, None)
        for m in dead:
            if m == n or own[m] == own[n]:
                continue
            d = math.hypot(dxy[n][0] - dxy[m][0], dxy[n][1] - dxy[m][1])
            if d < best[0]:
                best = (d, m)
        if best[1] is not None:
            m = best[1]
            if (m, n) not in paired:
                v = max(40, min(edges[own[n]]["v"], edges[own[m]]["v"]))
                out.append(([node_ll[n], node_ll[m]], v, 3))
            paired.add((n, m))
    has_pair = {a for a, _ in paired} | {b for _, b in paired}
    G = 200.0
    grid = collections.defaultdict(list)
    for ei, e in enumerate(edges):
        P = [xy(p) for p in e["ll"]]
        for i in range(len(P) - 1):
            (x1, y1), (x2, y2) = P[i], P[i + 1]
            for gx in range(int(min(x1, x2) // G), int(max(x1, x2) // G) + 1):
                for gy in range(int(min(y1, y2) // G), int(max(y1, y2) // G) + 1):
                    grid[(gx, gy)].append((ei, i, P[i], P[i + 1]))
    R = int(GAP_LINE // G) + 1
    for n in dead:
        if n in has_pair:
            continue
        p = dxy[n]
        gx, gy = int(p[0] // G), int(p[1] // G)
        best = (GAP_LINE, None)
        for ax in range(-R, R + 1):
            for ay in range(-R, R + 1):
                for ei, i, a, b in grid.get((gx + ax, gy + ay), ()):
                    if ei == own[n]:
                        continue
                    d, t = dseg(p, a, b)
                    if d < best[0]:
                        best = (d, (ei, i, t))
        if best[1] is not None:
            ei, i, t = best[1]
            a, b = edges[ei]["ll"][i], edges[ei]["ll"][i + 1]
            target = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            out.append(([node_ll[n], target], CONNECTOR_V, 3))
    return out, len(paired) // 1


def build_network(raw, quiet=False):
    say = (lambda *a: None) if quiet else print
    uf = UF()
    secs = []  # chaque section : {"ll": [...], "xy": [...], "id": [...], "v": int}
    for ll, v, origin in raw:
        ll = list(ll)
        secs.append({"ll": ll, "xy": [xy(p) for p in ll], "id": [uf.make() for _ in ll], "v": v, "o": origin})
    say("  sections :", len(secs))

    # index spatial des segments
    G = 200.0
    grid = collections.defaultdict(list)
    for si, s in enumerate(secs):
        P = s["xy"]
        for i in range(len(P) - 1):
            (x1, y1), (x2, y2) = P[i], P[i + 1]
            for gx in range(int(min(x1, x2) // G), int(max(x1, x2) // G) + 1):
                for gy in range(int(min(y1, y2) // G), int(max(y1, y2) // G) + 1):
                    grid[(gx, gy)].append((si, i))

    # raccordement des extremites
    inserts = collections.defaultdict(list)  # si -> [(i, t, endpoint_id)]
    njoin = 0
    for si, s in enumerate(secs):
        for e in (0, len(s["xy"]) - 1):
            p = s["xy"][e]
            gx, gy = int(p[0] // G), int(p[1] // G)
            best = {}
            for ax in (-1, 0, 1):
                for ay in (-1, 0, 1):
                    for (sj, i) in grid.get((gx + ax, gy + ay), ()):
                        if sj == si:
                            continue
                        d, t = dseg(p, secs[sj]["xy"][i], secs[sj]["xy"][i + 1])
                        if d <= JOIN_MAX and (sj not in best or d < best[sj][0]):
                            best[sj] = (d, i, t)
            if not best:
                continue
            near = [(d, sj, i, t) for sj, (d, i, t) in best.items() if d <= JOIN_NEAR]
            if not near:
                sj = min(best, key=lambda k: best[k][0])
                near = [(best[sj][0], sj, best[sj][1], best[sj][2])]
            if s["o"] in (1, 2):
                # une portion ajoutee doit aussi rejoindre le reseau d'une autre origine
                # (sinon deux voies paralleles OSM se relient entre elles et restent isolees)
                others = [sj for sj in best if secs[sj]["o"] != s["o"]]
                if others:
                    sj = min(others, key=lambda k: best[k][0])
                    if all(z[1] != sj for z in near):
                        near.append((best[sj][0], sj, best[sj][1], best[sj][2]))
            for d, sj, i, t in near:
                a, b = secs[sj]["xy"][i], secs[sj]["xy"][i + 1]
                seglen = math.hypot(b[0] - a[0], b[1] - a[1])
                if t * seglen < 1.5:
                    uf.union(s["id"][e], secs[sj]["id"][i])
                elif (1 - t) * seglen < 1.5:
                    uf.union(s["id"][e], secs[sj]["id"][i + 1])
                else:
                    inserts[sj].append((i, t, s["id"][e]))
                njoin += 1
    say("  raccordements :", njoin)

    # insertion des points de raccordement au milieu des segments
    for sj, lst in inserts.items():
        s = secs[sj]
        lst.sort(key=lambda z: (z[0], z[1]), reverse=True)
        for i, t, eid in lst:
            a, b = s["ll"][i], s["ll"][i + 1]
            np_ = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            nid = uf.make()
            uf.union(nid, eid)
            s["ll"].insert(i + 1, np_)
            s["id"].insert(i + 1, nid)

    # graphe fin : sommets = racines
    adj = collections.defaultdict(list)  # root -> [(root2, v, len)]
    pos = {}
    for s in secs:
        ids = [uf.find(i) for i in s["id"]]
        for k, r in enumerate(ids):
            pos.setdefault(r, s["ll"][k])
        for k in range(len(ids) - 1):
            a, b = ids[k], ids[k + 1]
            if a == b:
                continue
            ln = hav(s["ll"][k], s["ll"][k + 1])
            adj[a].append((b, s["v"], ln))
            adj[b].append((a, s["v"], ln))

    # dedoublonnage des aretes paralleles identiques
    for a in list(adj):
        seen = {}
        for b, v, ln in adj[a]:
            if b not in seen or v > seen[b][0]:
                seen[b] = (v, ln)
        adj[a] = [(b, v, ln) for b, (v, ln) in seen.items()]

    def is_node(r):
        e = adj[r]
        return len(e) != 2 or e[0][1] != e[1][1]

    nodes = [r for r in adj if is_node(r)]
    node_idx = {r: i for i, r in enumerate(nodes)}
    edges = []
    visited = set()

    def walk(start, nxt, v):
        chain = [start, nxt]
        length = next(ln for b, vv, ln in adj[start] if b == nxt)
        prev, cur = start, nxt
        while cur not in node_idx:
            a, b = adj[cur]
            step = b if a[0] == prev else a
            length += step[2]
            prev, cur = cur, step[0]
            chain.append(cur)
            if cur == start:
                break
        return chain, length

    for r in nodes:
        for b, v, ln in adj[r]:
            if (r, b) in visited:
                continue
            chain, length = walk(r, b, v)
            visited.add((chain[0], chain[1]))
            visited.add((chain[-1], chain[-2]))
            if chain[-1] not in node_idx:
                continue
            edges.append({"a": node_idx[chain[0]], "b": node_idx[chain[-1]], "v": v,
                          "ll": [pos[c] for c in chain]})
    say("  noeuds :", len(nodes), "| aretes :", len(edges))

    # simplification + longueurs
    tot_pts = 0
    for e in edges:
        e["ll"] = simplify(e["ll"], SIMPLIFY)
        e["ll"] = [(round(p[0], 5), round(p[1], 5)) for p in e["ll"]]
        e["len"] = sum(hav(e["ll"][i], e["ll"][i + 1]) for i in range(len(e["ll"]) - 1))
        tot_pts += len(e["ll"])
    edges = [e for e in edges if e["len"] > 0.5 or e["a"] != e["b"]]
    say("  points apres simplification :", tot_pts,
          "| km :", round(sum(e["len"] for e in edges) / 1000))
    node_ll = [pos[r] for r in nodes]
    return node_ll, edges


def components(n_nodes, edges):
    uf = UF()
    for _ in range(n_nodes):
        uf.make()
    for e in edges:
        uf.union(e["a"], e["b"])
    km = collections.Counter()
    for e in edges:
        km[uf.find(e["a"])] += e["len"] / 1000
    return uf, km


def load_stations(gtfs_path):
    z = zipfile.ZipFile(gtfs_path)
    stops = list(csv.DictReader(io.TextIOWrapper(z.open("stops.txt"), encoding="utf-8-sig")))
    areas = {}
    kinds = collections.defaultdict(set)
    for s in stops:
        sid = s["stop_id"]
        if s.get("location_type") == "1" and sid.startswith("StopArea:OCE"):
            areas[sid[len("StopArea:OCE"):]] = s
        elif sid.startswith("StopPoint:OCE") and "-" in sid:
            kind, uic = sid[len("StopPoint:OCE"):].rsplit("-", 1)
            kinds[uic].add(kind)
    # frequentation : nombre d'arrets de trains par gare
    count = collections.Counter()
    with z.open("stop_times.txt") as fh:
        rd = csv.reader(io.TextIOWrapper(fh, encoding="utf-8-sig"))
        head = next(rd)
        k = head.index("stop_id")
        for row in rd:
            sid = row[k]
            if sid.startswith("StopPoint:OCE") and not sid.startswith("StopPoint:OCECar"):
                count[sid.rsplit("-", 1)[-1]] += 1
    out = {}
    for uic, s in areas.items():
        ks = kinds.get(uic, set())
        rail = [k for k in ks if not k.startswith("Car")]
        if not rail:
            continue
        try:
            lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
        except ValueError:
            continue
        if abs(lat) < 1e-6 and abs(lon) < 1e-6:
            continue
        hs = any(k in ("TGV INOUI", "OUIGO", "ICE", "Lyria") for k in rail)
        out[uic] = {"n": s["stop_name"].strip(), "lat": round(lat, 5), "lon": round(lon, 5),
                    "hs": hs, "c": count.get(uic, 0)}
    return out


def snap_stations(stations, node_ll, edges):
    G = 500.0
    grid = collections.defaultdict(list)
    exy = []
    for ei, e in enumerate(edges):
        P = [xy(p) for p in e["ll"]]
        exy.append(P)
        for i in range(len(P) - 1):
            (x1, y1), (x2, y2) = P[i], P[i + 1]
            for gx in range(int(min(x1, x2) // G), int(max(x1, x2) // G) + 1):
                for gy in range(int(min(y1, y2) // G), int(max(y1, y2) // G) + 1):
                    grid[(gx, gy)].append((ei, i))
    cum = []
    for e in edges:
        c = [0.0]
        for i in range(len(e["ll"]) - 1):
            c.append(c[-1] + hav(e["ll"][i], e["ll"][i + 1]))
        cum.append(c)
    deg = collections.Counter()
    for e in edges:
        deg[e["a"]] += 1
        deg[e["b"]] += 1
    dead = [i for i in range(len(node_ll)) if deg[i] == 1]
    dead_edge = {}
    for ei, e in enumerate(edges):
        dead_edge[e["a"]] = ei
        dead_edge[e["b"]] = ei
    boxes = [(min(q[0] for q in P), min(q[1] for q in P), max(q[0] for q in P), max(q[1] for q in P)) for P in exy]

    def bbox_dist(q, b):
        dx = max(b[0] - q[0], 0, q[0] - b[2])
        dy = max(b[1] - q[1], 0, q[1] - b[3])
        return math.hypot(dx, dy)

    R = int(SNAP_MAX // G) + 1
    on = off = 0
    for uic, s in stations.items():
        p = xy((s["lon"], s["lat"]))
        gx, gy = int(p[0] // G), int(p[1] // G)
        best = {}
        for ax in range(-R, R + 1):
            for ay in range(-R, R + 1):
                for (ei, i) in grid.get((gx + ax, gy + ay), ()):
                    d, t = dseg(p, exy[ei][i], exy[ei][i + 1])
                    if d <= SNAP_MAX and (ei not in best or d < best[ei][0]):
                        along = cum[ei][i] + t * (cum[ei][i + 1] - cum[ei][i])
                        best[ei] = (d, along)
        if best:
            dmin = min(d for d, _ in best.values())
            cand = sorted((d, ei, al) for ei, (d, al) in best.items() if d <= dmin + SNAP_BAND)
            s["s"] = [[ei, round(al / edges[ei]["len"], 4) if edges[ei]["len"] > 0 else 0]
                      for d, ei, al in cand[:SNAP_KEEP]]
            s["d"] = round(dmin)
            on += 1
        else:
            # gare hors reseau (etranger, ligne absente de l'open data) : on l'accroche au
            # point du reseau le plus proche et aux fins de ligne voisines, avec un "ecart"
            # en metres parcouru en ligne droite.
            pt = (s["lon"], s["lat"])
            cands = []
            bestd, beste = float("inf"), None
            order = sorted(range(len(edges)), key=lambda ei: bbox_dist(p, boxes[ei]))
            for ei in order:
                if bbox_dist(p, boxes[ei]) >= bestd:
                    break
                P = exy[ei]
                for i in range(len(P) - 1):
                    d, t = dseg(p, P[i], P[i + 1])
                    if d < bestd:
                        bestd = d
                        beste = (ei, cum[ei][i] + t * (cum[ei][i + 1] - cum[ei][i]))
            if beste is not None and bestd <= LINK_MAX:
                ei, al = beste
                cands.append([ei, round(al / edges[ei]["len"], 4) if edges[ei]["len"] > 0 else 0, round(bestd)])
            ds = sorted((hav(pt, node_ll[i]), i) for i in dead)
            for d, i in ds[:3]:
                if d <= LINK_MAX:
                    ei = dead_edge[i]
                    cands.append([ei, 0 if edges[ei]["a"] == i else 1, round(d)])
            s["s"] = cands
            off += 1
    print("  gares sur le reseau :", on, "| hors reseau :", off)


def tiers(stations):
    """Niveau d'importance 0..4 (4 = tres grande gare), d'apres la frequentation."""
    vals = sorted((s["c"] for s in stations.values()), reverse=True)
    n = len(vals)
    cuts = [vals[min(n - 1, int(n * q))] for q in (0.015, 0.06, 0.2, 0.5)]
    for s in stations.values():
        c = s.pop("c")
        s["w"] = 4 if c >= cuts[0] else 3 if c >= cuts[1] else 2 if c >= cuts[2] else 1 if c >= cuts[3] else 0


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(here, ".cache"))
    ap.add_argument("--out", default=os.path.join(here, "..", "public", "data"))
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    os.makedirs(a.out, exist_ok=True)
    vmax_path = os.path.join(a.cache, "vmax.geojson")
    rfn_path = os.path.join(a.cache, "rfn.geojson")
    gtfs_path = os.path.join(a.cache, "gtfs.zip")
    patch_path = os.path.join(here, "patches.geojson")
    print("1/4 Telechargements")
    fetch(URL_VMAX, vmax_path)
    fetch(URL_RFN, rfn_path)
    fetch(URL_GTFS, gtfs_path)
    print("2/4 Reseau ferre")
    raw = load_vmax(vmax_path)
    n, km = add_uncovered(raw, load_lines(rfn_path, 100, lambda p: p.get("mnemo") == "EXPLOITE"), 15.0, 1)
    print("  complement RFN : %d portions, %.0f km" % (n, km))
    if os.path.exists(patch_path):
        osm = [(ll, v, 2) for ll, v in load_lines(patch_path, 100)]
        raw.extend(osm)
        print("  complement OpenStreetMap : %d troncons" % len(osm))
    node_ll, edges = build_network(raw, quiet=True)
    conn, _ = find_connectors(node_ll, edges)
    print("  raccords ajoutes :", len(conn), "(dont penalises : %d)" % sum(1 for c in conn if c[1] == CONNECTOR_V))
    raw.extend(conn)
    node_ll, edges = build_network(raw)
    uf, km = components(len(node_ll), edges)
    big = sorted(km.values(), reverse=True)
    print("  composantes :", len(big), "| plus grande :", round(big[0]), "km | suivantes :",
          [round(x) for x in big[1:6]])
    print("3/4 Gares")
    stations = load_stations(gtfs_path)
    snap_stations(stations, node_ll, edges)
    tiers(stations)
    print("4/4 Ecriture")
    rail = {
        "version": 1,
        "nodes": [[round(p[0], 5), round(p[1], 5)] for p in node_ll],
        "edges": [[e["a"], e["b"], e["v"], encode_polyline(e["ll"])] for e in edges],
    }
    with open(os.path.join(a.out, "rail.json"), "w", encoding="utf-8") as f:
        json.dump(rail, f, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(a.out, "stations.json"), "w", encoding="utf-8") as f:
        json.dump(stations, f, separators=(",", ":"), ensure_ascii=False)
    for n in ("rail.json", "stations.json"):
        print("  ", n, round(os.path.getsize(os.path.join(a.out, n)) / 1024), "Ko")


if __name__ == "__main__":
    sys.exit(main())
