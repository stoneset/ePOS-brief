'use strict';
// Prelevements du jour depuis Wallos (gestionnaire d'abonnements auto-heberge).
// API : /api/subscriptions/get_subscriptions.php (cle d'API envoyee dans le corps, pas dans l'URL)
const { DateTime } = require('luxon');
const { http } = require('./http');

const trimUrl = (u) => String(u || '').trim().replace(/\/+$/, '');
// Cycles Wallos : 1 jour, 2 semaine, 3 mois, 4 an (multiplies par "frequency")
const UNIT = { 1: 'days', 2: 'weeks', 3: 'months', 4: 'years' };

async function fetchSubscriptions(cfg) {
  const body = new URLSearchParams({ api_key: cfg.apiKey, state: '0', sort: 'next_payment', convert_currency: 'true' });
  const { data } = await http.post(`${trimUrl(cfg.url)}/api/subscriptions/get_subscriptions.php`, body.toString(), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  if (!data || data.success === false || !Array.isArray(data.subscriptions)) {
    throw new Error((data && (data.title || data.message)) || 'réponse inattendue de Wallos');
  }
  return data.subscriptions;
}

// Dates de paiement a considerer : la prochaine, et la precedente (Wallos avance next_payment
// une fois la date passee : sans ca, le rattrapage du lundi raterait les prelevements du week-end).
function paymentDates(sub, zone) {
  const next = DateTime.fromISO(String(sub.next_payment || '').slice(0, 10), { zone });
  if (!next.isValid) return [];
  const unit = UNIT[Number(sub.cycle)];
  const n = Math.max(1, Number(sub.frequency) || 1);
  return unit ? [next, next.minus({ [unit]: n })] : [next];
}

// Jours couverts : aujourd'hui, et le lundi aussi samedi et dimanche
function window(now) {
  const days = now.weekday === 1 ? [now.minus({ days: 2 }), now.minus({ days: 1 }), now] : [now];
  return days.map((d) => d.toISODate());
}

function dueToday(subs, now) {
  const days = window(now);
  const out = [];
  for (const s of subs) {
    if (Number(s.inactive) === 1) continue;
    const hit = paymentDates(s, now.zone).find((d) => days.includes(d.toISODate()));
    if (!hit) continue;
    out.push({ name: String(s.name || '?'), price: Number(s.price) || 0, day: hit.toISODate() });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
}

async function fetchPayments(settings, now) {
  const subs = await fetchSubscriptions(settings.wallos);
  return { ok: true, payments: dueToday(subs, now), currency: settings.wallos.currency || '€', total: subs.length };
}

module.exports = { fetchPayments, fetchSubscriptions, dueToday, paymentDates };
