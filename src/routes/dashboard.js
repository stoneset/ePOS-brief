'use strict';
const express = require('express');
const { DateTime } = require('luxon');
const { prints, getSettings } = require('../db');
const { TEMPLATES } = require('../ticket/templates');
const { toHtml, lengthCm } = require('../ticket/render');
const job = require('../job');
const scheduler = require('../scheduler');

const router = express.Router();
const SOURCE_LABELS = { weather: 'Météo', trello: 'Trello', calendar: 'Agenda', train: 'Train', homelab: 'Homelab', rss: 'Actus', birthdays: 'Anniversaires', tides: 'Marées', wallos: 'Wallos', ecowatt: 'Ecowatt' };

// Apercu : on garde le resultat 5 minutes pour ne pas solliciter les API a chaque rechargement
const previewCache = new Map();
const PREVIEW_TTL = 5 * 60 * 1000;
const clearPreviewCache = () => previewCache.clear();

const fmt = (iso, tz) => DateTime.fromISO(iso, { zone: tz }).setLocale('fr').toFormat('ccc d LLL HH:mm');

router.get('/', async (req, res) => {
  const settings = await getSettings();
  const tz = settings.schedule.timezone;
  const now = DateTime.now().setZone(tz);
  const next = scheduler.nextRun(settings);
  const todayTemplate = settings.schedule.days[now.weekday] || 'classique';
  const selected = TEMPLATES[req.query.template] ? req.query.template : todayTemplate;
  const history = (await prints.findAsync({}).sort({ number: -1 }).limit(15)).map((p) => ({
    id: p._id, number: p.number, when: fmt(p.createdAt, tz), templateName: p.templateName, trigger: p.trigger,
    status: p.status, attempts: p.attempts, error: p.error, warnings: p.warnings || [], reprints: p.reprints || 0,
  }));
  res.render('dashboard', {
    title: 'Tableau de bord',
    templates: TEMPLATES,
    selected,
    history,
    printerConfigured: !!settings.printer.host,
    printer: settings.printer,
    next: next ? { when: next.at.setLocale('fr').toFormat('cccc d LLLL \'à\' HH:mm'), template: TEMPLATES[next.templateId] ? TEMPLATES[next.templateId].name : next.templateId } : null,
    scheduleEnabled: settings.schedule.enabled,
  });
});

// Apercu du ticket avec les vraies donnees (JSON : { html, sources, lengthCm })
router.get('/preview', async (req, res) => {
  const settings = await getSettings();
  const id = TEMPLATES[req.query.template] ? req.query.template : 'classique';
  const cached = previewCache.get(id);
  if (cached && !req.query.refresh && Date.now() - cached.at < PREVIEW_TTL) return res.json(cached.body);
  const ticket = await job.generate(id, settings, await job.nextNumber());
  const body = {
    html: toHtml(ticket.lines, settings.printer.cols),
    lengthCm: lengthCm(ticket.lines),
    sources: Object.entries(ticket.sources).map(([name, s]) => ({ name: SOURCE_LABELS[name] || name, ok: s.ok, error: s.error || '' })),
    generatedAt: DateTime.now().setZone(settings.schedule.timezone).toFormat('HH:mm'),
  };
  previewCache.set(id, { at: Date.now(), body });
  res.json(body);
});

router.post('/print', async (req, res) => {
  const templateId = TEMPLATES[req.body.template] ? req.body.template : 'classique';
  const r = await job.runPrint({ templateId, trigger: 'manual', retry: false });
  if (r.ok) req.flash(r.warnings.length ? 'warning' : 'success', `Ticket #${r.number} imprimé.${r.warnings.length ? ` Attention : ${r.warnings.join(', ')}.` : ''}`);
  else req.flash('danger', `Échec de l'impression du ticket #${r.number} : ${r.error}.`);
  res.redirect(req.body.back === 'templates' ? '/templates' : '/');
});

router.post('/print/sample', async (req, res) => {
  const templateId = TEMPLATES[req.body.template] ? req.body.template : 'classique';
  try {
    const r = await job.printSample(templateId);
    req.flash(r.warnings.length ? 'warning' : 'success', `Exemple du modèle ${TEMPLATES[templateId].name} imprimé.${r.warnings.length ? ` Attention : ${r.warnings.join(', ')}.` : ''}`);
  } catch (e) {
    req.flash('danger', `Échec de l'impression de l'exemple : ${e.message}.`);
  }
  res.redirect('/templates');
});

router.get('/prints/:id', async (req, res) => {
  const doc = await prints.findOneAsync({ _id: req.params.id });
  if (!doc) return res.status(404).render('error', { title: 'Ticket introuvable', message: 'Ce ticket n\'est plus dans l\'historique.' });
  const settings = await getSettings();
  res.render('print', {
    title: `Ticket #${doc.number}`,
    doc: { id: doc._id, number: doc.number, when: fmt(doc.createdAt, settings.schedule.timezone), templateName: doc.templateName, status: doc.status, error: doc.error, attempts: doc.attempts },
    html: toHtml(doc.lines, doc.cols || settings.printer.cols),
    lengthCm: lengthCm(doc.lines),
  });
});

router.post('/prints/:id/reprint', async (req, res) => {
  try {
    const r = await job.reprint(req.params.id);
    req.flash(r.warnings.length ? 'warning' : 'success', `Ticket #${r.number} réimprimé.${r.warnings.length ? ` Attention : ${r.warnings.join(', ')}.` : ''}`);
  } catch (e) {
    req.flash('danger', `Échec de la réimpression : ${e.message}.`);
  }
  res.redirect(req.body.back === 'print' ? `/prints/${req.params.id}` : '/');
});

module.exports = router;
module.exports.clearPreviewCache = clearPreviewCache;
