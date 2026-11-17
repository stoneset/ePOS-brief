'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempDataDir, fakePrinter, fakeWebhook, wait, lineText } = require('./helpers');
tempDataDir();
process.env.EPOS_RETRY_DELAY_MS = '20';
const { DateTime } = require('luxon');
const { prints, saveSettings, getSettings } = require('../src/db');
const job = require('../src/job');
const scheduler = require('../src/scheduler');

// Aucune source reseau dans ces tests
const base = { weather: { enabled: false } };

test('impression réussie : ticket reçu par l\'imprimante et historisé', async () => {
  const p = await fakePrinter();
  await saveSettings({ ...base, printer: { host: '127.0.0.1', port: p.port } });
  const r = await job.runPrint({ templateId: 'classique', trigger: 'manual', retry: false });
  await wait(50);
  assert.equal(r.ok, true);
  assert.equal(r.number, 1);
  assert.equal(p.jobs.length, 1);
  assert.deepEqual([...p.jobs[0].subarray(0, 2)], [0x1b, 0x40]);
  const doc = await prints.findOneAsync({ number: 1 });
  assert.equal(doc.status, 'ok');
  assert.equal(doc.attempts, 1);
  assert.ok(doc.lines.some((l) => lineText(l) === 'REMARQUES'));
  assert.ok(lineText(doc.lines.at(-1)).endsWith('#0001'));
  await p.close();
});

test('réimpression : mêmes octets que l\'original', async () => {
  const p = await fakePrinter();
  await saveSettings({ printer: { host: '127.0.0.1', port: p.port } });
  const first = await job.runPrint({ templateId: 'minimal', trigger: 'manual', retry: false });
  const doc = await prints.findOneAsync({ number: first.number });
  await job.reprint(doc._id);
  await wait(50);
  assert.equal(p.jobs.length, 2);
  assert.ok(p.jobs[0].equals(p.jobs[1]));
  assert.equal((await prints.findOneAsync({ _id: doc._id })).reprints, 1);
  await assert.rejects(job.reprint('inconnu'), /introuvable/);
  await p.close();
});

test('échec planifié : nouvelles tentatives puis alerte Discord', async () => {
  const hook = await fakeWebhook();
  const p = await fakePrinter({ status: { 2: 0x32, 4: 0x72 } }); // plus de papier
  await saveSettings({ printer: { host: '127.0.0.1', port: p.port }, failure: { retryCount: 2, retryDelayMin: 1, discordWebhook: hook.url } });
  const r = await job.runPrint({ templateId: 'classique', trigger: 'schedule', retry: true });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 3);
  assert.match(r.error, /Plus de papier/);
  const doc = await prints.findOneAsync({ number: r.number });
  assert.equal(doc.status, 'failed');
  assert.equal(hook.calls.length, 1);
  assert.match(hook.calls[0].content, /échec d'impression.*#3.*3 tentative\(s\).*Plus de papier/s);
  await p.close();
  await hook.close();
});

test('la tentative suivante réussit si l\'imprimante revient', async () => {
  const hook = await fakeWebhook();
  const p = await fakePrinter();
  const { port } = p;
  await p.close(); // imprimante eteinte
  await saveSettings({ printer: { host: '127.0.0.1', port }, failure: { retryCount: 5, discordWebhook: hook.url } });
  process.env.EPOS_RETRY_DELAY_MS = '150';
  const pending = job.runPrint({ templateId: 'minimal', trigger: 'schedule', retry: true });
  await wait(200);
  // on la rallume sur le meme port
  const net = require('net');
  const jobs = [];
  const srv = net.createServer((sock) => { sock.on('data', (b) => { if (b.length !== 3) jobs.push(b); }); sock.on('end', () => sock.end()); }).listen(port, '127.0.0.1');
  const r = await pending;
  process.env.EPOS_RETRY_DELAY_MS = '20';
  assert.equal(r.ok, true);
  assert.ok(r.attempts >= 2);
  assert.equal(hook.calls.length, 0, 'pas d\'alerte si une tentative réussit');
  await wait(50);
  assert.equal(jobs.length, 1);
  await new Promise((res) => srv.close(res));
  await hook.close();
});

test('impression manuelle : pas de nouvelle tentative, pas d\'alerte', async () => {
  const hook = await fakeWebhook();
  await saveSettings({ printer: { host: '', port: 9100 }, failure: { retryCount: 3, discordWebhook: hook.url } });
  const r = await job.runPrint({ templateId: 'classique', trigger: 'manual', retry: false });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 1);
  assert.equal(hook.calls.length, 0);
  await hook.close();
});

test('planning : prochaine impression selon l\'heure et les jours', async () => {
  const s = await getSettings();
  s.schedule = { enabled: true, time: '06:30', timezone: 'Europe/Paris', days: { 1: 'lundi', 2: 'classique', 3: '', 4: 'classique', 5: 'classique', 6: '', 7: '' } };
  const at = (iso) => DateTime.fromISO(iso, { zone: 'Europe/Paris' });
  let n = scheduler.nextRun(s, at('2026-11-17T05:00')); // mardi avant l'heure
  assert.equal(n.at.toISO().slice(0, 16), '2026-11-17T06:30');
  assert.equal(n.templateId, 'classique');
  n = scheduler.nextRun(s, at('2026-11-17T07:00')); // mardi apres l'heure : mercredi saute
  assert.equal(n.at.toISO().slice(0, 16), '2026-11-19T06:30');
  n = scheduler.nextRun(s, at('2026-11-20T12:00')); // vendredi midi : lundi
  assert.equal(n.at.toISO().slice(0, 16), '2026-11-23T06:30');
  assert.equal(n.templateId, 'lundi');
  s.schedule.enabled = false;
  assert.equal(scheduler.nextRun(s, at('2026-11-17T05:00')), null);
  assert.deepEqual(scheduler.parseTime('7:05'), { hour: 7, minute: 5 });
});
