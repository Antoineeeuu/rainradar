#!/usr/bin/env python3
"""
RailRadar - generation des horaires urbains (RER, Transilien, metro, tram...).

Lance chaque nuit par la tache GitHub (.github/workflows/urban-data.yml) ; peut aussi
etre lance a la main pour tester en local :

    python3 tools/build_urban.py              # ecrit dans public/urban/
    python3 tools/build_urban.py --out dist   # ecrit ailleurs

Pour chaque reseau, deux sortes de fichiers sont produites :
  <reseau>.json           lignes, stations, traces, trajets types et profils horaires
  <reseau>-AAAAMMJJ.json  les departs de chaque trajet pour un jour de service donne
et un manifest.json qui liste le tout.

Sources (licence ODbL ou Licence Ouverte) :
  - Ile-de-France Mobilites : horaires GTFS (metro, RER, Transilien, tram, Orlyval, CDGVAL)
  - Ilevia (Lille) : horaires GTFS (metro, tram) ; traces OpenStreetMap (tools/lille_osm.geojson)
  - TBM (Bordeaux Metropole) : horaires GTFS (tram, bus express G)

Aucune dependance : Python 3.8+ suffit.
"""
import argparse
import collections
import csv
import datetime
import heapq
import io
import json
import math
import os
import sys
import time
import urllib.request
import zipfile

try:
    from zoneinfo import ZoneInfo
    PARIS = ZoneInfo("Europe/Paris")
except Exception:  # pragma: no cover
    PARIS = None

HERE = os.path.dirname(os.path.abspath(__file__))
SIMPLIFY = 2.5   # m
SNAP_MAX = 250   # m : distance max arret -> voie (traces OSM)
DAYS = (-1, 0, 1, 2)  # jours generes autour d'aujourd'hui (veille pour les trajets apres minuit)


def idf_mode(r):
    t, s = r["route_type"], r["route_short_name"].strip()
    if s in ("ORLYVAL", "CDG VAL"):
        return "val"
    if t == "1":
        return "metro"
    if t == "0":
        return "tram"
    if t == "2":
        return "rer" if s in ("A", "B", "C", "D", "E") else "transilien"
    return None


def idf_label(r):
    s = r["route_short_name"].strip()
    return {"ORLYVAL": "OV", "CDG VAL": "CDG"}.get(s, s)


NETWORKS = {
    "idf": {
        "name": "Île-de-France",
        "url": "https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip",
        "keep": lambda r: r["route_type"] in ("0", "1", "2") and r["route_short_name"].strip() not in ("TER", "FUN"),
        "mode": idf_mode,
        "label": idf_label,
        "trip_ids": False,
    },
    "lille": {
        "name": "Lille",
        "url": "https://media.ilevia.fr/opendata/gtfs.zip",
        "keep": lambda r: r["route_id"] in ("ME1", "ME2", "71"),
        "mode": lambda r: "metro" if r["route_type"] == "1" else "tram",
        "label": lambda r: {"ME1": "M1", "ME2": "M2", "71": "T"}.get(r["route_id"], r["route_short_name"]),
        "osm": "lille_osm.geojson",
        "trip_ids": False,
    },
    "bdx": {
        "name": "Bordeaux",
        "url": "https://bdx.mecatran.com/utw/ws/gtfsfeed/static/bordeaux?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt",
        "keep": lambda r: r["route_id"] in ("59", "60", "61", "62", "163", "164", "901"),
        "mode": lambda r: "bus" if r["route_type"] == "3" else "tram",
        "label": lambda r: r["route_short_name"].strip(),
        "trip_ids": True,
    },
}

# ------------------------------------------------------------------------------------------
# Geometrie


def xy(lon, lat, lat0):
    return (lon * 111320.0 * math.cos(math.radians(lat0)), lat * 110574.0)


def hav(a, b):
    r = 6371008.8
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    dp = p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def dseg(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    lat0 = pts[0][1]
    P = [xy(p[0], p[1], lat0) for p in pts]
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


def encode_polyline(coords):
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


def decode_rounded(coords):
    """Arrondit comme le fera le navigateur apres decodage (precision 1e-5)."""
    return [(round(lon, 5), round(lat, 5)) for lon, lat in coords]


def cumdist(pts):
    c = [0.0]
    for i in range(1, len(pts)):
        c.append(c[-1] + hav(pts[i - 1], pts[i]))
    return c


def project_monotonic(shape, cum, stops):
    """Distance le long du trace pour chaque arret.

    Optimisation globale (programmation dynamique) : chaque arret a plusieurs positions
    candidates sur le trace (les passages au plus pres) ; on choisit la combinaison
    croissante qui minimise l'ecart aux arrets et les sauts incoherents avec la distance
    a vol d'oiseau entre arrets consecutifs.
    """
    lat0 = shape[0][1]
    P = [xy(p[0], p[1], lat0) for p in shape]
    Q = [xy(p[0], p[1], lat0) for p in stops]
    n = len(P)
    cands = []
    for q in Q:
        ds = []
        for i in range(n - 1):
            d, t = dseg(q, P[i], P[i + 1])
            ds.append((d, cum[i] + t * (cum[i + 1] - cum[i])))
        dmin = min(d for d, _ in ds)
        lim = max(dmin * 2 + 60, 200)
        # minima locaux sous le seuil
        best = []
        for i, (d, al) in enumerate(ds):
            if d > lim:
                continue
            left = ds[i - 1][0] if i > 0 else float("inf")
            right = ds[i + 1][0] if i + 1 < len(ds) else float("inf")
            if d <= left and d <= right:
                best.append((d, al))
        if not best:
            best = [min(ds)]
        best.sort()
        cands.append(best[:12])
    crow = [0.0] + [math.hypot(Q[k][0] - Q[k - 1][0], Q[k][1] - Q[k - 1][1]) for k in range(1, len(Q))]
    INF = float("inf")
    dp = [[c[0] for c in cands[0]]]
    back = [[-1] * len(cands[0])]
    for k in range(1, len(Q)):
        row, brow = [], []
        for d, al in cands[k]:
            bestv, bi = INF, -1
            for j, (dj, alj) in enumerate(cands[k - 1]):
                if dp[k - 1][j] == INF or al + 5 < alj:
                    continue
                gap = al - alj
                pen = max(0.0, gap - (2.2 * crow[k] + 400)) * 0.6 + max(0.0, (0.7 * crow[k] - 80) - gap) * 0.6
                v = dp[k - 1][j] + pen
                if v < bestv:
                    bestv, bi = v, j
            row.append(bestv + d if bi >= 0 else INF)
            brow.append(bi)
        if all(v == INF for v in row):
            # aucun enchainement croissant : on repart du meilleur candidat
            row = [d for d, _ in cands[k]]
            brow = [-2] * len(cands[k])
        dp.append(row)
        back.append(brow)
    out = [0.0] * len(Q)
    j = min(range(len(dp[-1])), key=lambda i: dp[-1][i])
    for k in range(len(Q) - 1, -1, -1):
        out[k] = cands[k][j][1]
        bj = back[k][j]
        if bj == -2:
            j = min(range(len(dp[k - 1])), key=lambda i: dp[k - 1][i])
        elif bj >= 0:
            j = bj
    for k in range(1, len(out)):
        out[k] = max(out[k], out[k - 1])
    return out


class Graph:
    """Graphe de voies (OpenStreetMap) pour fabriquer un trace quand le GTFS n'en a pas."""

    def __init__(self, lines):
        self.nodes = {}
        self.pos = []
        self.adj = []
        self.segs = []
        for ll in lines:
            ids = [self._node(p) for p in ll]
            for a, b in zip(ids, ids[1:]):
                if a == b:
                    continue
                d = hav(self.pos[a], self.pos[b])
                self.adj[a].append((b, d))
                self.adj[b].append((a, d))
                self.segs.append((a, b))
        self.lat0 = sum(p[1] for p in self.pos) / max(1, len(self.pos))
        self.grid = collections.defaultdict(list)
        self.G = 300.0
        for si, (a, b) in enumerate(self.segs):
            pa, pb = self._xy(a), self._xy(b)
            for gx in range(int(min(pa[0], pb[0]) // self.G), int(max(pa[0], pb[0]) // self.G) + 1):
                for gy in range(int(min(pa[1], pb[1]) // self.G), int(max(pa[1], pb[1]) // self.G) + 1):
                    self.grid[(gx, gy)].append(si)

    def _node(self, p):
        k = (round(p[0], 6), round(p[1], 6))
        i = self.nodes.get(k)
        if i is None:
            i = len(self.pos)
            self.nodes[k] = i
            self.pos.append(k)
            self.adj.append([])
        return i

    def _xy(self, i):
        p = self.pos[i]
        return xy(p[0], p[1], self.lat0)

    def snap(self, lon, lat):
        q = xy(lon, lat, self.lat0)
        gx, gy = int(q[0] // self.G), int(q[1] // self.G)
        best = (SNAP_MAX, None)
        for ax in (-1, 0, 1):
            for ay in (-1, 0, 1):
                for si in self.grid.get((gx + ax, gy + ay), ()):
                    a, b = self.segs[si]
                    d, t = dseg(q, self._xy(a), self._xy(b))
                    if d < best[0]:
                        best = (d, (a, b, t))
        return best[1]

    def path(self, s1, s2):
        """Plus court chemin entre deux arrets accroches (a, b, t)."""
        a1, b1, t1 = s1
        a2, b2, t2 = s2
        pa = lambda a, b, t: (self.pos[a][0] + (self.pos[b][0] - self.pos[a][0]) * t,
                              self.pos[a][1] + (self.pos[b][1] - self.pos[a][1]) * t)
        p1, p2 = pa(a1, b1, t1), pa(a2, b2, t2)
        if {a1, b1} == {a2, b2}:
            return [p1, p2]
        L1 = hav(self.pos[a1], self.pos[b1])
        L2 = hav(self.pos[a2], self.pos[b2])
        dist = {a1: t1 * L1, b1: (1 - t1) * L1}
        prev = {a1: None, b1: None}
        pq = [(dist[a1], a1), (dist[b1], b1)]
        heapq.heapify(pq)
        goal = {a2: t2 * L2, b2: (1 - t2) * L2}
        best = (float("inf"), None)
        done = set()
        while pq:
            d, n = heapq.heappop(pq)
            if n in done or d > dist.get(n, float("inf")):
                continue
            done.add(n)
            if d >= best[0]:
                break
            if n in goal and d + goal[n] < best[0]:
                best = (d + goal[n], n)
            for m, w in self.adj[n]:
                nd = d + w
                if nd < dist.get(m, float("inf")):
                    dist[m] = nd
                    prev[m] = n
                    heapq.heappush(pq, (nd, m))
        if best[1] is None or best[0] > 2.5 * hav(p1, p2) + 800:
            return [p1, p2]
        chain = []
        n = best[1]
        while n is not None:
            chain.append(self.pos[n])
            n = prev[n]
        chain.reverse()
        return [p1] + chain + [p2]


# ------------------------------------------------------------------------------------------
# GTFS


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0 and time.time() - os.path.getmtime(path) < 6 * 3600:
        return
    print("  telechargement", url)
    req = urllib.request.Request(url, headers={"User-Agent": "railradar-build"})
    tmp = path + ".part"
    with urllib.request.urlopen(req, timeout=900) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 17)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, path)


def secs(t):
    if not t:
        return None
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def reader(z, name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))


def active_services(z, dates):
    """{date: set(service_id)} pour chaque date (AAAAMMJJ)."""
    out = {d: set() for d in dates}
    names = set(z.namelist())
    if "calendar.txt" in names:
        for c in reader(z, "calendar.txt"):
            for d in dates:
                dt = datetime.datetime.strptime(d, "%Y%m%d")
                wd = dt.strftime("%A").lower()
                if c["start_date"] <= d <= c["end_date"] and c.get(wd) == "1":
                    out[d].add(c["service_id"])
    if "calendar_dates.txt" in names:
        for c in reader(z, "calendar_dates.txt"):
            d = c["date"]
            if d in out:
                if c["exception_type"] == "1":
                    out[d].add(c["service_id"])
                else:
                    out[d].discard(c["service_id"])
    return out


def point_at(shape, cum, d):
    for i in range(len(cum) - 1):
        if cum[i + 1] >= d:
            r = (d - cum[i]) / ((cum[i + 1] - cum[i]) or 1)
            return (shape[i][0] + (shape[i + 1][0] - shape[i][0]) * r, shape[i][1] + (shape[i + 1][1] - shape[i][1]) * r)
    return shape[-1]


def slice_shape(shape, cum, d0, d1):
    pts = [point_at(shape, cum, d0)]
    pts += [shape[i] for i in range(len(cum)) if d0 < cum[i] < d1]
    pts.append(point_at(shape, cum, d1))
    return pts


def bad_gap(dd, crow):
    return dd > 2.5 * crow + 800 or dd < 0.6 * crow - 80


def build_network(key, cfg, zpath, dates, build_id):
    t0 = time.time()
    z = zipfile.ZipFile(zpath)
    routes = {}
    for r in reader(z, "routes.txt"):
        if cfg["keep"](r) and cfg["mode"](r):
            routes[r["route_id"]] = r
    services = active_services(z, dates)
    any_service = set().union(*services.values())
    trips = {}
    for t in reader(z, "trips.txt"):
        if t["route_id"] in routes and t["service_id"] in any_service:
            trips[t["trip_id"]] = t
    print("  %s : %d lignes, %d trajets sur %d jours" % (key, len(routes), len(trips), len(dates)))

    # horaires detailles
    times = collections.defaultdict(list)
    with z.open("stop_times.txt") as fh:
        rd = csv.reader(io.TextIOWrapper(fh, encoding="utf-8-sig"))
        h = next(rd)
        i_trip, i_stop, i_seq = h.index("trip_id"), h.index("stop_id"), h.index("stop_sequence")
        i_arr, i_dep = h.index("arrival_time"), h.index("departure_time")
        for row in rd:
            tid = row[i_trip]
            if tid in trips:
                arr, dep = secs(row[i_arr]), secs(row[i_dep])
                if arr is None and dep is None:
                    continue
                times[tid].append((int(row[i_seq]), row[i_stop], arr if arr is not None else dep, dep if dep is not None else arr))
    used_stops = set(s[1] for v in times.values() for s in v)

    # arrets et stations
    all_stops = {s["stop_id"]: s for s in reader(z, "stops.txt")}
    st_index = {}
    stations = []
    stops_out = []
    stop_index = {}
    for sid in sorted(used_stops):
        s = all_stops.get(sid)
        if not s:
            continue
        par = s.get("parent_station") or ""
        ps = all_stops.get(par) if par else None
        skey = par if ps else sid
        if skey not in st_index:
            src = ps or s
            st_index[skey] = len(stations)
            stations.append([src["stop_name"].strip(), float(src["stop_lon"]), float(src["stop_lat"]), set()])
        stop_index[sid] = len(stops_out)
        stops_out.append([st_index[skey], sid.split(":")[-1], float(s["stop_lon"]), float(s["stop_lat"])])

    # traces
    shapes_raw = {}
    shape_ids = set(t.get("shape_id") for t in trips.values() if t.get("shape_id"))
    if shape_ids and "shapes.txt" in z.namelist():
        tmp = collections.defaultdict(list)
        with z.open("shapes.txt") as fh:
            rd = csv.reader(io.TextIOWrapper(fh, encoding="utf-8-sig"))
            h = next(rd)
            i_id, i_lat, i_lon, i_seq = h.index("shape_id"), h.index("shape_pt_lat"), h.index("shape_pt_lon"), h.index("shape_pt_sequence")
            for row in rd:
                if row[i_id] in shape_ids:
                    tmp[row[i_id]].append((int(row[i_seq]), float(row[i_lon]), float(row[i_lat])))
        for sid, pts in tmp.items():
            pts.sort()
            shapes_raw[sid] = [(p[1], p[2]) for p in pts]
    graph = None
    if cfg.get("osm"):
        gj = json.load(open(os.path.join(HERE, cfg["osm"]), encoding="utf-8"))
        graph = {
            "metro": Graph([f["geometry"]["coordinates"] for f in gj["features"] if f["properties"]["m"] == "subway"]),
            "tram": Graph([f["geometry"]["coordinates"] for f in gj["features"] if f["properties"]["m"] != "subway"]),
        }

    lines = []
    line_index = {}
    for rid, r in sorted(routes.items(), key=lambda kv: (kv[1].get("route_sort_order") or "", kv[1]["route_short_name"])):
        line_index[rid] = len(lines)
        color = (r.get("route_color") or "888888").upper()
        text = (r.get("route_text_color") or "").upper() or "FFFFFF"
        lines.append([rid, cfg["label"](r), cfg["mode"](r), color, text, (r.get("route_long_name") or "").strip()])

    shapes_out = []
    shape_index = {}
    shape_cum = []
    patterns = []
    pattern_index = {}
    profiles = []
    profile_index = {}
    trip_rows = {}

    def get_shape(shape_key, pts):
        if shape_key in shape_index:
            return shape_index[shape_key]
        pts = decode_rounded(simplify(pts, SIMPLIFY))
        dedup = [pts[0]] + [p for i, p in enumerate(pts[1:], 1) if p != pts[i - 1]]
        if len(dedup) < 2:
            dedup = dedup * 2
        shape_index[shape_key] = len(shapes_out)
        shapes_out.append(dedup)
        shape_cum.append(cumdist(dedup))
        return shape_index[shape_key]

    graph_cache = {}
    repaired = [0]
    alias = {}
    for tid, st in times.items():
        t = trips[tid]
        st.sort()
        seq = [s for s in st if s[1] in stop_index]
        if len(seq) < 2:
            continue
        stop_ids = tuple(stop_index[s[1]] for s in seq)
        # trace
        if t.get("shape_id") and t["shape_id"] in shapes_raw:
            skey = ("gtfs", t["shape_id"])
            sh = get_shape(skey, shapes_raw[t["shape_id"]])
        elif graph is not None:
            if stop_ids not in graph_cache:
                pts = []
                g = graph.get(cfg["mode"](routes[t["route_id"]])) or graph["tram"]
                snaps = [g.snap(stops_out[i][2], stops_out[i][3]) for i in stop_ids]
                for k in range(len(stop_ids) - 1):
                    a, b = stop_ids[k], stop_ids[k + 1]
                    if snaps[k] and snaps[k + 1]:
                        part = g.path(snaps[k], snaps[k + 1])
                    else:
                        part = [(stops_out[a][2], stops_out[a][3]), (stops_out[b][2], stops_out[b][3])]
                    pts.extend(part if not pts else part[1:])
                graph_cache[stop_ids] = get_shape(("osm", stop_ids), pts)
            sh = graph_cache[stop_ids]
        else:
            pts = [(stops_out[i][2], stops_out[i][3]) for i in stop_ids]
            sh = get_shape(("line", stop_ids), pts)
        head = (t.get("trip_headsign") or "").strip()
        if not head or (len(head) == 4 and head.isupper() and head.isalnum()):
            # code de mission Transilien/RER (ex. « POMA ») : on affiche le terminus
            head = stations[stops_out[stop_ids[-1]][0]][0]
        li = line_index[t["route_id"]]
        pkey = (li, sh, head, stop_ids)
        pkey = alias.get(pkey, pkey)
        if pkey not in pattern_index:
            orig = pkey
            spts = [(stops_out[i][2], stops_out[i][3]) for i in stop_ids]
            dists = project_monotonic(shapes_out[sh], shape_cum[sh], spts)
            gaps = [k for k in range(len(spts) - 1) if bad_gap(dists[k + 1] - dists[k], hav(spts[k], spts[k + 1]))]
            if gaps:
                # trace officiel aberrant sur certains tronçons : on les remplace par une ligne directe
                shp, cm = shapes_out[sh], shape_cum[sh]
                pts = []
                for k in range(len(spts) - 1):
                    part = [spts[k], spts[k + 1]] if k in gaps else slice_shape(shp, cm, dists[k], dists[k + 1])
                    pts.extend(part if not pts else part[1:])
                sh = get_shape(("fix", sh, stop_ids), pts)
                dists = project_monotonic(shapes_out[sh], shape_cum[sh], spts)
                pkey = (li, sh, head, stop_ids)
                alias[orig] = pkey
                repaired[0] += 1
        if pkey not in pattern_index:
            pattern_index[pkey] = len(patterns)
            patterns.append([li, sh, head, list(stop_ids), [int(round(d)) for d in dists]])
            for i in stop_ids:
                stations[stops_out[i][0]][3].add(li)
        pi = pattern_index[pkey]
        start = seq[0][3]
        arr = tuple(s[2] - start for s in seq)
        dep = tuple(s[3] - start for s in seq)
        prk = (pi, arr, dep)
        if prk not in profile_index:
            profile_index[prk] = len(profiles)
            profiles.append([pi, list(arr), list(dep)])
        trip_rows[tid] = (profile_index[prk], start)

    # fichiers par jour
    days = {}
    for d in dates:
        rows = []
        for tid, (pr, start) in trip_rows.items():
            if trips[tid]["service_id"] in services[d]:
                rows.append((start, pr, tid))
        rows.sort()
        flat = []
        for start, pr, tid in rows:
            flat.extend((pr, start))
        day = {"v": 1, "build": build_id, "net": key, "date": d, "trips": flat}
        if cfg.get("trip_ids"):
            day["ids"] = [tid for _, _, tid in rows]
        days[d] = (day, len(rows))

    # stations : uniquement celles desservies, et lignes associees
    lat_all = [s[2] for s in stations]
    lon_all = [s[1] for s in stations]
    static = {
        "v": 1,
        "build": build_id,
        "net": key,
        "name": cfg["name"],
        "bbox": [round(min(lon_all), 4), round(min(lat_all), 4), round(max(lon_all), 4), round(max(lat_all), 4)],
        "lines": lines,
        "stations": [[s[0], round(s[1], 5), round(s[2], 5), sorted(s[3])] for s in stations],
        "stops": [[s[0], s[1]] for s in stops_out],
        "shapes": [encode_polyline(s) for s in shapes_out],
        "patterns": patterns,
        "profiles": profiles,
    }
    print("  %s : %d stations, %d traces (%d repares), %d trajets types, %d profils (%.0fs)" % (
        key, len(stations), len(shapes_out), repaired[0], len(patterns), len(profiles), time.time() - t0))
    return static, days


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(HERE, ".cache"))
    ap.add_argument("--out", default=os.path.join(HERE, "..", "public", "urban"))
    ap.add_argument("--only", default="", help="reseaux a generer, ex. lille,bdx")
    ap.add_argument("--date", default="", help="date de reference AAAAMMJJ (defaut : aujourd'hui a Paris)")
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    os.makedirs(a.out, exist_ok=True)
    if a.date:
        today = datetime.datetime.strptime(a.date, "%Y%m%d").date()
    else:
        now = datetime.datetime.now(PARIS) if PARIS else datetime.datetime.now()
        today = now.date()
    dates = [(today + datetime.timedelta(days=k)).strftime("%Y%m%d") for k in DAYS]
    build_id = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M")
    only = set(x for x in a.only.split(",") if x)
    manifest_path = os.path.join(a.out, "manifest.json")
    try:
        manifest = json.load(open(manifest_path, encoding="utf-8"))
    except Exception:
        manifest = {"v": 1, "nets": {}}
    for key, cfg in NETWORKS.items():
        if only and key not in only:
            continue
        print("Reseau", key)
        zpath = os.path.join(a.cache, key + ".zip")
        try:
            fetch(cfg["url"], zpath)
            static, days = build_network(key, cfg, zpath, dates, build_id)
        except Exception as e:  # un reseau en panne ne bloque pas les autres
            print("  ERREUR", key, e)
            continue
        with open(os.path.join(a.out, key + ".json"), "w", encoding="utf-8") as f:
            json.dump(static, f, separators=(",", ":"), ensure_ascii=False)
        for d, (day, n) in days.items():
            with open(os.path.join(a.out, "%s-%s.json" % (key, d)), "w", encoding="utf-8") as f:
                json.dump(day, f, separators=(",", ":"), ensure_ascii=False)
        # supprime les vieux jours
        for fn in os.listdir(a.out):
            if fn.startswith(key + "-") and fn.endswith(".json") and fn[len(key) + 1:-5] not in days:
                os.remove(os.path.join(a.out, fn))
        manifest["nets"][key] = {"build": build_id, "name": cfg["name"], "bbox": static["bbox"], "dates": sorted(days)}
        sizes = [os.path.getsize(os.path.join(a.out, key + ".json"))] + \
                [os.path.getsize(os.path.join(a.out, "%s-%s.json" % (key, d))) for d in days]
        print("  fichiers : %d Ko + %s Ko/jour" % (sizes[0] // 1024, "/".join(str(s // 1024) for s in sizes[1:])))
    manifest["updated"] = build_id
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, separators=(",", ":"), ensure_ascii=False)
    print("manifest.json ecrit")


if __name__ == "__main__":
    sys.exit(main())
