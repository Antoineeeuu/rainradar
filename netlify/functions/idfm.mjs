// Relais temps réel Île-de-France Mobilités (API PRIM).
// La clé PRIM est lue dans les réglages Netlify (variable PRIM_API_KEY) et n'est jamais
// envoyée au navigateur. La réponse est gardée en cache par Netlify : PRIM n'est interrogé
// qu'une fois toutes les 3 minutes au plus, quel que soit le nombre de visiteurs.
// La réponse de PRIM (54 Mo, 4,7 Mo compressée) est réduite ici à quelques centaines de Ko.
import { compactEstimatedTimetable } from '../../public/js/idfm-transform.js';

const PRIM_URL = 'https://prim.iledefrance-mobilites.fr/marketplace/estimated-timetable';
// 3 minutes : au plus 480 appels PRIM par jour (quota : 1 000) et peu de crédits Netlify.
const CACHE_SECONDS = 180;

// Lignes affichées par RailRadar : métro, RER, Transilien, tram, Orlyval, CDGVAL.
const LINES = new Set([
  'C01371', 'C01372', 'C01373', 'C01374', 'C01375', 'C01376', 'C01377', 'C01378', 'C01379', 'C01380',
  'C01381', 'C01382', 'C01383', 'C01384', 'C01386', 'C01387', // métro
  'C01742', 'C01743', 'C01727', 'C01728', 'C01729', // RER
  'C01737', 'C01739', 'C01738', 'C01740', 'C01736', 'C01730', 'C01731', 'C01741', 'C02711', // Transilien
  'C01389', 'C01390', 'C01391', 'C01679', 'C01843', 'C01684', 'C01794', 'C01774', 'C01795', 'C02317',
  'C02528', 'C01999', 'C02529', 'C02344', 'C02732', // tram
  'C01388', 'C00563', // Orlyval, CDGVAL
]);

const json = (body, status, maxAge) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': `public, max-age=${Math.min(maxAge, 30)}`,
      'netlify-cdn-cache-control': `public, durable, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}`,
    },
  });

export default async () => {
  const key = (globalThis.Netlify && Netlify.env.get('PRIM_API_KEY')) || process.env.PRIM_API_KEY;
  if (!key) return json({ error: 'no-key' }, 200, 300);
  let r;
  try {
    r = await fetch(PRIM_URL, { headers: { apikey: key, accept: 'application/json', 'accept-encoding': 'gzip' } });
  } catch (e) {
    return json({ error: 'network' }, 502, 30);
  }
  if (r.status === 429) return json({ error: 'quota' }, 200, 300);
  if (!r.ok) return json({ error: 'prim-' + r.status }, 502, 60);
  const data = compactEstimatedTimetable(await r.json(), LINES);
  return json(data, 200, CACHE_SECONDS);
};

export const config = { path: '/api/idfm' };
