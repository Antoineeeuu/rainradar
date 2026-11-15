// Textes de l'interface, en français et en anglais.

const FR = {
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
    '<ul><li>Les retards sont fournis par paliers de 5 minutes.</li><li>Un train arrêté en pleine voie apparaît en mouvement jusqu’à la mise à jour suivante.</li><li>À l’étranger, les trains suivent une ligne droite entre deux gares.</li><li>Le matériel affiché est le modèle le plus courant pour ce type de train, pas la rame exacte.</li><li>Les RER et le métro ne sont pas affichés.</li></ul>' +
    '<h3>Sources</h3>' +
    '<p>Horaires temps réel et réseau ferré : open data SNCF et SNCF Réseau, via transport.data.gouv.fr (licence ODbL). Quelques tronçons de voie et le fond de carte : © les contributeurs OpenStreetMap, tuiles OpenFreeMap. Vue satellite : © IGN.</p>' +
    '<p class="muted">Site indépendant, sans lien avec la SNCF. À ne pas utiliser pour la sécurité ou pour décider de prendre un train : fiez-vous aux canaux officiels.</p>',
};

const EN = {
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
    '<ul><li>Delays are reported in 5-minute steps.</li><li>A train halted between stations keeps moving on the map until the next update.</li><li>Outside France, trains follow a straight line between stations.</li><li>The rolling stock shown is the most common model for that train type, not the exact unit.</li><li>RER and metro lines are not shown.</li></ul>' +
    '<h3>Sources</h3>' +
    '<p>Real-time timetable and rail network: SNCF and SNCF Réseau open data, via transport.data.gouv.fr (ODbL licence). A few track sections and the base map: © OpenStreetMap contributors, tiles by OpenFreeMap. Satellite view: © IGN.</p>' +
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
