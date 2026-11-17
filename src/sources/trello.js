'use strict';
// Trello REST API : https://developer.atlassian.com/cloud/trello/rest/
const { http } = require('./http');

const API = 'https://api.trello.com/1';
const auth = (t) => ({ key: t.key, token: t.token });

async function me(t) {
  const { data } = await http.get(`${API}/members/me`, { params: { ...auth(t), fields: 'username,fullName' } });
  return { username: data.username, fullName: data.fullName };
}

async function boards(t) {
  const { data } = await http.get(`${API}/members/me/boards`, { params: { ...auth(t), fields: 'name', filter: 'open' } });
  return data.map((b) => ({ id: b.id, name: b.name }));
}

async function lists(t, boardId) {
  const { data } = await http.get(`${API}/boards/${encodeURIComponent(boardId)}/lists`, { params: { ...auth(t), fields: 'name', filter: 'open' } });
  return data.map((l) => ({ id: l.id, name: l.name }));
}

// Cartes de la liste, dans l'ordre du tableau. urgent = porte l'etiquette configuree
async function fetchCards(settings) {
  const t = settings.trello;
  const { data } = await http.get(`${API}/lists/${encodeURIComponent(t.listId)}/cards`, {
    params: { ...auth(t), fields: 'name,labels,due,pos' },
  });
  return { ok: true, cards: parse(data, t.urgentLabel) };
}

function parse(cards, urgentLabel) {
  const wanted = String(urgentLabel || 'URGENT').trim().toLowerCase();
  return [...cards]
    .sort((a, b) => (a.pos || 0) - (b.pos || 0))
    .map((c) => ({
      name: c.name,
      due: c.due || null,
      urgent: (c.labels || []).some((l) => String(l.name || '').trim().toLowerCase() === wanted),
    }));
}

module.exports = { me, boards, lists, fetchCards, parse };
