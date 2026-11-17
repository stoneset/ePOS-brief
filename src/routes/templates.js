'use strict';
const express = require('express');
const { getSettings, saveSettings, LOGO } = require('../db');
const { TEMPLATES, BLOCKS } = require('../ticket/templates');
const { build, notesLines } = require('../ticket/build');
const { toHtml, lengthCm } = require('../ticket/render');
const { sampleData, sampleNow } = require('../ticket/sample');
const { clearPreviewCache } = require('./dashboard');

const router = express.Router();

router.get('/templates', async (req, res) => {
  const s = await getSettings();
  const now = sampleNow(s.schedule.timezone);
  const data = sampleData(now);
  const cards = Object.entries(TEMPLATES).map(([id, t]) => {
    const lines = build(id, data, s, { now, number: 142 });
    return { id, name: t.name, description: t.description, html: toHtml(lines, s.printer.cols), lengthCm: lengthCm(lines) };
  });
  const order = s.customTemplate.blocks;
  const blocks = Object.entries(BLOCKS)
    .map(([id, b]) => ({ id, label: b.label, enabled: order.includes(id), position: order.includes(id) ? order.indexOf(id) + 1 : '' }))
    .sort((a, b) => (a.position || 99) - (b.position || 99));
  const notes = Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name, lines: notesLines(s, id) }));
  res.render('templates', { title: 'Modèles', cards, blocks, s, notes, defaultLogo: LOGO });
});

// Modele personnalise : blocs coches, tries par numero d'ordre
router.post('/templates/custom', async (req, res) => {
  const b = req.body || {};
  const checked = new Set(Array.isArray(b.block) ? b.block : b.block ? [b.block] : []);
  const blocks = Object.keys(BLOCKS)
    .filter((id) => checked.has(id))
    .map((id, i) => ({ id, pos: parseInt(b[`pos_${id}`], 10) || 100 + i }))
    .sort((x, y) => x.pos - y.pos)
    .map((x) => x.id);
  // Remplacement complet de la liste (les tableaux ne sont pas fusionnes)
  await saveSettings({ customTemplate: { blocks } });
  clearPreviewCache();
  req.flash('success', 'Modèle personnalisé enregistré.');
  res.redirect('/templates#custom');
});

router.post('/templates/appearance', async (req, res) => {
  const b = req.body || {};
  const text = String(b.logo ?? '').replace(/\r\n/g, '\n').split('\n').slice(0, 12).map((l) => l.slice(0, 64)).join('\n');
  const lines = {};
  for (const id of Object.keys(TEMPLATES)) {
    const n = parseInt(b[`notes_${id}`], 10);
    lines[id] = Number.isFinite(n) ? Math.min(20, Math.max(0, n)) : 5;
  }
  await saveSettings({
    logo: { text: b.reset ? LOGO : text, doubleWidth: b.doubleWidth === 'on' },
    notes: { lines },
  });
  clearPreviewCache();
  req.flash('success', 'Apparence enregistrée.');
  res.redirect('/templates#appearance');
});

module.exports = router;
