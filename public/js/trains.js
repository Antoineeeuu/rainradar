// Modèle des trains : transforme le flux temps réel SNCF en objets « train »
// et calcule la position estimée de chacun à un instant donné.

import { pointAt } from './rail.js';

// Marque commerciale (dans l'identifiant du train) -> type d'icône, groupe de filtre, classe de vitesse
const BRANDS = {
  OUI: { type: 'inoui', group: 'inoui', cls: 'hs', name: 'TGV INOUI' },
  OGO: { type: 'ouigo', group: 'ouigo', cls: 'hs', name: 'OUIGO' },
  IC: { type: 'ic', group: 'ic', cls: 'cl', name: 'Intercités' },
  ICN: { type: 'night', group: 'ic', cls: 'cl', name: 'Intercités de nuit' },
  TER: { type: 'ter', group: 'ter', cls: 'cl', name: 'TER' },
  TT: { type: 'ter', group: 'ter', cls: 'cl', name: 'Tram-train' },
  NAV: { type: 'ter', group: 'ter', cls: 'cl', name: 'Navette' },
  TRN: { type: 'ter', group: 'ter', cls: 'cl', name: 'Train' },
  ICE: { type: 'intl', group: 'intl', cls: 'hs', name: 'ICE' },
  LYR: { type: 'intl', group: 'intl', cls: 'hs', name: 'TGV Lyria' },
};

export const GROUPS = ['inoui', 'ouigo', 'ic', 'ter', 'intl'];

function brandFromNumber(num) {
  const n = Number(num);
  if (n >= 100000) return BRANDS.TER;
  if (n >= 3000 && n < 5000) return BRANDS.IC;
  if (n >= 10000) return BRANDS.TER;
  if (n >= 2000) return BRANDS.OUI;
  return BRANDS.TRN;
}

const RE_ID = /^(OCE[A-Z]{2}(\d+)([FR]))(?:\d*_?[FR]?:([A-Z]+):)?/;
const RE_UIC = /(\d{7,8})$/;

function parseStop(s, stations) {
  const m = RE_UIC.exec(s.stopId);
  const uic = m ? m[1] : '';
  const st = stations[uic] || null;
  let arr = s.arr && s.arr.time ? s.arr.time : 0;
  let dep = s.dep && s.dep.time ? s.dep.time : 0;
  if (!arr) arr = dep;
  if (!dep) dep = arr;
  const arrDelay = s.arr ? s.arr.delay : s.dep ? s.dep.delay : 0;
  const depDelay = s.dep ? s.dep.delay : arrDelay;
  return {
    uic,
    st,
    name: st ? st.n : uic || '?',
    arr,
    dep,
    arrDelay,
    depDelay,
    skipped: s.rel === 1,
    bus: s.stopId.indexOf('OCECar') >= 0,
  };
}

/**
 * Construit la liste des trains à partir du flux décodé.
 * Renvoie { trains: Map(id -> train), byNumber: Map(numéro -> train), cancelled: [train] }.
 */
export function buildTrains(feed, stations) {
  const trains = new Map();
  const byNumber = new Map();
  const cancelled = [];
  for (const tu of feed.trips) {
    const m = RE_ID.exec(tu.tripId);
    if (!m) continue;
    if (m[3] === 'R') continue; // service routier (autocar)
    const stops = tu.stops.map((s) => parseStop(s, stations)).filter((s) => s.arr > 0);
    if (stops.length < 2 || stops.some((s) => s.bus)) continue;
    const brand = BRANDS[m[4]] || (m[4] ? BRANDS.TRN : brandFromNumber(m[2]));
    const canceled = tu.rel === 3;
    const active = canceled ? stops : stops.filter((s) => !s.skipped);
    if (active.length < 2) continue;
    // horaires croissants, quoi qu'il arrive dans le flux
    let last = 0;
    for (const s of active) {
      if (s.arr < last) s.arr = last;
      if (s.dep < s.arr) s.dep = s.arr;
      last = s.dep;
    }
    const mv = active.filter((s) => s.st);
    const tr = {
      id: tu.tripId,
      key: m[1],
      num: m[2],
      type: brand.type,
      group: brand.group,
      cls: brand.cls,
      brand: brand.name,
      canceled,
      stops,
      active,
      mv,
      origin: active[0],
      dest: active[active.length - 1],
      t0: active[0].dep,
      t1: active[active.length - 1].arr,
      updated: tu.ts,
      aliases: [],
      hidden: canceled || mv.length < 2,
      li: 0,
      paths: [],
      pos: null,
    };
    if (canceled) cancelled.push(tr);
    trains.set(tr.id, tr);
  }

  // Un même train physique porte parfois plusieurs numéros (tranches renumérotées) :
  // si les arrêts d'un train sont exactement la fin du parcours d'un autre, on ne garde
  // que le plus long sur la carte et on mémorise l'autre numéro comme alias.
  const groups = new Map();
  for (const tr of trains.values()) {
    if (tr.hidden) continue;
    const k = tr.dest.uic + '@' + tr.dest.arr;
    const g = groups.get(k);
    if (g) g.push(tr);
    else groups.set(k, [tr]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => b.mv.length - a.mv.length || Number(a.num) - Number(b.num));
    for (let i = 1; i < g.length; i++) {
      const b = g[i];
      for (let j = 0; j < i; j++) {
        const a = g[j];
        if (a.aliasOf) continue;
        const off = a.mv.length - b.mv.length;
        let same = true;
        for (let k = 0; k < b.mv.length && same; k++) {
          const x = a.mv[off + k];
          const y = b.mv[k];
          same = x.uic === y.uic && x.dep === y.dep;
        }
        if (same) {
          b.aliasOf = a;
          b.hidden = true;
          a.aliases.push(b.num);
          break;
        }
      }
    }
  }
  for (const tr of trains.values()) {
    if (!byNumber.has(tr.num) || byNumber.get(tr.num).canceled) byNumber.set(tr.num, tr.aliasOf || tr);
  }
  cancelled.sort((a, b) => a.t0 - b.t0);
  return { trains, byNumber, cancelled };
}

// Profil de vitesse : accélération, palier, freinage. f et le résultat sont entre 0 et 1.
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

function legPath(tr, i, rail) {
  let p = tr.paths[i];
  if (p === undefined) {
    const a = tr.mv[i];
    const b = tr.mv[i + 1];
    p = rail.route(a.uic, b.uic, tr.cls, b.arr - a.dep) || null;
    tr.paths[i] = p;
  }
  return p;
}

/** Calcule (et met en cache) le tracé complet d'un train. */
export function allPaths(tr, rail) {
  const out = [];
  for (let i = 0; i < tr.mv.length - 1; i++) out.push(legPath(tr, i, rail));
  return out;
}

const tmp = { lon: 0, lat: 0, dist: 0, v: 0, bearing: 0 };

/**
 * Position estimée d'un train à l'instant `now` (secondes Unix).
 * Renvoie null si le train n'est pas en circulation, sinon tr.pos mis à jour :
 * { lon, lat, bearing, speed (km/h), moving, leg, legDist, next (arrêt suivant), delay (s), progress }.
 */
export function locate(tr, now, rail) {
  const mv = tr.mv;
  const last = mv.length - 1;
  if (now < mv[0].dep || now >= mv[last].arr) {
    tr.pos = null;
    return null;
  }
  let i = tr.li;
  if (i > last - 1 || now < mv[i].dep) i = 0;
  while (i < last - 1 && now >= mv[i + 1].dep) i++;
  tr.li = i;
  const a = mv[i];
  const b = mv[i + 1];
  const pos = tr.pos || (tr.pos = { lon: a.st.lon, lat: a.st.lat, bearing: 0 });
  const path = legPath(tr, i, rail);
  pos.leg = i;
  pos.progress = (now - tr.t0) / Math.max(1, tr.t1 - tr.t0);
  if (now < b.arr) {
    const T = Math.max(1, b.arr - a.dep);
    const f = (now - a.dep) / T;
    const acc = Math.min(0.25, (tr.cls === 'hs' ? 200 : 80) / T);
    pos.moving = true;
    pos.next = b;
    pos.delay = b.arrDelay;
    if (path) {
      tmp.bearing = pos.bearing;
      pointAt(path, ramp(f, acc) * path.time, tmp);
      pos.lon = tmp.lon;
      pos.lat = tmp.lat;
      pos.bearing = tmp.bearing;
      pos.legDist = tmp.dist;
      pos.speed = Math.min(330, tmp.v * rampSlope(f, acc) * (path.time / T) * 3.6);
    } else {
      const g = ramp(f, acc);
      pos.lon = a.st.lon + (b.st.lon - a.st.lon) * g;
      pos.lat = a.st.lat + (b.st.lat - a.st.lat) * g;
      pos.legDist = 0;
      pos.speed = 0;
    }
  } else {
    // à quai à l'arrêt b, en attente du départ
    pos.moving = false;
    pos.next = b;
    pos.delay = b.depDelay;
    pos.speed = 0;
    if (path) {
      tmp.bearing = pos.bearing;
      pointAt(path, path.time, tmp);
      pos.lon = tmp.lon;
      pos.lat = tmp.lat;
      pos.bearing = tmp.bearing;
      pos.legDist = path.len;
    } else {
      pos.lon = b.st.lon;
      pos.lat = b.st.lat;
      pos.legDist = 0;
    }
  }
  return pos;
}

export function delayLevel(sec) {
  return sec >= 900 ? 2 : sec >= 300 ? 1 : 0;
}
