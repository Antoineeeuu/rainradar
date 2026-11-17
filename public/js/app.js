// RailRadar — application principale : carte, trains en mouvement, panneaux, recherche.

import { t, setLang, getLang, applyI18n } from './i18n.js';
import { decodeTripUpdates, decodeAlerts } from './gtfsrt.js';
import { loadRail, sliceCoords } from './rail.js';
import { buildTrains, locate, allPaths, delayLevel, GROUPS } from './trains.js';
import { loadMapIcons, ICON_PIXEL_RATIO, TYPE_STYLE, GROUP_STYLE, sideArt, modelName, UI, arrowImage, urbanArt, urbanModel } from './icons.js';
import { Urban, CITIES, zoomFor } from './urban.js';

// ---- Réglages -----------------------------------------------------------------------------

const SITE_NAME = 'RailRadar';

// Horaires urbains (métro, RER, tram…) générés chaque nuit par GitHub dans la branche « data ».
// Dépôt GitHub : Antoineeeuu/rainradar. En local, les fichiers de public/urban/ sont utilisés.
const GITHUB_DATA = 'https://raw.githubusercontent.com/Antoineeeuu/rainradar/data/';
const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);
const URBAN_DATA_URL = IS_LOCAL || GITHUB_DATA.includes('VOTRE-PSEUDO') ? 'urban/' : GITHUB_DATA;
const FEED_URL = 'https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates';
const ALERTS_URL = 'https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-service-alerts';
const FEED_EVERY = 60 * 1000; // rechargement du flux temps réel (ms)
const ALERTS_MAX_AGE = 3 * 60 * 1000;
const FRANCE = [[-5.4, 41.2], [9.9, 51.3]];
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const STYLES = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
  sat: {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      sat: {
        type: 'raster',
        tiles: [
          'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a>',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0b1220' } },
      { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': 0.82, 'raster-saturation': -0.15 } },
    ],
  },
};
const DATA_CREDIT = 'Trains : <a href="https://transport.data.gouv.fr/" target="_blank" rel="noopener">open data SNCF</a>';
const FONT_BOLD = ['Noto Sans Bold'];
const FONT_REG = ['Noto Sans Regular'];
const Z_ORDER = { ter: 1, ic: 2, night: 2, intl: 3, ouigo: 4, inoui: 5 };

// ---- Petits outils --------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('rr.' + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('rr.' + k, JSON.stringify(v));
    } catch {
      /* stockage indisponible : tant pis */
    }
  },
};
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const fmtHM = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const fmtHMS = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris' });
const hm = (sec) => fmtHM.format(sec * 1000);
const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-'’.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

function delayText(sec) {
  if (sec < 300) return t('onTime');
  const m = Math.round(sec / 60);
  if (m < 60) return t('delayMin', { n: m });
  return t('delayHM', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') });
}
const delayClass = (sec) => (sec >= 900 ? 'bad' : sec >= 300 ? 'warn' : 'ok');
const badge = (type, text) => {
  const s = TYPE_STYLE[type];
  return `<span class="badge" style="--c:${s.color};--ink:${s.ink}">${esc(text || s.short)}</span>`;
};

// ---- État -----------------------------------------------------------------------------------

const state = {
  theme: store.get('theme', 'dark'),
  filters: Object.assign({ inoui: true, ouigo: true, ic: true, ter: true, intl: true }, store.get('filters', {})),
  lateOnly: false,
  sel: null, // { kind: 'train', id, num } | { kind: 'station', uic } | { kind: 'stats' } | { kind: 'favs' }
  follow: false,
  tab: 'dep',
  tall: false,
  favs: Object.assign({ trains: [], stations: [] }, store.get('favs', {})),
};

let map;
let rail;
let icons;
let railGeo;
let stationGeo;
let stationIndex = [];
let layersReady = false;
let trains = new Map();
let byNumber = new Map();
let cancelled = [];
let feedTime = 0;
let feedOk = null;
let lastFetch = 0;
let clockOffset = 0;
let alertIndex = null;
let alertsAt = 0;
let alertsLoading = false;
let stats = { running: 0, late: 0, avg: 0, counts: {} };
let tip;
let meMarker;
let pendingHash = null;
let urban = null;
let urbanDirty = true;

const nowSec = () => (Date.now() + clockOffset) / 1000;

// ---- Carte ----------------------------------------------------------------------------------

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: STYLES[state.theme] || STYLES.dark,
    bounds: FRANCE,
    fitBoundsOptions: { padding: isMobile() ? { top: 110, bottom: 70, left: 10, right: 10 } : { top: 110, bottom: 40, left: 40, right: 40 } },
    minZoom: 3.5,
    maxZoom: 17,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: DATA_CREDIT }), 'bottom-right');
  tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tip', offset: 16, maxWidth: 'none' });

  map.on('style.load', () => {
    layersReady = false;
    if (rail && icons) installLayers();
  });
  map.on('click', onMapClick);
  map.on('mousemove', onMapMove);
  map.on('mouseout', () => tip.remove());
  map.on('dragstart', () => {
    if (state.follow) setFollow(false);
  });
  map.on('error', (e) => console.warn('carte :', e && e.error ? e.error.message : e));
  map.on('styleimagemissing', (e) => {
    // pictogramme absent du fond de carte : on fournit une image vide pour éviter l'avertissement
    if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
}

function installLayers() {
  if (map.getSource('trains')) return;
  for (const name in icons) if (!map.hasImage(name)) map.addImage(name, icons[name], { pixelRatio: ICON_PIXEL_RATIO });
  const th = state.theme;
  const light = th === 'light';
  const lineColor = th === 'sat' ? '#ffffff' : light ? '#4c5a73' : '#8493ad';
  const lgvColor = th === 'sat' ? '#8fd0ff' : light ? '#2f6fe4' : '#62b6ff';
  const ink = light ? '#111a2b' : '#f2f5fa';
  const halo = light ? 'rgba(255,255,255,.92)' : 'rgba(8,12,20,.88)';
  const empty = { type: 'FeatureCollection', features: [] };

  map.addSource('rail', { type: 'geojson', data: railGeo, tolerance: 0.4 });
  map.addSource('route', { type: 'geojson', data: empty });
  map.addSource('stations', { type: 'geojson', data: stationGeo });
  map.addSource('route-stops', { type: 'geojson', data: empty });
  map.addSource('sel', { type: 'geojson', data: empty });
  map.addSource('trains', { type: 'geojson', data: empty });

  const railWidth = ['interpolate', ['linear'], ['zoom'], 4, 0.4, 8, 0.9, 12, 1.8, 15, 3];
  map.addLayer({
    id: 'rail-classic',
    type: 'line',
    source: 'rail',
    filter: ['==', ['get', 'k'], 0],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': lineColor, 'line-opacity': th === 'sat' ? 0.55 : light ? 0.6 : 0.42, 'line-width': railWidth },
  });
  map.addLayer({
    id: 'rail-lgv',
    type: 'line',
    source: 'rail',
    filter: ['==', ['get', 'k'], 1],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': lgvColor, 'line-opacity': 0.6, 'line-width': railWidth },
  });

  // réseaux urbains : tracés et stations (sous le parcours sélectionné)
  map.addSource('urban-lines', { type: 'geojson', data: empty, tolerance: 0.3 });
  map.addSource('urban-stations', { type: 'geojson', data: empty });
  map.addSource('urban', { type: 'geojson', data: empty });
  if (!map.hasImage('u-arrow')) map.addImage('u-arrow', arrowImage(), { sdf: true, pixelRatio: 2 });
  map.addLayer({
    id: 'urban-lines',
    type: 'line',
    source: 'urban-lines',
    filter: ['>=', ['zoom'], ['get', 'mz']],
    layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['match', ['get', 'm'], 'rer', 3, 'transilien', 2, 1] },
    paint: {
      'line-color': ['get', 'c'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 12, 2.4, 15, 4.5],
      'line-opacity': th === 'sat' ? 0.9 : 0.78,
    },
  });
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': light ? '#ffffff' : '#0b1220', 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 5, 12, 9] },
  });
  map.addLayer({
    id: 'route-todo',
    type: 'line',
    source: 'route',
    filter: ['==', ['get', 'part'], 'todo'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': light ? '#111a2b' : '#ffffff', 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 4], 'line-dasharray': [0.1, 2] },
  });
  map.addLayer({
    id: 'route-done',
    type: 'line',
    source: 'route',
    filter: ['==', ['get', 'part'], 'done'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': light ? '#e09a00' : '#ffc83d', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 12, 5] },
  });

  // gares : les plus importantes d'abord, les autres en zoomant
  map.addLayer({
    id: 'stations',
    type: 'circle',
    source: 'stations',
    filter: ['>=', ['zoom'], ['match', ['get', 'w'], 4, 5, 3, 7, 2, 8, 1, 9, 10]],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 9, 3.2, 13, 5.5],
      'circle-color': light ? '#ffffff' : '#0b1220',
      'circle-stroke-color': light ? '#111a2b' : '#dfe6f2',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 12, 1.8],
    },
  });
  map.addLayer({
    id: 'station-labels',
    type: 'symbol',
    source: 'stations',
    filter: ['>=', ['zoom'], ['match', ['get', 'w'], 4, 6, 3, 8, 2, 9, 1, 10, 11]],
    layout: {
      'text-field': ['get', 'n'],
      'text-font': FONT_REG,
      'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10.5, 12, 12.5],
      'text-anchor': 'top',
      'text-offset': [0, 0.55],
      'text-max-width': 9,
      'symbol-sort-key': ['-', 4, ['get', 'w']],
      'text-padding': 3,
    },
    paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.4, 'text-opacity': 0.9 },
  });
  map.addLayer({
    id: 'urban-stations',
    type: 'circle',
    source: 'urban-stations',
    filter: ['>=', ['zoom'], ['get', 'mz']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 14, 4.2, 16, 6],
      'circle-color': light ? '#ffffff' : '#0b1220',
      'circle-stroke-color': ['get', 'c'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 15, 2.2],
    },
  });
  map.addLayer({
    id: 'urban-station-labels',
    type: 'symbol',
    source: 'urban-stations',
    filter: ['>=', ['zoom'], ['+', ['get', 'mz'], 1.3]],
    layout: {
      'text-field': ['get', 'n'],
      'text-font': FONT_REG,
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10.5, 16, 12.5],
      'text-anchor': 'top',
      'text-offset': [0, 0.6],
      'text-max-width': 8,
      'text-padding': 4,
    },
    paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.4, 'text-opacity': 0.85 },
  });
  map.addLayer({
    id: 'route-stops',
    type: 'circle',
    source: 'route-stops',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 6],
      'circle-color': ['case', ['get', 'done'], light ? '#e09a00' : '#ffc83d', light ? '#ffffff' : '#0b1220'],
      'circle-stroke-color': light ? '#111a2b' : '#ffffff',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'route-stop-labels',
    type: 'symbol',
    source: 'route-stops',
    layout: {
      'text-field': ['get', 'n'],
      'text-font': FONT_BOLD,
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.6],
      'text-max-width': 9,
      'symbol-sort-key': ['get', 'p'],
    },
    paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.6 },
  });

  map.addLayer({
    id: 'sel-ring',
    type: 'circle',
    source: 'sel',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 13, 12, 26],
      'circle-color': '#ffc83d',
      'circle-opacity': 0.16,
      'circle-stroke-color': '#ffc83d',
      'circle-stroke-width': 2,
    },
  });
  // véhicules urbains : pastille couleur de ligne + numéro + flèche de direction
  map.addLayer({
    id: 'urban-arrow',
    type: 'symbol',
    source: 'urban',
    layout: {
      'icon-image': 'u-arrow',
      'icon-rotate': ['get', 'b'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.45, 12, 0.7, 15, 0.95],
      'icon-offset': [0, -17],
      'symbol-sort-key': ['get', 'z'],
    },
    paint: { 'icon-color': ['get', 'c'], 'icon-halo-color': light ? '#ffffff' : '#0b1220', 'icon-halo-width': 1.2 },
  });
  map.addLayer({
    id: 'urban-veh',
    type: 'circle',
    source: 'urban',
    layout: { 'circle-sort-key': ['get', 'z'] },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.2, 11, 4.6, 12, 7.5, 14, 9.5, 16, 11],
      'circle-color': ['get', 'c'],
      'circle-stroke-color': light ? '#ffffff' : '#0b1220',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 13, 1.8],
    },
  });
  map.addLayer({
    id: 'urban-label',
    type: 'symbol',
    source: 'urban',
    minzoom: 11.5,
    layout: {
      'text-field': ['get', 't'],
      'text-font': FONT_BOLD,
      'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 7.5, 14, 9.5, 16, 11],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'symbol-sort-key': ['get', 'z'],
    },
    paint: { 'text-color': ['get', 'tc'] },
  });
  map.addLayer({
    id: 'urban-delay',
    type: 'circle',
    source: 'urban',
    filter: ['>', ['get', 'd'], 0],
    minzoom: 11.5,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 2.4, 15, 3.6],
      'circle-color': ['match', ['get', 'd'], 2, '#ff3b40', '#ff9f1a'],
      'circle-stroke-color': '#0b1220',
      'circle-stroke-width': 1.2,
      'circle-translate': ['interpolate', ['linear'], ['zoom'], 11.5, ['literal', [6, -6]], 15, ['literal', [9, -9]]],
    },
  });
  map.addLayer({
    id: 'trains',
    type: 'symbol',
    source: 'trains',
    layout: {
      'icon-image': ['get', 'i'],
      'icon-rotate': ['get', 'b'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 6, 0.42, 8, 0.58, 10, 0.78, 12, 0.95, 15, 1.2],
      'symbol-sort-key': ['get', 'z'],
    },
  });
  map.addLayer({
    id: 'trains-delay',
    type: 'circle',
    source: 'trains',
    filter: ['>', ['get', 'd'], 0],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1.8, 8, 2.8, 12, 4.2],
      'circle-color': ['match', ['get', 'd'], 2, '#ff3b40', '#ff9f1a'],
      'circle-stroke-color': '#0b1220',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 12, 1.5],
      'circle-translate': ['interpolate', ['linear'], ['zoom'], 4, ['literal', [4, -4]], 8, ['literal', [6, -6]], 12, ['literal', [10, -10]]],
    },
  });
  map.addLayer({
    id: 'train-labels',
    type: 'symbol',
    source: 'trains',
    minzoom: 9,
    layout: {
      'text-field': ['get', 'n'],
      'text-font': FONT_BOLD,
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10.5, 13, 12.5],
      'text-anchor': ['get', 'a'],
      'text-offset': ['case', ['==', ['get', 'a'], 'left'], ['literal', [1.05, 0]], ['literal', [0, 1.05]]],
      'symbol-sort-key': ['-', 10, ['get', 'z']],
      'text-padding': 2,
    },
    paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.6 },
  });

  layersReady = true;
  urbanDirty = true;
  tick();
  updateRoute();
}

/** Recharge les tracés et stations urbains (après chargement d'un réseau ou d'un filtre). */
function refreshUrbanStatic() {
  if (!layersReady || !urban) return;
  map.getSource('urban-lines').setData(urban.linesGeoJSON());
  map.getSource('urban-stations').setData(urban.stationsGeoJSON());
  urbanDirty = false;
}

/** Transmet les trains SNCF d'Île-de-France (Transilien, RER) au module urbain comme temps réel. */
function feedSncfToUrban() {
  if (!urban || !urban.nets.has('idf')) return;
  const list = [];
  for (const tr of trains.values()) {
    if (tr.hidden || tr.canceled || tr.group !== 'ter') continue;
    if (!tr.mv.some((s) => s.st.lat > 48.1 && s.st.lat < 49.25 && s.st.lon > 1.4 && s.st.lon < 3.6)) continue;
    list.push({ id: tr.id, stops: tr.mv.map((s) => ({ uic: s.uic, lon: s.st.lon, lat: s.st.lat, dep: s.dep, depDelay: s.depDelay, arr: s.arr, arrDelay: s.arrDelay })) });
  }
  urban.applySncf(list);
}

function urbanView() {
  const b = map.getBounds();
  return { w: b.getWest(), e: b.getEast(), s: b.getSouth(), n: b.getNorth(), zoom: map.getZoom() };
}

function setTheme(theme) {
  if (theme === state.theme) return;
  state.theme = theme;
  store.set('theme', theme);
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  layersReady = false;
  map.setStyle(STYLES[theme], { diff: false });
  renderBasemaps();
}

function viewOffset() {
  if (!state.sel) return [0, 0];
  if (isMobile()) return [0, -Math.round(sheetPx() / 2) + 40];
  return [200, 40];
}

function nearestHit(hits, p) {
  let best = hits[0];
  let bd = Infinity;
  for (const f of hits) {
    const q = map.project(f.geometry.coordinates);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

function onMapClick(e) {
  if (!layersReady) return;
  const p = e.point;
  const box = [[p.x - 12, p.y - 12], [p.x + 12, p.y + 12]];
  const uhits = urban ? map.queryRenderedFeatures(box, { layers: ['urban-veh'] }) : [];
  const hits = map.queryRenderedFeatures(box, { layers: ['trains'] });
  if (uhits.length && !hits.length) return selectUrbanTrip(nearestHit(uhits, p).properties.id.slice(2), { fly: false });
  if (hits.length) {
    let best = hits[0];
    let bd = Infinity;
    for (const f of hits) {
      const q = map.project(f.geometry.coordinates);
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    const tr = trains.get(best.properties.id);
    if (tr) return selectTrain(tr, { fly: false });
  }
  if (uhits.length) return selectUrbanTrip(nearestHit(uhits, p).properties.id.slice(2), { fly: false });
  const st = map.queryRenderedFeatures(box, { layers: ['route-stops', 'urban-stations', 'stations'] });
  if (st.length) {
    const pr = st[0].properties;
    if (pr.us) return selectUrbanStation(pr.us, { fly: false });
    if (pr.uic) return selectStation(pr.uic, { fly: false });
    if (pr.id) return selectUrbanStation(pr.id, { fly: false });
  }
  if (state.sel && ['train', 'station', 'uveh', 'ustation'].includes(state.sel.kind)) closePanel();
}

function onMapMove(e) {
  if (!layersReady || isMobile()) return;
  const hits = map.queryRenderedFeatures(e.point, { layers: ['trains'] });
  if (hits.length) {
    const tr = trains.get(hits[0].properties.id);
    if (tr && tr.pos) {
      map.getCanvas().style.cursor = 'pointer';
      const d = tr.pos.delay;
      tip
        .setLngLat([tr.pos.lon, tr.pos.lat])
        .setHTML(
          `<div class="tip-title">${badge(tr.type, tr.brand)}<span class="tnum">${esc(tr.num)}</span></div>` +
            `<div class="tip-sub">${esc(tr.origin.name)} → ${esc(tr.dest.name)}</div>` +
            `<div class="tip-sub"><span class="${delayClass(d)}">${esc(delayText(d))}</span>${tr.pos.moving ? ' · ' + Math.round(tr.pos.speed / 5) * 5 + ' ' + t('kmh') : ' · ' + esc(t('atStation'))}</div>`,
        )
        .addTo(map);
      return;
    }
  }
  const uh = urban ? map.queryRenderedFeatures(e.point, { layers: ['urban-veh'] }) : [];
  if (uh.length) {
    const tr = urban.trip(uh[0].properties.id.slice(2));
    if (tr && tr.pos) {
      map.getCanvas().style.cursor = 'pointer';
      const src = urban.sourceOf(tr, nowSec());
      const status = src === 'gps' ? t('src.gpsShort') : src === 'rt' ? `<span class="${delayClass(tr.delay)}">${esc(delayText(tr.delay))}</span>` : esc(t('src.theoShort'));
      tip
        .setLngLat([tr.pos.lon, tr.pos.lat])
        .setHTML(
          `<div class="tip-title">${lineBadge(tr.line)}<span>${esc(t('mode.' + tr.line.mode))} ${esc(tr.line.label)}</span></div>` +
            `<div class="tip-sub">→ ${esc(tr.prof.pat.head)}</div><div class="tip-sub">${status}</div>`,
        )
        .addTo(map);
      return;
    }
  }
  const st = map.queryRenderedFeatures(e.point, { layers: ['stations', 'route-stops', 'urban-stations'] });
  if (st.length) {
    map.getCanvas().style.cursor = 'pointer';
    tip.setLngLat(st[0].geometry.coordinates).setHTML(`<div class="tip-title">${esc(st[0].properties.n)}</div>`).addTo(map);
    return;
  }
  map.getCanvas().style.cursor = '';
  tip.remove();
}

// ---- Flux temps réel ------------------------------------------------------------------------

async function refreshFeed() {
  lastFetch = Date.now();
  try {
    const r = await fetch(FEED_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const srv = Date.parse(r.headers.get('date') || '');
    if (!Number.isNaN(srv)) {
      const off = srv - Date.now();
      clockOffset = Math.abs(off) > 5000 ? off : 0; // corrige une horloge d'appareil déréglée
    }
    const feed = decodeTripUpdates(await r.arrayBuffer());
    const built = buildTrains(feed, rail.stations);
    for (const [id, tr] of built.trains) {
      const old = trains.get(id);
      if (old && old.pos) tr.pos = old.pos; // garde l'orientation d'un rafraîchissement à l'autre
    }
    trains = built.trains;
    byNumber = built.byNumber;
    cancelled = built.cancelled;
    feedTime = feed.timestamp || Math.floor(nowSec());
    feedOk = true;
    if (state.sel && state.sel.kind === 'train') {
      const cur = trains.get(state.sel.id) || byNumber.get(state.sel.num);
      if (cur) state.sel.id = cur.id;
    }
    if (pendingHash) applyHash();
    feedSncfToUrban();
    tick();
    renderPanel(true);
    updateRoute();
  } catch (err) {
    console.warn('flux SNCF :', err);
    feedOk = false;
  }
  updateLive();
}

async function loadAlerts() {
  if (alertsLoading || (alertIndex && Date.now() - alertsAt < ALERTS_MAX_AGE)) return;
  alertsLoading = true;
  try {
    const r = await fetch(ALERTS_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const idx = new Map();
    for (const a of decodeAlerts(await r.arrayBuffer())) {
      for (const id of a.trips) {
        const list = idx.get(id);
        if (list) list.push(a);
        else idx.set(id, [a]);
      }
    }
    alertIndex = idx;
    alertsAt = Date.now();
    renderAlerts();
  } catch (err) {
    console.warn('info trafic :', err);
  }
  alertsLoading = false;
}

function plainText(html) {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

// ---- Boucle d'animation -----------------------------------------------------------------------

function tick() {
  if (!layersReady) return;
  const now = nowSec();
  const feats = [];
  const counts = { inoui: 0, ouigo: 0, ic: 0, ter: 0, intl: 0 };
  let running = 0;
  let late = 0;
  let sum = 0;
  const zoom = map.getZoom();
  const selId = state.sel && state.sel.kind === 'train' ? state.sel.id : null;
  let selPos = null;
  for (const tr of trains.values()) {
    if (tr.hidden) continue;
    const pos = locate(tr, now, rail);
    if (!pos) continue;
    running++;
    counts[tr.group]++;
    sum += pos.delay;
    if (pos.delay >= 300) late++;
    const isSel = tr.id === selId;
    if (isSel) selPos = pos;
    else if (!state.filters[tr.group] || (state.lateOnly && pos.delay < 300)) continue;
    else if (urban && urban.sncfMatched && urban.hidesSncf(tr.id, zoom)) continue; // affiché comme Transilien/RER
    const vertical = pos.bearing % 180 < 45 || pos.bearing % 180 > 135;
    feats.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
      properties: { id: tr.id, i: 'tr-' + tr.type, b: pos.bearing, d: delayLevel(pos.delay), n: tr.num, z: isSel ? 9 : Z_ORDER[tr.type], a: vertical ? 'left' : 'top' },
    });
  }
  map.getSource('trains').setData({ type: 'FeatureCollection', features: feats });
  if (urban && urban.nets.size) {
    if (urbanDirty) refreshUrbanStatic();
    const selKey = state.sel && state.sel.kind === 'uveh' ? state.sel.key : null;
    map.getSource('urban').setData({ type: 'FeatureCollection', features: urban.features(now, urbanView(), selKey) });
    if (selKey) {
      const ut = urban.trip(selKey);
      if (ut && ut.pos && urban.locate(ut, now)) selPos = ut.pos;
    }
  }
  const selSt = state.sel && state.sel.kind === 'station' ? rail.stations[state.sel.uic] : state.sel && state.sel.kind === 'ustation' && urban ? urban.station(state.sel.key) : null;
  const ring = selPos ? [selPos.lon, selPos.lat] : selSt ? [selSt.lon, selSt.lat] : null;
  map.getSource('sel').setData({
    type: 'FeatureCollection',
    features: ring ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: ring }, properties: {} }] : [],
  });
  stats = { running, late, avg: running ? sum / running / 60 : 0, counts };
  if (state.follow && selPos && !map.isMoving()) {
    map.easeTo({ center: [selPos.lon, selPos.lat], offset: viewOffset(), duration: 0 });
  }
}

function tickInterval() {
  const z = map.getZoom();
  const base = z < 7.5 ? 1000 : z < 9.5 ? 400 : z < 11.5 ? 150 : 60;
  return state.follow ? Math.min(base, 100) : base;
}

let lastTick = 0;
let lastUi = 0;
function loop(ts) {
  if (ts - lastTick >= tickInterval()) {
    lastTick = ts;
    tick();
  }
  if (ts - lastUi >= 1000) {
    lastUi = ts;
    updateLive();
    updateChips();
    updatePanelLive();
  }
  requestAnimationFrame(loop);
}

// ---- Sélection --------------------------------------------------------------------------------

function setHash(h) {
  const url = location.pathname + location.search + (h ? '#' + h : '');
  history.replaceState(null, '', url);
}

function selectTrain(tr, opts = {}) {
  if (tr.aliasOf) tr = tr.aliasOf;
  state.sel = { kind: 'train', id: tr.id, num: tr.num };
  state.follow = false;
  setHash('train=' + tr.num);
  allPaths(tr, rail);
  if (!tr.hidden) locate(tr, nowSec(), rail);
  openPanel();
  tick();
  updateRoute();
  loadAlerts();
  if (opts.fly !== false) {
    if (tr.pos) map.flyTo({ center: [tr.pos.lon, tr.pos.lat], zoom: Math.max(map.getZoom(), 9), offset: viewOffset(), duration: 1200 });
    else if (tr.mv.length > 1) fitRoute(tr);
  }
}

function fitRoute(tr) {
  const b = new maplibregl.LngLatBounds();
  for (const s of tr.mv) b.extend([s.st.lon, s.st.lat]);
  const pad = isMobile() ? { top: 120, bottom: sheetPx() + 30, left: 30, right: 30 } : { top: 130, bottom: 60, left: 440, right: 70 };
  map.fitBounds(b, { padding: pad, maxZoom: 11, duration: 1000 });
}

function selectStation(uic, opts = {}) {
  const st = rail.stations[uic];
  if (!st) return;
  state.sel = { kind: 'station', uic };
  state.follow = false;
  setHash('gare=' + uic);
  openPanel();
  tick();
  updateRoute();
  if (opts.fly !== false) map.flyTo({ center: [st.lon, st.lat], zoom: Math.max(map.getZoom(), 11), offset: viewOffset(), duration: 1200 });
}

function lineBadge(line, big) {
  const shape = line.mode === 'metro' || line.mode === 'val' ? 'round' : line.mode === 'rer' || line.mode === 'transilien' ? 'square' : 'pill';
  return `<span class="lbadge ${shape}${big ? ' big' : ''}" style="--c:${line.color};--ink:${line.text}">${esc(line.label)}</span>`;
}

async function selectUrbanTrip(key, opts = {}) {
  if (!urban) return;
  let tr = urban.trip(key);
  if (!tr) {
    await urban.load(key.split('|')[0], nowSec());
    tr = urban.trip(key);
    if (!tr) return;
  }
  state.sel = { kind: 'uveh', key };
  state.follow = false;
  setHash('u=' + key);
  urban.locate(tr, nowSec());
  openPanel();
  tick();
  updateRoute();
  if (opts.fly !== false && tr.pos) map.flyTo({ center: [tr.pos.lon, tr.pos.lat], zoom: Math.max(map.getZoom(), zoomFor(tr.net.id, tr.line.mode, 'v') + 1), offset: viewOffset(), duration: 1200 });
}

async function selectUrbanStation(key, opts = {}) {
  if (!urban) return;
  if (!urban.station(key)) await urban.load(key.split('|')[0], nowSec());
  const st = urban.station(key);
  if (!st) return;
  state.sel = { kind: 'ustation', key };
  state.follow = false;
  setHash('us=' + key);
  openPanel();
  tick();
  updateRoute();
  if (opts.fly !== false) map.flyTo({ center: [st.lon, st.lat], zoom: Math.max(map.getZoom(), 14), offset: viewOffset(), duration: 1200 });
}

const selectedUrban = () => (state.sel && state.sel.kind === 'uveh' && urban ? urban.trip(state.sel.key) : null);

function urbanTripPanel() {
  const tr = selectedUrban();
  if (!tr) return head(esc(t('noPosition')), '') + '<div class="p-body"></div>';
  const line = tr.line;
  const net = tr.net;
  const title = `${lineBadge(line, true)}<span>${esc(t('mode.' + line.mode))} ${esc(line.label)}</span>`;
  const sub = `${UI.arrow}<strong>${esc(tr.prof.pat.head)}</strong><span class="muted-dot">·</span><span>${esc(t('city.' + net.id))}</span>`;
  let h = head(title, sub, '') + '<div class="p-body">';
  h += `<div id="uSource"></div>`;
  const alerts = net.alerts.get(line.id) || [];
  for (const a of alerts.slice(0, 3)) h += `<div class="note">${UI.warn}<div><strong>${esc(a.type || t('trafficInfo'))}</strong><p>${esc(a.text)}</p></div></div>`;
  h += `<div class="art-wrap">${urbanArt(line.mode, line.color)}<div class="art-cap"><span>${esc(t('model'))}</span><strong>${esc(urbanModel(net.id, line))}</strong></div></div>`;
  h +=
    `<div class="kpis">` +
    `<div class="kpi"><div class="k">${esc(t('delay'))}</div><div class="v" id="kDelay">–</div></div>` +
    `<div class="kpi"><div class="k">${esc(t('speed'))}</div><div class="v" id="kSpeed">–</div></div>` +
    `<div class="kpi wide"><div class="k" id="kNextLabel">${esc(t('nextStop'))}</div><div class="v" id="kNext">–</div><div class="s" id="kNextSub"></div></div>` +
    `</div>` +
    `<div class="btn-row">` +
    `<button class="btn" data-act="follow" aria-pressed="${state.follow}">${UI.follow}<span>${esc(t(state.follow ? 'following' : 'follow'))}</span></button>` +
    `<button class="btn" data-act="share">${UI.share}<span>${esc(t('share'))}</span></button></div>`;
  h += `<h3 class="sec">${esc(t('nextStations'))}</h3><ol class="timeline" id="timeline">`;
  for (const s of urban.tripStops(tr)) {
    const late = s.time - s.sched >= 60;
    const tm = late ? `<s>${hm(s.sched)}</s><span class="real ${delayClass(s.time - s.sched)}">${hm(s.time)}</span>` : `<span class="real">${hm(s.time)}</span>`;
    h += `<li data-t="${s.time}"><div class="tm">${tm}</div><div class="rail"></div><div class="st"><button data-act="ustation" data-key="${esc(net.id + '|' + s.st.i)}">${esc(s.st.n)}</button></div></li>`;
  }
  h += '</ol></div>';
  return h;
}

function updateUrbanLive() {
  const tr = selectedUrban();
  if (!tr) return;
  const now = nowSec();
  const pos = urban.locate(tr, now);
  const src = urban.sourceOf(tr, now);
  const box = $('uSource');
  if (box && box.dataset.src !== src) {
    box.dataset.src = src;
    box.innerHTML = `<div class="note ${src === 'gps' || src === 'rt' ? 'note-live' : 'plain'}">${src === 'gps' || src === 'rt' ? UI.follow : UI.clock}<div><strong>${esc(t('src.' + src))}</strong><p>${esc(t('srcNote.' + src))}</p></div></div>`;
  }
  const kd = $('kDelay');
  if (!kd) return;
  if (src === 'theo' || src === 'nokey') {
    kd.textContent = t('src.theoShort');
    kd.className = 'v';
  } else {
    kd.textContent = delayText(tr.delay);
    kd.className = 'v ' + delayClass(tr.delay);
  }
  $('kSpeed').innerHTML = pos && pos.moving ? `${Math.round(pos.speed / 5) * 5} <small>${esc(t('kmh'))}</small>` : pos ? `<small>${esc(t('atStation'))}</small>` : '–';
  const stops = urban.tripStops(tr);
  const k = pos ? (pos.moving ? pos.k + 1 : pos.k) : now < tr.start ? 0 : stops.length - 1;
  const next = stops[Math.min(k, stops.length - 1)];
  $('kNextLabel').textContent = pos && !pos.moving ? t('stopped') : t('nextStop');
  $('kNext').textContent = next ? next.st.n : '–';
  $('kNextSub').textContent = next ? t(pos && pos.moving ? 'arrivalAt' : 'departureAt', { time: hm(next.time) }) : '';
  const tl = $('timeline');
  if (tl) {
    let here = false;
    [...tl.children].forEach((li, i) => {
      const done = pos ? i < k || (!pos.moving && i === k && false) : now > tr.end;
      li.classList.toggle('done', done);
      li.classList.toggle('here', !done && !here);
      if (!done) here = true;
    });
  }
}

function urbanStationPanel() {
  const st = urban && urban.station(state.sel.key);
  if (!st) return head('…', '') + '<div class="p-body"></div>';
  const net = urban.nets.get(st.net);
  const lines = st.lines.map((i) => net.lines[i]);
  const sub = lines.map((l) => lineBadge(l)).join('') + `<span class="muted-dot">·</span><span>${esc(t('city.' + net.id))}</span>`;
  let h = head(esc(st.n), sub, '') + '<div class="p-body">';
  const now = nowSec();
  const rows = urban.board(st, now);
  h += `<h3 class="sec" style="margin-top:4px">${esc(t('passages'))}</h3>`;
  if (!rows.length) h += `<div class="empty-msg">${esc(t('noPassages'))}</div>`;
  else {
    h += '<div class="rows">';
    for (const r of rows) {
      const min = Math.max(0, Math.round((r.time - now) / 60));
      const when = min < 1 ? t('imminent') : t('inMin', { n: min });
      const late = r.live && r.delay >= 60;
      h +=
        `<button class="row" data-act="utrip" data-key="${esc(net.id + '|' + r.tr.key)}">` +
        `<div class="tm">${late ? `<s>${hm(r.time - r.delay)}</s>` : ''}${hm(r.time)}</div>` +
        `<div class="mid"><div class="l1">${lineBadge(r.tr.line)}<span>${esc(r.tr.prof.pat.head)}</span></div><div class="l2">${r.live ? esc(t('src.rtShort')) : esc(t('src.theoShort'))}</div></div>` +
        `<div class="end ${r.live ? delayClass(r.delay) : ''}">${esc(when)}</div></button>`;
    }
    h += '</div>';
  }
  h += `<p class="small">${esc(t('boardNoteUrban'))}</p></div>`;
  return h;
}

function openSimple(kind) {
  if (state.sel && state.sel.kind === kind) return closePanel();
  state.sel = { kind };
  state.follow = false;
  setHash('');
  openPanel();
  tick();
  updateRoute();
}

function sheetPx() {
  return Math.round(window.innerHeight * (state.tall ? 0.86 : 0.5));
}

function openPanel() {
  state.tall = false;
  document.body.classList.remove('sheet-tall');
  document.body.classList.add('has-panel');
  document.documentElement.style.setProperty('--sheet', sheetPx() + 'px');
  $('panel').hidden = false;
  renderPanel(false);
}

function closePanel() {
  state.sel = null;
  state.follow = false;
  setHash('');
  $('panel').hidden = true;
  document.body.classList.remove('has-panel', 'sheet-tall');
  document.documentElement.style.setProperty('--sheet', '0px');
  tick();
  updateRoute();
}

function setFollow(on) {
  state.follow = on;
  const b = document.querySelector('[data-act="follow"]');
  if (b) {
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('span').textContent = t(on ? 'following' : 'follow');
  }
  if (on) {
    const tr = selectedTrain() || selectedUrban();
    if (tr && tr.pos) map.flyTo({ center: [tr.pos.lon, tr.pos.lat], zoom: Math.max(map.getZoom(), 11), offset: viewOffset(), duration: 900 });
  }
}

const selectedTrain = () => (state.sel && state.sel.kind === 'train' ? trains.get(state.sel.id) : null);

function pathCoords(p) {
  if (!p.coords) {
    p.coords = new Array(p.lon.length);
    for (let i = 0; i < p.lon.length; i++) p.coords[i] = [p.lon[i], p.lat[i]];
  }
  return p.coords;
}

function updateRoute() {
  if (!layersReady) return;
  const tr = selectedTrain();
  const feats = [];
  const stops = [];
  if (tr && tr.mv.length > 1) {
    const now = nowSec();
    const paths = allPaths(tr, rail);
    const pos = tr.hidden ? null : tr.pos;
    const done = [];
    const todo = [];
    const over = !pos && now >= tr.t1 && !tr.canceled;
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      const a = tr.mv[i].st;
      const b = tr.mv[i + 1].st;
      const full = p ? pathCoords(p) : [[a.lon, a.lat], [b.lon, b.lat]];
      if (!pos) (over ? done : todo).push(...full);
      else if (i < pos.leg) done.push(...full);
      else if (i > pos.leg) todo.push(...full);
      else if (p) {
        done.push(...sliceCoords(p, 0, pos.legDist));
        todo.push(...sliceCoords(p, pos.legDist, p.len));
      } else {
        done.push([a.lon, a.lat], [pos.lon, pos.lat]);
        todo.push([pos.lon, pos.lat], [b.lon, b.lat]);
      }
    }
    if (done.length > 1) feats.push({ type: 'Feature', properties: { part: 'done' }, geometry: { type: 'LineString', coordinates: done } });
    if (todo.length > 1) feats.push({ type: 'Feature', properties: { part: 'todo' }, geometry: { type: 'LineString', coordinates: todo } });
    tr.mv.forEach((s, i) => {
      const edge = i === 0 || i === tr.mv.length - 1;
      stops.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.st.lon, s.st.lat] },
        properties: { uic: s.uic, n: s.name, done: !tr.canceled && now >= s.dep, p: edge ? 0 : 1 },
      });
    });
  }
  const ut = selectedUrban();
  if (ut) {
    const g = urban.routeGeo(ut, nowSec());
    if (g.done.length > 1) feats.push({ type: 'Feature', properties: { part: 'done' }, geometry: { type: 'LineString', coordinates: g.done } });
    if (g.todo.length > 1) feats.push({ type: 'Feature', properties: { part: 'todo' }, geometry: { type: 'LineString', coordinates: g.todo } });
    for (const s of g.stops) {
      stops.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.st.lon, s.st.lat] },
        properties: { us: s.st.net + '|' + s.st.i, n: s.st.n, done: s.done, p: s.edge ? 0 : 1 },
      });
    }
  }
  map.getSource('route').setData({ type: 'FeatureCollection', features: feats });
  map.getSource('route-stops').setData({ type: 'FeatureCollection', features: stops });
}

// ---- Panneau ----------------------------------------------------------------------------------

function renderPanel(keepScroll) {
  const panel = $('panel');
  if (!state.sel) return;
  const body = panel.querySelector('.p-body');
  const scroll = keepScroll && body ? body.scrollTop : 0;
  const kind = state.sel.kind;
  let html = '';
  if (kind === 'train') html = trainPanel();
  else if (kind === 'station') html = stationPanel();
  else if (kind === 'stats') html = statsPanel();
  else if (kind === 'favs') html = favsPanel();
  else if (kind === 'uveh') html = urbanTripPanel();
  else if (kind === 'ustation') html = urbanStationPanel();
  panel.innerHTML = `<button class="grip" data-act="grip" aria-label="${esc(t('resize'))}"></button>` + html;
  const nb = panel.querySelector('.p-body');
  if (nb) nb.scrollTop = scroll;
  if (kind === 'train') {
    renderAlerts();
    updatePanelLive();
  }
  if (kind === 'uveh') updateUrbanLive();
}

function head(title, sub, favKey) {
  const fav = favKey
    ? `<button class="ghost ${isFav(favKey) ? 'on' : ''}" data-act="fav" data-key="${esc(favKey)}" title="${esc(t(isFav(favKey) ? 'removeFav' : 'addFav'))}" aria-label="${esc(t(isFav(favKey) ? 'removeFav' : 'addFav'))}">${isFav(favKey) ? UI.starFill : UI.star}</button>`
    : '';
  return (
    `<div class="p-head"><div class="p-title"><h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>` +
    `<div class="p-actions">${fav}<button class="ghost" data-act="close" title="${esc(t('close'))}" aria-label="${esc(t('close'))}">${UI.close}</button></div></div>`
  );
}

function trainPanel() {
  const tr = selectedTrain();
  if (!tr) {
    return head(`<span class="tnum">${esc(state.sel.num)}</span>`, '', 't:' + state.sel.num) + `<div class="p-body"><div class="note plain">${UI.info}<div><p>${esc(t('noPosition'))}</p></div></div></div>`;
  }
  const title = `${badge(tr.type, tr.brand)}<span class="tnum">${esc(tr.num)}</span>`;
  const sub = `<strong>${esc(tr.origin.name)}</strong><span class="leg">${UI.arrow}<strong>${esc(tr.dest.name)}</strong></span>`;
  let h = head(title, sub, 't:' + tr.num) + '<div class="p-body">';
  if (tr.canceled) h += `<div class="note">${UI.warn}<div><strong>${esc(t('cancelled'))}</strong><p>${esc(t('trainCancelled'))}</p></div></div>`;
  h += `<div id="trainState"></div>`;
  h +=
    `<div class="art-wrap">${sideArt(tr.type)}<div class="art-cap"><span>${esc(t('model'))}</span><strong>${esc(modelName(tr.type))}</strong></div></div>`;
  if (!tr.canceled) {
    h +=
      `<div class="kpis">` +
      `<div class="kpi"><div class="k">${esc(t('delay'))}</div><div class="v" id="kDelay">–</div></div>` +
      `<div class="kpi"><div class="k">${esc(t('speed'))}</div><div class="v" id="kSpeed">–</div></div>` +
      `<div class="kpi wide"><div class="k" id="kNextLabel">${esc(t('nextStop'))}</div><div class="v" id="kNext">–</div><div class="s" id="kNextSub"></div></div>` +
      `</div>` +
      `<div class="progress"><div class="bar"><i id="barFill"></i><b id="barDot"></b></div>` +
      `<div class="ends"><span><strong>${hm(tr.origin.dep)}</strong> ${esc(tr.origin.name)}</span><span>${esc(tr.dest.name)} <strong>${hm(tr.dest.arr)}</strong></span></div></div>` +
      `<div class="btn-row">` +
      `<button class="btn" data-act="follow" aria-pressed="${state.follow}">${UI.follow}<span>${esc(t(state.follow ? 'following' : 'follow'))}</span></button>` +
      `<button class="btn" data-act="share">${UI.share}<span>${esc(t('share'))}</span></button>` +
      `</div>`;
  }
  if (tr.aliases.length) h += `<div class="note plain">${UI.info}<div><p>${esc(t('alsoNumbered', { nums: tr.aliases.join(', ') }))}</p></div></div>`;
  h += `<div id="alerts"></div>`;
  h += `<h3 class="sec">${esc(t('stops'))}</h3><ol class="timeline" id="timeline">`;
  const lastIdx = tr.stops.length - 1;
  tr.stops.forEach((s, i) => {
    const isLast = i === lastIdx;
    const time = isLast ? s.arr : s.dep;
    const delay = isLast ? s.arrDelay : s.depDelay;
    const cut = s.skipped || tr.canceled;
    const tm = delay >= 60 && !cut ? `<s>${hm(time - delay)}</s><span class="real ${delayClass(delay)}">${hm(time)}</span>` : `<span class="real">${hm(cut ? time - delay : time)}</span>`;
    const name = s.st ? `<button data-act="station" data-uic="${esc(s.uic)}">${esc(s.name)}</button>` : `<button disabled>${esc(s.name)}</button>`;
    const meta = cut && !tr.canceled ? `<div class="meta">${esc(t('stopCancelled'))}</div>` : '';
    h += `<li class="${cut ? 'cut' : ''}" data-t="${isLast ? s.arr : s.dep}" data-a="${s.arr}"><div class="tm">${tm}</div><div class="rail"></div><div class="st">${name}${meta}</div></li>`;
  });
  h += '</ol></div>';
  return h;
}

function renderAlerts() {
  const box = $('alerts');
  const tr = selectedTrain();
  if (!box || !tr) return;
  const list = alertIndex ? alertIndex.get(tr.key) || [] : [];
  const lang = getLang();
  const seen = new Set();
  let h = '';
  for (const a of list) {
    const title = plainText(a.header[lang] || a.header.fr || a.header.en || '');
    const text = plainText(a.text[lang] || a.text.fr || a.text.en || '');
    const k = title + '|' + text;
    if ((!title && !text) || seen.has(k)) continue;
    seen.add(k);
    h += `<div class="note">${UI.warn}<div><strong>${esc(title || t('trafficInfo'))}</strong>${text && text !== title ? `<p>${esc(text)}</p>` : ''}</div></div>`;
    if (seen.size >= 4) break;
  }
  box.innerHTML = h;
}

function updatePanelLive() {
  if (!state.sel) return;
  if (state.sel.kind === 'stats') return updateStatsLive();
  if (state.sel.kind === 'uveh') {
    updateUrbanLive();
    if (nowSec() - (updatePanelLive.lastU || 0) > 2) {
      updatePanelLive.lastU = nowSec();
      updateRoute();
    }
    return;
  }
  if (state.sel.kind === 'ustation') {
    if (nowSec() - (updatePanelLive.lastS || 0) > 20) {
      updatePanelLive.lastS = nowSec();
      renderPanel(true);
    }
    return;
  }
  if (state.sel.kind !== 'train') return;
  const tr = selectedTrain();
  if (!tr) return;
  const now = nowSec();
  const pos = tr.hidden ? null : tr.pos;
  const st = $('trainState');
  if (st) {
    let msg = '';
    if (!tr.canceled && !pos) msg = now < tr.t0 ? t('notDeparted', { time: hm(tr.t0) }) : now >= tr.t1 ? t('arrived') : t('noPosition');
    const html = msg ? `<div class="note plain">${UI.clock}<div><p>${esc(msg)}</p></div></div>` : '';
    if (st.dataset.msg !== msg) {
      st.dataset.msg = msg;
      st.innerHTML = html;
    }
  }
  const kd = $('kDelay');
  if (kd) {
    const d = pos ? pos.delay : now < tr.t0 ? tr.origin.depDelay : tr.dest.arrDelay;
    kd.textContent = delayText(d);
    kd.className = 'v ' + delayClass(d);
    $('kSpeed').innerHTML = pos && pos.moving ? `${Math.round(pos.speed / 5) * 5} <small>${esc(t('kmh'))}</small>` : pos ? `<small>${esc(t('atStation'))}</small>` : '–';
    const next = pos ? pos.next : now < tr.t0 ? tr.origin : null;
    $('kNextLabel').textContent = pos && !pos.moving ? t('stopped') : t('nextStop');
    $('kNext').textContent = next ? next.name : '–';
    $('kNextSub').textContent = !next ? '' : pos && pos.moving ? t('arrivalAt', { time: hm(next.arr) }) : t('departureAt', { time: hm(next.dep) });
    const f = Math.min(1, Math.max(0, (now - tr.t0) / Math.max(1, tr.t1 - tr.t0)));
    $('barFill').style.width = f * 100 + '%';
    $('barDot').style.left = f * 100 + '%';
  }
  const tl = $('timeline');
  if (tl && !tr.canceled) {
    let here = false;
    for (const li of tl.children) {
      if (li.classList.contains('cut')) continue;
      const done = now >= Number(li.dataset.t);
      li.classList.toggle('done', done);
      li.classList.toggle('here', !done && !here && now >= tr.t0);
      if (!done) here = true;
    }
  }
  if (now - (updatePanelLive.last || 0) > 2) {
    updatePanelLive.last = now;
    updateRoute();
  }
}

function boardRows(uic, mode) {
  const now = nowSec();
  const rows = [];
  for (const tr of trains.values()) {
    if (tr.aliasOf) continue;
    const list = tr.stops;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.uic !== uic) continue;
      if (s.skipped && !tr.canceled) continue;
      if (mode === 'dep') {
        if (i === list.length - 1 || s.dep < now - 60) continue;
        rows.push({ tr, time: s.dep, delay: s.depDelay, other: tr.dest.name });
      } else {
        if (i === 0 || s.arr < now - 60) continue;
        rows.push({ tr, time: s.arr, delay: s.arrDelay, other: tr.origin.name });
      }
      break;
    }
  }
  rows.sort((a, b) => a.time - b.time);
  return rows.slice(0, 40);
}

function trainRow(tr, first, sub, end, endClass, cut) {
  return (
    `<button class="row ${cut ? 'cut' : ''}" data-act="train" data-id="${esc(tr.id)}">` +
    `<div class="tm">${first}</div>` +
    `<div class="mid"><div class="l1">${badge(tr.type)}<span class="tnum">${esc(tr.num)}</span></div><div class="l2">${sub}</div></div>` +
    `<div class="end ${endClass || ''}">${end}</div></button>`
  );
}

function stationPanel() {
  const st = rail.stations[state.sel.uic];
  const title = esc(st.n);
  let h = head(title, `${UI.station}<span>${esc(t('stationOf'))}</span>`, 's:' + st.uic) + '<div class="p-body">';
  h +=
    `<div class="tabs" role="tablist">` +
    `<button class="tab" role="tab" data-act="tab" data-tab="dep" aria-selected="${state.tab === 'dep'}">${esc(t('departures'))}</button>` +
    `<button class="tab" role="tab" data-act="tab" data-tab="arr" aria-selected="${state.tab === 'arr'}">${esc(t('arrivals'))}</button></div>`;
  const rows = boardRows(st.uic, state.tab);
  if (!rows.length) h += `<div class="empty-msg">${esc(t(state.tab === 'dep' ? 'noDepartures' : 'noArrivals'))}</div>`;
  else {
    h += '<div class="rows">';
    for (const r of rows) {
      const late = r.delay >= 60 && !r.tr.canceled;
      const tm = late ? `<s>${hm(r.time - r.delay)}</s>${hm(r.time)}` : hm(r.tr.canceled ? r.time - r.delay : r.time);
      const sub = `${esc(t(state.tab === 'dep' ? 'to' : 'from'))} ${esc(r.other)}`;
      const end = r.tr.canceled ? esc(t('cancelled')) : esc(delayText(r.delay));
      h += trainRow(r.tr, tm, sub, end, r.tr.canceled ? 'bad' : delayClass(r.delay), r.tr.canceled);
    }
    h += '</div>';
  }
  h += `<p class="small">${esc(t('boardNote'))}</p></div>`;
  return h;
}

function statsPanel() {
  let h = head(esc(t('stats')), feedTime ? esc(t('updated', { time: fmtHMS.format(feedTime * 1000) })) : '') + '<div class="p-body">';
  h +=
    `<div class="stat-grid">` +
    `<div class="kpi"><div class="k">${esc(t('running'))}</div><div class="v" id="sRunning">–</div></div>` +
    `<div class="kpi"><div class="k">${esc(t('punctuality'))}</div><div class="v" id="sPunct">–</div></div>` +
    `<div class="kpi"><div class="k">${esc(t('avgDelay'))}</div><div class="v" id="sAvg">–</div></div></div>` +
    `<p class="small" style="margin-top:6px">${esc(t('punctuality'))} : ${esc(t('punctualityNote'))}</p>` +
    `<div class="split" id="sSplit"></div><div class="legend" id="sLegend"></div>`;
  const delayed = [];
  for (const tr of trains.values()) if (!tr.hidden && tr.pos && tr.pos.delay >= 300) delayed.push(tr);
  delayed.sort((a, b) => b.pos.delay - a.pos.delay);
  h += `<h3 class="sec">${esc(t('topDelays'))}</h3>`;
  if (!delayed.length) h += `<div class="empty-msg">${esc(t('noDelays'))}</div>`;
  else {
    h += '<div class="rows">';
    for (const tr of delayed.slice(0, 12)) {
      h += trainRow(tr, `<span class="${delayClass(tr.pos.delay)}">+${Math.round(tr.pos.delay / 60)}</span><small>${esc(t('minutes'))}</small>`, `${esc(tr.origin.name)} → ${esc(tr.dest.name)}`, '', '');
    }
    h += '</div>';
  }
  h += `<h3 class="sec">${esc(t('cancelledTrains'))} (${cancelled.length})</h3>`;
  if (!cancelled.length) h += `<div class="empty-msg">${esc(t('noCancelled'))}</div>`;
  else {
    h += '<div class="rows">';
    for (const tr of cancelled.slice(0, 60)) h += trainRow(tr, hm(tr.t0 - tr.origin.depDelay), `${esc(tr.origin.name)} → ${esc(tr.dest.name)}`, esc(t('cancelled')), 'bad', false);
    h += '</div>';
  }
  h += `<div class="btn-row" style="margin-top:16px"><button class="btn" data-act="about">${UI.info}<span>${esc(t('aboutTitle'))}</span></button></div>`;
  h += '</div>';
  setTimeout(updateStatsLive, 0);
  return h;
}

function updateStatsLive() {
  const el = $('sRunning');
  if (!el) return;
  el.textContent = stats.running;
  $('sPunct').innerHTML = stats.running ? `${Math.round(((stats.running - stats.late) / stats.running) * 100)} <small>%</small>` : '–';
  $('sAvg').innerHTML = `${stats.avg.toFixed(stats.avg < 10 ? 1 : 0).replace('.', getLang() === 'fr' ? ',' : '.')} <small>${esc(t('minutes'))}</small>`;
  let split = '';
  let legend = '';
  for (const g of GROUPS) {
    const n = stats.counts[g] || 0;
    const c = GROUP_STYLE[g].color;
    if (n) split += `<i style="--c:${c};flex:${n}"></i>`;
    legend += `<span><i style="--c:${c}"></i>${esc(t('g.' + g))} <b>${n}</b></span>`;
  }
  $('sSplit').innerHTML = split;
  $('sLegend').innerHTML = legend;
}

function favsPanel() {
  let h = head(esc(t('favorites')), '') + '<div class="p-body">';
  const f = state.favs;
  if (!f.trains.length && !f.stations.length) return h + `<div class="empty-msg">${esc(t('noFavs'))}</div></div>`;
  if (f.trains.length) {
    h += `<h3 class="sec">${esc(t('favTrains'))}</h3><div class="rows">`;
    for (const num of f.trains) {
      const tr = byNumber.get(num);
      if (tr) {
        const d = tr.pos ? tr.pos.delay : tr.dest.arrDelay;
        h += trainRow(tr, hm(tr.t0), `${esc(tr.origin.name)} → ${esc(tr.dest.name)}`, tr.canceled ? esc(t('cancelled')) : esc(delayText(d)), tr.canceled ? 'bad' : delayClass(d), false);
      } else {
        h += `<button class="row" data-act="favnum" data-num="${esc(num)}"><div class="tm">–</div><div class="mid"><div class="l1"><span class="tnum">${esc(num)}</span></div><div class="l2">${esc(t('notRunning'))}</div></div><div class="end"></div></button>`;
      }
    }
    h += '</div>';
  }
  if (f.stations.length) {
    h += `<h3 class="sec">${esc(t('favStations'))}</h3><div class="rows">`;
    for (const uic of f.stations) {
      const st = rail.stations[uic];
      if (!st) continue;
      h += `<button class="row" data-act="station" data-uic="${esc(uic)}"><div class="tm" style="color:var(--muted)">${UI.station}</div><div class="mid"><div class="l1"><span>${esc(st.n)}</span></div></div><div class="end" style="color:var(--muted)">${UI.chevron}</div></button>`;
    }
    h += '</div>';
  }
  return h + '</div>';
}

// ---- Favoris, partage -------------------------------------------------------------------------

function isFav(key) {
  const [k, v] = [key.slice(0, 1), key.slice(2)];
  return (k === 't' ? state.favs.trains : state.favs.stations).includes(v);
}

function toggleFav(key) {
  const list = key.startsWith('t:') ? state.favs.trains : state.favs.stations;
  const v = key.slice(2);
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
  else list.unshift(v);
  store.set('favs', state.favs);
  renderPanel(true);
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2200);
}

async function share() {
  const tr = selectedTrain();
  const ut = selectedUrban();
  const url = location.href;
  const title = tr ? `${tr.brand} ${tr.num} — ${SITE_NAME}` : ut ? `${t('mode.' + ut.line.mode)} ${ut.line.label} → ${ut.prof.pat.head} — ${SITE_NAME}` : SITE_NAME;
  try {
    if (navigator.share && isMobile()) await navigator.share({ title, url });
    else {
      await navigator.clipboard.writeText(url);
      toast(t('linkCopied'));
    }
  } catch {
    /* partage annulé */
  }
}

// ---- Barre du haut : recherche, filtres, pastille ---------------------------------------------

function search(q) {
  const out = { trains: [], stations: [], ustations: [] };
  const nq = norm(q);
  if (!nq) return out;
  if (urban && nq.length >= 2 && /[a-z]/.test(nq)) out.ustations = urban.searchStations(nq, norm);
  const digits = nq.replace(/\s/g, '');
  if (/^\d+$/.test(digits)) {
    for (const [num, tr] of byNumber) if (num.startsWith(digits)) out.trains.push(tr);
    for (const tr of trains.values()) if (!tr.aliasOf && tr.aliases.some((a) => a.startsWith(digits)) && !out.trains.includes(tr)) out.trains.push(tr);
    out.trains.sort((a, b) => a.num.length - b.num.length || Number(a.num) - Number(b.num));
    out.trains = out.trains.slice(0, 8);
  }
  if (nq.length >= 2 && /[a-z]/.test(nq)) {
    const hits = [];
    for (const s of stationIndex) {
      const i = s.norm.indexOf(nq);
      if (i < 0) continue;
      const word = i === 0 || s.norm[i - 1] === ' ';
      hits.push([(i === 0 ? 0 : word ? 1 : 2) * 10 - s.w, s]);
    }
    hits.sort((a, b) => a[0] - b[0] || a[1].n.length - b[1].n.length);
    out.stations = hits.slice(0, 8).map((h) => h[1]);
  }
  return out;
}

function renderSncfResults(r) {
  let h = '';
  if (r.stations.length) {
    h += `<h4>${esc(t('resultStations'))}</h4>`;
    for (const s of r.stations) {
      h += `<button class="result" data-i="${resultItems.length}"><span class="r-icon">${UI.station}</span><span class="r-main"><div class="r-title">${esc(s.n)}</div></span></button>`;
      resultItems.push(() => selectStation(s.uic));
    }
  }
  return h;
}

function renderUrbanResults(r) {
  let h = '';
  if (r.ustations.length) {
    h += `<h4>${esc(t('resultUrban'))}</h4>`;
    for (const s of r.ustations) {
      const net = urban.nets.get(s.net);
      const badges = s.lines.slice(0, 6).map((i) => lineBadge(net.lines[i])).join('');
      h += `<button class="result" data-i="${resultItems.length}"><span class="r-icon">${UI.station}</span><span class="r-main"><div class="r-title">${esc(s.n)}</div><div class="r-sub r-badges">${badges}<span>${esc(t('city.' + s.net))}</span></div></span></button>`;
      resultItems.push(() => selectUrbanStation(s.net + '|' + s.i));
    }
  }
  return h;
}

let resultItems = [];
let resultActive = -1;
function renderResults() {
  const box = $('results');
  const q = $('q').value;
  if (!q.trim()) {
    box.hidden = true;
    return;
  }
  const r = search(q);
  resultItems = [];
  let h = '';
  if (r.trains.length) {
    h += `<h4>${esc(t('resultTrains'))}</h4>`;
    for (const tr of r.trains) {
      const d = tr.pos ? tr.pos.delay : tr.dest.arrDelay;
      const status = tr.canceled ? `<span class="bad">${esc(t('cancelled'))}</span>` : `<span class="${delayClass(d)}">${esc(delayText(d))}</span>`;
      h += `<button class="result" data-i="${resultItems.length}"><span class="r-icon">${badge(tr.type)}</span><span class="r-main"><div class="r-title tnum">${esc(tr.num)}${tr.aliases.length ? ' · ' + esc(tr.aliases.join(', ')) : ''}</div><div class="r-sub">${esc(tr.origin.name)} → ${esc(tr.dest.name)}</div></span>${status}</button>`;
      resultItems.push(() => selectTrain(tr));
    }
  }
  const nq = norm(q);
  const starts = (n) => norm(n).startsWith(nq);
  const urbanFirst = r.ustations.length && starts(r.ustations[0].n) && !(r.stations.length && starts(r.stations[0].n));
  const sections = urbanFirst ? [renderUrbanResults, renderSncfResults] : [renderSncfResults, renderUrbanResults];
  for (const fn of sections) h += fn(r);
  if (!resultItems.length) h = `<div class="empty">${esc(t('noResult'))}</div>`;
  resultActive = resultItems.length ? 0 : -1;
  box.innerHTML = h;
  box.hidden = false;
  markActive();
}

function markActive() {
  $('results')
    .querySelectorAll('.result')
    .forEach((el, i) => el.classList.toggle('active', i === resultActive));
}

function pickResult(i) {
  const fn = resultItems[i];
  if (!fn) return;
  $('results').hidden = true;
  $('q').value = '';
  $('q').blur();
  fn();
}

function renderChips() {
  let h = '';
  for (const g of GROUPS) {
    h += `<button class="chip" data-g="${g}" aria-pressed="${state.filters[g]}" style="--c:${GROUP_STYLE[g].color}"><span class="dot"></span>${esc(t('g.' + g))}<span class="count" id="cnt-${g}"></span></button>`;
  }
  h += `<span class="chip-sep"></span><button class="chip late" data-g="late" aria-pressed="${state.lateOnly}"><span class="dot"></span>${esc(t('lateOnly'))}<span class="count" id="cnt-late"></span></button>`;
  h += `<span class="chip-sep"></span><button class="chip urban-chip" data-g="urban" aria-expanded="${!$('urbanMenu').hidden}">${UI.layers}${esc(t('urbanNetworks'))}<span class="caret">${UI.chevron}</span></button>`;
  $('chips').innerHTML = h;
  updateChips();
}

const MODE_ORDER = { rer: 0, transilien: 1, metro: 2, tram: 3, val: 4, bus: 5 };

function rtStatus(net) {
  if (!net) return '';
  if (net.id === 'bdx') return net.rtState === 'ok' ? t('rt.gps') : t('rt.theo');
  if (net.id === 'lille') return t('rt.lille');
  return { ok: t('rt.ok'), nokey: t('rt.nokey'), quota: t('rt.quota'), error: t('rt.error') }[net.rtState] || t('rt.theo');
}

function renderUrbanMenu() {
  const box = $('urbanMenu');
  if (box.hidden || !urban) return;
  const open = state.urbanOpen || (state.urbanOpen = {});
  let h = `<div class="um-head"><strong>${esc(t('urbanNetworks'))}</strong><button class="ghost" data-um="close" aria-label="${esc(t('close'))}">${UI.close}</button></div>`;
  h += `<p class="um-hint">${esc(t('zoomHint'))}</p>`;
  for (const city of CITIES) {
    const info = urban.netInfo(city.id);
    const net = urban.nets.get(city.id);
    h += `<section class="um-city"><div class="um-city-head"><span>${esc(t('city.' + city.id))}</span><span class="um-rt" data-net="${city.id}">${esc(net ? rtStatus(net) : info ? t('notLoaded') : t('urbanUnavailable'))}</span></div>`;
    if (!info) {
      h += '</section>';
      continue;
    }
    for (const mode of city.modes) {
      const on = urban.isModeOn(city.id, mode);
      const key = city.id + '|' + mode;
      const lines = net ? net.lines.filter((l) => l.mode === mode).sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true })) : [];
      if (net && !lines.length) continue;
      const n = urban.visibleCount[key];
      h +=
        `<div class="um-mode"><label class="um-check"><input type="checkbox" data-um="mode" data-key="${key}" ${on ? 'checked' : ''}>` +
        `<span>${esc(t('mode.' + mode))}</span>${n ? `<span class="count">${n}</span>` : ''}</label>` +
        (lines.length ? `<button class="ghost um-more ${open[key] ? 'on' : ''}" data-um="expand" data-key="${key}" aria-expanded="${!!open[key]}" aria-label="${esc(t('lines'))}">${UI.chevron}</button>` : '') +
        `</div>`;
      if (open[key] && lines.length) {
        h += `<div class="um-lines">`;
        for (const l of lines) {
          const lon = urban.isLineOn(city.id, l);
          h += `<button class="um-line ${lon ? '' : 'off'}" data-um="line" data-net="${city.id}" data-line="${esc(l.id)}" aria-pressed="${lon}" title="${esc(l.long || l.label)}">${lineBadge(l)}</button>`;
        }
        h += `</div>`;
      }
    }
    h += '</section>';
  }
  box.innerHTML = h;
}

function updateUrbanMenuStatus() {
  const box = $('urbanMenu');
  if (box.hidden || !urban) return;
  box.querySelectorAll('.um-rt').forEach((el) => {
    const net = urban.nets.get(el.dataset.net);
    if (net) el.textContent = rtStatus(net);
  });
}

function toggleUrbanMenu(force) {
  const box = $('urbanMenu');
  box.hidden = force === undefined ? !box.hidden : !force;
  const chip = document.querySelector('.urban-chip');
  if (chip) chip.setAttribute('aria-expanded', String(!box.hidden));
  if (!box.hidden && urban) urban.loadAll(nowSec()).then(renderUrbanMenu);
  renderUrbanMenu();
}

function updateChips() {
  for (const g of GROUPS) {
    const el = $('cnt-' + g);
    if (el) el.textContent = stats.counts[g] !== undefined ? stats.counts[g] : '';
  }
  const el = $('cnt-late');
  if (el) el.textContent = stats.running ? stats.late : '';
}

function updateLive() {
  const pulse = $('pulse');
  const text = $('liveText');
  if (feedOk === null) return;
  const stale = feedTime && nowSec() - feedTime > 420;
  pulse.className = 'pulse ' + (feedOk && !stale ? 'ok' : 'err');
  if (!feedOk && !trains.size) {
    text.textContent = t('feedError');
    return;
  }
  const pct = stats.running ? Math.round(((stats.running - stats.late) / stats.running) * 100) : 100;
  const time = feedTime ? fmtHMS.format(feedTime * 1000) : '';
  text.innerHTML =
    `${esc(t('liveTrains', { n: stats.running }))}<span class="sep">·</span>${esc(t('liveOnTime', { p: pct }))}` +
    `<span class="sep">·</span><span class="dim">${esc(!feedOk ? t('feedError') : stale ? t('stale') : t('updated', { time }))}</span>`;
}

function renderBasemaps() {
  $('basemaps').innerHTML = ['dark', 'light', 'sat'].map((k) => `<button data-theme-id="${k}" aria-pressed="${state.theme === k}">${esc(t('basemap.' + k))}</button>`).join('');
}

function locateMe() {
  if (!navigator.geolocation) return toast(t('geoDenied'));
  $('btnLocate').classList.add('on');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const c = [p.coords.longitude, p.coords.latitude];
      if (!meMarker) {
        const el = document.createElement('div');
        el.className = 'me-dot';
        meMarker = new maplibregl.Marker({ element: el });
      }
      meMarker.setLngLat(c).addTo(map);
      map.flyTo({ center: c, zoom: Math.max(map.getZoom(), 10.5), offset: viewOffset(), duration: 1200 });
    },
    () => {
      $('btnLocate').classList.remove('on');
      toast(t('geoDenied'));
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
  );
}

// ---- Adresse partageable ------------------------------------------------------------------------

function applyHash() {
  const u = /^#(u|us)=([\w-]+\|[\w.-]+)$/.exec(decodeURIComponent(location.hash));
  if (u) {
    pendingHash = null;
    if (u[1] === 'u') selectUrbanTrip(u[2]);
    else selectUrbanStation(u[2]);
    return;
  }
  const m = /^#(train|gare)=([\w-]+)$/.exec(location.hash);
  pendingHash = null;
  if (!m) return;
  if (m[1] === 'gare') {
    if (rail.stations[m[2]]) selectStation(m[2]);
    return;
  }
  const tr = byNumber.get(m[2]);
  if (tr) selectTrain(tr);
  else if (feedOk === null) pendingHash = m[2];
  else {
    state.sel = { kind: 'train', id: '', num: m[2] };
    openPanel();
  }
}

// ---- Démarrage ----------------------------------------------------------------------------------

function bindUi() {
  $('searchIcon').innerHTML = UI.search;
  $('btnFavs').innerHTML = UI.star;
  $('btnAbout').innerHTML = UI.info;
  $('btnLayers').innerHTML = UI.layers;
  $('btnLocate').innerHTML = UI.locate;
  $('btnZoomIn').innerHTML = UI.plus;
  $('btnZoomOut').innerHTML = UI.minus;
  $('aboutClose').innerHTML = UI.close;

  $('btnZoomIn').onclick = () => map.zoomIn();
  $('btnZoomOut').onclick = () => map.zoomOut();
  $('btnLocate').onclick = locateMe;
  $('btnLayers').onclick = () => {
    $('basemaps').hidden = !$('basemaps').hidden;
  };
  $('basemaps').onclick = (e) => {
    const b = e.target.closest('[data-theme-id]');
    if (!b) return;
    setTheme(b.dataset.themeId);
    $('basemaps').hidden = true;
  };
  $('btnFavs').onclick = () => openSimple('favs');
  $('live').onclick = () => openSimple('stats');
  $('btnAbout').onclick = () => $('about').showModal();
  $('aboutClose').onclick = () => $('about').close();
  $('about').addEventListener('click', (e) => {
    if (e.target === $('about')) $('about').close();
  });
  $('btnLang').onclick = () => {
    const l = getLang() === 'fr' ? 'en' : 'fr';
    setLang(l);
    store.set('lang', l);
    refreshTexts();
  };

  $('urbanMenu').onclick = (e) => {
    const b = e.target.closest('[data-um]');
    if (!b) return;
    const k = b.dataset.um;
    if (k === 'close') return toggleUrbanMenu(false);
    if (k === 'expand') {
      state.urbanOpen[b.dataset.key] = !state.urbanOpen[b.dataset.key];
      return renderUrbanMenu();
    }
    if (k === 'line') {
      const net = urban.nets.get(b.dataset.net);
      const line = net && net.lines.find((l) => l.id === b.dataset.line);
      if (!line) return;
      urban.setOff(b.dataset.net + '|' + line.id, urban.isLineOn(b.dataset.net, line));
    }
    urbanDirty = true;
    renderUrbanMenu();
    tick();
  };
  $('urbanMenu').onchange = (e) => {
    const b = e.target.closest('[data-um="mode"]');
    if (!b) return;
    urban.setOff(b.dataset.key, !b.checked);
    urbanDirty = true;
    renderUrbanMenu();
    tick();
  };
  $('chips').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const g = b.dataset.g;
    if (g === 'urban') return toggleUrbanMenu();
    if (g === 'late') state.lateOnly = !state.lateOnly;
    else {
      state.filters[g] = !state.filters[g];
      store.set('filters', state.filters);
    }
    b.setAttribute('aria-pressed', String(g === 'late' ? state.lateOnly : state.filters[g]));
    tick();
  };

  const q = $('q');
  q.addEventListener('input', renderResults);
  q.addEventListener('focus', renderResults);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!resultItems.length) return;
      e.preventDefault();
      resultActive = (resultActive + (e.key === 'ArrowDown' ? 1 : -1) + resultItems.length) % resultItems.length;
      markActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickResult(Math.max(0, resultActive));
    } else if (e.key === 'Escape') {
      $('results').hidden = true;
      q.blur();
    }
  });
  $('results').addEventListener('mousedown', (e) => e.preventDefault());
  $('results').onclick = (e) => {
    const b = e.target.closest('.result');
    if (b) pickResult(Number(b.dataset.i));
  };
  q.addEventListener('focus', () => urban && urban.loadAll(nowSec()).then(() => q.value && renderResults()));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) $('results').hidden = true;
    // le chemin du clic est figé avant tout redessin : un bouton du menu remplacé entre-temps compte bien comme « dans le menu »
    const inMenu = e.composedPath().some((el) => el.id === 'urbanMenu' || (el.classList && el.classList.contains('urban-chip')));
    if (!inMenu && !$('urbanMenu').hidden && !isMobile()) toggleUrbanMenu(false);
    if (!e.target.closest('.tools')) $('basemaps').hidden = true;
  });

  $('panel').onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') closePanel();
    else if (act === 'grip') {
      state.tall = !state.tall;
      document.body.classList.toggle('sheet-tall', state.tall);
      document.documentElement.style.setProperty('--sheet', sheetPx() + 'px');
    } else if (act === 'about') $('about').showModal(); else if (act === 'fav') toggleFav(b.dataset.key);
    else if (act === 'follow') setFollow(!state.follow);
    else if (act === 'share') share();
    else if (act === 'station') selectStation(b.dataset.uic);
    else if (act === 'ustation') selectUrbanStation(b.dataset.key);
    else if (act === 'utrip') selectUrbanTrip(b.dataset.key);
    else if (act === 'train') {
      const tr = trains.get(b.dataset.id);
      if (tr) selectTrain(tr);
    } else if (act === 'favnum') {
      state.sel = { kind: 'train', id: '', num: b.dataset.num };
      setHash('train=' + b.dataset.num);
      renderPanel(false);
    } else if (act === 'tab') {
      state.tab = b.dataset.tab;
      renderPanel(false);
    }
  };

  window.addEventListener('hashchange', applyHash);
  window.addEventListener('resize', () => {
    if (state.sel) document.documentElement.style.setProperty('--sheet', sheetPx() + 'px');
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastFetch > FEED_EVERY) refreshFeed();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.sel && !$('about').open && document.activeElement !== $('q')) closePanel();
  });
}

function refreshTexts() {
  $('btnLang').textContent = getLang() === 'fr' ? 'EN' : 'FR';
  document.title = `${SITE_NAME} — ${t('tagline')}`;
  applyI18n();
  renderChips();
  renderBasemaps();
  updateLive();
  renderPanel(true);
}

async function main() {
  setLang(store.get('lang', 'fr'));
  document.documentElement.dataset.theme = state.theme === 'light' ? 'light' : 'dark';
  bindUi();
  refreshTexts();
  if (!window.maplibregl) {
    $('liveText').textContent = 'Carte indisponible (MapLibre non chargé).';
    return;
  }
  initMap();
  try {
    [rail, icons] = await Promise.all([loadRail('data/'), loadMapIcons()]);
  } catch (err) {
    console.error(err);
    $('liveText').textContent = 'Données du réseau introuvables.';
    return;
  }
  railGeo = rail.linesGeoJSON();
  const feats = [];
  for (const uic in rail.stations) {
    const s = rail.stations[uic];
    stationIndex.push({ uic, n: s.n, norm: norm(s.n), w: s.w });
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { uic, n: s.n, w: s.w } });
  }
  stationGeo = { type: 'FeatureCollection', features: feats };
  if (map.isStyleLoaded()) installLayers();
  else map.once('load', () => !layersReady && installLayers());
  urban = new Urban(URBAN_DATA_URL, store);
  urban.onChange = (kind) => {
    if (kind === 'loaded') {
      urbanDirty = true;
      feedSncfToUrban();
      renderUrbanMenu();
    } else updateUrbanMenuStatus();
    if (state.sel && (state.sel.kind === 'uveh' || state.sel.kind === 'ustation') && kind !== 'realtime') renderPanel(true);
  };
  urban.init().then(() => {
    const go = () => urban.ensure(urbanView(), map.getZoom(), nowSec());
    map.on('moveend', go);
    go();
    if (/^#us?=/.test(location.hash)) applyHash();
  });
  if (location.hash) {
    const m = /^#gare=/.test(location.hash);
    if (m) applyHash();
    else if (!/^#us?=/.test(location.hash)) pendingHash = location.hash;
  }
  await refreshFeed();
  setInterval(refreshFeed, FEED_EVERY);
  requestAnimationFrame(loop);
}

main();
