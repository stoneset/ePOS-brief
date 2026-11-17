'use strict';
const axios = require('axios');

const http = axios.create({
  timeout: 10000,
  headers: { 'User-Agent': 'ePOS-Brief/1.0' },
  maxContentLength: 10 * 1024 * 1024,
});

// Message d'erreur court et lisible pour le ticket et l'interface
function explain(err) {
  if (err.response) {
    const s = err.response.status;
    const body = typeof err.response.data === 'string' ? err.response.data.trim() : '';
    const detail = body && body.length <= 60 && !body.startsWith('<') ? ` : ${body}` : '';
    if (s === 401 || s === 403) return `accès refusé (${s}${detail}), vérifier les identifiants`;
    if (s === 404) return 'introuvable (404)';
    if (s === 429) return 'trop de requêtes (429)';
    return `erreur HTTP ${s}`;
  }
  if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) return 'délai dépassé';
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return 'hôte introuvable';
  if (err.code === 'ECONNREFUSED') return 'connexion refusée';
  return String(err.message || err).slice(0, 80);
}

module.exports = { http, explain };
