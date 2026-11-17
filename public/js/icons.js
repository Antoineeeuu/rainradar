// Dessins : icônes des trains sur la carte (vue de dessus), illustration du matériel
// dans la fiche (vue de profil) et pictogrammes de l'interface. Tout est en SVG dessiné
// pour RailRadar : aucune image externe, aucun logo de marque.

export const TYPE_STYLE = {
  inoui: { color: '#E2185B', nose: '#E2185B', ink: '#ffffff', short: 'TGV' },
  ouigo: { color: '#18B5F0', nose: '#FF4FA3', ink: '#06202c', short: 'OUIGO' },
  ic: { color: '#9B6BFF', nose: '#9B6BFF', ink: '#ffffff', short: 'IC' },
  night: { color: '#4B4FD8', nose: '#4B4FD8', ink: '#ffffff', short: 'NUIT' },
  ter: { color: '#FFC83D', nose: '#FFC83D', ink: '#2a1e00', short: 'TER' },
  intl: { color: '#F4F6FA', nose: '#E11D2E', ink: '#1a2233', short: 'INT' },
};

export const GROUP_STYLE = {
  inoui: TYPE_STYLE.inoui,
  ouigo: TYPE_STYLE.ouigo,
  ic: TYPE_STYLE.ic,
  ter: TYPE_STYLE.ter,
  intl: TYPE_STYLE.intl,
};

const OUT = 'rgba(8,12,20,.9)';

// Vue de dessus, nez vers le haut. Zone de dessin 36 x 84.
function topView(type) {
  const s = TYPE_STYLE[type];
  let body;
  let extra = '';
  if (type === 'ter') {
    body = 'M18 9c5.5 0 10 4.5 10 10v48c0 5.5-4.5 10-10 10S8 72.5 8 67V19c0-5.5 4.5-10 10-10z';
    extra =
      `<rect x="12.5" y="13.5" width="11" height="6.5" rx="3" fill="#0b1220" opacity=".8"/>` +
      `<path d="M8.8 43h18.4" stroke="${OUT}" stroke-width="1.6" opacity=".55"/>` +
      `<rect x="12.5" y="66" width="11" height="6" rx="3" fill="#0b1220" opacity=".45"/>`;
  } else if (type === 'ic' || type === 'night') {
    body = 'M12.5 6h11L28 15v59c0 2.2-1.8 4-4 4H12c-2.2 0-4-1.8-4-4V15z';
    extra =
      `<path d="M13 10.5h10l2 5H11z" fill="#0b1220" opacity=".8"/>` +
      `<path d="M8.8 30h18.4" stroke="${OUT}" stroke-width="2.2" opacity=".7"/>` +
      `<path d="M8.8 54h18.4" stroke="${OUT}" stroke-width="1.4" opacity=".45"/>`;
    if (type === 'night') extra += `<circle cx="18" cy="42" r="4.2" fill="#FFD84D"/><circle cx="20" cy="40.6" r="3.4" fill="${s.color}"/>`;
  } else {
    body = 'M18 3c5 5.5 10 15 10 28v38c0 6-4.5 11-10 11S8 75 8 69V31C8 18 13 8.5 18 3z';
    const nose = 'M18 3c5 5.5 10 15 10 28H8C8 18 13 8.5 18 3z';
    extra =
      (s.nose !== s.color ? `<path d="${nose}" fill="${s.nose}"/>` : '') +
      `<path d="M14.3 17.5c2.2-3 5.2-3 7.4 0l-.7 5.5h-6z" fill="#0b1220" opacity=".8"/>` +
      `<path d="M8.8 44h18.4M8.8 59h18.4" stroke="${OUT}" stroke-width="1.4" opacity=".45"/>`;
    if (type === 'intl') extra += `<path d="M18 31v46" stroke="${s.nose}" stroke-width="2.6" opacity=".9"/>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="54" height="126" viewBox="0 0 36 84">` +
    `<path d="${body}" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="round" opacity=".95"/>` +
    `<path d="${body}" fill="${s.color}"/>${extra}` +
    `<path d="${body}" fill="none" stroke="${OUT}" stroke-width="1.7" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

function loadImage(svg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/** Prépare les images des icônes de la carte : { 'tr-inoui': Image, ... }. */
export async function loadMapIcons() {
  const out = {};
  await Promise.all(
    Object.keys(TYPE_STYLE).map(async (type) => {
      out['tr-' + type] = await loadImage(topView(type));
    }),
  );
  return out;
}

export const ICON_PIXEL_RATIO = 3;

// --- Illustration du matériel (vue de profil) -------------------------------------------

const ART = {
  inoui: { shape: 'tgv', decks: 2, body: '#F3F4F7', band: '#E2185B', roof: '#C9CED8', model: 'TGV Duplex / TGV M' },
  ouigo: { shape: 'tgv', decks: 2, body: '#22B8F0', band: '#FF4FA3', roof: '#1596C8', model: 'TGV Duplex OUIGO' },
  intl: { shape: 'tgv', decks: 1, body: '#F6F7FA', band: '#E11D2E', roof: '#C9CED8', model: 'ICE 3 / TGV Euroduplex' },
  ic: { shape: 'loco', decks: 1, body: '#D8DBE3', band: '#9B6BFF', roof: '#8C93A3', model: 'Coradia Liner / voitures Corail' },
  night: { shape: 'loco', decks: 1, body: '#2B2F7A', band: '#FFD84D', roof: '#1C1F55', model: 'Voitures-couchettes Corail' },
  ter: { shape: 'emu', decks: 1, body: '#E9ECF2', band: '#2F6FE4', roof: '#9AA3B5', model: 'Régiolis / Regio 2N / AGC' },
};

export function modelName(type) {
  return (ART[type] || ART.ter).model;
}

/** Illustration de profil du matériel roulant probable pour un type de train. */
export function sideArt(type) {
  const a = ART[type] || ART.ter;
  const top = a.decks === 2 ? 12 : 20;
  const floor = 60;
  const win = '#1b2536';
  let lead;
  let windshield;
  if (a.shape === 'tgv') {
    lead = `M6 ${floor}C10 ${floor - 14} 30 ${top + 12} 62 ${top + 3}C72 ${top} 80 ${top} 92 ${top}H166V${floor}Z`;
    windshield = `M38 ${top + 17}C46 ${top + 11} 56 ${top + 8} 66 ${top + 7}L64 ${top + 18}C54 ${top + 19} 46 ${top + 20} 38 ${top + 17}Z`;
  } else if (a.shape === 'loco') {
    lead = `M10 ${floor}V${top + 16}L22 ${top}H166V${floor}Z`;
    windshield = `M15 ${top + 16}L24 ${top + 4}H40V${top + 16}Z`;
  } else {
    lead = `M8 ${floor}V${top + 20}C8 ${top + 6} 22 ${top} 40 ${top}H166V${floor}Z`;
    windshield = `M13 ${top + 21}C14 ${top + 10} 24 ${top + 5} 38 ${top + 5}V${top + 21}Z`;
  }
  const windows = (x0, x1, y, h, step, w) => {
    let s = '';
    for (let x = x0; x + w <= x1; x += step) s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.5" fill="${win}"/>`;
    return s;
  };
  let glass = '';
  const leadStart = a.shape === 'tgv' ? 96 : a.shape === 'loco' ? 60 : 50;
  if (a.shape === 'loco') {
    glass += `<rect x="52" y="${top + 8}" width="100" height="5" rx="2" fill="${win}" opacity=".5"/>`;
  } else if (a.decks === 2) {
    glass += windows(leadStart + 6, 160, top + 8, 9, 16, 11) + windows(leadStart + 6, 160, top + 30, 9, 16, 11);
  } else {
    glass += windows(leadStart, 160, top + 9, 13, 19, 14);
  }
  if (a.decks === 2) glass += windows(180, 336, top + 8, 9, 16, 11) + windows(180, 336, top + 30, 9, 16, 11);
  else glass += windows(180, 336, top + 9, 13, 19, 14);
  const bandY = a.decks === 2 ? top + 22 : top + 27;
  const doors =
    a.shape === 'emu'
      ? `<rect x="118" y="${top + 6}" width="13" height="${floor - top - 8}" rx="2" fill="#FFD84D" opacity=".9"/><rect x="250" y="${top + 6}" width="13" height="${floor - top - 8}" rx="2" fill="#FFD84D" opacity=".9"/>`
      : '';
  const bogies = [30, 140, 196, 310].map((x) => `<circle cx="${x}" cy="${floor + 5}" r="5" fill="#3b475e"/><circle cx="${x + 13}" cy="${floor + 5}" r="5" fill="#3b475e"/>`).join('');
  const moon = type === 'night' ? `<circle cx="300" cy="${top - 4}" r="6" fill="#FFD84D"/><circle cx="303" cy="${top - 6}" r="5" fill="var(--panel, #111a2b)"/>` : '';
  return (
    `<svg class="art" viewBox="0 0 344 78" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">` +
    `<defs><linearGradient id="fade-${type}" x1="0" x2="1"><stop offset=".78" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<mask id="mask-${type}"><rect width="344" height="78" fill="url(#fade-${type})"/></mask></defs>` +
    `<g mask="url(#mask-${type})">${moon}` +
    `<path d="M0 ${floor + 11}H344" stroke="currentColor" stroke-width="1.5" opacity=".35"/>${bogies}` +
    `<path d="${lead}" fill="${a.body}"/><rect x="170" y="${top}" width="174" height="${floor - top}" fill="${a.body}"/>` +
    `<path d="M92 ${top}H166V${top + 3}H92Z" fill="${a.roof}" opacity=".8"/><rect x="170" y="${top}" width="174" height="3" fill="${a.roof}" opacity=".8"/>` +
    `<rect x="${a.shape === 'tgv' ? 30 : 10}" y="${bandY}" width="${a.shape === 'tgv' ? 136 : 156}" height="5" fill="${a.band}"/><rect x="170" y="${bandY}" width="174" height="5" fill="${a.band}"/>` +
    `${doors}<path d="${windshield}" fill="${win}"/>${glass}` +
    `<rect x="166" y="${top + 4}" width="4" height="${floor - top - 4}" fill="#111827"/>` +
    `</g></svg>`
  );
}

// --- Pictogrammes de l'interface --------------------------------------------------------

const P = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const UI = {
  search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  close: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  star: P('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  starFill: P('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/>'),
  share: P('<path d="M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'),
  follow: P('<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
  layers: P('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  locate: P('<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  minus: P('<path d="M5 12h14"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.1"/>'),
  chart: P('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  station: P('<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l-2-4M15 21l2-4"/><circle cx="9" cy="14" r=".6" fill="currentColor"/><circle cx="15" cy="14" r=".6" fill="currentColor"/>'),
  arrow: P('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  warn: P('<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17v.1"/>'),
  chevron: P('<path d="m9 6 6 6-6 6"/>'),
};

// --- Réseaux urbains --------------------------------------------------------------------

/** Petite flèche blanche (image SDF, recolorée par la carte) indiquant le sens de marche. */
export function arrowImage() {
  const s = 24;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(s / 2, 2);
  g.lineTo(s - 4, s - 4);
  g.lineTo(s / 2, s - 9);
  g.lineTo(4, s - 4);
  g.closePath();
  g.fill();
  return g.getImageData(0, 0, s, s);
}

// Matériel le plus courant par ligne (indicatif : la rame exacte n'est pas publiée).
const URBAN_MODELS = {
  idf: {
    1: 'MP05', 2: 'MF01', 3: 'MF67', '3B': 'MF67 / MF19', 4: 'MP14', 5: 'MF01', 6: 'MP73 / MP89', 7: 'MF77',
    '7B': 'MF88 / MF19', 8: 'MF77', 9: 'MF01', 10: 'MF67 / MF19', 11: 'MP14', 12: 'MF67', 13: 'MF77 / MF19', 14: 'MP14',
    A: 'MI09 / MI2N', B: 'MI79 / MI84', C: 'Z 2N', D: 'Z 2N / Regio 2N', E: 'MI2N / RER NG',
    H: 'Francilien', J: 'Francilien / Z 2N', K: 'Regio 2N', L: 'Francilien', N: 'Regio 2N', P: 'Francilien / Regio 2N',
    R: 'Regio 2N', U: 'Z 2N', V: 'Regio 2N',
    T1: 'Citadis', T2: 'Citadis 302', T3a: 'Citadis 402', T3b: 'Citadis 402', T4: 'Citadis Dualis', T5: 'Translohr STE3',
    T6: 'Translohr STE6', T7: 'Citadis 302', T8: 'Citadis 302', T9: 'Citadis X05', T10: 'Citadis X05', T11: 'Citadis Dualis',
    T12: 'Citadis Dualis', T13: 'Citadis Dualis', T14: 'Citadis', OV: 'VAL 206', CDG: 'VAL 208',
  },
  lille: { M1: 'VAL 206 / VAL 208', M2: 'VAL 208', T: 'Breda VLC / Citadis' },
  bdx: { A: 'Citadis 302 / 402', B: 'Citadis 302 / 402', C: 'Citadis 302 / 402', D: 'Citadis 402', E: 'Citadis 402', F: 'Citadis 402', G: 'Bus articulé électrique' },
};

export function urbanModel(net, line) {
  const m = URBAN_MODELS[net] && URBAN_MODELS[net][line.label];
  if (m) return m;
  return { metro: 'Métro', tram: 'Tramway', rer: 'Train RER', transilien: 'Train Transilien', val: 'VAL', bus: 'Bus' }[line.mode] || '';
}

/** Illustration de profil d'un véhicule urbain, aux couleurs de la ligne. */
export function urbanArt(mode, color) {
  const win = '#1b2536';
  const body = mode === 'rer' || mode === 'transilien' ? '#EEF1F6' : '#F3F4F7';
  const floor = 60;
  let top = 22;
  let nose;
  let wins = '';
  let extra = '';
  const w = (x0, x1, y, h, step, ww) => {
    let s = '';
    for (let x = x0; x + ww <= x1; x += step) s += `<rect x="${x}" y="${y}" width="${ww}" height="${h}" rx="2.5" fill="${win}"/>`;
    return s;
  };
  if (mode === 'rer' || mode === 'transilien') {
    top = 12;
    nose = `M8 ${floor}V${top + 14}C8 ${top + 4} 18 ${top} 32 ${top}H344V${floor}Z`;
    wins = w(46, 336, top + 8, 9, 16, 11) + w(46, 336, top + 30, 9, 16, 11);
    extra = `<path d="M12 ${top + 18}C13 ${top + 9} 20 ${top + 5} 30 ${top + 5}V${top + 18}Z" fill="${win}"/>`;
  } else if (mode === 'bus') {
    top = 18;
    nose = `M10 ${floor - 4}V${top + 8}Q10 ${top} 20 ${top}H330Q338 ${top} 338 ${top + 8}V${floor - 4}Z`;
    wins = w(40, 330, top + 6, 18, 24, 20);
    extra = `<rect x="14" y="${top + 6}" width="20" height="24" rx="3" fill="${win}"/><rect x="168" y="${top + 4}" width="6" height="${floor - top - 8}" fill="#111827" opacity=".6"/>`;
  } else {
    // métro, tram, VAL
    top = mode === 'tram' ? 20 : 24;
    const r = mode === 'tram' ? 16 : 8;
    nose = `M8 ${floor}V${top + r}Q8 ${top} ${8 + r * 1.6} ${top}H344V${floor}Z`;
    wins = w(48, 336, top + 7, 16, 22, 17);
    extra = `<path d="M13 ${top + 22}V${top + r}Q13 ${top + 5} ${13 + r} ${top + 5}H34V${top + 22}Z" fill="${win}"/>`;
    if (mode === 'tram') extra += `<path d="M150 ${top}L160 ${top - 12}M170 ${top - 12}H140" stroke="#8C93A3" stroke-width="2"/>`;
  }
  const band = `<rect x="8" y="${floor - 12}" width="336" height="5" fill="${color}"/>`;
  const wheels = mode === 'bus'
    ? [60, 250, 300].map((x) => `<circle cx="${x}" cy="${floor}" r="9" fill="#111827"/><circle cx="${x}" cy="${floor}" r="4" fill="#3b475e"/>`).join('')
    : [40, 120, 230, 310].map((x) => `<circle cx="${x}" cy="${floor + 4}" r="4.5" fill="#3b475e"/><circle cx="${x + 12}" cy="${floor + 4}" r="4.5" fill="#3b475e"/>`).join('');
  return (
    `<svg class="art" viewBox="0 0 344 78" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">` +
    `<defs><linearGradient id="uf" x1="0" x2="1"><stop offset=".78" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<mask id="um"><rect width="344" height="78" fill="url(#uf)"/></mask></defs><g mask="url(#um)">` +
    (mode === 'bus' ? '' : `<path d="M0 ${floor + 10}H344" stroke="currentColor" stroke-width="1.5" opacity=".35"/>`) +
    `<path d="${nose}" fill="${body}"/>${band}${extra}${wins}${wheels}</g></svg>`
  );
}
