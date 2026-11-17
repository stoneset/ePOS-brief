'use strict';
// Anniversaires du jour lus dans les contacts iCloud via CardDAV (protocole standard des carnets d'adresses).
const { createDAVClient } = require('tsdav');

// vCard -> { name, month, day, year|null } ou null si pas de date de naissance
function parseVCard(vcard) {
  const lines = String(vcard).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let name = '';
  let bday = null;
  for (const line of lines) {
    const fn = /^(?:item\d+\.)?FN(?:;[^:]*)?:(.*)$/i.exec(line);
    if (fn) name = fn[1].replace(/\\([,;\\])/g, '$1').trim();
    const b = /^(?:item\d+\.)?BDAY([^:]*):(.+)$/i.exec(line);
    if (!b) continue;
    const params = b[1];
    const value = b[2].trim();
    let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value);
    if (m) {
      // Apple code "annee inconnue" avec l'annee 1604
      const noYear = /OMIT-YEAR/i.test(params) || m[1] === '1604';
      bday = { year: noYear ? null : Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
      continue;
    }
    m = /^--(\d{2})-?(\d{2})/.exec(value);
    if (m) bday = { year: null, month: Number(m[1]), day: Number(m[2]) };
  }
  return name && bday ? { name, ...bday } : null;
}

// now : DateTime luxon. Les natifs du 29 fevrier sont fetes le 28 les annees non bissextiles.
function todays(contacts, now) {
  const leapFallback = now.month === 2 && now.day === 28 && !now.isInLeapYear;
  return contacts
    .filter((c) => c.month === now.month && (c.day === now.day || (leapFallback && c.day === 29)))
    .map((c) => ({ name: c.name, age: c.year ? now.year - c.year : null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

let cache = { key: '', at: 0, contacts: [] };
const TTL = 6 * 3600 * 1000;

async function loadContacts(settings) {
  const { username, password } = settings.calendar.icloud;
  const key = `${settings.birthdays.serverUrl}|${username}`;
  if (cache.key === key && Date.now() - cache.at < TTL) return cache.contacts;
  const client = await createDAVClient({
    serverUrl: settings.birthdays.serverUrl || 'https://contacts.icloud.com',
    credentials: { username, password },
    authMethod: 'Basic',
    defaultAccountType: 'carddav',
  });
  const books = await client.fetchAddressBooks();
  const contacts = [];
  for (const book of books) {
    const vcards = await client.fetchVCards({ addressBook: book });
    for (const v of vcards) {
      const c = v.data && parseVCard(v.data);
      if (c) contacts.push(c);
    }
  }
  cache = { key, at: Date.now(), contacts };
  return contacts;
}

async function fetchBirthdays(settings, now) {
  const contacts = await loadContacts(settings);
  return { ok: true, people: todays(contacts, now), total: contacts.length };
}

const clearCache = () => { cache = { key: '', at: 0, contacts: [] }; };

module.exports = { fetchBirthdays, parseVCard, todays, clearCache };
