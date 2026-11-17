'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TZ = 'Europe/Paris';
const { DateTime } = require('luxon');
const weather = require('../src/sources/weather');
const trello = require('../src/sources/trello');
const calendar = require('../src/sources/calendar');
const birthdays = require('../src/sources/birthdays');
const train = require('../src/sources/train');
const homelab = require('../src/sources/homelab');
const rss = require('../src/sources/rss');
const { eventsOn } = require('../src/ticket/build');

const now = DateTime.fromISO('2026-11-17T06:30:00', { zone: 'Europe/Paris' });

test('météo : réponse Open-Meteo -> données du ticket', () => {
  const hours = Array.from({ length: 24 }, (_, h) => `2026-11-17T${String(h).padStart(2, '0')}:00`);
  const probs = hours.map((_, h) => (h >= 14 && h <= 17 ? 70 : h === 3 ? 55 : 10));
  const w = weather.parse({
    current: { temperature_2m: 7.6 },
    daily: {
      weather_code: [80], temperature_2m_max: [11.2], temperature_2m_min: [3.8], precipitation_probability_max: [70],
      sunrise: ['2026-11-17T08:21'], sunset: ['2026-11-17T17:29'], wind_speed_10m_max: [34.6], wind_direction_10m_dominant: [230],
    },
    hourly: { time: hours, temperature_2m: hours.map((_, h) => h), weather_code: hours.map(() => 3), precipitation_probability: probs },
  }, 'Lannion', now);
  assert.deepEqual(
    { temp: w.temp, label: w.label, min: w.min, max: w.max, wind: w.wind, windDir: w.windDir, rainPct: w.rainPct, rainWindow: w.rainWindow, sunrise: w.sunrise },
    { temp: 8, label: 'Averses', min: 4, max: 11, wind: 35, windDir: 'SO', rainPct: 70, rainWindow: '14h-18h', sunrise: '08:21' },
  );
  assert.deepEqual(w.parts.map((p) => [p.name, p.temp, p.label]), [['Matin', 9, 'Couvert'], ['Après-midi', 15, 'Couvert'], ['Soir', 20, 'Couvert']]);
  assert.equal(weather.rainWindow(new Array(24).fill(10)), null);
});

test('trello : ordre du tableau et étiquette urgente insensible à la casse', () => {
  const cards = trello.parse([
    { name: 'B', pos: 200, labels: [{ name: 'perso' }] },
    { name: 'A', pos: 100, labels: [{ name: ' Urgent ' }, { name: '' }] },
    { name: 'C', pos: 300, labels: [] },
  ], 'URGENT');
  assert.deepEqual(cards.map((c) => [c.name, c.urgent]), [['A', true], ['B', false], ['C', false]]);
});

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:1
SUMMARY:Hebdo
DTSTART;TZID=Europe/Paris:20260901T090000
DTEND;TZID=Europe/Paris:20260901T100000
RRULE:FREQ=WEEKLY;BYDAY=TU
EXDATE;TZID=Europe/Paris:20261124T090000
END:VEVENT
BEGIN:VEVENT
UID:2
SUMMARY;LANGUAGE=fr:Déplacement
DTSTART;VALUE=DATE:20261116
DTEND;VALUE=DATE:20261119
END:VEVENT
BEGIN:VEVENT
UID:3
SUMMARY:Train Lannion > Paris
DTSTART:20261117T104500Z
DTEND:20261117T143000Z
END:VEVENT
BEGIN:VEVENT
UID:4
SUMMARY:Annulé
STATUS:CANCELLED
DTSTART:20261117T120000Z
DTEND:20261117T130000Z
END:VEVENT
BEGIN:VEVENT
UID:5
SUMMARY:Demain
DTSTART;VALUE=DATE:20261118
DTEND;VALUE=DATE:20261119
END:VEVENT
END:VCALENDAR`;

test('agenda : récurrences, journée entière sur plusieurs jours, annulation', () => {
  const day = now.startOf('day');
  const evs = calendar.parseIcs(ICS, day.toJSDate(), day.plus({ days: 1 }).toJSDate(), 'Perso');
  const today = eventsOn(evs, now, 'Europe/Paris');
  assert.deepEqual(today.map((e) => [e.allDay ? 'jour' : e.time, e.title]), [['jour', 'Déplacement'], ['09:00', 'Hebdo'], ['11:45', 'Train Lannion > Paris']]);
  // Sur 14 jours : l'occurrence du 24 est exclue (EXDATE), celle du 1er decembre existe
  const two = calendar.parseIcs(ICS, day.toJSDate(), day.plus({ days: 15 }).toJSDate(), 'Perso');
  const hebdo = two.filter((e) => e.title === 'Hebdo').map((e) => e.start.slice(0, 10));
  assert.deepEqual(hebdo, ['2026-11-17', '2026-12-01']);
  assert.equal(eventsOn(two, now.plus({ days: 2 }), 'Europe/Paris').some((e) => e.title === 'Déplacement'), false, 'fini le 18 au soir');
  assert.equal(eventsOn(two, now.plus({ days: 1 }), 'Europe/Paris').filter((e) => e.allDay).length, 2);
  assert.equal(calendar.icsUrl('webcal://p01-caldav.icloud.com/published/2/abc'), 'https://p01-caldav.icloud.com/published/2/abc');
});

test('train : mot-clé dans l\'agenda', () => {
  assert.equal(train.hasKeyword([{ title: 'TRAIN Lannion > Paris' }], 'train'), true);
  assert.equal(train.hasKeyword([{ title: 'Entraînement' }], 'train'), false);
  assert.equal(train.hasKeyword([{ title: 'Réunion équipe' }], 'Reunion'), true);
  assert.equal(train.hasKeyword([{ title: 'Train' }], '  '), false);
});

test('train : perturbations Navitia, dédoublonnées et triées par gravité', () => {
  const delay = {
    id: 'd-1', status: 'active', severity: { effect: 'SIGNIFICANT_DELAYS' },
    messages: [{ text: '<p>Défaillance de signalisation</p>' }],
    impacted_objects: [{
      pt_object: { trip: { name: '857312' } },
      impacted_stops: [
        { stop_point: { id: 'stop_point:SNCF:87473108:Train', name: 'Lannion' }, base_departure_time: '114500', amended_departure_time: '120000', departure_status: 'delayed' },
        { stop_point: { id: 'stop_point:SNCF:87473199:Train', name: 'Plouaret-Trégor' }, base_arrival_time: '120200', amended_arrival_time: '121700' },
      ],
    }],
  };
  const cancel = {
    id: 'd-2', status: 'active', severity: { effect: 'NO_SERVICE' }, messages: [],
    impacted_objects: [{ pt_object: { trip: { name: '857320' } }, impacted_stops: [{ stop_point: { id: 'stop_point:SNCF:87473108:Train', name: 'Lannion' }, base_departure_time: '171000', departure_status: 'deleted' }] }],
  };
  const past = { id: 'd-3', status: 'past', severity: { effect: 'NO_SERVICE' }, impacted_objects: [] };
  const r = train.parse([{ disruptions: [delay, past] }, { disruptions: [delay, cancel] }, {}], 'stop_area:SNCF:87473108', 'stop_area:SNCF:87473199');
  assert.deepEqual(r.map((d) => [d.label, d.train, d.detail, d.message]), [
    ['TRAIN SUPPRIME', 'n° 857320', 'Lannion 17:10 : supprimé', ''],
    ['RETARD', 'n° 857312', 'Lannion 11:45 : +15 min (12:00)', 'Défaillance de signalisation'],
  ]);
  assert.deepEqual(train.parse([{}, {}], 'a:1', 'b:2'), []);
});

test('anniversaires : formats de date vCard', () => {
  const card = (bday) => `BEGIN:VCARD\r\nVERSION:3.0\r\nN:Nom;Prénom;;;\r\nFN:Prénom Nom\r\n${bday}\r\nEND:VCARD`;
  assert.deepEqual(birthdays.parseVCard(card('BDAY:1998-11-17')), { name: 'Prénom Nom', year: 1998, month: 11, day: 17 });
  assert.deepEqual(birthdays.parseVCard(card('BDAY;value=date:19981117')), { name: 'Prénom Nom', year: 1998, month: 11, day: 17 });
  assert.equal(birthdays.parseVCard(card('BDAY;X-APPLE-OMIT-YEAR=1604:1604-11-17')).year, null);
  assert.deepEqual(birthdays.parseVCard(card('item1.BDAY:--1117')), { name: 'Prénom Nom', year: null, month: 11, day: 17 });
  assert.equal(birthdays.parseVCard(card('NOTE:rien')), null);
  const contacts = [{ name: 'Zoé', year: 1998, month: 11, day: 17 }, { name: 'Alex', year: null, month: 11, day: 17 }, { name: 'Autre', year: 1990, month: 11, day: 18 }, { name: 'Bissextile', year: 2000, month: 2, day: 29 }];
  assert.deepEqual(birthdays.todays(contacts, now), [{ name: 'Alex', age: null }, { name: 'Zoé', age: 28 }]);
  assert.deepEqual(birthdays.todays(contacts, DateTime.fromISO('2027-02-28')), [{ name: 'Bissextile', age: 27 }]);
  assert.deepEqual(birthdays.todays(contacts, DateTime.fromISO('2028-02-28')), []);
});

test('homelab : métriques Uptime Kuma et alertes Prometheus', () => {
  const metrics = [
    '# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)',
    '# TYPE monitor_status gauge',
    'monitor_status{monitor_name="Nextcloud",monitor_type="http",monitor_url="https://nc.example",monitor_hostname="null",monitor_port="null"} 0',
    'monitor_status{monitor_name="Plex",monitor_type="http",monitor_url="x",monitor_hostname="null",monitor_port="null"} 1',
    'monitor_status{monitor_name="NAS \\"froid\\"",monitor_type="ping",monitor_url="x",monitor_hostname="nas",monitor_port="null"} 1',
    'monitor_status{monitor_name="En maintenance",monitor_type="http",monitor_url="x",monitor_hostname="null",monitor_port="null"} 3',
    'monitor_status{monitor_name="Groupe",monitor_type="group",monitor_url="x",monitor_hostname="null",monitor_port="null"} 1',
    'monitor_response_time{monitor_name="Plex",monitor_type="http"} 42',
  ].join('\n');
  assert.deepEqual(homelab.parseKuma(metrics), { up: 2, total: 3, down: ['Nextcloud'] });
  const alerts = {
    status: 'success',
    data: {
      alerts: [
        { labels: { alertname: 'DiskFull', severity: 'critical', instance: 'truenas:9100' }, annotations: { summary: 'Disque presque plein' }, state: 'firing', activeAt: '2026-11-17T05:00:00Z', value: '0.93' },
        { labels: { alertname: 'HostDown', severity: 'CRITICAL', instance: 'dl360' }, annotations: {}, state: 'firing', activeAt: '2026-11-17T04:00:00Z', value: '1' },
        { labels: { alertname: 'HighLoad', severity: 'warning', instance: 'r710' }, annotations: {}, state: 'firing', activeAt: '2026-11-17T03:00:00Z', value: '1' },
        { labels: { alertname: 'NasHot', severity: 'critical', instance: 'truenas' }, annotations: {}, state: 'pending', activeAt: '2026-11-17T05:30:00Z', value: '1' },
        { labels: { alertname: 'Doublon', severity: 'critical', instance: 'dl360' }, annotations: { summary: 'HostDown' }, state: 'firing', activeAt: '2026-11-17T06:00:00Z', value: '1' },
      ],
    },
  };
  assert.deepEqual(homelab.parsePrometheus(alerts, 'critical').map((a) => a.text), ['HostDown (dl360)', 'Disque presque plein (truenas:9100)']);
  assert.equal(homelab.parsePrometheus(alerts, 'critical, warning').length, 3);
  assert.deepEqual(homelab.parsePrometheus({ status: 'success', data: { alerts: [] } }, 'critical'), []);
});

test('rss : répartition entre les flux et doublons', () => {
  const a = [{ title: 'A1' }, { title: 'A2' }, { title: 'A3' }];
  const b = [{ title: 'B1' }, { title: 'a1' }];
  assert.deepEqual(rss.pick([a, b], 4).map((i) => i.title), ['A1', 'B1', 'A2', 'A3']);
  assert.deepEqual(rss.pick([[], []], 5), []);
});

test('train : mot-clé en mot entier seulement', () => {
  assert.equal(train.hasKeyword([{ title: 'Trains de nuit' }], 'train'), true);
  assert.equal(train.hasKeyword([{ title: 'Paris (train)' }], 'train'), true);
  assert.equal(train.hasKeyword([{ title: 'Entraînement trail' }], 'train'), false);
  assert.equal(train.hasKeyword([{ title: 'RDV c++ club' }], 'c++'), true);
});

test('message d\'erreur : reprend le texte court de l\'API', () => {
  const { explain } = require('../src/sources/http');
  assert.equal(explain({ response: { status: 401, data: 'invalid token' } }), 'accès refusé (401 : invalid token), vérifier les identifiants');
  assert.equal(explain({ response: { status: 401, data: '<html>long</html>' } }), 'accès refusé (401), vérifier les identifiants');
  assert.equal(explain({ response: { status: 404, data: {} } }), 'introuvable (404)');
});
