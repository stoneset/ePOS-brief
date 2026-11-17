'use strict';
// Meteo via Open-Meteo (gratuit, sans cle) : https://open-meteo.com/en/docs
const { DateTime } = require('luxon');
const { http } = require('./http');

// Codes meteo OMM (Organisation meteorologique mondiale) renvoyes par Open-Meteo
const WMO = {
  0: 'Soleil', 1: 'Peu nuageux', 2: 'Eclaircies', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine', 53: 'Bruine', 55: 'Forte bruine', 56: 'Bruine verglaçante', 57: 'Bruine verglaçante',
  61: 'Pluie faible', 63: 'Pluie', 65: 'Forte pluie', 66: 'Pluie verglaçante', 67: 'Pluie verglaçante',
  71: 'Neige faible', 73: 'Neige', 75: 'Forte neige', 77: 'Neige en grains',
  80: 'Averses', 81: 'Averses', 82: 'Fortes averses', 85: 'Averses de neige', 86: 'Averses de neige',
  95: 'Orage', 96: 'Orage et grêle', 99: 'Orage et grêle',
};
const label = (code) => WMO[code] || 'Variable';
const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];

// Plage horaire la plus pluvieuse du reste de la journee (probabilite >= 50 %), ex. "14h-18h"
function rainWindow(probs, fromHour = 0) {
  let best = null;
  let cur = null;
  probs.forEach((p, h) => {
    if (h >= fromHour && p >= 50) {
      cur = cur || { start: h, end: h, max: 0 };
      cur.end = h;
      cur.max = Math.max(cur.max, p);
      if (!best || cur.max > best.max) best = cur;
    } else cur = null;
  });
  return best ? `${best.start}h-${best.end + 1}h` : null;
}

function parse(json, city, now) {
  const d = json.daily;
  const h = json.hourly;
  const hourIndex = (hour) => h.time.findIndex((t) => t.endsWith(`T${String(hour).padStart(2, '0')}:00`));
  const part = (name, hour) => {
    const i = hourIndex(hour);
    return i < 0 ? null : { name, temp: Math.round(h.temperature_2m[i]), label: label(h.weather_code[i]) };
  };
  const iNow = hourIndex(now.hour);
  const temp = json.current ? json.current.temperature_2m : h.temperature_2m[Math.max(0, iNow)];
  return {
    ok: true,
    city,
    temp: Math.round(temp),
    label: label(d.weather_code[0]),
    min: Math.round(d.temperature_2m_min[0]),
    max: Math.round(d.temperature_2m_max[0]),
    wind: Math.round(d.wind_speed_10m_max[0]),
    windDir: compass(d.wind_direction_10m_dominant[0]),
    rainPct: Math.round(d.precipitation_probability_max[0] ?? 0),
    rainWindow: rainWindow(h.precipitation_probability.slice(0, 24).map((p) => p ?? 0), now.hour),
    sunrise: d.sunrise[0].slice(11, 16),
    sunset: d.sunset[0].slice(11, 16),
    parts: [part('Matin', 9), part('Après-midi', 15), part('Soir', 20)].filter(Boolean),
  };
}

async function fetchWeather(settings, now) {
  const w = settings.weather;
  const { data } = await http.get('https://api.open-meteo.com/v1/forecast', {
    params: {
      latitude: w.latitude,
      longitude: w.longitude,
      current: 'temperature_2m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant',
      hourly: 'temperature_2m,weather_code,precipitation_probability',
      timezone: settings.schedule.timezone,
      forecast_days: 1,
    },
  });
  return parse(data, w.city, now || DateTime.now().setZone(settings.schedule.timezone));
}

// Recherche de ville pour les reglages
async function searchCity(q) {
  const { data } = await http.get('https://geocoding-api.open-meteo.com/v1/search', {
    params: { name: q, count: 8, language: 'fr', format: 'json' },
  });
  return (data.results || []).map((r) => ({
    name: r.name,
    detail: [r.admin2, r.admin1, r.country].filter(Boolean).join(', '),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

module.exports = { fetchWeather, searchCity, parse, rainWindow };
