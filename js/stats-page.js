// Statistics page (stats.html). Loads match records + include/note settings from Firebase, or a
// local self-play .jsonl file; filters them; renders one sortable table per question, each with a
// CSV export for Google Sheets. All the math is in stats-aggregate.js (pure, unit-tested).
import { fetchStatsData, writeMatchMeta } from './firebase.js?v=2026090402';
import { CARD_BY_ID } from './cards.js?v=2026090402';
import { MAPS } from './maps.js?v=2026090402';
import {
  recordsFromFirebase, recordsFromJsonl, filterRecords, summarize, damageBySource, cardRows,
  heroRows, objectiveSlotRows, objectiveCardRows, tradeRows, triggerRows, craftRows, matchRows, toCsv,
} from './stats-aggregate.js?v=2026090402';

const cardName = id => CARD_BY_ID[id]?.name ?? id;
const mapName = id => MAPS[id]?.name ?? id;

let allRecords = [];
let dataSource = 'firebase'; // 'firebase' | 'file'

const SECTIONS = [
  { id: 'summary', title: 'Summary', rows: rs => summarize(rs),
    columns: [['metric', 'Metric'], ['value', 'Value']] },
  { id: 'damage', title: 'HQ damage by source', rows: rs => damageBySource(rs),
    columns: [['source', 'Source'], ['total', 'Total'], ['perMatch', 'Per match'], ['sharePct', 'Share %']] },
  { id: 'cards', title: 'Cards', rows: rs => cardRows(rs, cardName),
    columns: [['cardId', 'ID'], ['name', 'Card'], ['inDecks', 'Decks'], ['copies', 'Copies'], ['drawn', 'Drawn'], ['played', 'Played'], ['playRatePct', 'Play % of drawn'], ['winPctInDeck', 'Win % in deck'], ['winPctWhenPlayed', 'Win % when played'], ['avgRoundPlayed', 'Avg round played'], ['avgFuel', 'Avg Fuel'], ['deadInHand', 'Dead in hand']] },
  { id: 'heroes', title: 'Heroes', rows: rs => heroRows(rs, cardName),
    columns: [['heroId', 'ID'], ['name', 'Hero'], ['rosters', 'In rosters'], ['deployed', 'Deployed'], ['deployPct', 'Deploy %'], ['avgDeployRound', 'Avg deploy round'], ['activations', 'Activations'], ['activationsPerDeploy', 'Activations per deploy'], ['avgFuelPerActivation', 'Avg Fuel per activation'], ['winPctWhenDeployed', 'Win % when deployed']] },
  { id: 'objective-slots', title: 'Objectives by map slot', rows: rs => objectiveSlotRows(rs, mapName),
    columns: [['map', 'Map'], ['slot', 'Slot'], ['matches', 'Matches'], ['heldFirstPct', 'Held by first player %'], ['heldSecondPct', 'Held by second player %'], ['neutralPct', 'Neutral %'], ['backbonePerMatch', 'Backbone damage per match'], ['winnerHeldAtEndPct', 'Winner held at end %']] },
  { id: 'objective-cards', title: 'Objectives by card', rows: rs => objectiveCardRows(rs, cardName),
    columns: [['cardId', 'ID'], ['name', 'Objective'], ['matches', 'Matches'], ['activationsPerMatch', 'Activations per match'], ['backbonePerMatch', 'Backbone per match'], ['fuelPerMatch', 'Fuel per match'], ['drawsPerMatch', 'Draws per match'], ['heldPct', 'Held %'], ['winnerHeldAtEndPct', 'Winner held at end %']] },
  { id: 'trades', title: 'Unit trades (hits dealt)', rows: rs => tradeRows(rs),
    columns: [['attacker', 'Attacker'], ['target', 'Target class'], ['suppressed', 'Suppressed'], ['destroyed', 'Destroyed'], ['armorAbsorbed', 'Armor absorbed'], ['destroyedPerMatch', 'Destroyed per match']] },
  { id: 'triggers', title: 'Keyword triggers', rows: rs => triggerRows(rs, cardName),
    columns: [['keyword', 'Keyword'], ['cardId', 'ID'], ['name', 'Card'], ['count', 'Count'], ['perMatch', 'Per match']] },
  { id: 'craft', title: 'Craft picks', rows: rs => craftRows(rs),
    columns: [['keyword', 'Keyword'], ['drawback', 'Drawback'], ['line', 'Stat line'], ['picks', 'Picks'], ['sharePct', 'Share %']] },
];

const MATCH_COLUMNS = [['date', 'Date (UTC)'], ['mode', 'Mode'], ['source', 'Source'], ['build', 'Build'], ['map', 'Map'], ['winnerSeat', 'Winner seat'], ['endReason', 'End'], ['rounds', 'Rounds'], ['minutes', 'Minutes'], ['debugUsed', 'Debug'], ['included', 'Included'], ['note', 'Note'], ['matchId', 'Match ID']];

const compare = (a, b) => {
  if (a == null || a === '') return -1;
  if (b == null || b === '') return 1;
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
};

function setStatus(text) {
  document.getElementById('stats-status').textContent = text;
}

function currentFilters() {
  const checked = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
  return {
    includedOnly: document.getElementById('f-included').checked,
    excludeDebug: document.getElementById('f-exclude-debug').checked,
    sources: checked('f-source'),
    modes: checked('f-mode'),
    buildLabel: document.getElementById('f-build').value,
  };
}

function downloadCsv(name, columns, rows) {
  const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `signal-stats-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// cellFor(row, key) may return a DOM node (for editable cells); otherwise the value is shown as text.
function renderTable(container, columns, rows, cellFor = null, sort = null) {
  const sorted = sort
    ? [...rows].sort((a, b) => compare(a[sort.key], b[sort.key]) * (sort.dir === 'desc' ? -1 : 1))
    : rows;
  const table = document.createElement('table');
  table.className = 'stats-table';
  const head = table.createTHead().insertRow();
  for (const [key, label] of columns) {
    const th = document.createElement('th');
    th.textContent = sort?.key === key ? `${label} ${sort.dir === 'desc' ? '▼' : '▲'}` : label;
    th.addEventListener('click', () => {
      const dir = sort?.key === key && sort.dir === 'desc' ? 'asc' : 'desc';
      renderTable(container, columns, rows, cellFor, { key, dir });
    });
    head.appendChild(th);
  }
  const body = table.createTBody();
  for (const row of sorted) {
    const tr = body.insertRow();
    for (const [key] of columns) {
      const td = tr.insertCell();
      const custom = cellFor?.(row, key);
      if (custom) td.appendChild(custom);
      else td.textContent = row[key] ?? '';
    }
  }
  if (!sorted.length) {
    const td = body.insertRow().insertCell();
    td.colSpan = columns.length;
    td.textContent = 'No matches for the current filters.';
  }
  container.replaceChildren(table);
}

function sectionShell(id, title, onCsv) {
  const section = document.createElement('section');
  section.className = 'stats-section';
  section.id = `section-${id}`;
  const header = document.createElement('div');
  header.className = 'stats-section-header';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary';
  btn.textContent = 'CSV';
  btn.addEventListener('click', onCsv);
  header.append(h2, btn);
  const body = document.createElement('div');
  body.className = 'stats-table-wrap';
  section.append(header, body);
  return { section, body };
}

// Include/note are editable here too, so a forgotten tick on the end screen can be fixed later.
function saveMeta(record) {
  setStatus('Saving…');
  writeMatchMeta(record.matchId, { included: record.included, note: record.note, updatedAt: Date.now() })
    .then(() => { setStatus('Saved.'); render(); })
    .catch(err => setStatus(`Could not save: ${err.message}`));
}

function matchCell(row, key) {
  if (dataSource !== 'firebase') return null;
  const record = allRecords.find(r => r.matchId === row.matchId);
  if (!record) return null;
  if (key === 'included') {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = record.included;
    box.addEventListener('change', () => { record.included = box.checked; saveMeta(record); });
    return box;
  }
  if (key === 'note') {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 300;
    input.value = record.note;
    input.addEventListener('change', () => { record.note = input.value.trim(); saveMeta(record); });
    return input;
  }
  return null;
}

function populateBuildFilter() {
  const select = document.getElementById('f-build');
  const current = select.value;
  const labels = [...new Set(allRecords.map(r => r.buildLabel).filter(Boolean))].sort().reverse();
  select.replaceChildren(new Option('All', ''), ...labels.map(l => new Option(l, l)));
  select.value = labels.includes(current) ? current : '';
}

function render() {
  const filters = currentFilters();
  const records = filterRecords(allRecords, filters);
  document.getElementById('stats-count').textContent =
    `${records.length} OF ${allRecords.length} MATCHES · ${dataSource === 'file' ? 'SELF-PLAY FILE' : 'FIREBASE'}`;
  const root = document.getElementById('stats-sections');
  root.replaceChildren();
  for (const s of SECTIONS) {
    const rows = s.rows(records);
    const { section, body } = sectionShell(s.id, s.title, () => downloadCsv(s.id, s.columns, rows));
    renderTable(body, s.columns, rows);
    root.appendChild(section);
  }
  // The match list ignores "Included only" so unticked matches can be found and ticked.
  const listed = filterRecords(allRecords, { ...filters, includedOnly: false });
  const rows = matchRows(listed, mapName);
  const { section, body } = sectionShell('matches', 'Matches', () => downloadCsv('matches', MATCH_COLUMNS, rows));
  renderTable(body, MATCH_COLUMNS, rows, matchCell);
  root.appendChild(section);
}

async function loadFirebase() {
  setStatus('Loading from Firebase…');
  try {
    const { matches, meta } = await fetchStatsData();
    allRecords = recordsFromFirebase(matches, meta);
    dataSource = 'firebase';
    populateBuildFilter();
    render();
    setStatus('');
  } catch (err) {
    console.error('[stats] load failed', err);
    setStatus(`Could not load statistics: ${err.message}`);
  }
}

document.getElementById('f-file').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    allRecords = recordsFromJsonl(await file.text());
    dataSource = 'file';
    document.querySelector('input[name="f-source"][value="selfplay"]').checked = true;
    populateBuildFilter();
    render();
    setStatus(`Loaded ${file.name}.`);
  } catch (err) {
    setStatus(`Could not read ${file.name}: ${err.message}`);
  }
  e.target.value = '';
});

document.querySelectorAll('.stats-filters input[type="checkbox"], #f-build')
  .forEach(el => el.addEventListener('change', render));
document.getElementById('stats-reload').addEventListener('click', loadFirebase);
document.getElementById('stats-back').addEventListener('click', () => { window.location.href = 'index.html'; });

(function initTheme() {
  const btn = document.getElementById('theme-toggle');
  btn.textContent = document.body.dataset.theme === 'light' ? '☀ DARK' : '☾ LIGHT';
  btn.addEventListener('click', () => {
    const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
    document.body.dataset.theme = next;
    try { localStorage.setItem('signal-theme', next); } catch {}
    btn.textContent = next === 'light' ? '☀ DARK' : '☾ LIGHT';
  });
})();

loadFirebase();
