// Réseau ferré : chargement, calcul d'itinéraire entre deux gares et géométrie des trajets.
//
// Le fichier data/rail.json contient un graphe : des nœuds (bifurcations) et des arêtes
// (tronçons de voie avec leur vitesse limite et leur tracé). Entre deux arrêts consécutifs
// d'un train, on cherche le chemin le plus rapide sur ce graphe ; le train est ensuite
// déplacé le long de ce chemin.

const RAD = Math.PI / 180;
const EARTH = 6371008.8;
const V_OFFNET = 25 / 1.3; // m/s : vitesse « de calcul » hors réseau (gares étrangères)
const CONNECTOR_PENALTY = 240; // s : pénalité d'un raccord ajouté pour combler un trou de données

export function hav(lon1, lat1, lon2, lat2) {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(h));
}

function decodePolyline(str) {
  const lon = [];
  const lat = [];
  let i = 0;
  let la = 0;
  let lo = 0;
  const n = str.length;
  while (i < n) {
    for (let k = 0; k < 2; k++) {
      let r = 0;
      let sh = 0;
      let b;
      do {
        b = str.charCodeAt(i++) - 63;
        r |= (b & 0x1f) << sh;
        sh += 5;
      } while (b >= 0x20);
      const d = r & 1 ? ~(r >> 1) : r >> 1;
      if (k === 0) la += d;
      else lo += d;
    }
    lat.push(la / 1e5);
    lon.push(lo / 1e5);
  }
  return [Float64Array.from(lon), Float64Array.from(lat)];
}

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }

  get size() {
    return this.k.length;
  }

  clear() {
    this.k.length = 0;
    this.v.length = 0;
  }

  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }

  pop() {
    const k = this.k;
    const v = this.v;
    const topV = v[0];
    this.topKey = k[0];
    const lastK = k.pop();
    const lastV = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return topV;
  }
}

export class Rail {
  constructor(rail, stations) {
    const E = rail.edges;
    const n = E.length;
    const N = rail.nodes.length;
    this.nodeCount = N;
    this.ea = new Int32Array(n);
    this.eb = new Int32Array(n);
    this.ev = new Float32Array(n);
    this.elen = new Float64Array(n);
    this.elon = new Array(n);
    this.elat = new Array(n);
    this.ecd = new Array(n);
    this.costHs = new Float64Array(n);
    this.costCl = new Float64Array(n);
    const deg = new Int32Array(N + 1);
    for (let i = 0; i < n; i++) {
      const [a, b, v, poly] = E[i];
      const [lon, lat] = decodePolyline(poly);
      const cd = new Float64Array(lon.length);
      for (let k = 1; k < lon.length; k++) cd[k] = cd[k - 1] + hav(lon[k - 1], lat[k - 1], lon[k], lat[k]);
      const len = cd[cd.length - 1];
      this.ea[i] = a;
      this.eb[i] = b;
      this.ev[i] = v;
      this.elen[i] = len;
      this.elon[i] = lon;
      this.elat[i] = lat;
      this.ecd[i] = cd;
      if (v <= 5) {
        this.costHs[i] = this.costCl[i] = CONNECTOR_PENALTY + len / 8;
      } else {
        this.costHs[i] = len / (Math.min(v, 320) / 3.6);
        const t = len / (Math.min(v, 160) / 3.6);
        this.costCl[i] = v >= 250 ? t * 3 : t; // un TER évite les LGV sauf nécessité
      }
      deg[a]++;
      deg[b]++;
    }
    // listes d'adjacence compactes
    this.adjStart = new Int32Array(N + 1);
    for (let i = 0; i < N; i++) this.adjStart[i + 1] = this.adjStart[i] + deg[i];
    this.adjNode = new Int32Array(2 * n);
    this.adjEdge = new Int32Array(2 * n);
    const fill = this.adjStart.slice(0, N);
    for (let i = 0; i < n; i++) {
      const a = this.ea[i];
      const b = this.eb[i];
      this.adjNode[fill[a]] = b;
      this.adjEdge[fill[a]++] = i;
      this.adjNode[fill[b]] = a;
      this.adjEdge[fill[b]++] = i;
    }
    this.dist = new Float64Array(N);
    this.stamp = new Uint32Array(N);
    this.prevNode = new Int32Array(N);
    this.prevEdge = new Int32Array(N);
    this.run = 0;
    this.heap = new Heap();
    this.cache = new Map();

    this.stations = stations;
    for (const uic in stations) {
      const s = stations[uic];
      s.uic = uic;
      s.n = s.n.replace(/ Hall 1 ?- ?2$/, ''); // « Paris Gare de Lyon Hall 1 - 2 » -> « Paris Gare de Lyon »
      s.off = s.s.some((x) => x.length > 2);
    }
  }

  /** Tracé de toutes les voies, pour l'affichage (classique / grande vitesse). */
  linesGeoJSON() {
    const classic = [];
    const lgv = [];
    for (let i = 0; i < this.ea.length; i++) {
      if (this.ev[i] <= 5) continue;
      const lon = this.elon[i];
      const lat = this.elat[i];
      const line = new Array(lon.length);
      for (let k = 0; k < lon.length; k++) line[k] = [lon[k], lat[k]];
      (this.ev[i] >= 250 ? lgv : classic).push(line);
    }
    return {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { k: 0 }, geometry: { type: 'MultiLineString', coordinates: classic } },
        { type: 'Feature', properties: { k: 1 }, geometry: { type: 'MultiLineString', coordinates: lgv } },
      ],
    };
  }

  /** Point à la distance d (m) le long de l'arête e. */
  _edgePoint(e, d) {
    const cd = this.ecd[e];
    const lon = this.elon[e];
    const lat = this.elat[e];
    let lo = 0;
    let hi = cd.length - 1;
    if (d <= 0) return [lon[0], lat[0]];
    if (d >= cd[hi]) return [lon[hi], lat[hi]];
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (cd[m] <= d) lo = m;
      else hi = m;
    }
    const r = (d - cd[lo]) / (cd[hi] - cd[lo] || 1);
    return [lon[lo] + (lon[hi] - lon[lo]) * r, lat[lo] + (lat[hi] - lat[lo]) * r];
  }

  /** Portion de l'arête e entre les fractions f0 et f1 (dans cet ordre). */
  _slice(e, f0, f1) {
    const L = this.elen[e];
    const d0 = f0 * L;
    const d1 = f1 * L;
    const lo = Math.min(d0, d1);
    const hi = Math.max(d0, d1);
    const cd = this.ecd[e];
    const lon = this.elon[e];
    const lat = this.elat[e];
    const pts = [this._edgePoint(e, lo)];
    for (let i = 0; i < cd.length; i++) if (cd[i] > lo && cd[i] < hi) pts.push([lon[i], lat[i]]);
    pts.push(this._edgePoint(e, hi));
    if (d1 < d0) pts.reverse();
    return pts;
  }

  _speed(e, cls) {
    const v = this.ev[e];
    if (v <= 5) return 30 / 3.6;
    return Math.min(v, cls === 'hs' ? 320 : 200) / 3.6;
  }

  _finish(pieces, cost) {
    const lon = [];
    const lat = [];
    const cd = [];
    const ct = [];
    let d = 0;
    let t = 0;
    for (const { pts, v } of pieces) {
      for (const p of pts) {
        const k = lon.length;
        if (k) {
          const seg = hav(lon[k - 1], lat[k - 1], p[0], p[1]);
          if (seg < 0.5) continue;
          d += seg;
          t += seg / v;
        }
        lon.push(p[0]);
        lat.push(p[1]);
        cd.push(d);
        ct.push(t);
      }
    }
    if (lon.length === 1) {
      lon.push(lon[0]);
      lat.push(lat[0]);
      cd.push(0);
      ct.push(0);
    }
    return { lon, lat, cd, ct, len: d, time: t, cost };
  }

  _straight(sa, sb, cls) {
    const v = cls === 'hs' ? 55 : 33;
    const p = this._finish([{ pts: [[sa.lon, sa.lat], [sb.lon, sb.lat]], v }], hav(sa.lon, sa.lat, sb.lon, sb.lat) / V_OFFNET);
    p.straight = true;
    return p;
  }

  _route(sa, sb, cls) {
    const cost = cls === 'hs' ? this.costHs : this.costCl;
    const vGap = cls === 'hs' ? 55 : 33;
    const direct = hav(sa.lon, sa.lat, sb.lon, sb.lat);
    let best = Infinity;
    let bestKind = 0; // 0 aucun, 1 ligne droite, 2 même arête, 3 via le graphe
    let bestA = null;
    let bestB = null;
    let bestNode = -1;
    if (sa.off || sb.off) {
      best = direct / V_OFFNET;
      bestKind = 1;
    }
    for (const x of sa.s) {
      for (const y of sb.s) {
        if (x[0] !== y[0]) continue;
        const c = Math.abs(x[1] - y[1]) * cost[x[0]] + ((x[2] || 0) + (y[2] || 0)) / V_OFFNET;
        if (c < best) {
          best = c;
          bestKind = 2;
          bestA = x;
          bestB = y;
        }
      }
    }
    // Dijkstra multi-sources / multi-cibles
    const run = ++this.run;
    const { dist, stamp, prevNode, prevEdge, heap, ea, eb, adjStart, adjNode, adjEdge } = this;
    heap.clear();
    const relax = (node, c, pn, pe) => {
      if (stamp[node] !== run || c < dist[node]) {
        stamp[node] = run;
        dist[node] = c;
        prevNode[node] = pn;
        prevEdge[node] = pe;
        heap.push(c, node);
      }
    };
    sa.s.forEach((x, i) => {
      const g = (x[2] || 0) / V_OFFNET;
      const c = cost[x[0]];
      relax(ea[x[0]], g + x[1] * c, -1, -1 - i);
      relax(eb[x[0]], g + (1 - x[1]) * c, -1, -1 - i);
    });
    const targets = new Map();
    for (const y of sb.s) {
      const g = (y[2] || 0) / V_OFFNET;
      const c = cost[y[0]];
      const add = (node, tc) => {
        const cur = targets.get(node);
        if (!cur || tc < cur.c) targets.set(node, { c: tc, y });
      };
      add(ea[y[0]], g + y[1] * c);
      add(eb[y[0]], g + (1 - y[1]) * c);
    }
    while (heap.size) {
      const node = heap.pop();
      const c = heap.topKey;
      if (c > dist[node]) continue;
      if (c >= best) break;
      const tg = targets.get(node);
      if (tg && c + tg.c < best) {
        best = c + tg.c;
        bestKind = 3;
        bestNode = node;
        bestB = tg.y;
      }
      for (let k = adjStart[node]; k < adjStart[node + 1]; k++) {
        const e = adjEdge[k];
        relax(adjNode[k], c + cost[e], node, e);
      }
    }
    if (bestKind <= 1) return this._straight(sa, sb, cls);

    const pieces = [];
    const gapPiece = (st, x, toStation) => {
      if (!x[2]) return;
      const p = this._edgePoint(x[0], x[1] * this.elen[x[0]]);
      pieces.push({ pts: toStation ? [p, [st.lon, st.lat]] : [[st.lon, st.lat], p], v: vGap });
    };
    if (bestKind === 2) {
      gapPiece(sa, bestA, false);
      pieces.push({ pts: this._slice(bestA[0], bestA[1], bestB[1]), v: this._speed(bestA[0], cls) });
      gapPiece(sb, bestB, true);
      return this._finish(pieces, best);
    }
    // remonte le chemin depuis le nœud d'arrivée
    const chain = [];
    let node = bestNode;
    while (prevEdge[node] >= 0) {
      chain.push([prevEdge[node], prevNode[node], node]);
      node = prevNode[node];
    }
    chain.reverse();
    const x = sa.s[-1 - prevEdge[node]];
    gapPiece(sa, x, false);
    pieces.push({ pts: this._slice(x[0], x[1], ea[x[0]] === node ? 0 : 1), v: this._speed(x[0], cls) });
    for (const [e, from] of chain) {
      const fwd = ea[e] === from;
      pieces.push({ pts: this._slice(e, fwd ? 0 : 1, fwd ? 1 : 0), v: this._speed(e, cls) });
    }
    const y = bestB;
    pieces.push({ pts: this._slice(y[0], ea[y[0]] === bestNode ? 0 : 1, y[1]), v: this._speed(y[0], cls) });
    gapPiece(sb, y, true);
    return this._finish(pieces, best);
  }

  /**
   * Trajet entre deux gares (codes UIC). cls : 'hs' (grande vitesse) ou 'cl' (classique).
   * sched : durée prévue en secondes, pour détecter un TER qui emprunte une LGV.
   * Renvoie { lon[], lat[], cd[] (m cumulés), ct[] (s cumulées à vitesse limite), len, time }.
   */
  route(a, b, cls, sched) {
    const key = a + '>' + b + '>' + cls;
    let p = this.cache.get(key);
    if (p) return p;
    const sa = this.stations[a];
    const sb = this.stations[b];
    if (!sa || !sb) return null;
    p = this._route(sa, sb, cls);
    if (cls === 'cl' && sched > 0 && p.cost > 1.15 * Math.max(sched, 60)) {
      const q = this._route(sa, sb, 'hs');
      if (q.cost < 0.8 * p.cost) p = q;
    }
    this.cache.set(key, p);
    return p;
  }
}

/** Position à l'instant tau (s, dans l'échelle « vitesse limite ») le long d'un trajet. */
export function pointAt(path, tau, out) {
  const ct = path.ct;
  let lo = 0;
  let hi = ct.length - 1;
  if (tau <= 0) hi = 1;
  else if (tau >= ct[hi]) lo = hi - 1;
  else {
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ct[m] <= tau) lo = m;
      else hi = m;
    }
  }
  const span = ct[hi] - ct[lo];
  const r = span > 0 ? Math.min(1, Math.max(0, (tau - ct[lo]) / span)) : 0;
  const lon1 = path.lon[lo];
  const lat1 = path.lat[lo];
  const lon2 = path.lon[hi];
  const lat2 = path.lat[hi];
  out.lon = lon1 + (lon2 - lon1) * r;
  out.lat = lat1 + (lat2 - lat1) * r;
  out.dist = path.cd[lo] + (path.cd[hi] - path.cd[lo]) * r;
  out.v = span > 0 ? (path.cd[hi] - path.cd[lo]) / span : 0;
  const dx = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * RAD);
  const dy = lat2 - lat1;
  if (dx !== 0 || dy !== 0) out.bearing = (Math.atan2(dx, dy) / RAD + 360) % 360;
  return out;
}

/** Coordonnées du trajet entre les distances d0 et d1 (m). */
export function sliceCoords(path, d0, d1) {
  const out = [];
  const { cd, lon, lat } = path;
  const at = (d) => {
    let lo = 0;
    let hi = cd.length - 1;
    if (d <= 0) return [lon[0], lat[0]];
    if (d >= cd[hi]) return [lon[hi], lat[hi]];
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (cd[m] <= d) lo = m;
      else hi = m;
    }
    const r = (d - cd[lo]) / (cd[hi] - cd[lo] || 1);
    return [lon[lo] + (lon[hi] - lon[lo]) * r, lat[lo] + (lat[hi] - lat[lo]) * r];
  };
  out.push(at(d0));
  for (let i = 0; i < cd.length; i++) if (cd[i] > d0 && cd[i] < d1) out.push([lon[i], lat[i]]);
  out.push(at(d1));
  return out;
}

export async function loadRail(base = 'data/') {
  const [rail, stations] = await Promise.all([
    fetch(base + 'rail.json').then((r) => r.json()),
    fetch(base + 'stations.json').then((r) => r.json()),
  ]);
  return new Rail(rail, stations);
}
