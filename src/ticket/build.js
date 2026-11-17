'use strict';
// Compose le ticket (liste de lignes) a partir des donnees collectees et du modele choisi.
const { DateTime } = require('luxon');
const { clean, cleanKeep, wrapMax, L, blank, rule, kv, item, section, frame } = require('./layout');
const { resolve } = require('./templates');
const { drawTide, hourAxis } = require('./tidechart');
const { holidayName, dstChange } = require('./calendar-fr');

const up = (s) => clean(s).toUpperCase();
const unavailable = (d) => L(`(indisponible : ${clean(d.error || 'erreur').slice(0, 60)})`);

// ---------- agenda : evenements d'un jour donne ----------
function eventsOn(events, day, tz) {
  const dayStart = day.startOf('day');
  const dayEnd = dayStart.plus({ days: 1 });
  const iso = dayStart.toISODate();
  const out = [];
  for (const e of events || []) {
    if (e.allDay) {
      if (e.startDay <= iso && iso <= e.lastDay) out.push({ title: e.title, allDay: true, sort: 0 });
      continue;
    }
    const start = DateTime.fromISO(e.start, { zone: tz });
    const end = e.end ? DateTime.fromISO(e.end, { zone: tz }) : start;
    const inDay = start < dayEnd && (end > dayStart || +start === +end && start >= dayStart);
    if (!inDay) continue;
    if (start < dayStart) out.push({ title: e.title, allDay: true, sort: 0 }); // commence la veille : couvre la journee
    else out.push({ title: e.title, allDay: false, time: start.toFormat('HH:mm'), sort: start.toMillis() });
  }
  return out.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
}

const eventLines = (ev, cols) => item(ev.allDay ? 'jour   ' : `${ev.time}  `, ev.title, cols);

// ---------- blocs ----------
const blocks = {
  weather({ data, cols }, detailed = false) {
    const w = data.weather;
    if (!w) return [];
    if (!w.ok) return [L(`Météo indisponible`)];
    const out = [
      kv(up(w.city), `${w.temp}°C  ${w.label}`, cols, { bold: true }),
      kv(`Min ${w.min}° / Max ${w.max}°`, `Vent ${w.windDir} ${w.wind} km/h`, cols),
      kv(`Pluie ${w.rainPct}%${w.rainWindow ? ` (${w.rainWindow})` : ''}`, `Lever ${w.sunrise}`, cols),
    ];
    if (detailed) {
      for (const p of w.parts || []) out.push(kv(`  ${p.name}`, `${p.temp}°C  ${p.label}`, cols));
      out.push(kv('', `Coucher ${w.sunset}`, cols));
    }
    return out;
  },
  weatherDetailed(ctx) { return blocks.weather(ctx, true); },

  urgent({ data, cols }) {
    const t = data.trello;
    if (!t || !t.ok) return [];
    const cards = t.cards.filter((c) => c.urgent);
    if (!cards.length) return [];
    const half = Math.floor(cols / 2);
    const title = half >= 14 ? '!!! URGENT !!!' : 'URGENT';
    const pad = Math.max(0, half - title.length);
    const bar = ' '.repeat(Math.floor(pad / 2)) + title + ' '.repeat(Math.ceil(pad / 2));
    const out = [blank(), { spans: [{ text: bar, bold: true, invert: true }], align: 'left', size: 'big' }];
    const inner = cols - 4;
    for (const c of cards) {
      wrapMax(c.name, inner - 4, 3).forEach((txt, i) => {
        out.push({
          spans: [
            { text: '# ', bold: false, invert: false },
            { text: ((i === 0 ? '[ ] ' : '    ') + txt).padEnd(inner), bold: true, invert: false },
            { text: ' #', bold: false, invert: false },
          ],
          align: 'left', size: 'normal',
        });
      });
    }
    out.push(L('#'.repeat(cols)));
    return out;
  },

  urgentBig({ data, cols }) {
    const t = data.trello;
    if (!t) return [];
    const half = Math.floor(cols / 2);
    const out = [blank(), L('URGENT', { size: 'big', bold: true, invert: true, align: 'center' })];
    if (!t.ok) return [...out, unavailable(t)];
    const cards = t.cards.filter((c) => c.urgent);
    if (!cards.length) return [...out, L('Rien d\'urgent aujourd\'hui', { align: 'center' })];
    for (const c of cards) {
      out.push(blank());
      wrapMax(c.name, half - 4, 4).forEach((txt, i) => out.push(L((i === 0 ? '[ ] ' : '    ') + txt, { size: 'big', bold: true })));
    }
    return out;
  },

  agenda({ data, cols, now, tz, settings }) {
    const c = data.calendar;
    if (!c) return [];
    const out = section('AGENDA');
    if (!c.ok) return [...out, unavailable(c)];
    const evs = eventsOn(c.events, now, tz);
    if (!evs.length) return [...out, L('Rien de prévu')];
    const max = settings.calendar.max;
    evs.slice(0, max).forEach((ev) => out.push(...eventLines(ev, cols)));
    if (evs.length > max) out.push(L(`+ ${evs.length - max} autre(s)`));
    if (c.errors && c.errors.length) out.push(L(`(${c.errors.length} calendrier(s) injoignable(s))`));
    return out;
  },

  agendaWeek({ data, cols, now, tz, settings }) {
    const c = data.calendar;
    if (!c) return [];
    const out = section('AGENDA DE LA SEMAINE');
    if (!c.ok) return [...out, unavailable(c)];
    let total = 0;
    for (let d = 0; d < 7; d++) {
      const day = now.startOf('day').plus({ days: d });
      const evs = eventsOn(c.events, day, tz).slice(0, settings.calendar.max);
      if (!evs.length) continue;
      total += evs.length;
      out.push(L(up(day.setLocale('fr').toFormat('cccc d LLLL')) + (d === 0 ? ' (aujourd\'hui)' : ''), { bold: true }));
      evs.forEach((ev) => out.push(...eventLines(ev, cols)));
    }
    if (!total) out.push(L('Rien de prévu cette semaine'));
    if (c.errors && c.errors.length) out.push(L(`(${c.errors.length} calendrier(s) injoignable(s))`));
    return out;
  },

  nextEvent({ data, cols, now, tz }) {
    const c = data.calendar;
    if (!c) return [];
    const half = Math.floor(cols / 2);
    const out = [blank(), L('PREMIER RDV', { size: 'big', bold: true, invert: true, align: 'center' }), blank()];
    if (!c.ok) return [...out, unavailable(c)];
    const evs = eventsOn(c.events, now, tz);
    const ev = evs.find((e) => !e.allDay) || evs[0];
    if (!ev) return [...out, L('Rien de prévu', { align: 'center' })];
    out.push(L(ev.allDay ? 'Journée' : ev.time, { size: 'big', bold: true, align: 'center' }));
    wrapMax(ev.title, half, 3).forEach((txt) => out.push(L(txt, { size: 'big', align: 'center' })));
    return out;
  },

  // N'apparait que si un evenement du jour contient le mot-cle (decide dans collect.js)
  train({ data, cols }) {
    const t = data.train;
    if (!t) return [];
    const inner = cols - 4;
    const rows = [{ text: `TRAIN  ${t.from} > ${t.to}`, bold: true }];
    if (!t.ok) rows.push({ text: 'Info trafic indisponible' });
    else if (!t.disruptions.length) rows.push({ text: 'Aucune perturbation signalée' }, { text: 'pour le moment' });
    else {
      for (const d of t.disruptions.slice(0, 4)) {
        rows.push({ text: d.label + (d.train ? `  ${d.train}` : ''), bold: true });
        if (d.detail) rows.push({ text: d.detail });
        if (d.message) wrapMax(d.message, inner, 3).forEach((text) => rows.push({ text }));
      }
      if (t.disruptions.length > 4) rows.push({ text: `+ ${t.disruptions.length - 4} autre(s) perturbation(s)` });
    }
    return [blank(), ...frame(rows, cols)];
  },

  todo({ data, cols, settings, opts }) {
    const t = data.trello;
    if (!t) return [];
    const out = section('TODO');
    if (!t.ok) return [...out, unavailable(t)];
    const cards = opts.mergeUrgent
      ? [...t.cards.filter((c) => c.urgent), ...t.cards.filter((c) => !c.urgent)]
      : t.cards.filter((c) => !c.urgent);
    if (!cards.length) return [...out, L('Liste vide')];
    const max = opts.todoMax || settings.trello.max;
    for (const c of cards.slice(0, max)) {
      out.push(...item('[ ] ', (opts.mergeUrgent && c.urgent ? '! ' : '') + c.name, cols, { bold: opts.mergeUrgent && c.urgent }));
    }
    if (cards.length > max) out.push(L(`+ ${cards.length - max} autre(s) sur Trello`));
    return out;
  },

  homelab({ data, cols }) {
    const h = data.homelab;
    if (!h) return [];
    const out = section('HOMELAB');
    if (!h.ok) return [...out, unavailable(h)];
    if (h.kuma) {
      if (h.kuma.error) out.push(L(`Uptime Kuma indisponible`));
      else {
        out.push(kv('Services', `${h.kuma.up}/${h.kuma.total} UP`, cols, { bold: h.kuma.down.length > 0 }));
        h.kuma.down.slice(0, 6).forEach((n) => out.push(...item('  DOWN : ', n, cols, { bold: true, maxLines: 1 })));
        if (h.kuma.down.length > 6) out.push(L(`  + ${h.kuma.down.length - 6} autre(s)`));
      }
    }
    if (h.prometheus) {
      if (h.prometheus.error) out.push(L('Prometheus indisponible'));
      else {
        const a = h.prometheus.alerts;
        out.push(kv('Alertes critiques', a.length ? String(a.length) : 'aucune', cols, { bold: a.length > 0 }));
        a.slice(0, 6).forEach((x) => out.push(...item('  ! ', x.text, cols, { bold: true })));
        if (a.length > 6) out.push(L(`  + ${a.length - 6} autre(s)`));
      }
    }
    return out;
  },

  rss({ data, cols }) {
    const r = data.rss;
    if (!r) return [];
    const out = section('ACTUS');
    if (!r.ok) return [...out, unavailable(r)];
    if (!r.items.length) return [...out, L('Pas d\'actu')];
    r.items.forEach((it) => out.push(...item('- ', it.title, cols)));
    return out;
  },

  ecowatt({ data, cols }) {
    const e = data.ecowatt;
    if (!e || !e.ok || !e.alerts.length) return []; // rien a signaler les jours normaux
    const inner = cols - 4;
    const rows = [];
    for (const a of e.alerts) {
      rows.push({ text: `ECOWATT ${a.level >= 3 ? 'ROUGE' : 'ORANGE'} ${a.when === 'today' ? 'AUJOURD\'HUI' : 'DEMAIN'}`, bold: true });
      if (a.hours) wrapMax(`Heures tendues : ${a.hours}`, inner, 2).forEach((text) => rows.push({ text }));
      rows.push({ text: a.level >= 3 ? 'Coupures possibles : réduis ta conso' : 'Modère ta consommation' });
    }
    return [blank(), ...frame(rows, cols, { h: '!', v: '!', c: '!' })];
  },

  payments({ data, cols, now }) {
    const w = data.wallos;
    if (!w) return [];
    if (!w.ok) return [...section('PRELEVEMENTS'), unavailable(w)];
    if (!w.payments.length) return [];
    const out = section(now.weekday === 1 ? 'PRELEVEMENTS DU WEEK-END' : 'PRELEVEMENTS');
    const money = (v) => `${v.toFixed(2).replace('.', ',')} ${w.currency}`.trim();
    const multiDay = new Set(w.payments.map((p) => p.day)).size > 1;
    for (const p of w.payments) {
      const day = multiDay ? `${up(DateTime.fromISO(p.day).setLocale('fr').toFormat('ccc')).replace('.', '')} ` : '';
      out.push(kv(day + p.name, money(p.price), cols));
    }
    if (w.payments.length > 1) out.push(kv('Total', money(w.payments.reduce((sum, p) => sum + p.price, 0)), cols, { bold: true }));
    return out;
  },

  tides({ data, cols, settings }) {
    const t = data.tides;
    if (!t) return [];
    const head = (right) => {
      const left = [{ text: ' MAREES ', bold: true, invert: true }, { text: ` ${clean(t.place)}`, bold: true, invert: false }];
      const used = left.reduce((n, s) => n + s.text.length, 0);
      const r = right && used + 1 + right.length <= cols ? right : '';
      return { spans: [...left, { text: r ? ' '.repeat(cols - used - r.length) + r : '', bold: false, invert: false }], align: 'left', size: 'normal' };
    };
    if (!t.ok) return [blank(), head(''), unavailable(t)];
    const out = [blank(), head(t.coef ? `coef. env. ${t.coef}` : '')];
    const hm = (h) => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
    const meters = (v) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1).replace('.', ',')} m`;
    const cells = t.extremes.map((e) => `${e.type} ${hm(e.hour)}  ${meters(e.height)}`);
    const half = Math.floor(cols / 2);
    for (let i = 0; i < cells.length; i += 2) out.push(L(cells[i].padEnd(half) + (cells[i + 1] || '')));
    if (settings.tides.display !== 'text' && t.curve && t.curve.length >= 25) {
      out.push({ image: drawTide(t.curve, t.extremes, cols), align: 'left', size: 'normal', spans: [] });
      out.push(L(hourAxis(cols)));
    }
    return out;
  },

  birthdays({ data }) {
    const b = data.birthdays;
    if (!b || !b.ok || !b.people.length) return [];
    const out = section('ANNIVERSAIRES');
    b.people.forEach((p) => out.push(L(`* ${clean(p.name)}${p.age ? ` (${p.age} ans)` : ''}`)));
    return out;
  },

  notes({ cols, settings, templateId }) {
    const n = notesLines(settings, templateId);
    if (!n) return [];
    const out = [blank(), rule(cols), L('REMARQUES', { bold: true })];
    for (let i = 0; i < n; i++) out.push(blank(), L('_'.repeat(cols)));
    return out;
  },
};

// Lignes de remarques du modele (ancien format : un seul nombre pour tous les modeles)
function notesLines(settings, templateId) {
  const v = settings.notes.lines;
  const n = typeof v === 'object' && v !== null ? v[templateId] : v;
  return Number.isFinite(Number(n)) ? Math.max(0, Math.min(20, Number(n))) : 5;
}

// ---------- en-tete et pied ----------
function logoLines(settings, cols) {
  const raw = String(settings.logo.text || '').split('\n').map((l) => cleanKeep(l).replace(/\s+$/, ''));
  const lines = raw.filter((l, i) => l.length || (i > 0 && i < raw.length - 1));
  if (!lines.length) return [];
  const half = Math.floor(cols / 2);
  const block = (ls, width, size) => {
    const w = Math.min(width, Math.max(...ls.map((l) => l.length)));
    const pad = ' '.repeat(Math.max(0, Math.floor((width - w) / 2)));
    return ls.map((l) => L(pad + l.slice(0, width), { bold: true, size }));
  };
  if (!settings.logo.doubleWidth) return block(lines, cols, 'normal');
  // Double largeur : les lignes assez courtes sont doublees, les autres sont centrees en taille normale
  const out = [];
  let group = [];
  const flush = () => { if (group.length) { out.push(...block(group, half, 'wide')); group = []; } };
  for (const l of lines) {
    if (l.length <= half) group.push(l);
    else { flush(); out.push(L(l.trim().slice(0, cols), { bold: true, align: 'center' })); }
  }
  flush();
  return out;
}

function header({ settings, cols, now, opts }) {
  const out = [];
  if (opts.logo !== false) out.push(...logoLines(settings, cols), blank());
  const fr = now.setLocale('fr');
  const date = up(fr.toFormat('cccc d LLLL'));
  // En gros si ca tient sur la demi-largeur, sinon en taille normale (papier etroit)
  out.push(L(date, { size: date.length <= Math.floor(cols / 2) ? 'big' : 'normal', bold: true, align: 'center' }));
  out.push(L(`Semaine ${now.weekNumber} - Jour ${now.ordinal}/${now.daysInYear}`, { align: 'center' }));
  const ferie = holidayName(now);
  if (ferie) out.push(L(`Jour férié : ${ferie}`, { align: 'center', bold: true }));
  const dst = dstChange(now);
  if (dst && dst.when === 'tonight') {
    out.push(L(dst.hours < 0 ? 'Cette nuit : on recule d\'1 h (3h -> 2h)' : 'Cette nuit : on avance d\'1 h (2h -> 3h)', { align: 'center', bold: true }));
  } else if (dst) {
    out.push(L(`Heure ${dst.hours < 0 ? 'd\'hiver' : 'd\'été'} depuis cette nuit`, { align: 'center', bold: true }));
  }
  out.push(rule(cols));
  return out;
}

function footer({ cols, now, number }) {
  return [blank(), rule(cols), L(`Imprimé ${now.toFormat('HH:mm')} - #${String(number).padStart(4, '0')}`, { align: 'center' })];
}

// data : resultat de collect() ; meta : { now: DateTime, number }
function build(templateId, data, settings, meta) {
  const tpl = resolve(templateId, settings);
  const cols = settings.printer.cols;
  const tz = settings.schedule.timezone;
  const ctx = { data, settings, cols, tz, now: meta.now, number: meta.number, opts: tpl.opts, templateId: tpl.id };
  const lines = [...header(ctx)];
  for (const b of tpl.blocks) lines.push(...blocks[b](ctx));
  lines.push(...footer(ctx));
  return lines;
}

module.exports = { build, eventsOn, notesLines };
