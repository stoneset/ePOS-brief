'use strict';
// Export et import de tous les reglages, avec ou sans les secrets (cles, tokens, mots de passe).
// Le compte de connexion et la cle de session ne sont jamais exportes.
const { DEFAULTS } = require('./db');

// Chemins des champs secrets dans les reglages
const SECRETS = [
  'trello.key', 'trello.token', 'calendar.icloud.password', 'train.apiKey',
  'homelab.kuma.apiKey', 'homelab.prometheus.password', 'wallos.apiKey', 'ecowatt.clientSecret', 'failure.discordWebhook',
];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function set(o, path, value) {
  const keys = path.split('.');
  let cur = o;
  for (const k of keys.slice(0, -1)) { if (!isObj(cur[k])) cur[k] = {}; cur = cur[k]; }
  cur[keys.at(-1)] = value;
}

function exportSettings(settings, withSecrets) {
  const { sessionSecret, ...rest } = settings;
  const data = JSON.parse(JSON.stringify(rest));
  if (!withSecrets) for (const p of SECRETS) if (get(data, p) !== undefined) set(data, p, '');
  return { app: 'ePOS-Brief', format: 1, exportedAt: new Date().toISOString(), includesSecrets: !!withSecrets, settings: data };
}

// Ne garde que les cles connues, avec le bon type. Les tableaux (flux, calendriers...) sont repris tels quels.
function sanitize(def, val) {
  if (isObj(def)) {
    if (!isObj(val)) return undefined;
    const out = {};
    for (const k of Object.keys(def)) {
      const v = sanitize(def[k], val[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(def)) return Array.isArray(val) ? JSON.parse(JSON.stringify(val)) : undefined;
  return typeof val === typeof def ? val : undefined;
}

// Renvoie { patch, secretsImported, secretsKept } ou leve une erreur lisible
function prepareImport(file, current) {
  if (!isObj(file) || file.app !== 'ePOS-Brief' || !isObj(file.settings)) {
    throw new Error('Ce fichier n\'est pas un export de réglages ePOS-Brief.');
  }
  const { sessionSecret, ...defaults } = DEFAULTS;
  const patch = sanitize(defaults, file.settings) || {};
  // Ancien format : un seul nombre de lignes de remarques pour tous les modeles
  if (typeof get(file.settings, 'notes.lines') === 'number') set(patch, 'notes.lines', file.settings.notes.lines);
  let secretsImported = 0;
  let secretsKept = 0;
  for (const p of SECRETS) {
    const v = get(patch, p);
    if (typeof v === 'string' && v.trim()) secretsImported++;
    else { set(patch, p, get(current, p) || ''); if (get(current, p)) secretsKept++; }
  }
  return { patch, secretsImported, secretsKept };
}

module.exports = { exportSettings, prepareImport, SECRETS };
