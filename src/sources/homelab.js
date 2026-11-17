'use strict';
// Etat du homelab : Uptime Kuma (page /metrics) et alertes actives de Prometheus (/api/v1/alerts).
const https = require('https');
const { http, explain } = require('./http');

const trimUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

// Texte /metrics -> { up, total, down: [noms] }. Valeurs : 0 down, 1 up, 2 en attente, 3 maintenance
function parseKuma(metrics) {
  const monitors = [];
  const re = /^monitor_status\{([^}]*)\}\s+([0-9.]+)/gm;
  let m;
  while ((m = re.exec(metrics))) {
    const name = /monitor_name="((?:[^"\\]|\\.)*)"/.exec(m[1]);
    const type = /monitor_type="([^"]*)"/.exec(m[1]);
    if (type && type[1] === 'group') continue; // les groupes ne sont pas des services
    monitors.push({ name: name ? name[1].replace(/\\(.)/g, '$1') : '?', status: Number(m[2]) });
  }
  const active = monitors.filter((x) => x.status !== 3);
  return {
    up: active.filter((x) => x.status === 1).length,
    total: active.length,
    down: active.filter((x) => x.status === 0).map((x) => x.name).sort(),
  };
}

async function fetchKuma(cfg) {
  const { data } = await http.get(`${trimUrl(cfg.url)}/metrics`, {
    auth: { username: '', password: cfg.apiKey }, // cle d'API en mot de passe, identifiant vide
    responseType: 'text',
    transformResponse: (d) => d,
  });
  if (!/monitor_status/.test(data)) throw new Error('réponse inattendue (pas de métriques)');
  return parseKuma(data);
}

// /api/v1/alerts -> alertes actives au niveau de gravite voulu (label "severity").
// Les alertes "pending" (condition pas encore tenue assez longtemps) sont ignorees.
function parsePrometheus(json, severity) {
  const wanted = String(severity || 'critical').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const alerts = ((json && json.data && json.data.alerts) || [])
    .filter((a) => a.state === 'firing')
    .filter((a) => wanted.includes(String((a.labels && a.labels.severity) || '').toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const a of alerts) {
    const l = a.labels || {};
    const ann = a.annotations || {};
    const where = l.instance || l.host || l.hostname || l.job || '';
    const title = ann.summary || l.alertname || 'alerte';
    const text = where && !title.includes(where) ? `${title} (${where})` : title;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ text, since: a.activeAt || null });
  }
  return out.sort((x, y) => String(x.since).localeCompare(String(y.since)));
}

async function fetchPrometheus(cfg) {
  const { data } = await http.get(`${trimUrl(cfg.url)}/api/v1/alerts`, {
    auth: cfg.username || cfg.password ? { username: cfg.username, password: cfg.password } : undefined,
    httpsAgent: new https.Agent({ rejectUnauthorized: !cfg.insecureTls }),
  });
  if (!data || data.status !== 'success') throw new Error('réponse inattendue de Prometheus');
  return { alerts: parsePrometheus(data, cfg.severity), severity: cfg.severity || 'critical' };
}

async function fetchHomelab(settings) {
  const h = settings.homelab;
  const out = { ok: true };
  const jobs = [];
  if (h.kuma.url) jobs.push(fetchKuma(h.kuma).then((r) => { out.kuma = r; }, (e) => { out.kuma = { error: explain(e) }; }));
  if (h.prometheus.url) jobs.push(fetchPrometheus(h.prometheus).then((r) => { out.prometheus = r; }, (e) => { out.prometheus = { error: explain(e) }; }));
  if (!jobs.length) return { ok: false, error: 'ni Uptime Kuma ni Prometheus configuré' };
  await Promise.all(jobs);
  return out;
}

module.exports = { fetchHomelab, fetchKuma, fetchPrometheus, parseKuma, parsePrometheus };
