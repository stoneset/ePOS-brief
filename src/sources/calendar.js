'use strict';
// Agenda : calendriers iCloud via CalDAV (protocole standard d'agenda) et liens ICS publics.
const ical = require('node-ical');
const { createDAVClient } = require('tsdav');
const { http, explain } = require('./http');

const text = (v) => (v && typeof v === 'object' ? v.val : v) || '';
const pad = (n) => String(n).padStart(2, '0');
// node-ical place les evenements "journee entiere" a minuit heure locale du processus
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Texte ICS -> evenements normalises entre deux instants (recurrences developpees)
function parseIcs(icsText, from, to, calendarName) {
  const parsed = ical.sync.parseICS(icsText);
  const out = [];
  for (const ev of Object.values(parsed)) {
    if (ev.type !== 'VEVENT' || !ev.start) continue;
    if (text(ev.status).toUpperCase() === 'CANCELLED') continue;
    let instances;
    try {
      instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true });
    } catch {
      continue; // un evenement mal forme ne doit pas faire tomber tout l'agenda
    }
    for (const i of instances) {
      const title = text(i.summary) || '(sans titre)';
      if (i.isFullDay) {
        const startDay = localDay(i.start);
        const last = i.end && i.end > i.start ? localDay(new Date(i.end.getTime() - 12 * 3600 * 1000)) : startDay;
        out.push({ title, allDay: true, startDay, lastDay: last < startDay ? startDay : last, calendar: calendarName });
      } else {
        out.push({ title, allDay: false, start: i.start.toISOString(), end: (i.end || i.start).toISOString(), calendar: calendarName });
      }
    }
  }
  return out;
}

function davClient(icloud) {
  return createDAVClient({
    serverUrl: icloud.serverUrl || 'https://caldav.icloud.com',
    credentials: { username: icloud.username, password: icloud.password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
}

// Liste des calendriers du compte, pour les cases a cocher des reglages
async function listCalendars(icloud) {
  const client = await davClient(icloud);
  const cals = await client.fetchCalendars();
  return cals
    .filter((c) => !c.components || c.components.includes('VEVENT'))
    .map((c) => ({ url: c.url, name: text(c.displayName) || c.url }));
}

const icsUrl = (u) => String(u).trim().replace(/^webcals?:\/\//i, 'https://');

// from / to : objets Date
async function fetchEvents(settings, from, to) {
  const cfg = settings.calendar;
  const events = [];
  const errors = [];
  const jobs = [];

  const selected = (cfg.icloud.calendars || []).filter((c) => c.enabled);
  if (cfg.icloud.username && cfg.icloud.password && selected.length) {
    jobs.push((async () => {
      let client;
      try {
        client = await davClient(cfg.icloud);
      } catch (e) {
        errors.push(`iCloud : ${explain(e)}`);
        return;
      }
      await Promise.all(selected.map(async (cal) => {
        try {
          const objects = await client.fetchCalendarObjects({
            calendar: { url: cal.url },
            timeRange: { start: from.toISOString(), end: to.toISOString() },
          });
          for (const o of objects) if (o.data) events.push(...parseIcs(o.data, from, to, cal.name));
        } catch (e) {
          errors.push(`${cal.name} : ${explain(e)}`);
        }
      }));
    })());
  }

  for (const src of cfg.ics || []) {
    if (!src.url) continue;
    jobs.push((async () => {
      try {
        const { data } = await http.get(icsUrl(src.url), { responseType: 'text', transformResponse: (d) => d });
        events.push(...parseIcs(data, from, to, src.name));
      } catch (e) {
        errors.push(`${src.name || 'ICS'} : ${explain(e)}`);
      }
    })());
  }

  if (!jobs.length) return { ok: false, error: 'aucun calendrier sélectionné' };
  await Promise.all(jobs);
  if (errors.length && !events.length && errors.length >= jobs.length) return { ok: false, error: errors[0] };

  // Un meme evenement peut apparaitre dans deux sources : on dedoublonne
  const seen = new Set();
  const unique = events.filter((e) => {
    const key = `${e.title}|${e.allDay ? e.startDay : e.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ok: true, events: unique, errors };
}

module.exports = { fetchEvents, listCalendars, parseIcs, icsUrl };
