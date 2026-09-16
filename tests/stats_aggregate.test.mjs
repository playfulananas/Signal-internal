import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordsFromFirebase, recordsFromJsonl, filterRecords, summarize, damageBySource, cardRows,
  heroRows, objectiveSlotRows, objectiveCardRows, tradeRows, triggerRows, craftRows, matchRows,
  slotLabel, toCsv,
} from '../js/stats-aggregate.js?v=2026090402';

function record(overrides = {}) {
  return {
    matchId: 'm1', mode: 'hotseat', source: 'human', buildLabel: '2026-09-16', debugUsed: false,
    startedAt: 1000, durationMs: 600000, mapId: 'kursk', firstPlayer: 'p1', winner: 'p1', winnerSeat: 'first',
    endReason: 'hq', rounds: 8, included: true, note: '',
    players: {
      p1: {
        heroRoster: ['H07'], hqDamageTaken: { combat: 10 },
        cards: { T33: { copies: 2, drawn: 2, played: 1, roundSum: 3, fuelSpent: 4, inHandAtEnd: 1 } },
        heroes: { H07: { deployedRound: 2, activations: 3, fuelSpent: 6 } },
        trades: { Tank: { Infantry: { destroyed: 2 } } }, triggers: { Breakthrough: { T33: 1 } },
        fuelLostToCap: 2, directHqUnits: 1, craftPicks: [],
      },
      p2: {
        heroRoster: ['H07'], hqDamageTaken: { combat: 20, directHq: 10 },
        cards: { T33: { copies: 2, drawn: 1, played: 0, roundSum: 0, fuelSpent: 0, inHandAtEnd: 1 } },
        heroes: {}, trades: {}, triggers: {}, fuelLostToCap: 0, directHqUnits: 0,
        craftPicks: [{ keyword: 'Armor', drawback: 'rotateAll', fixedLine: true }],
      },
    },
    objectives: { '1,0': { cardId: 'O1', heldAtEnd: 'p1', turnsHeld: { p1: 6, none: 2 }, activations: { p1: 3 }, backbone: { p1: 4 }, fuel: { p1: 3 }, draws: {} } },
    turns: [
      { turn: 1, player: 'p1', ms: 30000, fuelUnspent: 1 },
      { turn: 2, player: 'p2', ms: 90000, fuelUnspent: 3 },
      { turn: 3, player: 'p1', ms: 999000, terminal: true }, // partial final turn: must not move the averages
    ],
    ...overrides,
  };
}
// Same match, but p2 won (second seat).
const lost = () => record({ matchId: 'm2', startedAt: 2000, winner: 'p2', winnerSeat: 'second' });

test('recordsFromFirebase merges include/note settings and sorts newest first', () => {
  const rows = recordsFromFirebase(
    { m1: record({ included: undefined, note: undefined }), m2: lost() },
    { m2: { included: true, note: 'T33 test' } },
  );
  assert.deepEqual(rows.map(r => [r.matchId, r.included, r.note]), [['m2', true, 'T33 test'], ['m1', false, '']]);
});

test('recordsFromJsonl reads one record per line and treats them as included', () => {
  const rows = recordsFromJsonl(`${JSON.stringify(record())}\n\n${JSON.stringify(lost())}\n`);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.included));
});

test('filterRecords applies included, debug, source, mode and build filters', () => {
  const rs = [record(), record({ matchId: 'x', included: false }), record({ matchId: 'd', debugUsed: true }), record({ matchId: 's', source: 'selfplay' })];
  assert.deepEqual(filterRecords(rs, { sources: ['human'], modes: ['hotseat'] }).map(r => r.matchId), ['m1']);
  assert.equal(filterRecords(rs, { includedOnly: false, excludeDebug: false, sources: ['human', 'selfplay'], modes: ['hotseat'] }).length, 4);
  assert.equal(filterRecords(rs, { buildLabel: 'other' }).length, 0);
});

test('summarize reports seat win rates, averages and Fuel (terminal partial turns excluded)', () => {
  const byMetric = Object.fromEntries(summarize([record(), lost()]).map(r => [r.metric, r.value]));
  assert.equal(byMetric['Matches'], 2);
  assert.equal(byMetric['First player win %'], 50);
  assert.equal(byMetric['Avg rounds'], 8);
  assert.equal(byMetric['Avg match length (min)'], 10);
  assert.equal(byMetric['Avg turn length (sec)'], 60);
  assert.equal(byMetric['Avg unspent Fuel per turn'], 2);
  assert.equal(byMetric['Avg Fuel lost to cap per player per match'], 1);
});

test('damageBySource totals both players and computes shares', () => {
  assert.deepEqual(damageBySource([record(), lost()]), [
    { source: 'combat', total: 60, perMatch: 30, sharePct: 75 },
    { source: 'directHq', total: 20, perMatch: 10, sharePct: 25 },
  ]);
});

test('cardRows computes play rate, win rates and dead cards', () => {
  const [t33] = cardRows([record(), lost()], id => `name:${id}`);
  assert.equal(t33.name, 'name:T33');
  assert.equal(t33.drawn, 6);
  assert.equal(t33.played, 2);
  assert.equal(t33.playRatePct, 33.3);
  assert.equal(t33.winPctWhenPlayed, 50);
  assert.equal(t33.winPctInDeck, 50);
  assert.equal(t33.avgRoundPlayed, 3);
  assert.equal(t33.deadInHand, 4);
});

test('heroRows counts deployments, activations and win rate when deployed', () => {
  const [h07] = heroRows([record(), lost()]);
  assert.equal(h07.rosters, 4);
  assert.equal(h07.deployed, 2);
  assert.equal(h07.deployPct, 50);
  assert.equal(h07.avgDeployRound, 2);
  assert.equal(h07.activationsPerDeploy, 3);
  assert.equal(h07.winPctWhenDeployed, 50);
});

test('objective rows: seat-relative control share, backbone and winner holding at the end', () => {
  const [slot] = objectiveSlotRows([record(), lost()]);
  assert.equal(slot.slot, 'A2');
  assert.equal(slot.heldFirstPct, 75);
  assert.equal(slot.neutralPct, 25);
  assert.equal(slot.backbonePerMatch, 4);
  assert.equal(slot.winnerHeldAtEndPct, 50);
  const [o1] = objectiveCardRows([record(), lost()]);
  assert.equal(o1.cardId, 'O1');
  assert.equal(o1.fuelPerMatch, 3);
  assert.equal(o1.heldPct, 75);
  assert.equal(slotLabel('2,3'), 'D3');
});

test('trade, trigger and Craft rows', () => {
  assert.deepEqual(tradeRows([record()]), [{ attacker: 'Tank', target: 'Infantry', suppressed: 0, destroyed: 2, armorAbsorbed: 0, destroyedPerMatch: 2 }]);
  assert.deepEqual(triggerRows([record(), lost()]), [{ keyword: 'Breakthrough', cardId: 'T33', name: 'T33', count: 2, perMatch: 1 }]);
  assert.deepEqual(craftRows([record()]), [{ keyword: 'Armor', drawback: 'rotateAll', line: 'fixed 6/6/6/6', picks: 1, sharePct: 100 }]);
});

test('matchRows and toCsv escaping', () => {
  const [row] = matchRows([record({ note: 'said "hi", then left' })]);
  assert.equal(row.minutes, 10);
  const csv = toCsv([['matchId', 'Match'], ['note', 'Note']], [row]);
  assert.equal(csv, 'Match,Note\nm1,"said ""hi"", then left"');
});

test('toCsv quotes a cell containing a bare carriage return', () => {
  // `plain` has nothing but the \r to trigger quoting; `quoted` checks quotes are still doubled.
  const csv = toCsv([['plain', 'Plain'], ['quoted', 'Quoted']], [{ plain: 'line one\rline two', quoted: 'say "hi"\rbye' }]);
  assert.equal(csv, 'Plain,Quoted\n"line one\rline two","say ""hi""\rbye"');
});
