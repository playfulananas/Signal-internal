// Regenerates CARD_TRUTH.md straight from js/cards.js — the actual, currently-running card
// data, not a hand-maintained copy that can silently drift (see card_list.csv's own history:
// CLAUDE.md flags it as stale against the string-id scheme and never reconciled).
//
// This script has NO manual state of its own: every run reads CARD_BY_ID/CARDS fresh and
// overwrites CARD_TRUTH.md in full, so the generated file can never be "more correct" or "more
// stale" than the code it was built from — run it again any time cards.js changes.
//
// Run with: node scripts/generate_card_truth.mjs
import { CARDS } from '../js/cards.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'CARD_TRUTH.md');

function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|');
}

function keywordText(k) {
  if (!k) return '—';
  return Array.isArray(k) ? k.join(' / ') : k;
}

function unitTable(units) {
  const rows = units.map(c =>
    `| ${c.id} | ${esc(c.name)} | ${c.cost} | ${c.copies} | ${keywordText(c.keyword)} | ${c.n}/${c.e}/${c.s}/${c.w} | ${esc(c.ability) || '—'} |`
  );
  return [
    '| ID | Name | Fuel | Copies | Keyword(s) | N/E/S/W | Ability |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function heroTable(heroes) {
  const rows = heroes.map(h => {
    const cost = h.powerType === 'active' ? `${h.activeCost}⛽` : '—';
    return `| ${h.id} | ${esc(h.name)} | ${(h.scope ?? 'board')} | ${h.powerType} | ${cost} | ${esc(h.ability) || '—'} |`;
  });
  return [
    '| ID | Name | Scope | Power Type | Fuel | Ability |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function commandTable(commands) {
  const rows = commands.map(c =>
    `| ${c.id} | ${esc(c.name)} | ${c.cls} | ${c.cost}⛽ | ${c.copies} | ${esc(c.effect) || '—'} |`
  );
  return [
    '| ID | Name | Class | Fuel | Copies | Effect |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function objectiveTable(objectives) {
  const rows = objectives.map(o =>
    `| ${o.id} | ${esc(o.name)} | ${esc(o.category)} | ${esc(o.l1)} | ${esc(o.l2)} | ${esc(o.l3)} | ${esc(o.l4)} |`
  );
  return [
    '| ID | Name | Category | L1 | L2 | L3 | L4 |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

const units = CARDS.filter(c => c.type === 'unit');
const heroes = CARDS.filter(c => c.type === 'hero');
const commands = CARDS.filter(c => c.type === 'command');
const objectives = CARDS.filter(c => c.type === 'objective');

const byClass = cls => units.filter(u => u.cls === cls);

const lines = [];
lines.push('# SIGNAL — Card Truth');
lines.push('');
lines.push('**Generated file — do not hand-edit.** Regenerate with `node scripts/generate_card_truth.mjs`');
lines.push('any time `js/cards.js` changes. Every value here comes directly from `CARDS` in that file — the');
lines.push('code that actually runs — so this can never drift the way `card_list.csv` did (see CLAUDE.md).');
lines.push('');
lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
lines.push('');
lines.push(`${units.length} Units • ${heroes.length} Heroes • ${commands.length} Commands • ${objectives.length} Objectives • ${units.length + heroes.length + commands.length} collectible`);
lines.push('');
lines.push('---');
lines.push('');
lines.push(`## Units — Infantry (${byClass('Infantry').length})`);
lines.push('');
lines.push(unitTable(byClass('Infantry')));
lines.push('');
lines.push(`## Units — Tank (${byClass('Tank').length})`);
lines.push('');
lines.push(unitTable(byClass('Tank')));
lines.push('');
lines.push(`## Units — Artillery (${byClass('Artillery').length})`);
lines.push('');
lines.push(unitTable(byClass('Artillery')));
lines.push('');
lines.push(`## Units — Aircraft (${byClass('Aircraft').length})`);
lines.push('');
lines.push(unitTable(byClass('Aircraft')));
lines.push('');
lines.push(`## Heroes (${heroes.length})`);
lines.push('');
lines.push(heroTable(heroes));
lines.push('');
lines.push(`## Commands (${commands.length})`);
lines.push('');
lines.push(commandTable(commands));
lines.push('');
lines.push(`## Objectives (${objectives.length})`);
lines.push('');
lines.push(objectiveTable(objectives));
lines.push('');

writeFileSync(OUT_PATH, lines.join('\n'));
console.log(`Wrote ${OUT_PATH}`);
console.log(`${units.length} Units, ${heroes.length} Heroes, ${commands.length} Commands, ${objectives.length} Objectives`);
