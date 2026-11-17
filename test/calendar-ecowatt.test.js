'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempDataDir, lineText } = require('./helpers');
tempDataDir();
const { DateTime } = require('luxon');
const { DEFAULTS } = require('../src/db');
const fr = require('../src/ticket/calendar-fr');
const ecowatt = require('../src/sources/ecowatt');
const scheduler = require('../src/scheduler');
const { build } = require('../src/ticket/build');
const { sampleData } = require('../src/ticket/sample');

const zone = 'Europe/Paris';
const at = (iso) => DateTime.fromISO(iso, { zone });
const settings = () => JSON.parse(JSON.stringify(DEFAULTS));

test('Pâques et jours fériés', () => {
  assert.deepEqual(fr.easter(2026), { month: 4, day: 5 });
  assert.deepEqual(fr.easter(2027), { month: 3, day: 28 });
  assert.deepEqual(fr.easter(2024), { month: 3, day: 31 });
  const h = fr.holidays(2026);
  assert.equal(Object.keys(h).length, 11);
  assert.equal(h['2026-04-06'], 'Lundi de Pâques');
  assert.equal(h['2026-05-14'], 'Ascension');
  assert.equal(h['2026-05-25'], 'Lundi de Pentecôte');
  assert.equal(fr.holidayName(at('2026-11-11T06:30')), 'Armistice');
  assert.equal(fr.holidayName(at('2026-11-12T06:30')), null);
});

test('changement d\'heure : la veille et le jour même', () => {
  // 2026 : passage a l'heure d'hiver le dimanche 25 octobre, a l'heure d'ete le dimanche 29 mars
  assert.deepEqual(fr.dstChange(at('2026-10-24T06:30')), { when: 'tonight', hours: -1 });
  assert.deepEqual(fr.dstChange(at('2026-10-25T06:30')), { when: 'today', hours: -1 });
  assert.deepEqual(fr.dstChange(at('2026-03-28T06:30')), { when: 'tonight', hours: 1 });
  assert.equal(fr.dstChange(at('2026-10-26T06:30')), null);
  assert.equal(fr.dstChange(at('2026-11-17T06:30')), null);
  const t = build('weekend', sampleData(at('2026-10-24T06:30')), settings(), { now: at('2026-10-24T06:30'), number: 1 }).map(lineText);
  assert.ok(t.includes('Cette nuit : on recule d\'1 h (3h -> 2h)'));
  const f = build('classique', sampleData(at('2026-11-11T06:30')), settings(), { now: at('2026-11-11T06:30'), number: 1 }).map(lineText);
  assert.ok(f.includes('Jour férié : Armistice'));
});

test('planning : règle des jours fériés', () => {
  const s = settings();
  const wed = at('2026-11-11T06:30'); // mercredi 11 novembre
  assert.equal(scheduler.templateFor(s, wed), 'weekend');
  s.schedule.holiday = '';
  assert.equal(scheduler.templateFor(s, wed), 'classique');
  s.schedule.holiday = 'skip';
  assert.equal(scheduler.templateFor(s, wed), '');
  // prochaine impression le 10 au soir : on saute le 11
  assert.equal(scheduler.nextRun(s, at('2026-11-10T20:00')).at.toISODate(), '2026-11-12');
  assert.equal(scheduler.templateFor(s, at('2026-11-12T06:30')), 'classique');
});

test('Ecowatt : alertes du jour et du lendemain seulement', () => {
  const now = at('2026-11-17T06:30');
  const hv = (tense) => Array.from({ length: 24 }, (_, h) => ({ pas: h, hvalue: tense.includes(h) ? 2 : 1 }));
  const signals = [
    { jour: '2026-11-17T00:00:00+01:00', dvalue: 2, values: hv([8, 9, 10, 11, 12, 18, 19]) },
    { jour: '2026-11-18T00:00:00+01:00', dvalue: 1, values: hv([]) },
    { jour: '2026-11-19T00:00:00+01:00', dvalue: 3, values: hv([8]) },
  ];
  assert.deepEqual(ecowatt.alerts(signals, now), [{ when: 'today', level: 2, hours: '8h-13h, 18h-20h', message: '' }]);
  assert.deepEqual(ecowatt.alerts(signals, at('2026-11-18T06:30')).map((a) => [a.when, a.level]), [['tomorrow', 3]]);
  assert.equal(ecowatt.ranges([]), '');
  const lines = build('classique', sampleData(now), settings(), { now, number: 1 }).map(lineText);
  const i = lines.findIndex((l) => l.includes('ECOWATT ORANGE AUJOURD\'HUI'));
  assert.ok(i > 0);
  assert.ok(lines.slice(i - 1, i + 4).every((l) => l.length === 42));
  const calm = sampleData(now);
  calm.ecowatt = { ok: true, alerts: [] };
  assert.ok(!build('classique', calm, settings(), { now, number: 1 }).map(lineText).some((l) => l.includes('ECOWATT')));
});
