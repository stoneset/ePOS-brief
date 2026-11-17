'use strict';
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const { getSettings, users } = require('./db');
const scheduler = require('./scheduler');
const auth = require('./auth');

async function createApp() {
  const settings = await getSettings();
  process.env.TZ = settings.schedule.timezone; // les dates "journee entiere" des agendas en dependent

  const app = express();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.use('/static', express.static(path.join(__dirname, 'public')));
  app.use('/vendor/bootstrap', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist')));
  app.use(express.urlencoded({ extended: true, limit: '200kb' }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieSession({
    name: 'eposbrief',
    keys: [settings.sessionSecret],
    maxAge: 30 * 24 * 3600 * 1000,
    sameSite: 'lax', // le cookie n'accompagne pas les formulaires postes depuis un autre site
    httpOnly: true,
  }));

  // Message "flash" affiche une fois apres une redirection
  app.use((req, res, next) => {
    res.locals.flash = req.session.flash || null;
    res.locals.currentUser = req.session.user || null;
    res.locals.path = req.path;
    delete req.session.flash;
    req.flash = (type, text) => { req.session.flash = { type, text }; };
    next();
  });

  app.use(auth.router);
  app.use(auth.requireAuth);
  app.use(require('./routes/dashboard'));
  app.use(require('./routes/settings'));
  app.use(require('./routes/templates'));
  app.use('/api', require('./routes/api'));

  app.use((req, res) => res.status(404).render('error', { title: 'Page introuvable', message: 'Cette page n\'existe pas.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err.stack || err);
    if (req.path.startsWith('/api/')) return res.status(500).json({ ok: false, message: 'Erreur interne' });
    res.status(500).render('error', { title: 'Erreur', message: 'Une erreur interne est survenue. Détail dans les logs (pm2 logs epos-brief).' });
  });

  return { app, settings };
}

async function main() {
  const { app, settings } = await createApp();
  scheduler.start(settings);
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  app.listen(port, host, async () => {
    console.log(`ePOS-Brief en écoute sur http://${host}:${port}`);
    if (!(await users.countAsync({}))) console.log('Premier lancement : ouvre l\'interface pour créer le compte.');
  });
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { createApp };
