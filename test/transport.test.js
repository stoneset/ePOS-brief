'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { fakePrinter, wait } = require('./helpers');
const { printRaw } = require('../src/printer/transport');

const payload = Buffer.from('ticket de test\n');

test('envoi nominal : la fausse imprimante reçoit exactement les octets', async () => {
  const p = await fakePrinter();
  const r = await printRaw(payload, { host: '127.0.0.1', port: p.port });
  await wait(50);
  assert.deepEqual(r.warnings, []);
  assert.equal(p.jobs.length, 1);
  assert.ok(p.jobs[0].equals(payload));
  await p.close();
});

test('imprimante muette sur les demandes d\'état : on imprime quand même', async () => {
  const p = await fakePrinter({ silent: true });
  await printRaw(payload, { host: '127.0.0.1', port: p.port });
  await wait(50);
  assert.ok(p.jobs[0].equals(payload));
  await p.close();
});

test('plus de papier, capot ouvert : erreur et rien n\'est envoyé', async () => {
  for (const [status, message] of [[{ 2: 0x12, 4: 0x72 }, /Plus de papier/], [{ 2: 0x32, 4: 0x12 }, /Plus de papier/], [{ 2: 0x16, 4: 0x12 }, /Capot/]]) {
    const p = await fakePrinter({ status });
    await assert.rejects(printRaw(payload, { host: '127.0.0.1', port: p.port }), message);
    await wait(50);
    assert.equal(p.jobs.length, 0);
    await p.close();
  }
});

test('papier presque fini : imprime avec un avertissement', async () => {
  const p = await fakePrinter({ status: { 2: 0x12, 4: 0x1e } });
  const r = await printRaw(payload, { host: '127.0.0.1', port: p.port });
  assert.deepEqual(r.warnings, ['Rouleau de papier presque terminé']);
  await p.close();
});

test('imprimante éteinte ou non configurée : erreur lisible', async () => {
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  await assert.rejects(printRaw(payload, { host: '127.0.0.1', port }), /Connexion refusée/);
  await assert.rejects(printRaw(payload, { host: '' }), /non configurée/);
});
