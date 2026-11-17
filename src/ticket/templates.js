'use strict';
// Modeles de ticket. L'en-tete (logo + date) et le pied (heure + numero) sont toujours presents.

const BLOCKS = {
  weather: { label: 'Météo', source: 'weather' },
  weatherDetailed: { label: 'Météo détaillée (matin / après-midi / soir)', source: 'weather' },
  urgent: { label: 'Encart URGENT', source: 'trello' },
  urgentBig: { label: 'URGENT en gros caractères', source: 'trello' },
  agenda: { label: 'Agenda du jour', source: 'calendar' },
  agendaWeek: { label: 'Agenda de la semaine', source: 'calendar' },
  nextEvent: { label: 'Premier événement du jour en gros', source: 'calendar' },
  train: { label: 'Info trafic train (si mot-clé dans l\'agenda)', source: 'train' },
  todo: { label: 'Todo Trello', source: 'trello' },
  homelab: { label: 'Homelab', source: 'homelab' },
  rss: { label: 'Actus RSS', source: 'rss' },
  birthdays: { label: 'Anniversaires', source: 'birthdays' },
  payments: { label: 'Prélèvements du jour (Wallos)', source: 'wallos' },
  ecowatt: { label: 'Alerte Ecowatt (jours de tension)', source: 'ecowatt' },
  tides: { label: 'Marées', source: 'tides' },
  notes: { label: 'Remarques (lignes à écrire)', source: null },
};

const TEMPLATES = {
  classique: {
    name: 'Classique',
    description: 'Le briefing complet : météo, urgent, prélèvements, agenda, train, todo, homelab, actus, anniversaires, remarques.',
    blocks: ['weather', 'ecowatt', 'urgent', 'payments', 'agenda', 'train', 'todo', 'homelab', 'rss', 'birthdays', 'notes'],
    opts: {},
  },
  minimal: {
    name: 'Minimal',
    description: 'La date, 3 tâches maximum (urgentes en premier) et la zone de remarques. Ticket très court.',
    blocks: ['todo', 'notes'],
    opts: { logo: false, todoMax: 3, mergeUrgent: true },
  },
  focus: {
    name: 'Focus',
    description: 'Uniquement les tâches urgentes et le premier événement du jour, en gros caractères.',
    blocks: ['urgentBig', 'nextEvent', 'notes'],
    opts: {},
  },
  weekend: {
    name: 'Week-end',
    description: 'Météo détaillée, marées, agenda, anniversaires et actus. Pas de todo ni de homelab, plus de place pour écrire.',
    blocks: ['weatherDetailed', 'ecowatt', 'tides', 'agenda', 'train', 'birthdays', 'rss', 'notes'],
    opts: {},
  },
  lundi: {
    name: 'Lundi',
    description: 'Comme le classique, mais avec l\'agenda des 7 jours à venir et les prélèvements du week-end.',
    blocks: ['weather', 'ecowatt', 'urgent', 'payments', 'agendaWeek', 'train', 'todo', 'homelab', 'rss', 'birthdays', 'notes'],
    opts: {},
  },
  custom: {
    name: 'Personnalisé',
    description: 'Tes blocs, dans ton ordre (réglable plus bas sur cette page).',
    blocks: null, // lus dans les reglages
    opts: {},
  },
};

function resolve(templateId, settings) {
  const id = TEMPLATES[templateId] ? templateId : 'classique';
  const t = TEMPLATES[id];
  const blocks = id === 'custom'
    ? (settings.customTemplate.blocks || []).filter((b) => BLOCKS[b])
    : t.blocks;
  return { id, name: t.name, description: t.description, blocks, opts: t.opts };
}

// Quelles sources de donnees ce modele utilise-t-il ?
function sourcesFor(blocks) {
  const set = new Set(blocks.map((b) => BLOCKS[b].source).filter(Boolean));
  if (set.has('train')) set.add('calendar'); // l'encart train depend du mot-cle dans l'agenda
  return set;
}

module.exports = { BLOCKS, TEMPLATES, resolve, sourcesFor };
