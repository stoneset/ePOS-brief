'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempDataDir, lineText } = require('./helpers');
tempDataDir();
const { DateTime } = require('luxon');
const { DEFAULTS } = require('../src/db');
const { clean, wrap, wrapMax, kv, frame } = require('../src/ticket/layout');
const { build } = require('../src/ticket/build');
const { TEMPLATES, sourcesFor } = require('../src/ticket/templates');
const { toHtml, toText } = require('../src/ticket/render');
const { sampleData } = require('../src/ticket/sample');
const { encode } = require('../src/printer/escpos');

const settings = () => JSON.parse(JSON.stringify(DEFAULTS));
const now = DateTime.fromISO('2026-11-17T06:30:00', { zone: 'Europe/Paris' });
const texts = (lines) => lines.map(lineText);
const overflow = (lines, cols) => lines.filter((l) => lineText(l).length > (l.size === 'normal' ? cols : Math.floor(cols / 2)));

test('clean retire ce que l\'imprimante ne sait pas imprimer', () => {
  assert.equal(clean('Appeler  maman \u{1F600} → gare'), 'Appeler maman -> gare');
  assert.equal(clean('été œuvre 20 € 8°C'), 'été œuvre 20 € 8°C');
  assert.equal(clean('日本語 ok'), 'ok');
  assert.equal(clean('ligne1\nligne2\tfin'), 'ligne1 ligne2 fin');
});

test('wrap et wrapMax respectent la largeur', () => {
  const lines = wrap('Relire le chapitre 2 de l\'état de l\'art avant jeudi', 20);
  assert.ok(lines.every((l) => l.length <= 20));
  assert.equal(lines.join(' '), 'Relire le chapitre 2 de l\'état de l\'art avant jeudi');
  assert.deepEqual(wrap('a'.repeat(45), 20).map((l) => l.length), [20, 20, 5]);
  const cut = wrapMax('un deux trois quatre cinq six sept huit neuf dix', 12, 2);
  assert.equal(cut.length, 2);
  assert.ok(cut[1].endsWith('...') && cut[1].length <= 12);
});

test('kv et frame font exactement la largeur demandée', () => {
  assert.equal(lineText(kv('Services', '23/24 UP', 42)).length, 42);
  assert.equal(lineText(kv('x'.repeat(60), 'droite', 42)).length, 42);
  frame([{ text: 'TRAIN' }, { text: 'y'.repeat(80) }], 42).forEach((l) => assert.equal(lineText(l).length, 42));
});

test('tous les modèles tiennent dans la largeur, en 42 et 32 colonnes', () => {
  for (const cols of [42, 32]) {
    const s = settings();
    s.printer.cols = cols;
    if (cols < 42) s.logo.text = 'ePOS-BRIEF';
    for (const id of Object.keys(TEMPLATES)) {
      const lines = build(id, sampleData(now), s, { now, number: 142 });
      assert.deepEqual(overflow(lines, cols).map(lineText), [], `${id} en ${cols} colonnes`);
      assert.ok(toHtml(lines, cols).startsWith('<div class="ticket"'));
    }
  }
});

test('modèle classique : contenu attendu', () => {
  const t = texts(build('classique', sampleData(now), settings(), { now, number: 142 }));
  assert.ok(t.includes('MARDI 17 NOVEMBRE'));
  assert.ok(t.includes('Semaine 47 - Jour 321/365'));
  assert.ok(t.some((l) => l.includes('!!! URGENT !!!')));
  assert.ok(t.some((l) => l.includes('[ ] Renvoyer le contrat signé')));
  assert.ok(t.includes('11:45  Train Lannion > Paris'));
  assert.ok(t.some((l) => l.includes('Aucune perturbation signalée')));
  assert.ok(t.includes('[ ] Mettre à jour Proxmox'));
  assert.ok(t.includes('  DOWN : nextcloud'));
  assert.ok(t.some((l) => l.startsWith('Alertes critiques') && l.endsWith('1')));
  assert.ok(t.includes('  ! Disque presque plein sur truenas (92'));
  assert.ok(t.includes('* Prénom Nom (28 ans)'));
  assert.ok(t.includes('REMARQUES'));
  assert.equal(t.filter((l) => /^_+$/.test(l)).length, 5);
  assert.equal(t.at(-1), 'Imprimé 06:30 - #0142');
  // les cartes urgentes ne sont pas repetees dans la todo
  assert.equal(t.filter((l) => l.includes('Renvoyer le contrat signé')).length, 1);
});

test('encart URGENT absent sans carte urgente, bloc absent si source désactivée', () => {
  const data = sampleData(now);
  data.trello.cards = data.trello.cards.filter((c) => !c.urgent);
  data.homelab = null;
  data.birthdays = { ok: true, people: [] };
  const t = texts(build('classique', data, settings(), { now, number: 1 }));
  assert.ok(!t.some((l) => l.includes('URGENT')));
  assert.ok(!t.includes(' HOMELAB '));
  assert.ok(!t.includes(' ANNIVERSAIRES '));
});

test('encart train : absent, indisponible, perturbé', () => {
  const s = settings();
  const data = sampleData(now);
  data.train = null;
  assert.ok(!texts(build('classique', data, s, { now, number: 1 })).some((l) => l.includes('TRAIN ')));
  data.train = { ok: false, from: 'Lannion', to: 'Plouaret', error: 'délai dépassé' };
  assert.ok(texts(build('classique', data, s, { now, number: 1 })).some((l) => l.includes('Info trafic indisponible')));
  data.train = { ok: true, from: 'Lannion', to: 'Plouaret', disruptions: [{ label: 'TRAIN SUPPRIME', train: 'n° 857312', detail: 'Lannion 11:45 : supprimé', message: 'Travaux sur la voie entre Plouaret et Lannion' }] };
  const t = texts(build('classique', data, s, { now, number: 1 }));
  assert.ok(t.some((l) => l.includes('TRAIN SUPPRIME n° 857312')));
  assert.ok(t.some((l) => l.includes('Lannion 11:45 : supprimé')));
  assert.ok(!t.some((l) => l.includes('Aucune perturbation')));
});

test('source en erreur : le ticket sort quand même', () => {
  const data = sampleData(now);
  data.trello = { ok: false, error: 'accès refusé (401), vérifier les identifiants' };
  data.weather = { ok: false, error: 'délai dépassé' };
  const t = texts(build('classique', data, settings(), { now, number: 1 }));
  assert.ok(t.includes('Météo indisponible'));
  assert.ok(t.some((l) => l.startsWith('(indisponible : accès refusé')));
});

test('agenda : journée entière, événement commencé la veille, semaine', () => {
  const s = settings();
  const data = sampleData(now);
  data.calendar.events.push(
    { title: 'Congé', allDay: true, startDay: '2026-11-16', lastDay: '2026-11-17' },
    { title: 'Astreinte', allDay: false, start: '2026-11-16T20:00:00+01:00', end: '2026-11-17T08:00:00+01:00' },
    { title: 'Hier seulement', allDay: true, startDay: '2026-11-16', lastDay: '2026-11-16' },
  );
  const day = texts(build('classique', data, s, { now, number: 1 }));
  assert.ok(day.includes('jour   Congé') && day.includes('jour   Astreinte'));
  assert.ok(!day.some((l) => l.includes('Hier seulement')));
  assert.ok(day.indexOf('jour   Congé') < day.indexOf('09:00  Point d\'avancement'));
  const week = texts(build('lundi', data, s, { now, number: 1 }));
  assert.ok(week.includes('MARDI 17 NOVEMBRE (aujourd\'hui)'));
  assert.ok(week.includes('JEUDI 19 NOVEMBRE') && week.includes('08:30  Rendez-vous garage'));
  assert.ok(week.includes('SAMEDI 21 NOVEMBRE') && week.includes('DIMANCHE 22 NOVEMBRE'));
});

test('modèles minimal, focus et personnalisé', () => {
  const s = settings();
  const min = texts(build('minimal', sampleData(now), s, { now, number: 1 }));
  assert.equal(min.filter((l) => l.startsWith('[ ] ')).length, 3);
  assert.ok(min[0] === 'MARDI 17 NOVEMBRE', 'pas de logo');
  const focus = build('focus', sampleData(now), s, { now, number: 1 });
  assert.ok(focus.some((l) => l.size === 'big' && lineText(l) === '09:00'));
  s.customTemplate.blocks = ['notes', 'weather', 'bloc-inconnu'];
  const custom = texts(build('custom', sampleData(now), s, { now, number: 1 }));
  assert.ok(custom.indexOf('REMARQUES') < custom.findIndex((l) => l.startsWith('LANNION')));
  assert.deepEqual([...sourcesFor(['train', 'notes'])].sort(), ['calendar', 'train']);
});

test('logo en double largeur', () => {
  const s = settings();
  s.logo.doubleWidth = true;
  const lines = build('classique', sampleData(now), s, { now, number: 1 });
  assert.deepEqual(lines.slice(0, 5).map((l) => l.size), ['wide', 'wide', 'wide', 'wide', 'normal']);
  assert.equal(lines[4].align, 'center');
  assert.deepEqual(overflow(lines, 42), []);
  assert.ok(toText(lines, 42).length > 0);
});

test('ESC/POS : initialisation, page de codes, accents, coupe', () => {
  const lines = build('classique', sampleData(now), settings(), { now, number: 1 });
  const buf = encode(lines, { cut: true });
  assert.deepEqual([...buf.subarray(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 16]);
  assert.deepEqual([...buf.subarray(-4)], [0x1d, 0x56, 66, 0]);
  assert.ok(buf.includes(Buffer.from([0x52, 0xe9, 0x70, 0xe9, 0x74]))); // "Répét" en WPC1252
  assert.ok(buf.includes(Buffer.from([0x38, 0xb0, 0x43]))); // "8°C"
  assert.ok(!buf.includes(Buffer.from('é', 'utf8')), 'aucun octet UTF-8');
  assert.ok(buf.includes(Buffer.from([0x1d, 0x21, 0x11])), 'double taille');
  assert.ok(buf.includes(Buffer.from([0x1d, 0x42, 1])) && buf.includes(Buffer.from([0x1d, 0x42, 0])), 'inversion puis retour');
  assert.deepEqual([...encode(lines, { cut: false }).subarray(-3)], [0x1b, 0x64, 6]);
});

test('remarques : nombre de lignes par modèle, 0 = pas de zone', () => {
  const s = settings();
  const count = (id) => texts(build(id, sampleData(now), s, { now, number: 1 })).filter((l) => /^_+$/.test(l)).length;
  assert.deepEqual([count('classique'), count('focus'), count('weekend')], [5, 3, 10]);
  s.notes.lines.weekend = 2;
  s.notes.lines.classique = 0;
  assert.equal(count('weekend'), 2);
  assert.equal(count('classique'), 0);
  assert.ok(!texts(build('classique', sampleData(now), s, { now, number: 1 })).includes('REMARQUES'));
  s.notes.lines = 4; // ancien format enregistre : un seul nombre
  assert.equal(count('focus'), 4);
});
