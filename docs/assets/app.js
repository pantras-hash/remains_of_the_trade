(() => {
  const state = {
    config: {},
    metadata: {},
    metaById: {},
    countryNames: {},
    rows: [],
    columns: [],
    indices: [],
    stats: {},
    selectedIndex: null,
    selectedCountry: null,
    compareIndex: null
  };

  const $ = (id) => document.getElementById(id);
  const isMissing = (value) => value === null || value === undefined || value === '' || String(value).trim().toUpperCase() === 'NA' || String(value).trim().toUpperCase() === 'NAN';
  const rawToDisplay = (value) => isMissing(value) ? null : Number(value) * 100;
  const decimalsFor = (id) => (id && (id.startsWith('ESI') || id.startsWith('ISI'))) ? 1 : 2;
  const formatValue = (value, id) => {
    if (isMissing(value) || Number.isNaN(Number(value))) return 'NA';
    return rawToDisplay(value).toLocaleString(undefined, { maximumFractionDigits: decimalsFor(id), minimumFractionDigits: decimalsFor(id) });
  };
  const escapeHtml = (text) => String(text ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindNav();
    try {
      const [config, metadata, countryNames, csvText] = await Promise.all([
        fetchJson('site_config.json'),
        fetchJson('data/index_metadata.json'),
        fetchJson('data/country_names.json'),
        fetchText('data/measures_panel.csv')
      ]);
      state.config = config || {};
      state.metadata = metadata || { indices: [] };
      state.countryNames = countryNames || {};
      state.metaById = Object.fromEntries((state.metadata.indices || []).map(m => [m.id, m]));
      const parsed = parseCSV(csvText);
      state.columns = parsed.headers;
      state.rows = parsed.rows.map(row => normalizeRow(row));
      state.indices = computeIndexList();
      computeStats();
      applyConfig();
      populateControls();
      bindEvents();
      state.selectedIndex = chooseDefaultIndex();
      state.compareIndex = chooseCompareIndex(state.selectedIndex);
      state.selectedCountry = chooseDefaultCountry(state.selectedIndex);
      $('indexSelect').value = state.selectedIndex;
      $('compareSelect').value = state.compareIndex;
      $('countrySelect').value = state.selectedCountry;
      renderAll();
    } catch (err) {
      console.error(err);
      showFatalError(err);
    }
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load ${url}`);
    return res.json();
  }
  async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load ${url}`);
    return res.text();
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', inQuotes = false;
    const pushCell = () => { row.push(cell); cell = ''; };
    const pushRow = () => {
      if (row.length > 0 || cell.length > 0) {
        pushCell();
        if (row.some(v => v !== '')) rows.push(row);
        row = [];
      }
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === '"') {
        if (inQuotes && next === '"') { cell += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        pushCell();
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && next === '\n') i++;
        pushRow();
      } else {
        cell += ch;
      }
    }
    pushRow();
    const headers = rows.shift().map(h => h.trim().replace(/^\uFEFF/, ''));
    return { headers, rows: rows.map(cols => Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? '']))) };
  }

  function normalizeRow(row) {
    const iso3 = String(row.iso3 || '').trim().toUpperCase();
    const normalized = { iso3, country: state.countryNames[iso3] || iso3, values: {}, stat: {} };
    for (const id of state.columns) {
      if (id === 'iso3') continue;
      const raw = row[id];
      normalized.values[id] = isMissing(raw) ? null : Number(raw);
    }
    return normalized;
  }

  function computeIndexList() {
    const numericColumns = state.columns.filter(c => c !== 'iso3');
    const metaOrder = (state.metadata.indices || []).map(m => m.id).filter(id => numericColumns.includes(id));
    const extras = numericColumns.filter(id => !metaOrder.includes(id));
    return [...metaOrder, ...extras].map(id => metaFor(id));
  }

  function metaFor(id) {
    return state.metaById[id] || { id, label: id, short_label: id, family: 'Other', description: 'No description provided yet.', unit: 'index points' };
  }

  function computeStats() {
    for (const meta of computeIndexList()) {
      const id = meta.id;
      const values = state.rows.map(row => ({ row, value: row.values[id] })).filter(d => d.value !== null && Number.isFinite(d.value));
      const n = values.length;
      values.forEach(({ row, value }) => {
        const greater = values.filter(d => d.value > value).length;
        row.stat[id] = { rank: greater + 1, n };
      });
      const sorted = values.map(d => d.value).sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      state.stats[id] = {
        n,
        mean: n ? sum / n : null,
        median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2 : null,
        min: n ? sorted[0] : null,
        max: n ? sorted[n - 1] : null,
        top: values.sort((a, b) => b.value - a.value)[0]?.row || null
      };
    }
  }

  function applyConfig() {
    const cfg = state.config;
    document.title = `${cfg.title || 'The Remains of Trade'} | Exposure Indices`;
    setText('siteTitle', cfg.title || 'The Remains of Trade');
    setText('siteSubtitle', cfg.subtitle || 'Interactive exposure indices');
    setText('siteAuthors', cfg.authors || '');
    setText('footerAuthors', cfg.authors || '');
    setText('paperVersion', (cfg.paper_version || 'June 2026').replace(' draft', ''));
    setText('downloadPaperVersion', cfg.paper_version || 'June 2026 draft');
    setText('wipNotice', cfg.work_in_progress_note || 'Work in progress.');
    ['paperLink', 'navPaperLink', 'downloadPaperCard'].forEach(id => { const el = $(id); if (el) el.href = cfg.paper_url || 'paper/resettling_trade.pdf'; });
    ['dataLink', 'downloadDataCard'].forEach(id => { const el = $(id); if (el) el.href = cfg.data_url || 'data/measures_panel.csv'; });
    setText('countryCount', state.rows.length.toString());
    setText('indexCount', state.indices.length.toString());
    setText('year', new Date().getFullYear().toString());
  }

  function setText(id, value) { const el = $(id); if (el) el.textContent = value; }

  function populateControls() {
    populateIndexSelect('indexSelect', state.indices);
    populateIndexSelect('compareSelect', state.indices);
    const countrySelect = $('countrySelect');
    countrySelect.innerHTML = state.rows.slice().sort((a, b) => a.country.localeCompare(b.country)).map(row => `<option value="${row.iso3}">${escapeHtml(row.country)} (${row.iso3})</option>`).join('');
    renderDictionary();
  }

  function populateIndexSelect(id, indices) {
    const select = $(id);
    const groups = [...new Set(indices.map(m => m.family || 'Other'))];
    select.innerHTML = groups.map(group => {
      const opts = indices.filter(m => (m.family || 'Other') === group).map(m => `<option value="${m.id}">${escapeHtml(m.label || m.id)}</option>`).join('');
      return `<optgroup label="${escapeHtml(group)}">${opts}</optgroup>`;
    }).join('');
  }

  function bindEvents() {
    $('indexSelect').addEventListener('change', e => {
      state.selectedIndex = e.target.value;
      if (state.compareIndex === state.selectedIndex) state.compareIndex = chooseCompareIndex(state.selectedIndex);
      $('compareSelect').value = state.compareIndex;
      if (valueFor(state.selectedCountry, state.selectedIndex) === null) state.selectedCountry = chooseDefaultCountry(state.selectedIndex);
      $('countrySelect').value = state.selectedCountry;
      renderAll();
    });
    $('countrySelect').addEventListener('change', e => { state.selectedCountry = e.target.value; renderCountryPanel(); });
    $('scaleSelect').addEventListener('change', () => renderMap());
    $('compareSelect').addEventListener('change', e => { state.compareIndex = e.target.value; renderScatter(); });
    $('resetViewButton').addEventListener('click', () => renderMap());
    $('downloadRankingsButton').addEventListener('click', downloadRankings);
    window.addEventListener('resize', debounce(() => { if (window.Plotly) { Plotly.Plots.resize('map'); Plotly.Plots.resize('scatter'); } }, 120));
  }

  function bindNav() {
    const btn = $('navToggle');
    const links = $('navLinks');
    if (!btn || !links) return;
    btn.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { links.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }));
  }

  function chooseDefaultIndex() {
    const id = state.metadata.default_index || 'ECI';
    return state.indices.some(m => m.id === id) ? id : state.indices[0]?.id;
  }
  function chooseCompareIndex(id) {
    const preferred = ['ESI', 'ICI', 'CGI', 'SGI', 'ISI'].find(x => x !== id && state.indices.some(m => m.id === x));
    return preferred || state.indices.find(m => m.id !== id)?.id || id;
  }
  function chooseDefaultCountry(id) {
    const vnm = state.rows.find(row => row.iso3 === 'VNM' && row.values[id] !== null);
    if (vnm) return 'VNM';
    const top = state.stats[id]?.top;
    return top ? top.iso3 : state.rows[0]?.iso3;
  }
  function valueFor(iso, id) {
    const row = state.rows.find(r => r.iso3 === iso);
    return row && row.values[id] !== null ? row.values[id] : null;
  }

  function renderAll() {
    const meta = metaFor(state.selectedIndex);
    setText('defaultIndexText', meta.label);
    setText('mapTitle', meta.label);
    setText('mapSubtitle', meta.description || 'Hover over a country for details.');
    renderMap();
    renderCountryPanel();
    renderSummary();
    renderTopTable();
    renderScatter();
  }

  function renderMap() {
    if (!window.Plotly) { $('map').innerHTML = '<p class="muted">Plotly did not load. Check your internet connection or bundle Plotly locally.</p>'; return; }
    const id = state.selectedIndex;
    const meta = metaFor(id);
    const records = state.rows.filter(row => row.values[id] !== null && Number.isFinite(row.values[id]));
    const zvals = records.map(row => rawToDisplay(row.values[id]));
    const dec = decimalsFor(id);
    const hoverValue = dec === 1 ? ':.1f' : ':.2f';
    const data = [{
      type: 'choropleth', locationmode: 'ISO-3', locations: records.map(row => row.iso3), z: zvals,
      text: records.map(row => row.country), customdata: records.map(row => [row.stat[id].rank, row.stat[id].n]),
      colorscale: $('scaleSelect').value, reversescale: false, marker: { line: { color: 'rgba(255,255,255,0.55)', width: 0.4 } },
      colorbar: { title: { text: meta.short_label || id, side: 'right' }, thickness: 13, len: 0.70 },
      hovertemplate: `<b>%{text}</b><br>${escapeHtml(meta.short_label || id)}: %{z${hoverValue}}<br>Rank: %{customdata[0]} of %{customdata[1]}<extra></extra>`
    }];
    const layout = {
      margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      geo: { projection: { type: 'natural earth' }, showframe: false, showcoastlines: false, showland: true, landcolor: '#edf1f5', bgcolor: 'rgba(0,0,0,0)' }
    };
    const config = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['select2d', 'lasso2d'] };
    Plotly.newPlot('map', data, layout, config).then(() => {
      const map = $('map');
      if (map.removeAllListeners) map.removeAllListeners('plotly_click');
      if (map.on) map.on('plotly_click', ev => {
        const iso = ev.points?.[0]?.location;
        if (iso) { state.selectedCountry = iso; $('countrySelect').value = iso; renderCountryPanel(); }
      });
    });
  }

  function renderCountryPanel() {
    const id = state.selectedIndex;
    const row = state.rows.find(r => r.iso3 === state.selectedCountry) || state.rows[0];
    if (!row) return;
    state.selectedCountry = row.iso3;
    const stat = row.stat[id];
    setText('selectedCountryName', row.country);
    setText('selectedCountryCode', row.iso3);
    setText('selectedValue', formatValue(row.values[id], id));
    setText('selectedRank', stat ? `${stat.rank} of ${stat.n}` : 'NA');
    setText('selectedIndexDescription', metaFor(id).description || '');
    const tbody = $('countryProfileTable').querySelector('tbody');
    tbody.innerHTML = state.indices.map(meta => {
      const val = row.values[meta.id];
      const s = row.stat[meta.id];
      return `<tr><td>${escapeHtml(meta.short_label || meta.id)}</td><td>${formatValue(val, meta.id)}</td><td>${s ? s.rank + ' / ' + s.n : 'NA'}</td></tr>`;
    }).join('');
  }

  function renderSummary() {
    const id = state.selectedIndex;
    const s = state.stats[id] || {};
    setText('observedCount', s.n ? s.n.toString() : '-');
    setText('meanValue', s.mean !== null ? formatValue(s.mean, id) : '-');
    setText('medianValue', s.median !== null ? formatValue(s.median, id) : '-');
  }

  function rankedRows(id) {
    return state.rows.filter(row => row.values[id] !== null && Number.isFinite(row.values[id])).sort((a, b) => b.values[id] - a.values[id] || a.country.localeCompare(b.country));
  }

  function renderTopTable() {
    const id = state.selectedIndex;
    const rows = rankedRows(id).slice(0, 20);
    $('topTableCaption').textContent = `Highest values for ${metaFor(id).label}.`;
    $('topTable').querySelector('tbody').innerHTML = rows.map(row => {
      const s = row.stat[id];
      return `<tr class="clickable" data-iso="${row.iso3}"><td>${s.rank}</td><td>${escapeHtml(row.country)} <span class="muted">${row.iso3}</span></td><td>${formatValue(row.values[id], id)}</td></tr>`;
    }).join('');
    $('topTable').querySelectorAll('tr[data-iso]').forEach(tr => tr.addEventListener('click', () => { state.selectedCountry = tr.dataset.iso; $('countrySelect').value = state.selectedCountry; renderCountryPanel(); document.querySelector('#explorer').scrollIntoView({ behavior: 'smooth' }); }));
  }

  function renderScatter() {
    if (!window.Plotly) { $('scatter').innerHTML = '<p class="muted">Plotly did not load.</p>'; return; }
    const xId = state.selectedIndex;
    const yId = state.compareIndex;
    const rows = state.rows.filter(row => row.values[xId] !== null && row.values[yId] !== null);
    const data = [{
      type: 'scatter', mode: 'markers', x: rows.map(row => rawToDisplay(row.values[xId])), y: rows.map(row => rawToDisplay(row.values[yId])),
      text: rows.map(row => row.country), customdata: rows.map(row => row.iso3), marker: { size: 9, opacity: 0.75, line: { width: 0.5, color: '#ffffff' } },
      hovertemplate: '<b>%{text}</b><br>%{x:.2f}<br>%{y:.2f}<extra></extra>'
    }];
    const layout = { margin: { l: 56, r: 12, t: 8, b: 50 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', xaxis: { title: metaFor(xId).short_label || xId, zeroline: false }, yaxis: { title: metaFor(yId).short_label || yId, zeroline: false } };
    Plotly.newPlot('scatter', data, layout, { responsive: true, displaylogo: false }).then(() => {
      const scatter = $('scatter');
      if (scatter.removeAllListeners) scatter.removeAllListeners('plotly_click');
      if (scatter.on) scatter.on('plotly_click', ev => { const iso = ev.points?.[0]?.customdata; if (iso) { state.selectedCountry = iso; $('countrySelect').value = iso; renderCountryPanel(); } });
    });
  }

  function renderDictionary() {
    const tbody = $('dictionaryTable').querySelector('tbody');
    tbody.innerHTML = state.indices.map(meta => `<tr><td><strong>${escapeHtml(meta.id)}</strong><br><span class="muted">${escapeHtml(meta.label || meta.id)}</span></td><td>${escapeHtml(meta.family || 'Other')}</td><td>${escapeHtml(meta.description || '')}</td></tr>`).join('');
  }

  function downloadRankings() {
    const id = state.selectedIndex;
    const header = ['rank', 'iso3', 'country', 'value_raw', 'value_display_x100'];
    const lines = [header.join(',')];
    rankedRows(id).forEach(row => {
      const s = row.stat[id];
      const values = [s.rank, row.iso3, csvEscape(row.country), row.values[id], rawToDisplay(row.values[id])];
      lines.push(values.join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${id}_rankings.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  function csvEscape(value) { const s = String(value ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function debounce(fn, wait) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; }
  function showFatalError(err) {
    const target = $('explorer') || document.body;
    target.insertAdjacentHTML('afterbegin', `<div class="shell card"><h3>Could not load the site data</h3><p>${escapeHtml(err.message || err)}</p><p>For local previews, use <code>python -m http.server</code> rather than opening <code>index.html</code> directly.</p></div>`);
  }
})();
