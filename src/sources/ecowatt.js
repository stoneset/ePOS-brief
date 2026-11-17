'use strict';
// Signal Ecowatt de RTE (tension sur le reseau electrique) : https://data.rte-france.com
// Authentification OAuth2 "client credentials" : ID client et ID secret de l'application creee sur le portail RTE.
const { http } = require('./http');

const BASE = 'https://digital.iservices.rte-france.com';
// RTE limite les appels : on garde la reponse en memoire une heure
const TTL = 60 * 60 * 1000;
let cache = { key: '', at: 0, signals: null };
let token = { key: '', value: '', until: 0 };

async function getToken(cfg) {
  const key = `${cfg.clientId}:${cfg.clientSecret}`;
  if (token.key === key && Date.now() < token.until) return token.value;
  const { data } = await http.post(`${BASE}/token/oauth/`, '', {
    headers: { Authorization: `Basic ${Buffer.from(key).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
  });
  token = { key, value: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000 };
  return token.value;
}

async function fetchSignals(cfg, { force = false } = {}) {
  const key = `${cfg.clientId}`;
  if (!force && cache.key === key && cache.signals && Date.now() - cache.at < TTL) return cache.signals;
  const { data } = await http.get(`${BASE}/open_api/ecowatt/v5/signals`, { headers: { Authorization: `Bearer ${await getToken(cfg)}` } });
  if (!data || !Array.isArray(data.signals)) throw new Error('réponse inattendue de RTE');
  cache = { key, at: Date.now(), signals: data.signals };
  return data.signals;
}

// Jours en tension (orange = 2, rouge = 3) parmi aujourd'hui et demain, avec les heures concernees
function alerts(signals, now) {
  const days = [now.toISODate(), now.plus({ days: 1 }).toISODate()];
  const out = [];
  for (const s of signals) {
    const day = String(s.jour || '').slice(0, 10);
    const idx = days.indexOf(day);
    if (idx < 0 || Number(s.dvalue) < 2) continue;
    const hours = (s.values || []).filter((v) => Number(v.hvalue) >= 2).map((v) => Number(v.pas)).sort((a, b) => a - b);
    out.push({ when: idx === 0 ? 'today' : 'tomorrow', level: Number(s.dvalue), hours: ranges(hours), message: s.message || '' });
  }
  return out.sort((a, b) => (a.when === 'today' ? -1 : 1));
}

// [8, 9, 10, 18, 19] -> "8h-11h, 18h-20h"
function ranges(hours) {
  const parts = [];
  for (let i = 0; i < hours.length; i++) {
    let j = i;
    while (j + 1 < hours.length && hours[j + 1] === hours[j] + 1) j++;
    parts.push(`${hours[i]}h-${hours[j] + 1}h`);
    i = j;
  }
  return parts.join(', ');
}

async function fetchEcowatt(settings, now, opts) {
  const signals = await fetchSignals(settings.ecowatt, opts);
  return { ok: true, alerts: alerts(signals, now), days: signals.length };
}

const clearCache = () => { cache = { key: '', at: 0, signals: null }; token = { key: '', value: '', until: 0 }; };

module.exports = { fetchEcowatt, alerts, ranges, clearCache };
