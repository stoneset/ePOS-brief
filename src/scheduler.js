'use strict';
// Impression quotidienne planifiee avec node-cron.
const cron = require('node-cron');
const { DateTime } = require('luxon');
const { getSettings } = require('./db');
const { runPrint } = require('./job');
const { holidayName } = require('./ticket/calendar-fr');
const { TEMPLATES } = require('./ticket/templates');

// Modele a imprimer ce jour-la ('' = pas d'impression)
function templateFor(settings, day) {
  const usual = settings.schedule.days[day.weekday] || '';
  const rule = settings.schedule.holiday;
  if (!rule || !holidayName(day)) return usual;
  if (rule === 'skip') return '';
  return TEMPLATES[rule] ? rule : usual;
}

let task = null;

const parseTime = (time) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  return m ? { hour: Math.min(23, Number(m[1])), minute: Math.min(59, Number(m[2])) } : { hour: 6, minute: 30 };
};

async function tick() {
  const settings = await getSettings();
  const now = DateTime.now().setZone(settings.schedule.timezone);
  const templateId = templateFor(settings, now);
  if (!templateId) return; // pas d'impression ce jour-la
  try {
    const r = await runPrint({ templateId, trigger: 'schedule', retry: true });
    console.log(`[schedule] ticket #${r.number} : ${r.ok ? 'imprimé' : `échec (${r.error})`}`);
  } catch (e) {
    console.error(`[schedule] ${e.stack || e}`);
  }
}

function stop() {
  if (task) { task.destroy(); task = null; }
}

function start(settings) {
  stop();
  if (!settings.schedule.enabled) return;
  const { hour, minute } = parseTime(settings.schedule.time);
  task = cron.schedule(`${minute} ${hour} * * *`, tick, { timezone: settings.schedule.timezone });
}

// Prochaine impression prevue (DateTime) et son modele, ou null
function nextRun(settings, from) {
  if (!settings.schedule.enabled) return null;
  const { hour, minute } = parseTime(settings.schedule.time);
  const now = from || DateTime.now().setZone(settings.schedule.timezone);
  for (let d = 0; d < 8; d++) {
    const at = now.startOf('day').plus({ days: d }).set({ hour, minute });
    const templateId = templateFor(settings, at);
    if (at > now && templateId) return { at, templateId };
  }
  return null;
}

module.exports = { start, stop, nextRun, tick, parseTime, templateFor };
