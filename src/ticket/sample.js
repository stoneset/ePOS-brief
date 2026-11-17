'use strict';
// Donnees d'exemple pour les apercus de modeles (aucun appel reseau).
const { DateTime } = require('luxon');
const { extremes } = require('../sources/tides');

// Maree simulee : onde semi-diurne de 12 h 25 et un peu d'inegalite diurne
const tideSeries = Array.from({ length: 48 }, (_, h) => 2.9 * Math.cos((2 * Math.PI * (h - 6.2)) / 12.42) + 0.25 * Math.cos((2 * Math.PI * (h - 3)) / 12));

function sampleData(now) {
  const d = (h, m = 0) => now.startOf('day').set({ hour: h, minute: m }).toISO();
  const day = (offset) => now.startOf('day').plus({ days: offset });
  return {
    weather: {
      ok: true, city: 'Lannion', temp: 8, label: 'Averses', min: 4, max: 11, wind: 35, windDir: 'SO',
      rainPct: 70, rainWindow: '14h-18h', sunrise: '08:21', sunset: '17:29',
      parts: [
        { name: 'Matin', temp: 6, label: 'Nuageux' },
        { name: 'Après-midi', temp: 11, label: 'Averses' },
        { name: 'Soir', temp: 8, label: 'Couvert' },
      ],
    },
    trello: {
      ok: true,
      cards: [
        { name: 'Renvoyer le contrat signé', urgent: true },
        { name: 'Payer la facture d\'hébergement', urgent: true },
        { name: 'Commander des rouleaux de papier 80 mm', urgent: false },
        { name: 'Relire le chapitre 2 de l\'état de l\'art', urgent: false },
        { name: 'Mettre à jour Proxmox', urgent: false },
        { name: 'Appeler le garage', urgent: false },
        { name: 'Sauvegarde hors-site du NAS', urgent: false },
      ],
    },
    calendar: {
      ok: true, errors: [],
      events: [
        { title: 'Point d\'avancement', allDay: false, start: d(9), end: d(10) },
        { title: 'Train Lannion > Paris', allDay: false, start: d(11, 45), end: d(15, 30) },
        { title: 'Réunion (visio)', allDay: false, start: d(14), end: d(15) },
        { title: 'Répétition orchestre', allDay: false, start: d(19, 30), end: d(21, 30) },
        { title: 'Rendez-vous garage', allDay: false, start: day(2).set({ hour: 8, minute: 30 }).toISO(), end: day(2).set({ hour: 9 }).toISO() },
        { title: 'Week-end en famille', allDay: true, startDay: day(4).toISODate(), lastDay: day(5).toISODate() },
      ],
    },
    train: { ok: true, from: 'Lannion', to: 'Plouaret-Trégor', disruptions: [] },
    homelab: {
      ok: true,
      kuma: { up: 23, total: 24, down: ['nextcloud'] },
      prometheus: { alerts: [{ text: 'Disque presque plein sur truenas (92 %)' }] },
    },
    rss: {
      ok: true,
      items: [
        { title: 'Premier titre d\'actualité, assez long pour tenir sur deux lignes du ticket' },
        { title: 'Deuxième titre du flux RSS' },
        { title: 'Troisième titre du flux RSS' },
        { title: 'Quatrième titre du flux RSS' },
      ],
    },
    birthdays: { ok: true, people: [{ name: 'Prénom Nom', age: 28 }] },
    tides: { ok: true, place: 'Trébeurden', extremes: extremes(tideSeries), curve: tideSeries.slice(0, 25), coef: 85 },
    ecowatt: { ok: true, alerts: [{ when: 'today', level: 2, hours: '8h-13h, 18h-20h' }] },
    wallos: { ok: true, currency: '€', payments: [{ name: 'Forfait mobile', price: 19.99, day: now.toISODate() }, { name: 'Hébergement serveur', price: 6, day: now.toISODate() }] },
  };
}

const sampleNow = (tz) => DateTime.now().setZone(tz).set({ hour: 6, minute: 30 });

module.exports = { sampleData, sampleNow };
