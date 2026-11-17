'use strict';
// Interactions de l'interface : onglets, boutons de test, recherches, apercu.
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const getJson = (url, opts) => fetch(url, opts).then((r) => {
    if (r.status === 401) { window.location = '/login'; throw new Error('Session expirée'); }
    return r.json();
  });

  // Onglets des reglages : l'onglet ouvert suit l'ancre de l'adresse (#trello, ...)
  const tabs = $('#settingsTabs');
  if (tabs) {
    const show = () => {
      const btn = $(`[data-hash="${CSS.escape(location.hash.slice(1))}"]`, tabs);
      if (btn) bootstrap.Tab.getOrCreateInstance(btn).show();
    };
    $$('[data-hash]', tabs).forEach((btn) => btn.addEventListener('shown.bs.tab', () => history.replaceState(null, '', `#${btn.dataset.hash}`)));
    window.addEventListener('hashchange', show);
    show();
  }

  // Evite les doubles clics sur les formulaires d'impression
  $$('form[data-busy]').forEach((form) => form.addEventListener('submit', () => {
    $$('button', form).forEach((b) => { b.disabled = true; });
  }));

  // Boutons "Tester"
  $$('[data-test]').forEach((btn) => btn.addEventListener('click', async () => {
    const out = $('[data-test-result]', btn.closest('form'));
    btn.disabled = true;
    out.className = 'small text-secondary';
    out.textContent = 'Test en cours...';
    try {
      const r = await getJson(`/api/test/${btn.dataset.test}`, { method: 'POST' });
      out.className = `small ${r.ok ? 'test-ok' : 'test-ko'}`;
      out.textContent = r.ok ? r.message : `Échec : ${r.message}`;
    } catch (e) {
      out.className = 'small test-ko';
      out.textContent = `Échec : ${e.message}`;
    }
    btn.disabled = false;
  }));

  // Lignes ajoutables (liens ICS, flux RSS)
  $$('[data-rows]').forEach((box) => {
    const tpl = $('template', box);
    const addBtn = $('[data-row-add]', box);
    addBtn.addEventListener('click', () => box.insertBefore(tpl.content.cloneNode(true), tpl));
    box.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-row-remove]');
      if (rm) rm.closest('[data-row]').remove();
    });
    if (!$('[data-row]', box)) addBtn.click();
  });

  // Recherches (ville meteo, gares) : liste de resultats cliquables
  const SEARCHES = {
    weather: {
      url: (q) => `/api/weather/search?q=${encodeURIComponent(q)}`,
      label: (r) => `${r.name}${r.detail ? ` - ${r.detail}` : ''}`,
      pick: (r) => { $('#w-city').value = r.name; $('#w-lat').value = r.latitude; $('#w-lon').value = r.longitude; },
    },
  };
  SEARCHES.tides = {
    url: (q) => `/api/weather/search?q=${encodeURIComponent(q)}`,
    label: (r) => `${r.name}${r.detail ? ` - ${r.detail}` : ''}`,
    pick: (r) => { $('#m-place').value = r.name; $('#m-lat').value = r.latitude; $('#m-lon').value = (r.longitude - 0.04).toFixed(4); },
  };
  ['from', 'to'].forEach((side) => {
    SEARCHES[`train-${side}`] = {
      url: (q) => `/api/train/places?q=${encodeURIComponent(q)}`,
      label: (r) => r.name,
      pick: (r) => {
        $(`#tr-${side}-id`).value = r.id;
        $(`#tr-${side}-name`).value = r.name.replace(/\s*\(.*\)\s*$/, '');
        $(`#tr-${side}-info`).textContent = `Gare choisie : ${r.id}`;
      },
    };
  });
  $$('[data-search]').forEach((btn) => {
    const key = btn.dataset.search;
    const cfg = SEARCHES[key];
    const input = $(`[data-search-input="${key}"]`);
    const box = $(`[data-search-results="${key}"]`);
    const message = (text) => { box.replaceChildren(Object.assign(document.createElement('div'), { className: 'list-group-item small text-secondary', textContent: text })); };
    const run = async () => {
      message('Recherche...');
      try {
        const r = await getJson(cfg.url(input.value.trim()));
        if (!r.ok) return message(r.message);
        if (!r.results.length) return message('Aucun résultat.');
        box.replaceChildren(...r.results.map((res) => {
          const b = Object.assign(document.createElement('button'), { type: 'button', className: 'list-group-item list-group-item-action', textContent: cfg.label(res) });
          b.addEventListener('click', () => { cfg.pick(res); box.replaceChildren(); });
          return b;
        }));
      } catch (e) { message(e.message); }
    };
    btn.addEventListener('click', run);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  });

  // Trello : tableaux puis listes
  const tLoad = $('#t-load');
  if (tLoad) {
    const board = $('#t-board');
    const list = $('#t-list');
    const msg = $('#t-msg');
    const fill = (select, items, current, placeholder) => {
      select.replaceChildren(new Option(placeholder, ''), ...items.map((i) => new Option(i.name, i.id, false, i.id === current)));
      select.dispatchEvent(new Event('change'));
    };
    let loaded = false;
    const loadLists = async () => {
      if (!board.value) { msg.textContent = 'Choisis le tableau.'; return; }
      msg.textContent = 'Chargement des listes...';
      try {
        const r = await getJson(`/api/trello/lists?board=${encodeURIComponent(board.value)}`);
        if (!r.ok) { msg.textContent = r.message; return; }
        fill(list, r.results, list.dataset.current || '', 'Choisir une liste');
        msg.textContent = 'Choisis la liste, puis enregistre.';
      } catch (e) { msg.textContent = e.message; }
    };
    [board, list].forEach((sel) => sel.addEventListener('change', () => {
      const opt = sel.selectedOptions[0];
      $(sel.dataset.nameTarget).value = opt && opt.value ? opt.textContent : '';
    }));
    board.addEventListener('change', () => { if (loaded) loadLists(); });
    tLoad.addEventListener('click', async () => {
      msg.textContent = 'Chargement des tableaux...';
      list.dataset.current = list.value;
      try {
        const r = await getJson('/api/trello/boards');
        if (!r.ok) { msg.textContent = r.message; return; }
        loaded = true;
        fill(board, r.results, board.value, 'Choisir un tableau'); // declenche le chargement des listes
      } catch (e) { msg.textContent = e.message; }
    });
  }

  // iCloud : liste des calendriers sous forme de cases a cocher
  const cLoad = $('#c-load');
  if (cLoad) {
    cLoad.addEventListener('click', async () => {
      const msg = $('#c-msg');
      const box = $('#c-list');
      msg.textContent = 'Connexion à iCloud...';
      try {
        const r = await getJson('/api/icloud/calendars', { method: 'POST' });
        if (!r.ok) { msg.textContent = r.message; return; }
        box.replaceChildren(...r.results.map((c, i) => {
          const div = Object.assign(document.createElement('div'), { className: 'form-check' });
          const cb = Object.assign(document.createElement('input'), { className: 'form-check-input', type: 'checkbox', id: `cal-${i}`, name: 'cal_enabled[]', value: c.url, checked: c.enabled });
          const label = Object.assign(document.createElement('label'), { className: 'form-check-label', htmlFor: `cal-${i}`, textContent: c.name });
          const url = Object.assign(document.createElement('input'), { type: 'hidden', name: 'cal_url[]', value: c.url });
          const name = Object.assign(document.createElement('input'), { type: 'hidden', name: 'cal_name[]', value: c.name });
          div.append(cb, label, url, name);
          return div;
        }));
        msg.textContent = `${r.results.length} calendrier(s) trouvé(s). Coche ceux à imprimer, puis enregistre.`;
      } catch (e) { msg.textContent = e.message; }
    });
  }

  // Import des reglages : lecture du fichier dans le navigateur, envoi en JSON
  const bkBtn = $('#bk-import');
  if (bkBtn) {
    bkBtn.addEventListener('click', async () => {
      const msg = $('#bk-msg');
      const file = $('#bk-file').files[0];
      msg.className = 'small test-ko';
      if (!file) { msg.textContent = 'Choisis d\'abord un fichier.'; return; }
      if (!window.confirm('Remplacer les réglages actuels par ceux de ce fichier ?')) return;
      let body;
      try { body = JSON.parse(await file.text()); } catch { msg.textContent = 'Fichier illisible (JSON invalide).'; return; }
      try {
        const r = await getJson('/settings/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) { msg.textContent = r.message; return; }
        window.location = '/settings#backup';
        window.location.reload();
      } catch (e) { msg.textContent = e.message; }
    });
  }

  // Tableau de bord : apercu du ticket avec les vraies donnees
  const preview = $('#preview');
  if (preview) {
    const select = $('#templateSelect');
    const load = async (refresh) => {
      const meta = $('#previewMeta');
      meta.textContent = '- chargement...';
      try {
        const r = await getJson(`/preview?template=${encodeURIComponent(select.value)}${refresh ? '&refresh=1' : ''}`);
        preview.innerHTML = r.html; // HTML produit et echappe cote serveur
        meta.textContent = `- environ ${r.lengthCm} cm, données de ${r.generatedAt}`;
        const items = r.sources.map((s) => {
          const li = document.createElement('li');
          const badge = Object.assign(document.createElement('span'), { className: `badge me-2 ${s.ok ? 'text-bg-success' : 'text-bg-danger'}`, textContent: s.ok ? 'OK' : 'KO' });
          li.append(badge, s.name + (s.error ? ` - ${s.error}` : ''));
          return li;
        });
        const sources = $('#sources');
        if (items.length) sources.replaceChildren(...items);
        else sources.replaceChildren(Object.assign(document.createElement('li'), { className: 'text-secondary', textContent: 'Aucune source active pour ce modèle.' }));
      } catch (e) {
        meta.textContent = `- échec : ${e.message}`;
      }
    };
    select.addEventListener('change', () => load(false));
    $('#refreshPreview').addEventListener('click', () => load(true));
    load(false);
  }
})();
