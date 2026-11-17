// Réseaux urbains : RER, Transilien, métro, tram, Orlyval/CDGVAL (Île-de-France),
// métro et tram (Lille), tram et bus express (Bordeaux).
//
// Les horaires du jour sont générés chaque nuit (tools/build_urban.py) et chargés
// seulement quand la carte montre la ville concernée. Les positions sont calculées
// uniquement pour les lignes affichées et la zone visible, pour rester fluide.

import { compactEstimatedTimetable } from './idfm-transform.js';

const RAD = Math.PI / 180;

export const CITIES = [
  { id: 'idf', modes: ['rer', 'transilien', 'metro', 'tram', 'val'] },
  { id: 'lille', modes: ['metro', 'tram'] },
  { id: 'bdx', modes: ['tram', 'bus'] },
];

// Zoom minimal d'apparition des véhicules (v), des tracés (l) et des stations (s).
const ZOOMS = {
  rer: { v: 9, l: 8.5, s: 10.5 },
  transilien: { v: 9.5, l: 9, s: 11 },
  metro: { v: 11.5, l: 11, s: 12.5 },
  tram: { v: 11.5, l: 11, s: 13 },
  val: { v: 11.5, l: 11, s: 12.5 },
  bus: { v: 12, l: 11.5, s: 13.5 },
};
const SMALL_CITY = { lille: -0.5, bdx: -0.5 }; // villes plus compactes : un peu plus tôt

export function zoomFor(net, mode, kind) {
  return (ZOOMS[mode] || ZOOMS.tram)[kind] + (SMALL_CITY[net] || 0);
}

const SOURCE = { idf: 'rt', lille: 'mixed', bdx: 'gps' };
const IDFM_URL = '/api/idfm';
const BDX_VP_URL = 'https://bdx.mecatran.com/utw/ws/gtfsfeed/vehicles/bordeaux?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt';
const LILLE_WFS = 'https://data.lillemetropole.fr/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json&typeNames=';
const RT_EVERY = { idf: 90e3, lille: 60e3, bdx: 20e3 }; // Île-de-France : réponse en cache 3 min côté Netlify
const ALERTS_EVERY = 5 * 60e3;
const RT_FRESH = 4 * 60; // s : au-delà, une position GPS est ignorée
const GPS_ANIM = 18; // s : durée du glissement entre deux positions GPS

// ---- Outils --------------------------------------------------------------------------------

function hav(lon1, lat1, lon2, lat2) {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function decodePolyline(str) {
  const lon = [];
  const lat = [];
  let i = 0;
  let la = 0;
  let lo = 0;
  while (i < str.length) {
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
  const cd = new Float64Array(lon.length);
  for (let k = 1; k < lon.length; k++) cd[k] = cd[k - 1] + hav(lon[k - 1], lat[k - 1], lon[k], lat[k]);
  return { lon: Float64Array.from(lon), lat: Float64Array.from(lat), cd };
}

function shapePoint(sh, d, out) {
  const cd = sh.cd;
  let lo = 0;
  let hi = cd.length - 1;
  if (d <= 0) hi = Math.min(1, hi);
  else if (d >= cd[hi]) lo = Math.max(0, hi - 1);
  else {
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (cd[m] <= d) lo = m;
      else hi = m;
    }
  }
  const span = cd[hi] - cd[lo];
  const r = span > 0 ? Math.min(1, Math.max(0, (d - cd[lo]) / span)) : 0;
  out.lon = sh.lon[lo] + (sh.lon[hi] - sh.lon[lo]) * r;
  out.lat = sh.lat[lo] + (sh.lat[hi] - sh.lat[lo]) * r;
  const dx = (sh.lon[hi] - sh.lon[lo]) * Math.cos(out.lat * RAD);
  const dy = sh.lat[hi] - sh.lat[lo];
  if (dx || dy) out.bearing = (Math.atan2(dx, dy) / RAD + 360) % 360;
  return out;
}

function shapeSlice(sh, d0, d1) {
  const out = [];
  const p = {};
  shapePoint(sh, d0, p);
  out.push([p.lon, p.lat]);
  for (let i = 0; i < sh.cd.length; i++) if (sh.cd[i] > d0 && sh.cd[i] < d1) out.push([sh.lon[i], sh.lat[i]]);
  shapePoint(sh, d1, p);
  out.push([p.lon, p.lat]);
  return out;
}

/** Projette un point sur un tracé entre deux distances ; renvoie la distance le long du tracé. */
function projectOnShape(sh, lon, lat, dmin, dmax, near) {
  const k = Math.cos(lat * RAD);
  let best = Infinity;
  let bestD = near;
  for (let i = 0; i < sh.cd.length - 1; i++) {
    if (sh.cd[i + 1] < dmin || sh.cd[i] > dmax) continue;
    const ax = sh.lon[i] * k;
    const ay = sh.lat[i];
    const bx = sh.lon[i + 1] * k;
    const by = sh.lat[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((lon * k - ax) * dx + (lat - ay) * dy) / l2)) : 0;
    const ex = ax + dx * t - lon * k;
    const ey = ay + dy * t - lat;
    const al = sh.cd[i] + t * (sh.cd[i + 1] - sh.cd[i]);
    // pénalise les sauts lointains le long du tracé (lignes qui repassent au même endroit)
    let score = (ex * ex + ey * ey) * 1.2e10;
    if (near != null) score += Math.max(0, Math.abs(al - near) - 1500) * 0.5;
    if (score < best) {
      best = score;
      bestD = al;
    }
  }
  return bestD;
}

const parisFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function parisParts(ms) {
  const o = {};
  for (const p of parisFmt.formatToParts(ms)) o[p.type] = p.value;
  return o;
}

/** Instant (s) correspondant à une heure murale de Paris. */
function parisEpoch(y, mo, d, h = 0, mi = 0, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const p = parisParts(guess);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((guess - (asUtc - guess)) / 1000);
}

export function parisDate(sec) {
  const p = parisParts(sec * 1000);
  return p.year + p.month + p.day;
}

function shiftDate(yyyymmdd, days) {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function ramp(f, a) {
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  if (a <= 0.001) return f;
  const k = 1 / (2 * a * (1 - a));
  if (f < a) return k * f * f;
  if (f > 1 - a) return 1 - k * (1 - f) * (1 - f);
  return (f - a / 2) / (1 - a);
}

function rampSlope(f, a) {
  if (f <= 0 || f >= 1) return 0;
  if (a <= 0.001) return 1;
  const k = 1 / (2 * a * (1 - a));
  if (f < a) return 2 * k * f;
  if (f > 1 - a) return 2 * k * (1 - f);
  return 1 / (1 - a);
}

function hexColor(h) {
  return '#' + (h || '888888').replace('#', '').padStart(6, '0').slice(0, 6);
}

// ---- Réseau chargé --------------------------------------------------------------------------

class Network {
  constructor(id, S) {
    this.id = id;
    this.name = S.name;
    this.bbox = S.bbox;
    this.lines = S.lines.map((l, i) => ({
      i,
      id: l[0],
      code: String(l[0]).split(':').pop(),
      label: l[1],
      mode: l[2],
      color: hexColor(l[3]),
      text: hexColor(l[4]),
      long: l[5],
      net: id,
    }));
    this.stations = S.stations.map((s, i) => ({ i, n: s[0], lon: s[1], lat: s[2], lines: s[3], net: id }));
    this.stops = S.stops.map((s) => ({ st: s[0], key: s[1] }));
    this.shapes = S.shapes.map(decodePolyline);
    this.patterns = S.patterns.map((p) => {
      const sh = this.shapes[p[1]];
      let minLon = Infinity;
      let minLat = Infinity;
      let maxLon = -Infinity;
      let maxLat = -Infinity;
      for (let i = 0; i < sh.lon.length; i++) {
        if (sh.cd[i] < p[4][0] - 50 || sh.cd[i] > p[4][p[4].length - 1] + 50) continue;
        if (sh.lon[i] < minLon) minLon = sh.lon[i];
        if (sh.lon[i] > maxLon) maxLon = sh.lon[i];
        if (sh.lat[i] < minLat) minLat = sh.lat[i];
        if (sh.lat[i] > maxLat) maxLat = sh.lat[i];
      }
      return { line: this.lines[p[0]], shape: sh, head: p[2], stops: p[3], dists: p[4], bbox: [minLon, minLat, maxLon, maxLat] };
    });
    this.profiles = S.profiles.map((p) => ({ pat: this.patterns[p[0]], arr: p[1], dep: p[2], dur: p[1][p[1].length - 1] }));
    this.trips = [];
    this.byKey = new Map();
    this.byId = new Map();
    this.days = new Set();
    this.maxDur = 0;
    this.rtAt = 0; // dernier temps réel reçu (s)
    this.rtState = 'none'; // none | ok | nokey | error
    this.gpsAt = 0;
    this.alerts = new Map(); // ligne -> [messages]
    this.stationTrips = null;
  }

  addDay(day) {
    if (this.days.has(day.date)) return;
    this.days.add(day.date);
    const base = parisEpoch(+day.date.slice(0, 4), +day.date.slice(4, 6), +day.date.slice(6, 8));
    const flat = day.trips;
    for (let i = 0, k = 0; i < flat.length; i += 2, k++) {
      const prof = this.profiles[flat[i]];
      if (!prof) continue;
      const start = base + flat[i + 1];
      const tr = {
        key: day.date + '.' + k,
        net: this,
        prof,
        line: prof.pat.line,
        start,
        end: start + prof.dur,
        delay: 0,
        rtAt: 0,
        cancel: false,
        gps: null,
        li: 0,
        pos: null,
      };
      this.trips.push(tr);
      this.byKey.set(tr.key, tr);
      if (day.ids) this.byId.set(day.ids[k], tr);
      if (prof.dur > this.maxDur) this.maxDur = prof.dur;
    }
    this.trips.sort((a, b) => a.start - b.start);
    this.stationTrips = null;
  }

  /** Trajets dont l'horaire couvre l'instant `now` (retard possible inclus). */
  *running(now, slack = 1800) {
    const lo = now - this.maxDur - slack;
    const T = this.trips;
    let a = 0;
    let b = T.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (T[m].start < lo) a = m + 1;
      else b = m;
    }
    for (let i = a; i < T.length && T[i].start <= now + 60; i++) {
      const tr = T[i];
      if (tr.end + slack >= now) yield tr;
    }
  }

  indexStations() {
    if (this.stationTrips) return this.stationTrips;
    const idx = new Map();
    const byProf = new Map();
    for (const tr of this.trips) {
      const l = byProf.get(tr.prof);
      if (l) l.push(tr);
      else byProf.set(tr.prof, [tr]);
    }
    for (const [prof, list] of byProf) {
      prof.pat.stops.forEach((s, pos) => {
        const st = this.stops[s].st;
        const e = idx.get(st);
        const item = { prof, pos, trips: list };
        if (e) e.push(item);
        else idx.set(st, [item]);
      });
    }
    this.stationTrips = idx;
    return idx;
  }
}

// ---- Gestionnaire --------------------------------------------------------------------------

export class Urban {
  constructor(dataUrl, store) {
    this.dataUrl = dataUrl;
    this.store = store;
    this.manifest = null;
    this.nets = new Map();
    this.loading = new Map();
    this.off = new Set(store.get('urbanOff', [])); // "net|mode" ou "net|ligne"
    this.onChange = () => {};
    this.lastView = null;
    this.rtTimers = {};
    this.visibleCount = {};
    this.tmp = { lon: 0, lat: 0, bearing: 0 };
  }

  init() {
    if (!this.ready) this.ready = this._init();
    return this.ready;
  }

  async _init() {
    try {
      const r = await fetch(this.dataUrl + 'manifest.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.manifest = await r.json();
    } catch (err) {
      console.warn('réseaux urbains indisponibles :', err);
      this.manifest = { nets: {} };
    }
    return this.manifest;
  }

  netInfo(id) {
    return this.manifest && this.manifest.nets[id];
  }

  // -- filtres
  isModeOn(net, mode) {
    return !this.off.has(net + '|' + mode);
  }

  isLineOn(net, line) {
    return this.isModeOn(net, line.mode) && !this.off.has(net + '|' + line.id);
  }

  setOff(key, off) {
    if (off) this.off.add(key);
    else this.off.delete(key);
    this.store.set('urbanOff', [...this.off]);
  }

  // -- chargement à la demande
  wanted(bounds, zoom) {
    if (!this.manifest || zoom < 8) return [];
    const out = [];
    for (const id in this.manifest.nets) {
      const b = this.manifest.nets[id].bbox;
      if (!b) continue;
      const m = 0.15;
      if (bounds.w > b[2] + m || bounds.e < b[0] - m || bounds.s > b[3] + m || bounds.n < b[1] - m) continue;
      out.push(id);
    }
    return out;
  }

  ensure(bounds, zoom, now) {
    this.lastView = { bounds, zoom };
    for (const id of this.wanted(bounds, zoom)) this.load(id, now);
    // charge le jour suivant après minuit / le cas échéant
    for (const net of this.nets.values()) {
      const today = parisDate(now);
      if (!net.days.has(today) && !this.loading.has(net.id + today)) this.loadDay(net, today);
    }
  }

  load(id, now) {
    if (this.nets.has(id) || this.loading.has(id)) return this.loading.get(id) || Promise.resolve(this.nets.get(id));
    const info = this.netInfo(id);
    if (!info) return Promise.resolve(null);
    const v = '?v=' + info.build;
    const today = parisDate(now);
    const yesterday = shiftDate(today, -1);
    const p = (async () => {
      try {
        const S = await fetch(this.dataUrl + id + '.json' + v).then((r) => r.json());
        const net = new Network(id, S);
        const days = [yesterday, today].filter((d) => info.dates.includes(d));
        const loaded = await Promise.all(
          days.map((d) => fetch(this.dataUrl + id + '-' + d + '.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null)),
        );
        for (const day of loaded) if (day && day.build === S.build) net.addDay(day);
        this.nets.set(id, net);
        this.startRealtime(net);
        this.onChange('loaded', net);
        return net;
      } catch (err) {
        console.warn('réseau ' + id + ' :', err);
        return null;
      } finally {
        this.loading.delete(id);
      }
    })();
    this.loading.set(id, p);
    return p;
  }

  async loadDay(net, date) {
    const info = this.netInfo(net.id);
    if (!info || !info.dates.includes(date)) return;
    this.loading.set(net.id + date, true);
    try {
      const day = await fetch(this.dataUrl + net.id + '-' + date + '.json?v=' + info.build).then((r) => r.json());
      net.addDay(day);
    } catch {
      /* jour indisponible */
    }
    this.loading.delete(net.id + date);
  }

  async loadAll(now) {
    if (this.ready) await this.ready;
    if (!this.manifest) return;
    await Promise.all(Object.keys(this.manifest.nets).map((id) => this.load(id, now)));
  }

  // -- temps réel
  startRealtime(net) {
    const run = () => this.refreshRealtime(net).catch((e) => console.warn('temps réel ' + net.id + ' :', e));
    run();
    this.rtTimers[net.id] = setInterval(() => {
      if (document.hidden) return;
      const v = this.lastView;
      if (v && v.zoom >= 8.5 && this.wanted(v.bounds, v.zoom).includes(net.id)) run();
    }, RT_EVERY[net.id] || 60e3);
    if (net.id === 'lille') {
      const al = () => this.refreshLilleAlerts(net).catch(() => {});
      al();
      setInterval(al, ALERTS_EVERY);
    }
  }

  async refreshRealtime(net) {
    const now = Date.now() / 1000;
    if (net.id === 'idf') {
      if (net.rtPause && Date.now() < net.rtPause) return;
      const r = await fetch(IDFM_URL, { cache: 'no-store' });
      if (r.status === 503 || r.status === 404) {
        const body = await r.json().catch(() => ({}));
        net.rtState = body.error === 'quota' ? 'quota' : 'nokey';
        net.rtPause = Date.now() + 10 * 60e3; // pas de clé ou quota atteint : on réessaie dans 10 min
        return;
      }
      if (!r.ok) {
        net.rtState = 'error';
        return;
      }
      let data = await r.json();
      if (data.error) {
        net.rtState = data.error === 'quota' ? 'quota' : data.error === 'no-key' ? 'nokey' : 'error';
        net.rtPause = Date.now() + 10 * 60e3;
        return;
      }
      if (data.Siri) {
        const codes = new Set(net.lines.map((l) => l.code));
        data = compactEstimatedTimetable(data, codes, now);
      }
      const byCode = new Map(net.lines.map((l) => [l.code, l]));
      const passages = data.calls.map((c) => {
        const j = data.journeys[c[0]];
        return { line: byCode.get(j[0]), key: c[1], aim: c[2], exp: c[3], dest: j[1], j: c[0] };
      });
      this.applyPassages(net, passages.filter((p) => p.line), data.ts || now);
      net.rtState = 'ok';
    } else if (net.id === 'lille') {
      const url = LILLE_WFS + 'dsp_ilevia:prochains_passages&CQL_FILTER=' + encodeURIComponent("code_ligne='TRAM'");
      const d = await fetch(url, { cache: 'no-store' }).then((r) => r.json());
      const tram = net.lines.find((l) => l.mode === 'tram');
      const passages = [];
      for (const f of d.features || []) {
        const p = f.properties;
        const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/.exec(p.heure_estimee_depart || '');
        if (!m || !tram) continue;
        // les heures sont l'heure de Paris, malgré le « Z » final
        const exp = parisEpoch(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
        passages.push({ line: tram, key: p.code_arret_physique, aim: 0, exp, dest: p.sens_ligne, j: -1 });
      }
      this.applyPassages(net, passages, now);
      net.rtState = 'ok';
    } else if (net.id === 'bdx') {
      const buf = await fetch(BDX_VP_URL, { cache: 'no-store' }).then((r) => r.arrayBuffer());
      this.applyGps(net, decodeVehicles(new Uint8Array(buf)), now);
    }
    this.onChange('realtime', net);
  }

  async refreshLilleAlerts(net) {
    const url = LILLE_WFS + 'dsp_ilevia:perturbations';
    const d = await fetch(url, { cache: 'no-store' }).then((r) => r.json());
    const now = Date.now();
    net.alerts = new Map();
    for (const f of d.features || []) {
      const p = f.properties;
      const m = /LineRef::([^:]+):/.exec(p.cible || '');
      if (!m) continue;
      const line = net.lines.find((l) => l.id === m[1]);
      if (!line) continue;
      const end = Date.parse(p.heure_fin_prevue || '');
      if (end && end < now) continue;
      const list = net.alerts.get(line.id) || [];
      list.push({ type: p.type_perturbation, text: String(p.message || '').replace(/►/g, ' — ') });
      net.alerts.set(line.id, list);
    }
    this.onChange('alerts', net);
  }

  /** Associe des passages temps réel (quai + heure estimée) aux trajets théoriques. */
  applyPassages(net, passages, ts, opts) {
    const now = Date.now() / 1000;
    const byQuay = new Map();
    const byStation = new Map();
    for (const p of passages) {
      const k = p.line ? p.line.i + '|' + p.key : 's' + p.station;
      const m = p.line ? byQuay : byStation;
      const l = m.get(k);
      if (l) l.push(p);
      else m.set(k, [p]);
    }
    const rtLines = new Set(passages.filter((p) => p.line).map((p) => p.line.i));
    const stationModes = opts && opts.modes;
    const cands = [];
    for (const tr of net.running(now, 900)) {
      if (!rtLines.has(tr.line.i) && !(stationModes && stationModes.has(tr.line.mode))) continue;
      const { pat, dep } = tr.prof;
      // prochain arrêt selon l'horaire (retard précédent compris)
      let k = 0;
      while (k < dep.length - 1 && tr.start + dep[k] + tr.delay < now - 30) k++;
      for (let q = k; q < pat.stops.length; q++) {
        const key = net.stops[pat.stops[q]].key;
        const list = byQuay.get(tr.line.i + '|' + key) || (stationModes ? byStation.get('s' + net.stops[pat.stops[q]].st) : null);
        if (!list) continue;
        const sched = tr.start + (q === pat.stops.length - 1 ? tr.prof.arr[q] : dep[q]);
        for (const p of list) {
          let cost;
          if (p.aim) {
            if (Math.abs(p.aim - sched) > 90) continue;
            cost = Math.abs(p.aim - sched);
          } else {
            const dl = p.exp - sched;
            if (p.exp < 0 || dl < -240 || dl > 2400) continue;
            cost = Math.abs(dl - tr.delay) + (q - k) * 8;
          }
          cands.push({ cost, tr, p, sched });
        }
      }
    }
    cands.sort((a, b) => a.cost - b.cost);
    const usedT = new Set();
    const usedP = new Set();
    const usedJ = new Set();
    for (const c of cands) {
      if (usedT.has(c.tr) || usedP.has(c.p)) continue;
      const jk = c.p.j >= 0 ? c.p.j : c.p.ref ? 'r' + c.p.ref : null; // une course réelle = un seul véhicule
      if (jk != null && usedJ.has(jk)) continue;
      if (jk != null) usedJ.add(jk);
      usedT.add(c.tr);
      usedP.add(c.p);
      if (c.p.exp < 0) c.tr.cancel = true;
      else {
        c.tr.delay = Math.max(-120, c.p.exp - (c.p.aim || c.sched));
        c.tr.cancel = false;
      }
      c.tr.rtAt = ts;
      if (c.p.ref && opts && opts.matched) opts.matched.set(c.p.ref, c.tr);
    }
    if (!opts || !opts.keepTs) net.rtAt = ts;
  }

  /**
   * Utilise les trains SNCF du flux national (Transilien, branches RER) comme temps réel
   * pour les trajets Île-de-France équivalents. Renvoie le nombre d'associations.
   * sncfTrains : [{ id, stops: [{ lon, lat, dep, depDelay, arr, arrDelay }] }]
   */
  applySncf(sncfTrains) {
    const net = this.nets.get('idf');
    if (!net) return 0;
    if (!net.uicMap) net.uicMap = new Map();
    const railStations = net.stations.filter((st) => st.lines.some((i) => net.lines[i].mode === 'rer' || net.lines[i].mode === 'transilien'));
    const near = (s) => {
      const k = s.uic;
      if (net.uicMap.has(k)) return net.uicMap.get(k);
      let best = 450;
      let bi = -1;
      for (const st of railStations) {
        if (Math.abs(st.lat - s.lat) > 0.01 || Math.abs(st.lon - s.lon) > 0.015) continue;
        const d = hav(st.lon, st.lat, s.lon, s.lat);
        if (d < best) {
          best = d;
          bi = st.i;
        }
      }
      net.uicMap.set(k, bi);
      return bi;
    };
    const now = Date.now() / 1000;
    const passages = [];
    for (const tr of sncfTrains) {
      for (const s of tr.stops) {
        const t = s.dep || s.arr;
        if (!t || t < now - 120 || t > now + 3600) continue;
        const station = near(s);
        if (station < 0) continue;
        const delay = s.dep ? s.depDelay : s.arrDelay;
        passages.push({ line: null, station, aim: t - delay, exp: t, ref: tr.id });
      }
    }
    this.sncfMatched = new Map();
    this.applyPassages(net, passages, now, { modes: new Set(['rer', 'transilien']), matched: this.sncfMatched, keepTs: true });
    return this.sncfMatched.size;
  }

  /** Vrai si ce train SNCF est déjà affiché comme véhicule Île-de-France (évite les doublons). */
  hidesSncf(id, zoom) {
    const tr = this.sncfMatched && this.sncfMatched.get(id);
    if (!tr) return false;
    return this.isLineOn('idf', tr.line) && zoom >= zoomFor('idf', tr.line.mode, 'v');
  }

  applyGps(net, vehicles, ts) {
    let n = 0;
    for (const v of vehicles) {
      const tr = net.byId.get(v.trip);
      if (!tr) continue;
      const pat = tr.prof.pat;
      const d0 = pat.dists[0];
      const d1 = pat.dists[pat.dists.length - 1];
      const prev = tr.gps;
      const d = projectOnShape(pat.shape, v.lon, v.lat, d0 - 50, d1 + 50, prev ? prev.d1 : null);
      const at = v.ts || ts;
      if (prev && at <= prev.at) continue;
      const shown = prev ? this.gpsDist(tr, Date.now() / 1000) : d;
      tr.gps = { d0: shown, d1: Math.min(d1, Math.max(d0, d)), t0: Date.now() / 1000, at, raw: [v.lon, v.lat] };
      tr.delay = this.delayFromDist(tr, tr.gps.d1, at);
      tr.rtAt = at;
      n++;
    }
    net.gpsAt = n ? ts : net.gpsAt;
    net.rtState = n ? 'ok' : 'error';
  }

  gpsDist(tr, now) {
    const g = tr.gps;
    const f = Math.min(1, Math.max(0, (now - g.t0) / GPS_ANIM));
    return g.d0 + (g.d1 - g.d0) * f;
  }

  delayFromDist(tr, d, at) {
    const { pat, arr, dep } = tr.prof;
    const D = pat.dists;
    let k = 0;
    while (k < D.length - 2 && D[k + 1] <= d) k++;
    const span = D[k + 1] - D[k];
    const f = span > 0 ? Math.min(1, Math.max(0, (d - D[k]) / span)) : 0;
    const sched = tr.start + dep[k] + f * (arr[k + 1] - dep[k]);
    return Math.max(-120, Math.round(at - sched)); // au terminus, un véhicule en avance attend son départ
  }

  // -- positions
  locate(tr, now) {
    const { pat, arr, dep } = tr.prof;
    const net = tr.net;
    const D = pat.dists;
    const out = tr.pos || (tr.pos = { lon: 0, lat: 0, bearing: 0 });
    const gpsOk = tr.gps && now - tr.gps.at < RT_FRESH;
    if (gpsOk) {
      const d = this.gpsDist(tr, now);
      shapePoint(pat.shape, d, out);
      let k = 0;
      while (k < D.length - 2 && D[k + 1] <= d + 5) k++;
      out.dist = d;
      out.k = k;
      out.moving = Math.abs(tr.gps.d1 - tr.gps.d0) > 15;
      out.speed = out.moving ? Math.min(90, (Math.abs(tr.gps.d1 - tr.gps.d0) / GPS_ANIM) * 3.6) : 0;
      out.src = 'gps';
      return out;
    }
    const rtOk = tr.rtAt && now - tr.rtAt < RT_FRESH + 600;
    const delay = rtOk ? tr.delay : 0;
    const local = now - delay - tr.start;
    const last = D.length - 1;
    if (local < 0 || local > arr[last]) return null;
    let k = tr.li < last ? tr.li : 0;
    if (local < dep[k]) k = 0;
    while (k < last - 1 && local >= arr[k + 1]) k++;
    tr.li = k;
    let d;
    if (local < dep[k] && local >= arr[k]) {
      d = D[k];
      out.moving = false;
      out.speed = 0;
    } else if (local >= arr[k + 1]) {
      d = D[k + 1];
      k = k + 1;
      out.moving = false;
      out.speed = 0;
    } else {
      const T = Math.max(1, arr[k + 1] - dep[k]);
      const f = (local - dep[k]) / T;
      const acc = Math.min(0.35, 22 / T);
      d = D[k] + (D[k + 1] - D[k]) * ramp(f, acc);
      out.moving = true;
      out.speed = Math.min(160, ((D[k + 1] - D[k]) / T) * rampSlope(f, acc) * 3.6);
    }
    shapePoint(pat.shape, d, out);
    out.dist = d;
    out.k = k;
    out.src = rtOk ? 'rt' : 'theo';
    out.delay = delay;
    return out;
  }

  /**
   * Véhicules visibles : renvoie des entités GeoJSON pour la carte.
   * view : { w, s, e, n, zoom }.
   */
  features(now, view, selKey) {
    const out = [];
    const counts = {};
    const m = 0.02 * Math.pow(2, 12 - Math.min(view.zoom, 14));
    const W = view.w - m;
    const E = view.e + m;
    const Sb = view.s - m;
    const N = view.n + m;
    for (const net of this.nets.values()) {
      const bb = net.bbox;
      if (W > bb[2] || E < bb[0] || Sb > bb[3] || N < bb[1]) continue;
      const gpsFresh = net.id === 'bdx' && now - net.gpsAt < RT_FRESH;
      for (const tr of net.running(now, net.id === 'bdx' ? 900 : 600)) {
        const line = tr.line;
        const key = net.id + '|' + tr.key;
        const isSel = key === selKey;
        if (!isSel) {
          if (!this.isLineOn(net.id, line)) continue;
          if (view.zoom < zoomFor(net.id, line.mode, 'v')) continue;
          const b = tr.prof.pat.bbox;
          if (b[0] > E || b[2] < W || b[1] > N || b[3] < Sb) continue;
        }
        if (tr.cancel) continue;
        if (gpsFresh && !(tr.gps && now - tr.gps.at < RT_FRESH)) continue; // Bordeaux : seuls les véhicules GPS
        const pos = this.locate(tr, now);
        if (!pos) continue;
        if (!isSel && (pos.lon < W || pos.lon > E || pos.lat < Sb || pos.lat > N)) continue;
        counts[net.id + '|' + line.mode] = (counts[net.id + '|' + line.mode] || 0) + 1;
        out.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
          properties: {
            id: 'u|' + key,
            c: line.color,
            tc: line.text,
            t: line.label,
            b: pos.bearing,
            d: (pos.delay || tr.delay) >= 300 && pos.src !== 'theo' ? (tr.delay >= 900 ? 2 : 1) : 0,
            z: isSel ? 50 : line.mode === 'rer' || line.mode === 'transilien' ? 2 : 1,
          },
        });
      }
    }
    this.visibleCount = counts;
    return out;
  }

  /** Tracés des lignes chargées (un objet par tracé, avec couleur et zoom minimal). */
  linesGeoJSON() {
    const feats = [];
    for (const net of this.nets.values()) {
      const seen = new Set();
      const drawn = new Map(); // ligne -> grille des cellules déjà couvertes
      // les tracés les plus longs d'abord : les variantes plus courtes sont souvent incluses
      const pats = [...net.patterns].sort((a, b) => b.shape.cd[b.shape.cd.length - 1] - a.shape.cd[a.shape.cd.length - 1]);
      for (const pat of pats) {
        const k = pat.shape;
        if (seen.has(k)) continue;
        seen.add(k);
        const line = pat.line;
        if (!this.isLineOn(net.id, line)) continue;
        const sh = pat.shape;
        // l'autre sens de circulation suit presque le même chemin : on ne le redessine pas
        let cells = drawn.get(line.id);
        if (!cells) drawn.set(line.id, (cells = new Set()));
        const mine = [];
        let covered = 0;
        for (let i = 0; i < sh.lon.length; i++) {
          const c = Math.round(sh.lon[i] / 0.0012) + ':' + Math.round(sh.lat[i] / 0.0008);
          mine.push(c);
          if (cells.has(c)) covered++;
        }
        if (covered > 0.9 * sh.lon.length) continue;
        for (const c of mine) {
          const [x, y] = c.split(':').map(Number);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) cells.add(x + dx + ':' + (y + dy));
        }
        const coords = new Array(sh.lon.length);
        for (let i = 0; i < sh.lon.length; i++) coords[i] = [sh.lon[i], sh.lat[i]];
        feats.push({
          type: 'Feature',
          properties: { c: line.color, mz: zoomFor(net.id, line.mode, 'l'), m: line.mode },
          geometry: { type: 'LineString', coordinates: coords },
        });
      }
    }
    return { type: 'FeatureCollection', features: feats };
  }

  stationsGeoJSON() {
    const feats = [];
    for (const net of this.nets.values()) {
      for (const st of net.stations) {
        const lines = st.lines.map((i) => net.lines[i]).filter((l) => this.isLineOn(net.id, l));
        if (!lines.length) continue;
        const mz = Math.min(...lines.map((l) => zoomFor(net.id, l.mode, 's')));
        feats.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [st.lon, st.lat] },
          properties: { id: net.id + '|' + st.i, n: st.n, mz, c: lines[0].color },
        });
      }
    }
    return { type: 'FeatureCollection', features: feats };
  }

  // -- sélection
  trip(key) {
    const [netId, k] = String(key).split('|');
    const net = this.nets.get(netId);
    return net ? net.byKey.get(k) : null;
  }

  station(key) {
    const [netId, i] = String(key).split('|');
    const net = this.nets.get(netId);
    return net ? net.stations[+i] : null;
  }

  /** Arrêts d'un trajet avec heures prévues et estimées. */
  tripStops(tr) {
    const { pat, arr, dep } = tr.prof;
    const net = tr.net;
    const delay = tr.rtAt ? tr.delay : 0;
    return pat.stops.map((s, i) => {
      const st = net.stations[net.stops[s].st];
      const sched = tr.start + (i === pat.stops.length - 1 ? arr[i] : dep[i]);
      return { st, sched, time: sched + delay };
    });
  }

  routeGeo(tr, now) {
    const pat = tr.prof.pat;
    const D = pat.dists;
    const pos = tr.pos;
    const d = pos && pos.dist != null ? pos.dist : now < tr.start ? D[0] : D[D.length - 1];
    const done = d > D[0] ? shapeSlice(pat.shape, D[0], d) : [];
    const todo = d < D[D.length - 1] ? shapeSlice(pat.shape, d, D[D.length - 1]) : [];
    const stops = pat.stops.map((s, i) => {
      const st = tr.net.stations[tr.net.stops[s].st];
      return { st, done: D[i] <= d + 1, edge: i === 0 || i === pat.stops.length - 1 };
    });
    return { done, todo, stops };
  }

  /** Prochains passages en station : [{ tr, time, delay, last }]. */
  board(st, now, horizon = 3600) {
    const net = this.nets.get(st.net);
    if (!net) return [];
    const idx = net.indexStations().get(st.i) || [];
    const rows = [];
    for (const { prof, pos, trips } of idx) {
      const last = pos === prof.pat.stops.length - 1;
      if (last) continue;
      const off = prof.dep[pos];
      for (const tr of trips) {
        if (tr.cancel) continue;
        const delay = tr.rtAt && now - tr.rtAt < RT_FRESH + 600 ? tr.delay : 0;
        const time = tr.start + off + delay;
        if (time < now - 30 || time > now + horizon) continue;
        if (net.id === 'bdx' && now - net.gpsAt < RT_FRESH && tr.start < now && !tr.gps) continue;
        rows.push({ tr, time, delay, live: !!tr.rtAt && now - tr.rtAt < RT_FRESH + 600 });
      }
    }
    rows.sort((a, b) => a.time - b.time);
    return rows.slice(0, 40);
  }

  sourceOf(tr, now) {
    const net = tr.net;
    if (tr.gps && now - tr.gps.at < RT_FRESH) return 'gps';
    if (tr.rtAt && now - tr.rtAt < RT_FRESH + 600) return 'rt';
    if (net.id === 'idf' && net.rtState === 'nokey') return 'nokey';
    return 'theo';
  }

  searchStations(nq, norm) {
    const hits = [];
    for (const net of this.nets.values()) {
      for (const st of net.stations) {
        const nn = st._n || (st._n = norm(st.n));
        const i = nn.indexOf(nq);
        if (i < 0) continue;
        const word = i === 0 || nn[i - 1] === ' ';
        hits.push([(i === 0 ? 0 : word ? 1 : 2) * 10 - Math.min(5, st.lines.length), st]);
      }
    }
    hits.sort((a, b) => a[0] - b[0] || a[1].n.length - b[1].n.length);
    return hits.slice(0, 6).map((h) => h[1]);
  }

  searchLines(q) {
    const out = [];
    const nq = q.toLowerCase().replace(/^(ligne|line|metro|métro|rer|tram|m|t)\s*/i, '').trim();
    if (!nq) return out;
    for (const net of this.nets.values()) {
      for (const l of net.lines) {
        if (l.label.toLowerCase() === nq || l.label.toLowerCase() === 't' + nq || l.label.toLowerCase() === 'm' + nq) out.push(l);
      }
    }
    return out.slice(0, 6);
  }
}

// ---- Décodage minimal des positions GTFS-RT (Bordeaux) --------------------------------------

function decodeVehicles(buf) {
  let pos = 0;
  const end0 = buf.length;
  const out = [];
  const varint = () => {
    let r = 0;
    let s = 0;
    let b;
    do {
      b = buf[pos++];
      if (s < 28) r |= (b & 0x7f) << s;
      else r += (b & 0x7f) * 2 ** s;
      s += 7;
    } while (b >= 0x80);
    return r >>> 0 === r ? r : r;
  };
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const str = (a, b) => new TextDecoder().decode(buf.subarray(a, b));
  const walk = (end, cb) => {
    while (pos < end) {
      const key = varint();
      const f = key >>> 3;
      const w = key & 7;
      if (w === 0) cb(f, 0, varint());
      else if (w === 2) {
        const len = varint();
        const s = pos;
        cb(f, 2, s, s + len);
        pos = s + len;
      } else if (w === 5) {
        cb(f, 5, dv.getFloat32(pos, true));
        pos += 4;
      } else if (w === 1) pos += 8;
      else return;
    }
  };
  walk(end0, (f, w, a, b) => {
    if (f !== 2 || w !== 2) return;
    walk(b, (f2, w2, a2, b2) => {
      if (f2 !== 4 || w2 !== 2) return;
      const v = { trip: '', lon: 0, lat: 0, ts: 0 };
      walk(b2, (f3, w3, a3, b3) => {
        if (f3 === 1 && w3 === 2) {
          walk(b3, (f4, w4, a4, b4) => {
            if (f4 === 1 && w4 === 2) v.trip = str(a4, b4);
          });
        } else if (f3 === 2 && w3 === 2) {
          walk(b3, (f4, w4, x) => {
            if (f4 === 1 && w4 === 5) v.lat = x;
            else if (f4 === 2 && w4 === 5) v.lon = x;
          });
        } else if (f3 === 5 && w3 === 0) v.ts = a3;
      });
      if (v.trip && v.lat) out.push(v);
    });
  });
  return out;
}

export const _test = { decodeVehicles, parisEpoch, projectOnShape };
