'use strict';
// Marees via l'API marine d'Open-Meteo (gratuite, sans cle) : https://open-meteo.com/en/docs/marine-weather-api
// sea_level_height_msl = hauteur d'eau par rapport au niveau moyen de la mer, maree comprise.
// Valeurs horaires : les heures de pleine et basse mer sont interpolees (precision de l'ordre de 10 a 15 min).
const { http } = require('./http');

const API = 'https://marine-api.open-meteo.com/v1/marine';
// Point en mer d'Iroise, au large de Brest : sert a estimer le coefficient
const BREST = { latitude: 48.3, longitude: -4.65 };
// Marnage moyen de vive-eau a Brest qui correspond a un coefficient de 100
const BREST_UNIT_RANGE = 6.1;

async function fetchSeries(lat, lon, timezone) {
  const { data } = await http.get(API, {
    params: { latitude: lat, longitude: lon, hourly: 'sea_level_height_msl', timezone, forecast_days: 2 },
  });
  const t = data.hourly && data.hourly.time;
  const v = data.hourly && data.hourly.sea_level_height_msl;
  if (!t || !v || v.slice(0, 26).some((x) => x === null || x === undefined)) {
    throw new Error('pas de donnée de marée à ce point : choisis un point un peu plus au large');
  }
  return v.slice(0, 48); // 48 valeurs horaires a partir de minuit du jour
}

// Pleines et basses mers du jour [0 h ; 24 h[ par interpolation parabolique sur 3 points horaires
function extremes(values) {
  const out = [];
  for (let i = 1; i < values.length - 1; i++) {
    const [a, b, c] = [values[i - 1], values[i], values[i + 1]];
    const high = b >= a && b > c;
    const low = b <= a && b < c;
    if (!high && !low) continue;
    const denom = a - 2 * b + c;
    const offset = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
    const hour = i + offset;
    if (hour < 0 || hour >= 24) continue;
    out.push({ type: high ? 'PM' : 'BM', hour, height: b - 0.25 * (a - c) * offset });
  }
  return out;
}

// Plus grand ecart entre une pleine mer et la basse mer voisine
function range(ext) {
  let best = 0;
  for (let i = 1; i < ext.length; i++) {
    if (ext[i].type !== ext[i - 1].type) best = Math.max(best, Math.abs(ext[i].height - ext[i - 1].height));
  }
  return best;
}

const coefficient = (brestRange) => Math.max(20, Math.min(120, Math.round((brestRange / BREST_UNIT_RANGE) * 100)));

async function fetchTides(settings) {
  const t = settings.tides;
  const tz = settings.schedule.timezone;
  const [local, brest] = await Promise.all([
    fetchSeries(t.latitude, t.longitude, tz),
    t.showCoef ? fetchSeries(BREST.latitude, BREST.longitude, tz).catch(() => null) : null,
  ]);
  const ext = extremes(local);
  // la courbe : 25 points, de 0 h a 24 h inclus
  return {
    ok: true,
    place: t.place,
    extremes: ext,
    curve: local.slice(0, 25),
    coef: brest ? coefficient(range(extremes(brest))) : null,
  };
}

module.exports = { fetchTides, extremes, range, coefficient };
