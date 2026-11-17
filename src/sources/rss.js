'use strict';
// Titres d'actualite depuis des flux RSS/Atom.
const Parser = require('rss-parser');
const { explain } = require('./http');

const parser = new Parser({ timeout: 10000, headers: { 'User-Agent': 'ePOS-Brief/1.0' } });

// Repartit les titres entre les flux : 1er de chaque flux, puis 2e de chaque flux, etc.
function pick(perFeed, max) {
  const out = [];
  const seen = new Set();
  for (let i = 0; out.length < max && perFeed.some((f) => f.length > i); i++) {
    for (const feed of perFeed) {
      const it = feed[i];
      if (!it || out.length >= max) continue;
      const key = it.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

async function fetchRss(settings) {
  const feeds = (settings.rss.feeds || []).filter((f) => f.url);
  const errors = [];
  const perFeed = await Promise.all(feeds.map(async (f) => {
    try {
      const feed = await parser.parseURL(f.url);
      return (feed.items || [])
        .filter((it) => it.title)
        .sort((a, b) => new Date(b.isoDate || 0) - new Date(a.isoDate || 0))
        .slice(0, settings.rss.max)
        .map((it) => ({ title: String(it.title).trim(), source: f.name || feed.title || '' }));
    } catch (e) {
      errors.push(`${f.name || f.url} : ${explain(e)}`);
      return [];
    }
  }));
  if (feeds.length && errors.length === feeds.length) return { ok: false, error: errors[0] };
  return { ok: true, items: pick(perFeed, settings.rss.max), errors };
}

module.exports = { fetchRss, pick };
