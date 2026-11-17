'use strict';
// Jours feries de France metropolitaine et changements d'heure, calcules localement (aucune API).

// Dimanche de Paques (algorithme de Meeus / Jones / Butcher, calendrier gregorien)
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// { 'AAAA-MM-JJ': 'nom' }
function holidays(year) {
  const e = easter(year);
  const shift = (days) => {
    const dt = new Date(Date.UTC(year, e.month - 1, e.day + days));
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  };
  return {
    [iso(year, 1, 1)]: 'Jour de l\'an',
    [shift(1)]: 'Lundi de Pâques',
    [iso(year, 5, 1)]: 'Fête du Travail',
    [iso(year, 5, 8)]: 'Victoire 1945',
    [shift(39)]: 'Ascension',
    [shift(50)]: 'Lundi de Pentecôte',
    [iso(year, 7, 14)]: 'Fête nationale',
    [iso(year, 8, 15)]: 'Assomption',
    [iso(year, 11, 1)]: 'Toussaint',
    [iso(year, 11, 11)]: 'Armistice',
    [iso(year, 12, 25)]: 'Noël',
  };
}

// now : DateTime luxon -> nom du jour ferie, ou null
const holidayName = (now) => holidays(now.year)[now.toISODate()] || null;

// Changement d'heure la nuit prochaine ("tonight") ou la nuit passee ("today").
// Renvoie { when, hours } avec hours = +1 (on avance) ou -1 (on recule), ou null.
function dstChange(now) {
  const offset = (d) => d.setZone(now.zone).offset;
  const today = now.startOf('day');
  const tomorrow = today.plus({ days: 1 });
  if (offset(tomorrow.plus({ hours: 12 })) !== offset(tomorrow.startOf('day'))) {
    return { when: 'tonight', hours: (offset(tomorrow.plus({ hours: 12 })) - offset(tomorrow.startOf('day'))) / 60 };
  }
  if (offset(today.plus({ hours: 12 })) !== offset(today)) {
    return { when: 'today', hours: (offset(today.plus({ hours: 12 })) - offset(today)) / 60 };
  }
  return null;
}

module.exports = { easter, holidays, holidayName, dstChange };
