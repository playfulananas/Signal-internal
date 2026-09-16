// Sanity-checks match records written by selfplay_test.mjs. The key check: every point of HQ
// damage should be attributed to a named source. A non-zero "other" in a match without debug use
// means some HQ damage path isn't calling recordHqDamage (js/stats.js). "!!" lines are problems
// (non-zero exit code); "i" lines are informational.
// Run: node scripts/check_selfplay_stats.mjs [file]
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'selfplay_stats.jsonl';
const records = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
let problems = 0;

for (const r of records) {
  const turns = r.turns ?? [];
  const lines = [`${r.matchId} ${r.mapId} winner=${r.winner ?? 'none'} (${r.winnerSeat}) rounds=${r.rounds} turns=${turns.length} durationMs=${r.durationMs}`];
  const problem = text => { problems++; lines.push(`!! ${text}`); };

  for (const role of ['p1', 'p2']) {
    const p = r.players?.[role] ?? {};
    const dmg = p.hqDamageTaken ?? {};
    const played = Object.values(p.cards ?? {}).reduce((a, c) => a + (c.played ?? 0), 0);
    lines.push(`${role}: finalHq=${p.finalHq} damage=${JSON.stringify(dmg)} played=${played} heroes=${Object.keys(p.heroes ?? {}).length}`);
    if (!r.debugUsed && (dmg.other ?? 0) !== 0) problem(`${role} has ${dmg.other} unattributed HQ damage`);
    if (p.cards?.GENERATED) problem(`${role} has a GENERATED card row (an H19 copy lost its printed card identity?)`);
    if (played === 0) lines.push(`i ${role} played no cards`);
  }

  if (turns.length === 0) problem('no turns recorded');
  const seen = new Set();
  for (const t of turns) {
    const key = `${t.turn}|${t.player}`;
    if (seen.has(key)) problem(`duplicate turn row for turn ${t.turn} ${t.player}`);
    seen.add(key);
  }
  if (turns.filter(t => t.terminal).length > 1) problem('more than one terminal turn row');
  const maxTurn = Math.max(0, ...turns.map(t => t.turn));
  if (r.turnsPlayed < maxTurn) problem(`turnsPlayed ${r.turnsPlayed} is below the highest recorded turn ${maxTurn}`);
  if (r.endReason === 'hq' && turns.at(-1)?.turn !== r.turnsPlayed) problem(`last turn row (${turns.at(-1)?.turn}) is not the final turn (${r.turnsPlayed}): phantom turn after lethal?`);
  if (Number(r.durationMs) < 0) problem(`negative durationMs ${r.durationMs}`);
  console.log(lines.join('\n  '));
}

console.log(`\n${records.length} record(s), ${problems} problem(s)`);
process.exitCode = problems ? 1 : 0;
