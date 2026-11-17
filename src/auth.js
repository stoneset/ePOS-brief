'use strict';
// Compte unique : cree au premier lancement, mot de passe hache avec bcrypt.
const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { users } = require('./db');

const router = express.Router();
const MIN_PASSWORD = 8;
const DUMMY_HASH = bcrypt.hashSync('epos-brief', 12); // compare quand l'identifiant n'existe pas

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10, // 10 essais par quart d'heure et par adresse IP
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).render('login', { title: 'Connexion', error: 'Trop de tentatives. Réessaie dans 15 minutes.' }),
});

const hasUser = async () => (await users.countAsync({})) > 0;

router.get('/setup', async (req, res) => {
  if (await hasUser()) return res.redirect('/login');
  res.render('setup', { title: 'Premier lancement', error: null, username: 'admin' });
});

router.post('/setup', async (req, res) => {
  if (await hasUser()) return res.redirect('/login');
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  let error = null;
  if (!username) error = 'Choisis un identifiant.';
  else if (password.length < MIN_PASSWORD) error = `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`;
  else if (password !== req.body.confirm) error = 'Les deux mots de passe sont différents.';
  if (error) return res.status(400).render('setup', { title: 'Premier lancement', error, username });
  await users.insertAsync({ username, hash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() });
  req.session.user = username;
  req.flash('success', 'Compte créé. Commence par renseigner l\'adresse IP de l\'imprimante.');
  res.redirect('/settings');
});

router.get('/login', async (req, res) => {
  if (!(await hasUser())) return res.redirect('/setup');
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Connexion', error: null });
});

router.post('/login', loginLimiter, async (req, res) => {
  const user = await users.findOneAsync({ username: String(req.body.username || '').trim() });
  // On compare toujours un hache, meme si l'identifiant n'existe pas (temps de reponse constant)
  const hash = user ? user.hash : DUMMY_HASH;
  const ok = await bcrypt.compare(String(req.body.password || ''), hash).catch(() => false);
  if (!user || !ok) return res.status(401).render('login', { title: 'Connexion', error: 'Identifiant ou mot de passe incorrect.' });
  req.session.user = user.username;
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

async function requireAuth(req, res, next) {
  if (req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, message: 'Non connecté' });
  res.redirect((await hasUser()) ? '/login' : '/setup');
}

async function changePassword(username, current, next) {
  const user = await users.findOneAsync({ username });
  if (!user || !(await bcrypt.compare(String(current || ''), user.hash))) return 'Mot de passe actuel incorrect.';
  if (String(next || '').length < MIN_PASSWORD) return `Le nouveau mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`;
  await users.updateAsync({ _id: user._id }, { $set: { hash: await bcrypt.hash(next, 12) } });
  return null;
}

module.exports = { router, requireAuth, changePassword };
