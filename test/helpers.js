'use strict';
const net = require('net');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Dossier de donnees jetable : a appeler avant tout require de src/
function tempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epos-brief-test-'));
  process.env.EPOS_DATA_DIR = dir;
  return dir;
}

// Fausse imprimante TCP. status = { 2: octet, 4: octet } pour repondre aux demandes d'etat DLE EOT n
function fakePrinter({ status = { 2: 0x12, 4: 0x12 }, silent = false } = {}) {
  const jobs = [];
  const server = net.createServer((sock) => {
    const chunks = [];
    sock.on('data', (buf) => {
      if (buf.length === 3 && buf[0] === 0x10 && buf[1] === 0x04) {
        if (!silent && status[buf[2]] !== undefined) sock.write(Buffer.from([status[buf[2]]]));
        return;
      }
      chunks.push(buf);
    });
    sock.on('end', () => { if (chunks.length) jobs.push(Buffer.concat(chunks)); sock.end(); });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    jobs,
    close: () => new Promise((r) => server.close(r)),
  })));
}

// Faux serveur HTTP qui enregistre les corps JSON recus (webhook Discord)
function fakeWebhook() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { calls.push(JSON.parse(body || '{}')); res.statusCode = 204; res.end(); });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/hook`,
    calls,
    close: () => new Promise((r) => server.close(r)),
  })));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lineText = (l) => l.spans.map((s) => s.text).join('');

module.exports = { tempDataDir, fakePrinter, fakeWebhook, wait, lineText };
