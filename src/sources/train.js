'use strict';
// Info trafic via l'API SNCF, basee sur Navitia (moteur open source de calcul d'itineraires).
// Doc : https://doc.navitia.io/ - cle gratuite sur https://numerique.sncf.com/startup/api/
const { http } = require('./http');

const API = 'https://api.sncf.com/v1/coverage/sncf';
const auth = (key) => ({ username: key, password: '' });

// Effets de perturbation (vocabulaire GTFS-RT repris par Navitia)
const EFFECTS = {
  NO_SERVICE: 'TRAIN SUPPRIME',
  REDUCED_SERVICE: 'DESSERTE REDUITE',
  SIGNIFICANT_DELAYS: 'RETARD',
  DETOUR: 'ITINERAIRE MODIFIE',
  MODIFIED_SERVICE: 'SERVICE MODIFIE',
  ADDITIONAL_SERVICE: 'TRAIN SUPPLEMENTAIRE',
  STOP_MOVED: 'ARRET DEPLACE',
  OTHER_EFFECT: 'PERTURBATION',
  UNKNOWN_EFFECT: 'PERTURBATION',
};
const SEVERITY_ORDER = ['NO_SERVICE', 'REDUCED_SERVICE', 'SIGNIFICANT_DELAYS', 'DETOUR', 'MODIFIED_SERVICE'];

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const hhmm = (t) => (t && t.length >= 4 ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : '');
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(2, 4));
const uic = (stopAreaId) => String(stopAreaId).split(':').pop(); // code gare, ex. 87473108

async function searchPlaces(apiKey, q) {
  const { data } = await http.get(`${API}/places`, { auth: auth(apiKey), params: { q, 'type[]': 'stop_area', count: 8 } });
  return (data.places || []).filter((p) => p.embedded_type === 'stop_area').map((p) => ({ id: p.id, name: p.name }));
}

// Une perturbation Navitia -> une ligne lisible pour le ticket
function describe(d, codes) {
  const effect = (d.severity && d.severity.effect) || 'UNKNOWN_EFFECT';
  let train = '';
  let detail = '';
  for (const obj of d.impacted_objects || []) {
    const trip = obj.pt_object && obj.pt_object.trip;
    if (trip && trip.name && !train) train = `n° ${trip.name}`;
    const stop = (obj.impacted_stops || []).find((s) => codes.some((c) => String((s.stop_point && s.stop_point.id) || '').includes(c)));
    if (!stop || detail) continue;
    const base = stop.base_departure_time || stop.base_arrival_time;
    const amended = stop.amended_departure_time || stop.amended_arrival_time;
    const where = stop.stop_point.name || '';
    if (stop.departure_status === 'deleted' || stop.arrival_status === 'deleted') detail = `${where} ${hhmm(base)} : supprimé`;
    else if (base && amended && amended !== base) {
      let delay = minutes(amended) - minutes(base);
      if (delay < -720) delay += 1440; // passage de minuit
      detail = `${where} ${hhmm(base)} : ${delay > 0 ? `+${delay} min (${hhmm(amended)})` : `avancé à ${hhmm(amended)}`}`;
    } else if (base) detail = `${where} ${hhmm(base)}`;
  }
  const msg = (d.messages || []).map((m) => stripHtml(m.text)).find(Boolean) || stripHtml(d.cause) || '';
  return { id: d.id || d.disruption_id || `${effect}|${train}|${detail}`, effect, label: EFFECTS[effect] || 'PERTURBATION', train, detail, message: msg };
}

function parse(responses, fromId, toId) {
  const codes = [uic(fromId), uic(toId)];
  const byId = new Map();
  for (const r of responses) {
    for (const d of r.disruptions || []) {
      if (d.status && d.status === 'past') continue;
      const item = describe(d, codes);
      if (item.effect === 'ADDITIONAL_SERVICE') continue;
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  const rank = (e) => { const i = SEVERITY_ORDER.indexOf(e); return i < 0 ? 99 : i; };
  return [...byId.values()].sort((a, b) => rank(a.effect) - rank(b.effect));
}

// Interroge les trajets du jour dans les deux sens. "base_schedule" renvoie l'horaire theorique
// accompagne des perturbations qui le touchent (trains supprimes compris).
async function fetchTraffic(settings, now) {
  const t = settings.train;
  const datetime = now.toFormat("yyyyLLdd'T'HHmmss");
  const query = (from, to) => http.get(`${API}/journeys`, {
    auth: auth(t.apiKey),
    params: { from, to, datetime, data_freshness: 'base_schedule', min_nb_journeys: 6, max_nb_transfers: 0 },
    validateStatus: (s) => s === 200 || s === 404, // 404 = aucun trajet trouve
  }).then((r) => r.data || {});
  const responses = await Promise.all([query(t.from.id, t.to.id), query(t.to.id, t.from.id)]);
  return { ok: true, from: t.from.name, to: t.to.name, disruptions: parse(responses, t.from.id, t.to.id) };
}

// Un evenement du jour contient-il le mot-cle ? Insensible a la casse et aux accents,
// et en mot entier : "train" ne doit pas reagir a "Entrainement".
const fold = (s) => String(s || '').normalize('NFD').replace(/[^\x00-\x7f]/g, '').toLowerCase();
function hasKeyword(todayEvents, keyword) {
  const k = fold(keyword).trim();
  if (!k) return false;
  const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?([^a-z0-9]|$)`);
  return todayEvents.some((e) => re.test(fold(e.title)));
}

module.exports = { fetchTraffic, searchPlaces, parse, hasKeyword };
