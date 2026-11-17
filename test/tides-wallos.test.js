'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { tempDataDir, lineText } = require('./helpers');
tempDataDir();
const { DateTime } = require('luxon');
const { DEFAULTS } = require('../src/db');
const tides = require('../src/sources/tides');
const wallos = require('../src/sources/wallos');
const weather = require('../src/sources/weather');
const { Bitmap, imageToPng } = require('../src/ticket/bitmap');
const { drawTide, hourAxis } = require('../src/ticket/tidechart');
const { build } = require('../src/ticket/build');
const { toHtml, toText } = require('../src/ticket/render');
const { sampleData } = require('../src/ticket/sample');
const { encode } = require('../src/printer/escpos');

const settings = () => JSON.parse(JSON.stringify(DEFAULTS));
const zone = 'Europe/Paris';
const series = (phase, amp = 2.9) => Array.from({ length: 48 }, (_, h) => amp * Math.cos((2 * Math.PI * (h - phase)) / 12.42));

test('marées : heures et hauteurs interpolées à quelques minutes près', () => {
  const ext = tides.extremes(series(6.2));
  // vrais extremums : PM 6,2 h et 18,62 h, BM 12,41 h (et 0 h hors calcul)
  assert.deepEqual(ext.map((e) => e.type), ['PM', 'BM', 'PM']);
  for (const [e, h] of [[ext[0], 6.2], [ext[1], 12.41], [ext[2], 18.62]]) assert.ok(Math.abs(e.hour - h) < 0.1, `${e.hour} vs ${h}`);
  assert.ok(Math.abs(ext[0].height - 2.9) < 0.1 && Math.abs(ext[1].height + 2.9) < 0.1);
  assert.ok(Math.abs(tides.range(ext) - 5.8) < 0.15);
  assert.equal(tides.coefficient(6.1), 100);
  assert.equal(tides.coefficient(3.66), 60);
  assert.equal(tides.coefficient(20), 120);
});

test('image : format ESC/POS et PNG valides', () => {
  const b = new Bitmap(16, 2);
  b.set(0, 0); b.set(15, 1);
  const img = b.toImage();
  assert.deepEqual([...Buffer.from(img.data, 'base64')], [0x80, 0, 0, 0x01]);
  const png = imageToPng(img);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = png.indexOf('IDAT');
  const len = png.readUInt32BE(idat - 4);
  const raw = zlib.inflateSync(png.subarray(idat + 4, idat + 4 + len));
  assert.deepEqual([...raw], [0, 0x7f, 0xff, 0, 0xff, 0xfe]); // 0 = noir en PNG gris
});

test('courbe de marée : taille, encre présente, axe aligné', () => {
  const s = series(6.2);
  const img = drawTide(s.slice(0, 25), tides.extremes(s), 42);
  assert.equal(img.width, 504);
  assert.equal(img.height, 96);
  const ink = [...Buffer.from(img.data, 'base64')].reduce((n, byte) => n + byte.toString(2).replace(/0/g, '').length, 0);
  assert.ok(ink > 1500 && ink < 12000, `${ink} points noirs`);
  const axis = hourAxis(42);
  assert.ok(axis.startsWith('0h') && axis.endsWith('24h') && axis.length === 42);
  assert.equal(axis.indexOf('12h'), 20);
});

test('bloc marées : courbe ou texte seul, ESC/POS', () => {
  const now = DateTime.fromISO('2026-11-21T07:00', { zone });
  const s = settings();
  let lines = build('weekend', sampleData(now), s, { now, number: 1 });
  const t = lines.map((l) => (l.image ? '[img]' : lineText(l)));
  const i = t.findIndex((l) => l.includes('MAREES'));
  assert.ok(t[i].includes('Trébeurden') && t[i].endsWith('coef. env. 85') && t[i].length === 42);
  assert.equal(t[i + 1], 'PM 06:01  +2,9 m     BM 12:14  -2,9 m');
  assert.equal(t[i + 3], '[img]');
  assert.ok(t[i + 4].startsWith('0h'));
  const buf = encode(lines);
  const at = buf.indexOf(Buffer.from([0x1d, 0x76, 0x30, 0, 63, 0, 96, 0]));
  assert.ok(at > 0, 'commande GS v 0');
  assert.match(toHtml(lines, 42), /<img alt="courbe" src="data:image\/png;base64,/);
  assert.ok(toText(lines, 42).includes('[image 504x96]'));
  s.tides.display = 'text';
  lines = build('weekend', sampleData(now), s, { now, number: 1 });
  assert.ok(!lines.some((l) => l.image));
  assert.ok(!encode(lines).includes(Buffer.from([0x1d, 0x76, 0x30])));
  const data = sampleData(now);
  data.tides = { ok: false, place: 'Trébeurden', error: 'délai dépassé' };
  assert.ok(build('weekend', data, s, { now, number: 1 }).some((l) => lineText(l).includes('indisponible')));
});

const subs = [
  { name: 'Mobile', price: 19.99, next_payment: '2026-11-23', cycle: 3, frequency: 1, inactive: 0 },
  { name: 'Hebdo', price: 2, next_payment: '2026-11-28', cycle: 2, frequency: 1, inactive: 0 }, // precedent : samedi 21
  { name: 'Annuel', price: 50, next_payment: '2027-11-22', cycle: 4, frequency: 1, inactive: 0 }, // precedent : dimanche 22/11/2026
  { name: 'Demain', price: 5, next_payment: '2026-11-24', cycle: 3, frequency: 1, inactive: 0 },
  { name: 'Coupé', price: 9, next_payment: '2026-11-23', cycle: 3, frequency: 1, inactive: 1 },
  { name: 'Date vide', price: 1, next_payment: '', cycle: 3, frequency: 1, inactive: 0 },
];

test('wallos : jour normal, puis rattrapage du week-end le lundi', () => {
  const tuesday = DateTime.fromISO('2026-11-24T06:30', { zone });
  assert.deepEqual(wallos.dueToday(subs, tuesday).map((p) => p.name), ['Demain']);
  const monday = DateTime.fromISO('2026-11-23T06:30', { zone });
  assert.deepEqual(wallos.dueToday(subs, monday).map((p) => [p.day, p.name]), [
    ['2026-11-21', 'Hebdo'], ['2026-11-22', 'Annuel'], ['2026-11-23', 'Mobile'],
  ]);
  // fin de mois : un prelevement du 31 se retrouve le 30 du mois precedent quand on recule
  const jan = [{ name: 'Fin de mois', price: 1, next_payment: '2026-12-31', cycle: 3, frequency: 1, inactive: 0 }];
  assert.equal(wallos.dueToday(jan, DateTime.fromISO('2026-11-30T06:30', { zone })).length, 1);
});

test('bloc prélèvements : total, jours affichés le lundi, absent si rien', () => {
  const s = settings();
  const monday = DateTime.fromISO('2026-11-23T06:30', { zone });
  const data = sampleData(monday);
  data.wallos = { ok: true, currency: '€', payments: wallos.dueToday(subs, monday) };
  const t = build('lundi', data, s, { now: monday, number: 1 }).map(lineText);
  assert.ok(t.includes(' PRELEVEMENTS DU WEEK-END '));
  assert.ok(t.some((l) => l.startsWith('SAM Hebdo') && l.endsWith('2,00 €') && l.length === 42));
  assert.ok(t.some((l) => l.startsWith('Total') && l.endsWith('71,99 €')));
  data.wallos.payments = [];
  assert.ok(!build('lundi', data, s, { now: monday, number: 1 }).map(lineText).some((l) => l.includes('PRELEVEMENTS')));
});

test('météo : la plage de pluie ignore les heures déjà passées', () => {
  const probs = Array.from({ length: 24 }, (_, h) => (h < 6 || (h >= 14 && h <= 17) ? 90 : 10));
  assert.equal(weather.rainWindow(probs, 0), '0h-6h');
  assert.equal(weather.rainWindow(probs, 7), '14h-18h');
  assert.equal(weather.rainWindow(probs, 19), null);
});
