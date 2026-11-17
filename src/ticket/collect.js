'use strict';
// Interroge en parallele les sources necessaires au modele choisi.
// Chaque source renvoie : null (desactivee -> bloc absent), { ok: true, ... } ou { ok: false, error }.
const { sourcesFor } = require('./templates');
const { eventsOn } = require('./build');
const { explain } = require('../sources/http');
const { fetchWeather } = require('../sources/weather');
const { fetchCards } = require('../sources/trello');
const { fetchEvents } = require('../sources/calendar');
const { fetchBirthdays } = require('../sources/birthdays');
const { fetchTraffic, hasKeyword } = require('../sources/train');
const { fetchHomelab } = require('../sources/homelab');
const { fetchRss } = require('../sources/rss');
const { fetchTides } = require('../sources/tides');
const { fetchPayments } = require('../sources/wallos');
const { fetchEcowatt } = require('../sources/ecowatt');

const TIMEOUT_MS = 25000;
const safe = (promise) => Promise.race([
  promise,
  new Promise((_, reject) => { setTimeout(() => reject(new Error('délai dépassé')), TIMEOUT_MS).unref(); }),
]).catch((e) => ({ ok: false, error: explain(e) }));

async function collect(settings, now, blocks) {
  const s = settings;
  const need = sourcesFor(blocks);
  const data = {};
  const jobs = [];
  const add = (name, enabled, configured, fn) => {
    data[name] = null;
    if (!need.has(name) || !enabled) return;
    if (!configured) { data[name] = { ok: false, error: 'non configuré' }; return; }
    jobs.push(safe(fn()).then((r) => { data[name] = r; }));
  };

  add('weather', s.weather.enabled, Number.isFinite(Number(s.weather.latitude)) && Number.isFinite(Number(s.weather.longitude)), () => fetchWeather(s, now));
  add('trello', s.trello.enabled, s.trello.key && s.trello.token && s.trello.listId, () => fetchCards(s));
  add('homelab', s.homelab.enabled, s.homelab.kuma.url || s.homelab.prometheus.url, () => fetchHomelab(s));
  add('rss', s.rss.enabled, (s.rss.feeds || []).some((f) => f.url), () => fetchRss(s));
  add('tides', s.tides.enabled, Number.isFinite(Number(s.tides.latitude)) && Number.isFinite(Number(s.tides.longitude)), () => fetchTides(s));
  add('ecowatt', s.ecowatt.enabled, s.ecowatt.clientId && s.ecowatt.clientSecret, () => fetchEcowatt(s, now));
  add('wallos', s.wallos.enabled, s.wallos.url && s.wallos.apiKey, () => fetchPayments(s, now));
  add('birthdays', s.birthdays.enabled, s.calendar.icloud.username && s.calendar.icloud.password, () => fetchBirthdays(s, now));

  const from = now.startOf('day');
  const to = from.plus({ days: blocks.includes('agendaWeek') ? 7 : 1 });
  add('calendar', s.calendar.enabled, true, () => fetchEvents(s, from.toJSDate(), to.toJSDate()));

  await Promise.all(jobs);

  // Encart train : seulement si un evenement du jour contient le mot-cle
  data.train = null;
  if (need.has('train') && s.train.enabled && data.calendar && data.calendar.ok
    && hasKeyword(eventsOn(data.calendar.events, now, s.schedule.timezone), s.train.keyword)) {
    const names = { from: s.train.from.name || '?', to: s.train.to.name || '?' };
    const configured = s.train.apiKey && s.train.from.id && s.train.to.id;
    data.train = configured
      ? await safe(fetchTraffic(s, now)).then((r) => (r.ok ? r : { ...r, ...names }))
      : { ok: false, error: 'non configuré', ...names };
  }
  return data;
}

// Resume de l'etat des sources pour l'interface : { nom: { ok, error } }
function summarize(data) {
  const out = {};
  for (const [name, d] of Object.entries(data)) {
    if (!d) continue;
    const partial = (d.errors && d.errors.length ? d.errors : [])
      .concat(d.kuma && d.kuma.error ? [`Uptime Kuma : ${d.kuma.error}`] : [])
      .concat(d.prometheus && d.prometheus.error ? [`Prometheus : ${d.prometheus.error}`] : []);
    out[name] = { ok: !!d.ok && !partial.length, error: d.ok ? partial.join(' ; ') : d.error };
  }
  return out;
}

module.exports = { collect, summarize };
