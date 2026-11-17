'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempDataDir, fakePrinter, wait } = require('./helpers');
tempDataDir();
const { createApp } = require('../src/server');
const { getSettings, saveSettings } = require('../src/db');

let base;
let server;
let cookie = '';

// Petit client HTTP qui garde le cookie de session et ne suit pas les redirections
async function req(path, { method = 'GET', form, noCookie } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: { ...(cookie && !noCookie ? { cookie } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const set = res.headers.getSetCookie();
  if (set.length && !noCookie) cookie = set.map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
}

test.before(async () => {
  await saveSettings({ weather: { enabled: false } }); // pas d'appel reseau pendant les tests
  const { app } = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  require('../src/scheduler').stop(); // sinon la tache planifiee garde le processus en vie
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

test('premier lancement : tout redirige vers la création du compte', async () => {
  assert.equal((await req('/')).location, '/setup');
  assert.equal((await req('/login')).location, '/setup');
  assert.equal((await req('/api/trello/boards')).status, 401);
  assert.equal((await req('/setup', { method: 'POST', form: { username: 'admin', password: 'court', confirm: 'court' } })).status, 400);
  const r = await req('/setup', { method: 'POST', form: { username: 'admin', password: 'motdepasse1', confirm: 'motdepasse1' } });
  assert.equal(r.location, '/settings');
  assert.equal((await req('/setup')).location, '/login', 'un seul compte possible');
});

test('connexion et déconnexion', async () => {
  await req('/logout', { method: 'POST' });
  cookie = '';
  assert.equal((await req('/')).location, '/login');
  assert.equal((await req('/settings')).location, '/login');
  assert.equal((await req('/login', { method: 'POST', form: { username: 'admin', password: 'mauvais' } })).status, 401);
  assert.equal((await req('/login', { method: 'POST', form: { username: 'inconnu', password: 'motdepasse1' } })).status, 401);
  assert.equal((await req('/login', { method: 'POST', form: { username: 'admin', password: 'motdepasse1' } })).location, '/');
  assert.equal((await req('/')).status, 200);
  // un cookie forge n'ouvre pas de session
  const forged = await fetch(`${base}/`, { redirect: 'manual', headers: { cookie: 'eposbrief=eyJ1c2VyIjoiYWRtaW4ifQ==; eposbrief.sig=faux' } });
  assert.equal(forged.status, 302);
});

test('pages principales', async () => {
  const dash = await req('/');
  assert.match(dash.text, /Prochaine impression/);
  assert.match(dash.text, /pas encore configurée/);
  const tpl = await req('/templates');
  assert.equal(tpl.status, 200);
  for (const name of ['Classique', 'Minimal', 'Focus', 'Week-end', 'Lundi', 'Personnalisé']) assert.ok(tpl.text.includes(`>${name}</h2>`), name);
  assert.match(tpl.text, /!!! URGENT !!!/);
  assert.equal((await req('/settings')).status, 200);
  assert.equal((await req('/nimporte')).status, 404);
});

test('réglages : enregistrement, validation, secrets jamais renvoyés', async () => {
  await req('/settings/trello', { method: 'POST', form: { enabled: 'on', key: 'CLE-SECRETE', token: 'TOKEN-SECRET', boardId: 'b1', boardName: 'Perso', listId: 'l1', listName: 'A faire', urgentLabel: 'urgent', max: '999' } });
  let s = await getSettings();
  assert.deepEqual([s.trello.enabled, s.trello.key, s.trello.listId, s.trello.max], [true, 'CLE-SECRETE', 'l1', 50]);
  const page = await req('/settings');
  assert.ok(!page.text.includes('CLE-SECRETE') && !page.text.includes('TOKEN-SECRET'));
  // champ secret vide = valeur conservee
  await req('/settings/trello', { method: 'POST', form: { key: '', token: '', listId: 'l2' } });
  s = await getSettings();
  assert.deepEqual([s.trello.enabled, s.trello.key, s.trello.token, s.trello.listId], [false, 'CLE-SECRETE', 'TOKEN-SECRET', 'l2']);

  await req('/settings/schedule', { method: 'POST', form: { enabled: 'on', time: '07:15', timezone: 'Pas/Un/Fuseau', day_1: 'lundi', day_2: 'inconnu', day_6: 'weekend' } });
  s = await getSettings();
  assert.equal(s.schedule.time, '07:15');
  assert.equal(s.schedule.timezone, 'Europe/Paris', 'fuseau invalide refusé');
  assert.deepEqual(s.schedule.days, { 1: 'lundi', 2: '', 3: '', 4: '', 5: '', 6: 'weekend', 7: '' });

  const body = new URLSearchParams();
  body.append('enabled', 'on'); body.append('username', 'moi@example.com'); body.append('password', 'abcd-efgh');
  body.append('cal_url[]', 'https://caldav.example/a/'); body.append('cal_name[]', 'Perso');
  body.append('cal_url[]', 'https://caldav.example/b/'); body.append('cal_name[]', 'Travail');
  body.append('cal_enabled[]', 'https://caldav.example/b/');
  body.append('ics_name[]', ''); body.append('ics_url[]', 'webcal://example.com/cal.ics');
  body.append('ics_name[]', 'vide'); body.append('ics_url[]', '');
  body.append('birthdays', 'on');
  await fetch(`${base}/settings/calendar`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  s = await getSettings();
  assert.deepEqual(s.calendar.icloud.calendars, [{ url: 'https://caldav.example/a/', name: 'Perso', enabled: false }, { url: 'https://caldav.example/b/', name: 'Travail', enabled: true }]);
  assert.deepEqual(s.calendar.ics, [{ url: 'https://example.com/cal.ics', name: 'ICS 1' }]);
  assert.equal(s.birthdays.enabled, true);

  await req('/settings/rss', { method: 'POST', form: { enabled: 'on', max: '4', 'feed_name[]': 'Le flux', 'feed_url[]': 'https://example.com/rss.xml' } });
  await req('/settings/failure', { method: 'POST', form: { retryCount: '4', retryDelayMin: '10', discordWebhook: 'javascript:alert(1)' } });
  s = await getSettings();
  assert.deepEqual(s.rss.feeds, [{ url: 'https://example.com/rss.xml', name: 'Le flux' }]);
  assert.deepEqual(s.failure, { retryCount: 4, retryDelayMin: 10, discordWebhook: '' });
  assert.equal((await req('/settings/inconnu', { method: 'POST', form: {} })).status, 404);
  // on coupe tout ce qui appellerait le reseau pour la suite
  await saveSettings({ trello: { enabled: false }, calendar: { enabled: false }, birthdays: { enabled: false }, rss: { enabled: false } });
});

test('modèle personnalisé et apparence', async () => {
  const body = new URLSearchParams();
  for (const b of ['notes', 'weather', 'todo', 'faux']) body.append('block[]', b);
  body.append('pos_notes', '3'); body.append('pos_weather', '1'); body.append('pos_todo', '2');
  await fetch(`${base}/templates/custom`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  assert.deepEqual((await getSettings()).customTemplate.blocks, ['weather', 'todo', 'notes']);
  await req('/templates/appearance', { method: 'POST', form: { logo: '<b>MON LOGO</b>', doubleWidth: 'on', notes_classique: '8', notes_focus: '0', notes_weekend: '99' } });
  const s = await getSettings();
  assert.deepEqual([s.logo.text, s.logo.doubleWidth], ['<b>MON LOGO</b>', true]);
  assert.deepEqual(s.notes.lines, { classique: 8, minimal: 5, focus: 0, weekend: 20, lundi: 5, custom: 5 });
  const tpl = await req('/templates');
  assert.ok(tpl.text.includes('&lt;b&gt;MON LOGO&lt;/b&gt;') && !tpl.text.includes('<b>MON LOGO</b>'), 'le logo est échappé dans la page');
});

test('aperçu, impression, historique, réimpression, test imprimante', async () => {
  const p = await fakePrinter();
  await req('/settings/printer', { method: 'POST', form: { host: '127.0.0.1', port: String(p.port), cols: '42', cut: 'on' } });
  const preview = JSON.parse((await req('/preview?template=classique')).text);
  assert.match(preview.html, /REMARQUES/);
  assert.ok(preview.lengthCm > 5);
  assert.equal((await req('/print', { method: 'POST', form: { template: 'classique' } })).location, '/');
  await wait(50);
  assert.equal(p.jobs.length, 1);
  const dash = await req('/');
  assert.match(dash.text, /Ticket #1 imprimé/);
  const id = /\/prints\/([A-Za-z0-9]+)"/.exec(dash.text)[1];
  assert.match((await req(`/prints/${id}`)).text, /Ticket #0001/);
  await req(`/prints/${id}/reprint`, { method: 'POST', form: {} });
  await wait(50);
  assert.equal(p.jobs.length, 2);
  assert.ok(p.jobs[0].equals(p.jobs[1]));
  // exemple : imprime les donnees fictives, sans entrer dans l'historique
  assert.equal((await req('/print/sample', { method: 'POST', form: { template: 'focus' } })).location, '/templates');
  await wait(50);
  assert.equal(p.jobs.length, 3);
  const sample = p.jobs[2].toString('latin1');
  assert.ok(sample.includes('EXEMPLE - donn') && sample.includes('PREMIER RDV') && sample.includes('Renvoyer le'));
  assert.match((await req('/templates')).text, /Exemple du modèle Focus imprimé/);
  assert.equal((await req('/')).text.match(/\/prints\/[A-Za-z0-9]+"/g).length, 1, 'pas dans l\'historique');
  p.jobs.splice(2, 1);
  const t = JSON.parse((await req('/api/test/printer', { method: 'POST' })).text);
  assert.equal(t.ok, true);
  await wait(50);
  assert.equal(p.jobs.length, 3);
  await p.close();
  const ko = JSON.parse((await req('/api/test/printer', { method: 'POST' })).text);
  assert.equal(ko.ok, false);
  assert.match(ko.message, /Connexion refusée/);
  assert.equal((await req('/prints/inexistant')).status, 404);
});

test('export et import des réglages, avec ou sans secrets', async () => {
  await saveSettings({ trello: { key: 'CLE-T', token: 'TOK-T', boardName: 'Perso' }, wallos: { apiKey: 'W-KEY', url: 'http://wallos.lan' }, logo: { text: 'LOGO A' } });
  const plain = JSON.parse((await req('/settings/export')).text);
  assert.equal(plain.app, 'ePOS-Brief');
  assert.equal(plain.includesSecrets, false);
  assert.equal(plain.settings.trello.key, '');
  assert.equal(plain.settings.wallos.apiKey, '');
  assert.equal(plain.settings.wallos.url, 'http://wallos.lan');
  assert.ok(!('sessionSecret' in plain.settings));
  const full = JSON.parse((await req('/settings/export?secrets=1')).text);
  assert.equal(full.settings.trello.token, 'TOK-T');

  // import sans secrets : les secrets actuels sont conserves, le reste est remplace
  plain.settings.logo.text = 'LOGO B';
  plain.settings.trello.boardName = 'Pro';
  plain.settings.inconnu = { x: 1 };
  plain.settings.printer.port = 'pas un nombre';
  const post = async (body) => {
    const res = await fetch(`${base}/settings/import`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    return res;
  };
  let r = await post(plain);
  assert.equal(r.status, 200);
  let s = await getSettings();
  assert.deepEqual([s.logo.text, s.trello.boardName, s.trello.key, s.wallos.apiKey], ['LOGO B', 'Pro', 'CLE-T', 'W-KEY']);
  assert.equal(typeof s.printer.port, 'number');
  assert.ok(!('inconnu' in s));
  assert.match((await req('/settings')).text, /Réglages importés\..*secret\(s\) absent\(s\)/);

  // import avec secrets : ils remplacent les actuels
  full.settings.trello.key = 'NOUVELLE';
  r = await post(full);
  s = await getSettings();
  assert.equal(s.trello.key, 'NOUVELLE');

  r = await post({ hello: 'world' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).message, /pas un export/);
  await saveSettings({ trello: { enabled: false }, wallos: { enabled: false } });
});

test('changement de mot de passe', async () => {
  await req('/settings/account', { method: 'POST', form: { current: 'faux', next: 'nouveaupass1', confirm: 'nouveaupass1' } });
  assert.match((await req('/settings')).text, /Mot de passe actuel incorrect/);
  await req('/settings/account', { method: 'POST', form: { current: 'motdepasse1', next: 'nouveaupass1', confirm: 'nouveaupass1' } });
  cookie = '';
  assert.equal((await req('/login', { method: 'POST', form: { username: 'admin', password: 'motdepasse1' } })).status, 401);
  assert.equal((await req('/login', { method: 'POST', form: { username: 'admin', password: 'nouveaupass1' } })).location, '/');
});
