'use strict';
// Petites routes JSON appelees par les boutons "Tester" et "Charger" des reglages.
// Elles utilisent toujours les reglages enregistres : enregistrer avant de tester.
const express = require('express');
const { getSettings } = require('../db');
const { explain } = require('../sources/http');
const weather = require('../sources/weather');
const trello = require('../sources/trello');
const calendar = require('../sources/calendar');
const birthdays = require('../sources/birthdays');
const train = require('../sources/train');
const homelab = require('../sources/homelab');
const rss = require('../sources/rss');
const tides = require('../sources/tides');
const wallos = require('../sources/wallos');
const ecowatt = require('../sources/ecowatt');
const job = require('../job');

const router = express.Router();
const wrap = (fn) => async (req, res) => {
  try {
    res.json({ ok: true, ...(await fn(req, await getSettings())) });
  } catch (e) {
    res.json({ ok: false, message: e.response || e.code ? explain(e) : e.message });
  }
};
const need = (cond, message) => { if (!cond) throw new Error(message); };

router.get('/weather/search', wrap(async (req) => {
  const q = String(req.query.q || '').trim();
  need(q.length >= 2, 'Tape au moins 2 lettres.');
  return { results: await weather.searchCity(q) };
}));

router.get('/trello/boards', wrap(async (req, s) => {
  need(s.trello.key && s.trello.token, 'Enregistre d\'abord la clé et le token Trello.');
  return { results: await trello.boards(s.trello) };
}));

router.get('/trello/lists', wrap(async (req, s) => {
  need(s.trello.key && s.trello.token, 'Enregistre d\'abord la clé et le token Trello.');
  need(/^[a-zA-Z0-9]+$/.test(String(req.query.board || '')), 'Choisis un tableau.');
  return { results: await trello.lists(s.trello, req.query.board) };
}));

router.post('/icloud/calendars', wrap(async (req, s) => {
  const ic = s.calendar.icloud;
  need(ic.username && ic.password, 'Enregistre d\'abord l\'identifiant Apple et le mot de passe d\'app.');
  const enabled = new Set((ic.calendars || []).filter((c) => c.enabled).map((c) => c.url));
  const found = await calendar.listCalendars(ic);
  return { results: found.map((c) => ({ ...c, enabled: enabled.has(c.url) })) };
}));

router.get('/train/places', wrap(async (req, s) => {
  const q = String(req.query.q || '').trim();
  need(s.train.apiKey, 'Enregistre d\'abord la clé d\'API SNCF.');
  need(q.length >= 2, 'Tape au moins 2 lettres.');
  return { results: await train.searchPlaces(s.train.apiKey, q) };
}));

// Tests de bout en bout d'une source avec les reglages enregistres
const TESTS = {
  printer: async () => {
    const r = await job.testPrint();
    return `Ticket de test envoyé.${r.warnings.length ? ` Attention : ${r.warnings.join(', ')}.` : ''}`;
  },
  weather: async (s) => {
    const w = await weather.fetchWeather(s, job.nowIn(s));
    return `${w.city} : ${w.temp}°C, ${w.label}, min ${w.min}° / max ${w.max}°.`;
  },
  trello: async (s) => {
    need(s.trello.key && s.trello.token, 'Enregistre d\'abord la clé et le token.');
    if (!s.trello.listId) {
      const u = await trello.me(s.trello);
      return `Clé et token valides (compte ${u.username}). Clique sur « Charger » pour choisir le tableau et la liste, puis enregistre.`;
    }
    const r = await trello.fetchCards(s);
    return `${r.cards.length} carte(s) dans la liste, dont ${r.cards.filter((c) => c.urgent).length} avec l'étiquette ${s.trello.urgentLabel}.`;
  },
  calendar: async (s) => {
    const now = job.nowIn(s).startOf('day');
    const r = await calendar.fetchEvents(s, now.toJSDate(), now.plus({ days: 1 }).toJSDate());
    need(r.ok, r.error);
    return `${r.events.length} événement(s) aujourd'hui.${r.errors.length ? ` Erreurs : ${r.errors.join(' ; ')}` : ''}`;
  },
  birthdays: async (s) => {
    need(s.calendar.icloud.username && s.calendar.icloud.password, 'Identifiant Apple et mot de passe d\'app requis.');
    birthdays.clearCache();
    const r = await birthdays.fetchBirthdays(s, job.nowIn(s));
    return `${r.total} contact(s) avec une date de naissance, ${r.people.length} anniversaire(s) aujourd'hui.`;
  },
  train: async (s) => {
    need(s.train.apiKey && s.train.from.id && s.train.to.id, 'Clé d\'API et les deux gares requises.');
    const r = await train.fetchTraffic(s, job.nowIn(s));
    return r.disruptions.length
      ? `${r.disruptions.length} perturbation(s) : ${r.disruptions.slice(0, 3).map((d) => `${d.label} ${d.detail}`.trim()).join(' ; ')}`
      : `${r.from} > ${r.to} : aucune perturbation signalée pour le moment.`;
  },
  homelab: async (s) => {
    const r = await homelab.fetchHomelab(s);
    need(r.ok, r.error);
    const parts = [];
    if (r.kuma) parts.push(r.kuma.error ? `Uptime Kuma : ${r.kuma.error}` : `Uptime Kuma : ${r.kuma.up}/${r.kuma.total} UP`);
    if (r.prometheus) {
      const a = r.prometheus.alerts || [];
      parts.push(r.prometheus.error ? `Prometheus : ${r.prometheus.error}`
        : `Prometheus : ${a.length} alerte(s) ${r.prometheus.severity} active(s)${a.length ? ` (${a.slice(0, 3).map((x) => x.text).join(', ')})` : ''}`);
    }
    need(!((r.kuma && r.kuma.error) || (r.prometheus && r.prometheus.error)), parts.join(' ; '));
    return parts.join(' ; ');
  },
  rss: async (s) => {
    const r = await rss.fetchRss(s);
    need(r.ok, r.error);
    return `${r.items.length} titre(s). Premier : ${r.items[0] ? r.items[0].title : '-'}${r.errors.length ? ` Erreurs : ${r.errors.join(' ; ')}` : ''}`;
  },
  tides: async (s) => {
    const r = await tides.fetchTides(s);
    const hm = (h) => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
    return `${r.place} : ${r.extremes.map((e) => `${e.type} ${hm(e.hour)}`).join(', ') || 'aucun extremum aujourd\'hui'}${r.coef ? `, coef. env. ${r.coef}` : ''}.`;
  },
  wallos: async (s) => {
    need(s.wallos.url && s.wallos.apiKey, 'Adresse et clé d\'API requises.');
    const r = await wallos.fetchPayments(s, job.nowIn(s));
    return `${r.total} abonnement(s) actif(s), ${r.payments.length} prélèvement(s) aujourd'hui${r.payments.length ? ` : ${r.payments.map((p) => p.name).join(', ')}` : ''}.`;
  },
  ecowatt: async (s) => {
    need(s.ecowatt.clientId && s.ecowatt.clientSecret, 'ID client et ID secret requis.');
    ecowatt.clearCache();
    const r = await ecowatt.fetchEcowatt(s, job.nowIn(s), { force: true });
    return r.alerts.length
      ? `Alerte : ${r.alerts.map((a) => `${a.when === 'today' ? 'aujourd\'hui' : 'demain'} ${a.level >= 3 ? 'rouge' : 'orange'} (${a.hours})`).join(' ; ')}.`
      : `Connexion OK, ${r.days} jour(s) de prévision, aucune tension aujourd'hui ni demain.`;
  },
  discord: async (s) => {
    need(s.failure.discordWebhook, 'Enregistre d\'abord l\'URL du webhook.');
    await job.notifyDiscord(s, 'ePOS-Brief : message de test. Les alertes d\'échec d\'impression arriveront ici.');
    return 'Message envoyé sur Discord.';
  },
};

router.post('/test/:source', wrap(async (req, s) => {
  const test = TESTS[req.params.source];
  need(test, 'Test inconnu.');
  return { message: await test(s) };
}));

module.exports = router;
