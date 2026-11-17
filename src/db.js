'use strict';
// Base NoSQL embarquee (NeDB) : trois collections stockees dans data/*.db
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Datastore = require('@seald-io/nedb');

const DATA_DIR = process.env.EPOS_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

const store = (name) => new Datastore({ filename: path.join(DATA_DIR, `${name}.db`), autoload: true });

const users = store('users');
const settingsDb = store('settings');
const prints = store('prints');

const LOGO = [
  '      ___  ___  ___',
  ' ___ | _ \\/ _ \\/ __|',
  '/ -_)|  _/ (_) \\__ \\',
  '\\___||_|  \\___/|___/',
  '  -----  B R I E F  -----',
].join('\n');

const DEFAULTS = {
  printer: { host: '', port: 9100, cols: 42, cut: true, timeoutMs: 5000 },
  schedule: {
    enabled: true,
    time: '06:30',
    timezone: 'Europe/Paris',
    // 1 = lundi ... 7 = dimanche ; '' = pas d'impression ce jour-la
    days: { 1: 'lundi', 2: 'classique', 3: 'classique', 4: 'classique', 5: 'classique', 6: 'weekend', 7: 'weekend' },
    // Jours feries : '' = modele habituel du jour, un identifiant de modele, ou 'skip' = pas d'impression
    holiday: 'weekend',
  },
  logo: { text: LOGO, doubleWidth: false },
  weather: { enabled: true, city: 'Lannion', latitude: 48.7326, longitude: -3.4566 },
  trello: { enabled: false, key: '', token: '', boardId: '', boardName: '', listId: '', listName: '', urgentLabel: 'URGENT', max: 10 },
  calendar: {
    enabled: false,
    max: 8,
    icloud: { serverUrl: 'https://caldav.icloud.com', username: '', password: '', calendars: [] }, // calendars: [{url, name, enabled}]
    ics: [], // [{name, url}]
  },
  birthdays: { enabled: false, serverUrl: 'https://contacts.icloud.com' },
  train: { enabled: false, apiKey: '', keyword: 'train', from: { id: '', name: '' }, to: { id: '', name: '' } },
  homelab: {
    enabled: false,
    kuma: { url: '', apiKey: '' },
    prometheus: { url: '', username: '', password: '', severity: 'critical', insecureTls: false },
  },
  rss: { enabled: false, max: 5, feeds: [] }, // feeds: [{name, url}]
  // Point en mer au large de Trebeurden : le modele de maree n'a pas de donnee trop pres de la cote
  tides: { enabled: false, place: 'Trébeurden', latitude: 48.79, longitude: -3.62, display: 'curve', showCoef: true },
  wallos: { enabled: false, url: '', apiKey: '', currency: '€' },
  ecowatt: { enabled: false, clientId: '', clientSecret: '' },
  // Nombre de lignes de la zone Remarques, par modele (0 = pas de zone Remarques)
  notes: { lines: { classique: 5, minimal: 5, focus: 3, weekend: 10, lundi: 5, custom: 5 } },
  failure: { retryCount: 3, retryDelayMin: 5, discordWebhook: '' },
  customTemplate: { blocks: ['weather', 'ecowatt', 'urgent', 'payments', 'agenda', 'train', 'todo', 'homelab', 'rss', 'birthdays', 'notes'] },
  sessionSecret: '',
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Fusion profonde : les tableaux et scalaires de `src` remplacent ceux de `base`
function merge(base, src) {
  const out = { ...base };
  for (const [k, v] of Object.entries(src || {})) {
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

async function getSettings() {
  const doc = (await settingsDb.findOneAsync({ _id: 'settings' })) || {};
  const { _id, ...stored } = doc;
  const s = merge(DEFAULTS, stored);
  if (!s.sessionSecret) {
    s.sessionSecret = crypto.randomBytes(32).toString('hex');
    await settingsDb.updateAsync({ _id: 'settings' }, { $set: { sessionSecret: s.sessionSecret } }, { upsert: true });
  }
  return s;
}

// patch = { section: { ...champs } } ; fusionne avec l'existant
async function saveSettings(patch) {
  const doc = (await settingsDb.findOneAsync({ _id: 'settings' })) || {};
  const { _id, ...stored } = doc;
  const next = merge(stored, patch);
  await settingsDb.updateAsync({ _id: 'settings' }, { _id: 'settings', ...next }, { upsert: true });
  return getSettings();
}

module.exports = { users, prints, getSettings, saveSettings, DEFAULTS, LOGO, DATA_DIR, merge };
