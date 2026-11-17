// Réduit la réponse « estimated-timetable » (SIRI Lite) d'Île-de-France Mobilités
// aux seules informations utiles à RailRadar. Utilisé par la fonction Netlify
// (netlify/functions/idfm.mjs) et, en développement local, directement par le navigateur.

const MAX_CALLS = 6; // prochains arrêts gardés par course

const val = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const first = (x) => val(arr(x)[0]);

function epoch(s) {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : Math.round(t / 1000);
}

/**
 * keepLines : ensemble des codes de ligne gardés (ex. "C01371"), ou null pour tout garder.
 * Renvoie { v, ts, journeys: [[ligne, destination]], calls: [[course, quai, prévu, estimé]] }.
 */
export function compactEstimatedTimetable(json, keepLines, nowSec) {
  const now = nowSec || Math.round(Date.now() / 1000);
  const sd = (json && json.Siri && json.Siri.ServiceDelivery) || {};
  const journeys = [];
  const calls = [];
  for (const del of arr(sd.EstimatedTimetableDelivery)) {
    for (const frame of arr(del.EstimatedJourneyVersionFrame)) {
      for (const j of arr(frame.EstimatedVehicleJourney)) {
        const lref = String(val(j.LineRef) || '');
        const m = /::?(C\d+)/.exec(lref);
        const line = m ? m[1] : lref;
        if (keepLines && !keepLines.has(line)) continue;
        const ec = j.EstimatedCalls ? arr(j.EstimatedCalls.EstimatedCall) : [];
        let kept = 0;
        const ji = journeys.length;
        for (const c of ec) {
          // quai (« Q:22101 », RATP) ou zone d'arrêt (« SP:43104 », trains SNCF) : les deux codes existent dans les horaires
          const q = /(?:Q|SP):(\d+)/.exec(String(val(c.StopPointRef) || ''));
          if (!q) continue;
          const exp = epoch(c.ExpectedDepartureTime || c.ExpectedArrivalTime);
          if (!exp || exp < now - 120) continue;
          const aim = epoch(c.AimedDepartureTime || c.AimedArrivalTime);
          const status = String(c.DepartureStatus || c.ArrivalStatus || '');
          calls.push([ji, q[1], aim, status === 'cancelled' ? -1 : exp]);
          if (++kept >= MAX_CALLS) break;
        }
        if (kept) journeys.push([line, String(first(j.DestinationName) || first(j.DirectionName) || '')]);
      }
    }
  }
  return { v: 1, ts: epoch(sd.ResponseTimestamp) || now, journeys, calls };
}
