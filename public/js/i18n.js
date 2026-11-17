// Textes de l'interface, en français et en anglais.

const FR = {
  urbanNetworks: 'Réseaux urbains',
  zoomHint: 'Les métros et trams apparaissent en zoomant sur la ville, les RER et Transilien un peu avant.',
  'city.idf': 'Paris et Île-de-France',
  'city.lille': 'Lille',
  'city.bdx': 'Bordeaux',
  'mode.rer': 'RER',
  'mode.transilien': 'Transilien',
  'mode.metro': 'Métro',
  'mode.tram': 'Tram',
  'mode.val': 'Orlyval / CDGVAL',
  'mode.bus': 'Bus express',
  lines: 'Lignes',
  notLoaded: 'chargé en approchant',
  urbanUnavailable: 'indisponible',
  'rt.ok': 'temps réel',
  'rt.nokey': 'théorique (clé PRIM à configurer)',
  'rt.quota': 'théorique (quota PRIM atteint)',
  'rt.error': 'théorique (temps réel indisponible)',
  'rt.gps': 'GPS en direct',
  'rt.theo': 'horaires théoriques',
  'rt.lille': 'tram en temps réel, métro théorique',
  'src.gps': 'Position GPS réelle',
  'src.rt': 'Temps réel',
  'src.theo': 'Horaire théorique',
  'src.nokey': 'Horaire théorique',
  'src.gpsShort': 'GPS en direct',
  'src.rtShort': 'temps réel',
  'src.theoShort': 'Théorique',
  'srcNote.gps': 'Position transmise par le véhicule lui-même (TBM), rafraîchie toutes les 20 secondes environ.',
  'srcNote.rt': 'Position estimée d’après les heures de passage en temps réel publiées par l’exploitant.',
  'srcNote.theo': 'Aucune donnée temps réel publique pour cette ligne : le véhicule suit l’horaire prévu.',
  'srcNote.nokey': 'Le temps réel Île-de-France s’activera dès que la clé PRIM sera configurée dans Netlify.',
  nextStations: 'Stations',
  passages: 'Prochains passages',
  noPassages: 'Aucun passage dans l’heure qui vient.',
  imminent: 'Imminent',
  inMin: '{n} min',
  boardNoteUrban: 'Horaires temps réel quand l’exploitant les publie, sinon horaires prévus.',
  resultUrban: 'Stations métro, tram, RER',
  tagline: 'Les trains de France en temps réel',
  searchPlaceholder: 'Numéro de train ou gare',
  searchLabel: 'Rechercher un train ou une gare',
  noResult: 'Aucun résultat',
  resultTrains: 'Trains',
  resultStations: 'Gares',
  notRunning: 'pas en circulation',
  'g.inoui': 'TGV INOUI',
  'g.ouigo': 'OUIGO',
  'g.ic': 'Intercités',
  'g.ter': 'TER',
  'g.intl': 'International',
  lateOnly: 'En retard',
  filtersLabel: 'Filtrer les trains',
  favorites: 'Favoris',
  language: 'Switch to English',
  about: 'À propos',
  basemap: 'Fond de carte',
  'basemap.dark': 'Sombre',
  'basemap.light': 'Clair',
  'basemap.sat': 'Satellite',
  locate: 'Autour de moi',
  zoomIn: 'Zoomer',
  zoomOut: 'Dézoomer',
  close: 'Fermer',
  resize: 'Agrandir ou réduire le panneau',
  loading: 'Chargement du réseau et des trains…',
  liveTrains: '{n} trains',
  liveOnTime: '{p} % à l’heure',
  updated: 'Données de {time}',
  feedError: 'Flux SNCF indisponible, nouvelle tentative…',
  stale: 'Données anciennes',
  onTime: 'À l’heure',
  delayMin: '+{n} min',
  delayHM: '+{h} h {m}',
  cancelled: 'Supprimé',
  stopCancelled: 'Arrêt supprimé',
  speed: 'Vitesse estimée',
  kmh: 'km/h',
  atStation: 'À quai',
  nextStop: 'Prochain arrêt',
  arrivalAt: 'Arrivée à {time}',
  departureAt: 'Départ à {time}',
  stopped: 'À l’arrêt à',
  delay: 'Retard',
  follow: 'Suivre',
  following: 'Suivi actif',
  share: 'Partager',
  linkCopied: 'Lien copié',
  addFav: 'Ajouter aux favoris',
  removeFav: 'Retirer des favoris',
  model: 'Matériel probable',
  alsoNumbered: 'Circule aussi sous le n° {nums}',
  stops: 'Arrêts',
  trafficInfo: 'Info trafic',
  notDeparted: 'Départ prévu à {time}',
  arrived: 'Train arrivé à destination',
  trainCancelled: 'Ce train est supprimé.',
  noPosition: 'Ce train n’est pas en circulation pour le moment.',
  departures: 'Départs',
  arrivals: 'Arrivées',
  noDepartures: 'Aucun départ dans l’heure qui vient.',
  noArrivals: 'Aucune arrivée dans l’heure qui vient.',
  boardNote: 'Trains en circulation ou partant dans l’heure, d’après le flux temps réel SNCF.',
  to: 'vers',
  from: 'de',
  stationOf: 'Gare',
  stats: 'Trafic en direct',
  running: 'Trains en circulation',
  punctuality: 'Ponctualité',
  punctualityNote: 'trains avec moins de 5 min de retard',
  avgDelay: 'Retard moyen',
  minutes: 'min',
  topDelays: 'Plus gros retards',
  cancelledTrains: 'Trains supprimés',
  noCancelled: 'Aucun train supprimé dans le flux actuel.',
  noDelays: 'Aucun retard en ce moment.',
  favTrains: 'Trains',
  favStations: 'Gares',
  noFavs: 'Aucun favori pour l’instant. Touchez l’étoile dans la fiche d’un train ou d’une gare.',
  geoDenied: 'Position indisponible',
  aboutTitle: 'À propos de RailRadar',
  aboutBody:
    '<p><strong>RailRadar</strong> affiche en direct les TGV INOUI, OUIGO, Intercités, TER et trains internationaux qui circulent en France, avec leurs retards réels.</p>' +
    '<h3>D’où viennent les positions ?</h3>' +
    '<p>La SNCF ne publie pas la position GPS de ses trains. Elle publie en revanche, toutes les deux minutes environ, les horaires réels de chaque train à chacun de ses arrêts, retards compris. RailRadar place chaque train sur les voies entre ses deux arrêts, d’après ces horaires recalés. <strong>Les positions et les vitesses sont donc des estimations</strong> : elles sont justes en gare et approchées entre deux gares.</p>' +
    '<h3>Limites connues</h3>' +
    '<ul><li>Les retards sont fournis par paliers de 5 minutes.</li><li>Un train arrêté en pleine voie apparaît en mouvement jusqu’à la mise à jour suivante.</li><li>À l’étranger, les trains suivent une ligne droite entre deux gares.</li><li>Le matériel affiché est le modèle le plus courant pour ce type de train, pas la rame exacte.</li><li>Métros, trams et RER apparaissent en zoomant sur la ville. À Bordeaux, les trams et le bus express G sont à leur position GPS réelle ; en Île-de-France et pour le tram de Lille, les positions sont recalées sur les heures de passage temps réel ; le métro de Lille suit l’horaire prévu (Ilévia ne publie pas de temps réel pour lui).</li></ul>' +
    '<h3>Sources</h3>' +
    '<p>Horaires temps réel et réseau ferré : open data SNCF et SNCF Réseau, via transport.data.gouv.fr (licence ODbL). Quelques tronçons de voie et le fond de carte : © les contributeurs OpenStreetMap, tuiles OpenFreeMap. Vue satellite : © IGN. Réseaux urbains : Île-de-France Mobilités (PRIM), Ilévia / Métropole Européenne de Lille, TBM / Bordeaux Métropole ; tracés du métro et du tram de Lille © OpenStreetMap.</p>' +
    '<p class="muted">Site indépendant, sans lien avec la SNCF. À ne pas utiliser pour la sécurité ou pour décider de prendre un train : fiez-vous aux canaux officiels.</p>',
};

const EN = {
  urbanNetworks: 'City networks',
  zoomHint: 'Metro and tram vehicles appear when you zoom into the city, RER and Transilien a little earlier.',
  'city.idf': 'Paris region',
  'city.lille': 'Lille',
  'city.bdx': 'Bordeaux',
  'mode.rer': 'RER',
  'mode.transilien': 'Transilien',
  'mode.metro': 'Metro',
  'mode.tram': 'Tram',
  'mode.val': 'Orlyval / CDGVAL',
  'mode.bus': 'Express bus',
  lines: 'Lines',
  notLoaded: 'loads when you get closer',
  urbanUnavailable: 'unavailable',
  'rt.ok': 'real time',
  'rt.nokey': 'scheduled (PRIM key not set)',
  'rt.quota': 'scheduled (PRIM quota reached)',
  'rt.error': 'scheduled (real time unavailable)',
  'rt.gps': 'live GPS',
  'rt.theo': 'scheduled times',
  'rt.lille': 'tram live, metro scheduled',
  'src.gps': 'Live GPS position',
  'src.rt': 'Real time',
  'src.theo': 'Scheduled time',
  'src.nokey': 'Scheduled time',
  'src.gpsShort': 'Live GPS',
  'src.rtShort': 'real time',
  'src.theoShort': 'Scheduled',
  'srcNote.gps': 'Position sent by the vehicle itself (TBM), refreshed about every 20 seconds.',
  'srcNote.rt': 'Position estimated from the real-time arrival times published by the operator.',
  'srcNote.theo': 'No public real-time data for this line: the vehicle follows its timetable.',
  'srcNote.nokey': 'Paris-region real time will switch on once the PRIM key is set in Netlify.',
  nextStations: 'Stops',
  passages: 'Next departures',
  noPassages: 'No departures in the coming hour.',
  imminent: 'Due',
  inMin: '{n} min',
  boardNoteUrban: 'Real-time when the operator publishes it, otherwise scheduled times.',
  resultUrban: 'Metro, tram, RER stops',
  tagline: 'Live trains across France',
  searchPlaceholder: 'Train number or station',
  searchLabel: 'Search for a train or a station',
  noResult: 'No results',
  resultTrains: 'Trains',
  resultStations: 'Stations',
  notRunning: 'not running',
  'g.inoui': 'TGV INOUI',
  'g.ouigo': 'OUIGO',
  'g.ic': 'Intercités',
  'g.ter': 'TER',
  'g.intl': 'International',
  lateOnly: 'Delayed',
  filtersLabel: 'Filter trains',
  favorites: 'Favourites',
  language: 'Passer en français',
  about: 'About',
  basemap: 'Map style',
  'basemap.dark': 'Dark',
  'basemap.light': 'Light',
  'basemap.sat': 'Satellite',
  locate: 'Near me',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  close: 'Close',
  resize: 'Expand or collapse the panel',
  loading: 'Loading the network and trains…',
  liveTrains: '{n} trains',
  liveOnTime: '{p}% on time',
  updated: 'Data from {time}',
  feedError: 'SNCF feed unavailable, retrying…',
  stale: 'Stale data',
  onTime: 'On time',
  delayMin: '+{n} min',
  delayHM: '+{h} h {m}',
  cancelled: 'Cancelled',
  stopCancelled: 'Stop cancelled',
  speed: 'Estimated speed',
  kmh: 'km/h',
  atStation: 'At platform',
  nextStop: 'Next stop',
  arrivalAt: 'Arrives {time}',
  departureAt: 'Departs {time}',
  stopped: 'Stopped at',
  delay: 'Delay',
  follow: 'Follow',
  following: 'Following',
  share: 'Share',
  linkCopied: 'Link copied',
  addFav: 'Add to favourites',
  removeFav: 'Remove from favourites',
  model: 'Likely rolling stock',
  alsoNumbered: 'Also runs as no. {nums}',
  stops: 'Stops',
  trafficInfo: 'Service information',
  notDeparted: 'Scheduled to leave at {time}',
  arrived: 'Train has reached its destination',
  trainCancelled: 'This train is cancelled.',
  noPosition: 'This train is not running at the moment.',
  departures: 'Departures',
  arrivals: 'Arrivals',
  noDepartures: 'No departures in the coming hour.',
  noArrivals: 'No arrivals in the coming hour.',
  boardNote: 'Trains currently running or leaving within the hour, from the SNCF real-time feed.',
  to: 'to',
  from: 'from',
  stationOf: 'Station',
  stats: 'Live traffic',
  running: 'Trains running',
  punctuality: 'Punctuality',
  punctualityNote: 'trains less than 5 min late',
  avgDelay: 'Average delay',
  minutes: 'min',
  topDelays: 'Longest delays',
  cancelledTrains: 'Cancelled trains',
  noCancelled: 'No cancelled trains in the current feed.',
  noDelays: 'No delays right now.',
  favTrains: 'Trains',
  favStations: 'Stations',
  noFavs: 'No favourites yet. Tap the star on a train or station card.',
  geoDenied: 'Location unavailable',
  aboutTitle: 'About RailRadar',
  aboutBody:
    '<p><strong>RailRadar</strong> shows the TGV INOUI, OUIGO, Intercités, TER and international trains running in France, live, with their actual delays.</p>' +
    '<h3>Where do positions come from?</h3>' +
    '<p>SNCF does not publish GPS positions for its trains. It does publish, roughly every two minutes, the real-time timetable of every train at each of its stops, delays included. RailRadar places each train on the tracks between its two stops using those adjusted times. <strong>Positions and speeds are therefore estimates</strong>: exact at stations, approximate in between.</p>' +
    '<h3>Known limits</h3>' +
    '<ul><li>Delays are reported in 5-minute steps.</li><li>A train halted between stations keeps moving on the map until the next update.</li><li>Outside France, trains follow a straight line between stations.</li><li>The rolling stock shown is the most common model for that train type, not the exact unit.</li><li>Metro, tram and RER vehicles appear as you zoom into the city. In Bordeaux, trams and the G express bus are shown at their live GPS position; in the Paris region and for the Lille tram, positions follow real-time arrival times; the Lille metro follows its timetable (Ilévia publishes no real-time data for it).</li></ul>' +
    '<h3>Sources</h3>' +
    '<p>Real-time timetable and rail network: SNCF and SNCF Réseau open data, via transport.data.gouv.fr (ODbL licence). A few track sections and the base map: © OpenStreetMap contributors, tiles by OpenFreeMap. Satellite view: © IGN. City networks: Île-de-France Mobilités (PRIM), Ilévia / Lille Metropole, TBM / Bordeaux Métropole; Lille metro and tram tracks © OpenStreetMap.</p>' +
    '<p class="muted">Independent site, not affiliated with SNCF. Do not rely on it for safety or to decide whether to catch a train: use official channels.</p>',
};

const DICT = { fr: FR, en: EN };
let lang = 'fr';

export function getLang() {
  return lang;
}

export function setLang(l) {
  lang = DICT[l] ? l : 'fr';
  document.documentElement.lang = lang;
}

export function t(key, vars) {
  let s = DICT[lang][key];
  if (s === undefined) s = FR[key] !== undefined ? FR[key] : key;
  if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
  return s;
}

/** Applique les traductions aux éléments marqués data-i18n, data-i18n-title, data-i18n-placeholder. */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const v = t(el.dataset.i18nTitle);
    el.title = v;
    el.setAttribute('aria-label', v);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}
