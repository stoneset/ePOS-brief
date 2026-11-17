'use strict';
// Generation et impression d'un ticket, avec tentatives multiples, alerte Discord et historique.
const { DateTime } = require('luxon');
const { prints, getSettings } = require('./db');
const { resolve } = require('./ticket/templates');
const { collect, summarize } = require('./ticket/collect');
const { build } = require('./ticket/build');
const { L, blank, rule } = require('./ticket/layout');
const { encode } = require('./printer/escpos');
const { printRaw } = require('./printer/transport');
const { http, explain } = require('./sources/http');

const KEEP = 90; // nombre de tickets conserves dans l'historique
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIn = (settings) => DateTime.now().setZone(settings.schedule.timezone);

async function nextNumber() {
  const last = await prints.findAsync({}).sort({ number: -1 }).limit(1);
  return last.length ? last[0].number + 1 : 1;
}

// Interroge les sources et compose le ticket (sans l'imprimer)
async function generate(templateId, settings, number) {
  const tpl = resolve(templateId, settings);
  const now = nowIn(settings);
  const data = await collect(settings, now, tpl.blocks);
  const lines = build(tpl.id, data, settings, { now, number });
  return { lines, templateId: tpl.id, templateName: tpl.name, sources: summarize(data) };
}

function send(lines, settings) {
  const p = settings.printer;
  return printRaw(encode(lines, { cut: p.cut }), { host: p.host, port: p.port, timeoutMs: p.timeoutMs });
}

async function notifyDiscord(settings, content) {
  const url = settings.failure.discordWebhook;
  if (!url) return false;
  await http.post(url, { username: 'ePOS-Brief', content: content.slice(0, 1900) });
  return true;
}

async function prune() {
  const old = await prints.findAsync({}).sort({ number: -1 }).skip(KEEP);
  if (old.length) await prints.removeAsync({ _id: { $in: old.map((d) => d._id) } }, { multi: true });
}

// trigger : 'schedule' | 'manual'. retry : applique les tentatives des reglages, puis previent Discord.
async function runPrint({ templateId, trigger, retry }) {
  const settings = await getSettings();
  const number = await nextNumber();
  const ticket = await generate(templateId, settings, number);
  const doc = await prints.insertAsync({
    number,
    createdAt: new Date().toISOString(),
    trigger,
    templateId: ticket.templateId,
    templateName: ticket.templateName,
    sources: ticket.sources,
    lines: ticket.lines,
    cols: settings.printer.cols,
    status: 'pending',
    attempts: 0,
    error: null,
    warnings: [],
  });
  const maxAttempts = 1 + (retry ? Math.max(0, Number(settings.failure.retryCount) || 0) : 0);
  // EPOS_RETRY_DELAY_MS : raccourcit l'attente pour les tests automatiques
  const delayMs = Number(process.env.EPOS_RETRY_DELAY_MS) || Math.max(1, Number(settings.failure.retryDelayMin) || 1) * 60000;
  let error = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { warnings } = await send(ticket.lines, settings);
      await prints.updateAsync({ _id: doc._id }, { $set: { status: 'ok', attempts: attempt, error: null, warnings } });
      await prune();
      return { ok: true, number, attempts: attempt, warnings };
    } catch (e) {
      error = e.message;
      const last = attempt === maxAttempts;
      await prints.updateAsync({ _id: doc._id }, { $set: { status: last ? 'failed' : 'retrying', attempts: attempt, error } });
      console.error(`[print] ticket #${number} tentative ${attempt}/${maxAttempts} : ${error}`);
      if (!last) await sleep(delayMs);
    }
  }
  if (retry) {
    const msg = `**ePOS-Brief : échec d'impression** du ticket #${number} (modèle ${ticket.templateName}) après ${maxAttempts} tentative(s).\nDernière erreur : ${error}`;
    await notifyDiscord(settings, msg).catch((e) => console.error(`[discord] ${explain(e)}`));
  }
  await prune();
  return { ok: false, number, attempts: maxAttempts, error };
}

// Reimprime a l'identique un ticket de l'historique
async function reprint(id) {
  const doc = await prints.findOneAsync({ _id: id });
  if (!doc) throw new Error('Ticket introuvable');
  const settings = await getSettings();
  const { warnings } = await send(doc.lines, settings);
  await prints.updateAsync({ _id: id }, { $set: { reprintedAt: new Date().toISOString() }, $inc: { reprints: 1 } });
  return { number: doc.number, warnings };
}

// Imprime un modele avec les donnees d'exemple (non historise), marque EXEMPLE en tete
async function printSample(templateId) {
  const { build } = require('./ticket/build');
  const { sampleData } = require('./ticket/sample');
  const settings = await getSettings();
  const now = nowIn(settings);
  const cols = settings.printer.cols;
  const tag = { spans: [{ text: ' EXEMPLE - données fictives '.padEnd(cols).slice(0, cols), bold: true, invert: true }], align: 'left', size: 'normal' };
  const lines = [tag, blank(), ...build(templateId, sampleData(now), settings, { now, number: 0 }), blank(), tag];
  return send(lines, settings);
}

// Petit ticket de controle : accents, largeur, tailles
async function testPrint() {
  const settings = await getSettings();
  const cols = settings.printer.cols;
  const now = nowIn(settings);
  const ruler = '1234567890'.repeat(6).slice(0, cols);
  const lines = [
    L('ePOS-BRIEF', { size: 'big', bold: true, align: 'center' }),
    L('Test d\'impression', { align: 'center' }),
    L(now.setLocale('fr').toFormat('cccc d LLLL yyyy HH:mm'), { align: 'center' }),
    rule(cols),
    L(ruler),
    L(`^ ${cols} colonnes : cette règle doit tenir`),
    L('  sur une seule ligne'),
    blank(),
    L('Accents : é è ê ë à â ç ù û î ï ô œ'),
    L('Symboles : ° € £ § « » ½'),
    L('Gras', { bold: true }),
    { spans: [{ text: ' Inversé ', bold: true, invert: true }], align: 'left', size: 'normal' },
    L('Double largeur', { size: 'wide' }),
    L('Double taille', { size: 'big' }),
    L('[ ] Case à cocher'),
    rule(cols),
    L(`Imprimante ${settings.printer.host}:${settings.printer.port}`, { align: 'center' }),
  ];
  return send(lines, settings);
}

module.exports = { generate, runPrint, reprint, testPrint, printSample, notifyDiscord, nextNumber, nowIn };
