'use strict';
// Envoi brut en TCP sur le port 9100 de l'imprimante.
const net = require('net');

const NET_ERRORS = {
  ECONNREFUSED: 'Connexion refusée (mauvais port, ou imprimante occupée)',
  EHOSTUNREACH: 'Imprimante injoignable sur le réseau',
  ENETUNREACH: 'Réseau injoignable',
  ETIMEDOUT: 'Délai dépassé (imprimante éteinte ou injoignable)',
  ECONNRESET: 'Connexion coupée par l\'imprimante',
  ENOTFOUND: 'Nom d\'hôte introuvable',
};

// Demande d'etat temps reel (DLE EOT n). Renvoie un octet, ou null si l'imprimante ne repond pas.
function queryStatus(sock, n, waitMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { sock.off('data', onData); resolve(null); }, waitMs);
    const onData = (buf) => { clearTimeout(timer); sock.off('data', onData); resolve(buf[buf.length - 1]); };
    sock.on('data', onData);
    sock.write(Buffer.from([0x10, 0x04, n]));
  });
}

const valid = (b) => b !== null && (b & 0x93) === 0x12; // bits fixes d'un octet d'etat Epson

// Renvoie { warnings: [] } ou rejette avec une erreur lisible.
function printRaw(buffer, { host, port = 9100, timeoutMs = 5000, checkStatus = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!host) return reject(new Error('Adresse IP de l\'imprimante non configurée'));
    const sock = new net.Socket();
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) { sock.destroy(); reject(err); } else resolve(value);
    };
    sock.setTimeout(timeoutMs, () => finish(new Error(NET_ERRORS.ETIMEDOUT)));
    sock.once('error', (e) => finish(new Error(NET_ERRORS[e.code] || e.message)));
    sock.connect(Number(port), host, async () => {
      try {
        const warnings = [];
        if (checkStatus) {
          const offline = await queryStatus(sock, 2, 700); // causes de mise hors ligne
          const paper = valid(offline) ? await queryStatus(sock, 4, 700) : null; // capteurs papier
          if (valid(offline)) {
            if (offline & 0x04) throw new Error('Capot de l\'imprimante ouvert');
            if (offline & 0x20) throw new Error('Plus de papier');
            if (offline & 0x40) throw new Error('Imprimante en erreur (voyant ERROR)');
          }
          if (valid(paper)) {
            if (paper & 0x60) throw new Error('Plus de papier');
            if (paper & 0x0c) warnings.push('Rouleau de papier presque terminé');
          }
        }
        sock.end(buffer, () => {
          sock.setTimeout(0);
          setTimeout(() => sock.destroy(), 3000).unref();
          finish(null, { warnings });
        });
      } catch (e) {
        finish(e);
      }
    });
  });
}

module.exports = { printRaw };
