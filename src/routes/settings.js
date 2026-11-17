'use strict';
const express = require('express');
const { IANAZone } = require('luxon');
const { getSettings, saveSettings } = require('../db');
const { TEMPLATES } = require('../ticket/templates');
const scheduler = require('../scheduler');
const { changePassword } = require('../auth');
const { clearPreviewCache } = require('./dashboard');
const { clearCache: clearBirthdayCache } = require('../sources/birthdays');
const { exportSettings, prepareImport } = require('../backup');

const router = express.Router();

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const bool = (v) => v === 'on' || v === '1' || v === true || v === 'true';
const int = (v, min, max, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const num = (v, def) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : def; };
const arr = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const url = (v) => { const s = str(v, 1000); return /^https?:\/\//i.test(s) ? s : ''; };
// Un champ secret laisse vide conserve la valeur enregistree
const secret = (v, current) => (str(v, 1000) ? str(v, 1000) : current);

// Une fonction par section : (corps du formulaire, reglages actuels) -> morceau de reglages a fusionner
const SECTIONS = {
  printer: (b) => ({ printer: { host: str(b.host, 255), port: int(b.port, 1, 65535, 9100), cols: int(b.cols, 32, 64, 42), cut: bool(b.cut) } }),

  schedule: (b, s) => {
    const days = {};
    for (let d = 1; d <= 7; d++) days[d] = TEMPLATES[b[`day_${d}`]] ? b[`day_${d}`] : '';
    const time = /^([01]?\d|2[0-3]):[0-5]\d$/.test(str(b.time)) ? str(b.time) : s.schedule.time;
    const timezone = IANAZone.isValidZone(str(b.timezone)) ? str(b.timezone) : s.schedule.timezone;
    const holiday = b.holiday === 'skip' || TEMPLATES[b.holiday] ? b.holiday : '';
    return { schedule: { enabled: bool(b.enabled), time, timezone, days, holiday } };
  },

  weather: (b, s) => ({ weather: { enabled: bool(b.enabled), city: str(b.city, 80) || s.weather.city, latitude: num(b.latitude, s.weather.latitude), longitude: num(b.longitude, s.weather.longitude) } }),

  trello: (b, s) => ({
    trello: {
      enabled: bool(b.enabled), key: secret(b.key, s.trello.key), token: secret(b.token, s.trello.token),
      boardId: str(b.boardId, 64), boardName: str(b.boardName, 200), listId: str(b.listId, 64), listName: str(b.listName, 200),
      urgentLabel: str(b.urgentLabel, 50) || 'URGENT', max: int(b.max, 1, 50, 10),
    },
  }),

  calendar: (b, s) => {
    const enabledUrls = new Set(arr(b.cal_enabled));
    const names = arr(b.cal_name);
    const calendars = arr(b.cal_url).map((u, i) => ({ url: str(u, 1000), name: str(names[i], 200), enabled: enabledUrls.has(u) })).filter((c) => c.url);
    const icsNames = arr(b.ics_name);
    const ics = arr(b.ics_url).map((u, i) => ({ url: str(u, 1000).replace(/^webcals?:\/\//i, 'https://'), name: str(icsNames[i], 80) }))
      .filter((c) => /^https?:\/\//i.test(c.url)).map((c, i) => ({ ...c, name: c.name || `ICS ${i + 1}` }));
    return {
      calendar: {
        enabled: bool(b.enabled), max: int(b.max, 1, 30, 8), ics,
        icloud: { serverUrl: url(b.serverUrl) || 'https://caldav.icloud.com', username: str(b.username, 200), password: secret(b.password, s.calendar.icloud.password), calendars },
      },
      birthdays: { enabled: bool(b.birthdays) },
    };
  },

  train: (b, s) => ({
    train: {
      enabled: bool(b.enabled), apiKey: secret(b.apiKey, s.train.apiKey), keyword: str(b.keyword, 40) || 'train',
      from: { id: str(b.from_id, 100), name: str(b.from_name, 100) }, to: { id: str(b.to_id, 100), name: str(b.to_name, 100) },
    },
  }),

  homelab: (b, s) => ({
    homelab: {
      enabled: bool(b.enabled),
      kuma: { url: url(b.kuma_url), apiKey: secret(b.kuma_apiKey, s.homelab.kuma.apiKey) },
      prometheus: {
        url: url(b.prom_url), username: str(b.prom_username, 200), password: secret(b.prom_password, s.homelab.prometheus.password),
        severity: str(b.prom_severity, 100).toLowerCase() || 'critical', insecureTls: bool(b.prom_insecureTls),
      },
    },
  }),

  rss: (b) => {
    const names = arr(b.feed_name);
    const feeds = arr(b.feed_url).map((u, i) => ({ url: url(u), name: str(names[i], 80) })).filter((f) => f.url);
    return { rss: { enabled: bool(b.enabled), max: int(b.max, 1, 15, 5), feeds } };
  },

  tides: (b, s) => ({
    tides: {
      enabled: bool(b.enabled), place: str(b.place, 60) || s.tides.place,
      latitude: num(b.latitude, s.tides.latitude), longitude: num(b.longitude, s.tides.longitude),
      display: b.display === 'text' ? 'text' : 'curve', showCoef: bool(b.showCoef),
    },
  }),

  wallos: (b, s) => ({
    wallos: { enabled: bool(b.enabled), url: url(b.url), apiKey: secret(b.apiKey, s.wallos.apiKey), currency: str(b.currency, 5) || '€' },
  }),

  ecowatt: (b, s) => ({
    ecowatt: { enabled: bool(b.enabled), clientId: str(b.clientId, 200), clientSecret: secret(b.clientSecret, s.ecowatt.clientSecret) },
  }),

  failure: (b) => ({ failure: { retryCount: int(b.retryCount, 0, 20, 3), retryDelayMin: int(b.retryDelayMin, 1, 120, 5), discordWebhook: /^https:\/\//i.test(str(b.discordWebhook, 500)) ? str(b.discordWebhook, 500) : '' } }),
};

router.get('/settings', async (req, res) => {
  const s = await getSettings();
  res.render('settings', {
    title: 'Réglages',
    s,
    templates: TEMPLATES,
    dayNames: ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
    // Indique seulement si un secret est enregistre, jamais sa valeur
    has: {
      trelloKey: !!s.trello.key, trelloToken: !!s.trello.token, icloudPassword: !!s.calendar.icloud.password,
      trainKey: !!s.train.apiKey, wallosKey: !!s.wallos.apiKey, ecowattSecret: !!s.ecowatt.clientSecret, kumaKey: !!s.homelab.kuma.apiKey, promPassword: !!s.homelab.prometheus.password,
    },
  });
});

// Export : fichier JSON telecharge, avec ou sans les secrets
router.get('/settings/export', async (req, res) => {
  const withSecrets = req.query.secrets === '1';
  const body = exportSettings(await getSettings(), withSecrets);
  const day = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="epos-brief-reglages-${day}${withSecrets ? '-avec-secrets' : ''}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/json').send(JSON.stringify(body, null, 2));
});

// Import : le navigateur lit le fichier et l'envoie en JSON
router.post('/settings/import', async (req, res) => {
  try {
    const current = await getSettings();
    const { patch, secretsImported, secretsKept } = prepareImport(req.body, current);
    const saved = await saveSettings(patch);
    process.env.TZ = saved.schedule.timezone;
    scheduler.start(saved);
    clearBirthdayCache();
    clearPreviewCache();
    const parts = [`Réglages importés.`];
    if (secretsImported) parts.push(`${secretsImported} secret(s) importé(s).`);
    if (secretsKept) parts.push(`${secretsKept} secret(s) absent(s) du fichier : valeurs actuelles conservées.`);
    req.flash('success', parts.join(' '));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
});

router.post('/settings/account', async (req, res) => {
  let error = null;
  if (req.body.next !== req.body.confirm) error = 'Les deux nouveaux mots de passe sont différents.';
  else error = await changePassword(req.session.user, req.body.current, req.body.next);
  req.flash(error ? 'danger' : 'success', error || 'Mot de passe modifié.');
  res.redirect('/settings#account');
});

router.post('/settings/:section', async (req, res, next) => {
  const handler = SECTIONS[req.params.section];
  if (!handler) return next();
  const current = await getSettings();
  const saved = await saveSettings(handler(req.body || {}, current));
  if (req.params.section === 'schedule') {
    process.env.TZ = saved.schedule.timezone;
    scheduler.start(saved);
  }
  if (req.params.section === 'calendar') clearBirthdayCache();
  clearPreviewCache();
  req.flash('success', 'Réglages enregistrés.');
  res.redirect(`/settings#${req.params.section}`);
});

module.exports = router;
module.exports.SECTIONS = SECTIONS;
