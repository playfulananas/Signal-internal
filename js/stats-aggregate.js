// Pure aggregation of match records (buildMatchRecord output, js/stats.js) into table rows for
// stats.html. No DOM, no Firebase; tested in tests/stats_aggregate.test.mjs.

const ROLES = ['p1', 'p2'];
const toArray = v => (Array.isArray(v) ? v : Object.values(v ?? {}));
const sum = values => values.reduce((a, b) => a + (Number(b) || 0), 0);
const avg = (total, count) => (count > 0 ? total / count : null);
const round2 = v => (v == null ? null : Math.round(v * 100) / 100);
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const isDecided = r => r.winnerSeat === 'first' || r.winnerSeat === 'second';
const seatOf = (r, role) => (role === r.firstPlayer ? 'first' : 'second');

// "1,0" (row,col) -> "A2" (the Handoff docs' column-letter + row-number labels).
export function slotLabel(key) {
  const [row, col] = String(key).split(',').map(Number);
  return Number.isInteger(row) && Number.isInteger(col) ? `${'ABCD'[col]}${row + 1}` : String(key);
}

export function recordsFromFirebase(matches, meta) {
  return Object.entries(matches ?? {})
    .map(([id, r]) => ({ ...r, matchId: r.matchId ?? id, included: meta?.[id]?.included === true, note: meta?.[id]?.note ?? '' }))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

// Self-play files are deliberate test runs, so every record counts as included.
export function recordsFromJsonl(text) {
  return text.split('\n').map(line => line.trim()).filter(Boolean)
    .map(line => ({ ...JSON.parse(line), included: true, note: '' }));
}

export function filterRecords(records, { includedOnly = true, excludeDebug = true, sources = ['human'], modes = null, buildLabel = '' } = {}) {
  return records.filter(r =>
    (!includedOnly || r.included) &&
    (!excludeDebug || !r.debugUsed) &&
    (!sources || sources.includes(r.source)) &&
    (!modes || modes.includes(r.mode)) &&
    (!buildLabel || r.buildLabel === buildLabel));
}

export function summarize(records) {
  const n = records.length;
  const decided = records.filter(isDecided);
  const firstWins = decided.filter(r => r.winnerSeat === 'first').length;
  // A terminal turn was cut short by the win: its time and leftover Fuel would skew both averages.
  const turns = records.flatMap(r => toArray(r.turns)).filter(t => !t.terminal);
  const turnMs = turns.map(t => t.ms).filter(Number.isFinite);
  const durations = records.map(r => r.durationMs).filter(Number.isFinite);
  const perPlayer = field => round2(avg(sum(records.flatMap(r => ROLES.map(role => r.players?.[role]?.[field]))), n * 2));
  return [
    { metric: 'Matches', value: n },
    { metric: 'Decided (HQ destroyed)', value: decided.length },
    { metric: 'First player win %', value: pct(firstWins, decided.length) },
    { metric: 'Second player win %', value: pct(decided.length - firstWins, decided.length) },
    { metric: 'Avg rounds', value: round2(avg(sum(records.map(r => r.rounds)), n)) },
    { metric: 'Avg match length (min)', value: durations.length ? round2(sum(durations) / durations.length / 60000) : null },
    { metric: 'Avg turn length (sec)', value: turnMs.length ? round2(sum(turnMs) / turnMs.length / 1000) : null },
    { metric: 'Avg unspent Fuel per turn', value: round2(avg(sum(turns.map(t => t.fuelUnspent)), turns.length)) },
    { metric: 'Avg Fuel lost to cap per player per match', value: perPlayer('fuelLostToCap') },
    { metric: 'Avg Direct HQ unit conversions per player per match', value: perPlayer('directHqUnits') },
  ];
}

export function damageBySource(records) {
  const totals = {};
  for (const r of records) {
    for (const role of ROLES) {
      for (const [source, amount] of Object.entries(r.players?.[role]?.hqDamageTaken ?? {})) {
        totals[source] = (totals[source] ?? 0) + amount;
      }
    }
  }
  const all = sum(Object.values(totals));
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([source, total]) => ({ source, total, perMatch: round2(avg(total, records.length)), sharePct: pct(total, all) }));
}

export function cardRows(records, cardName = id => id) {
  const rows = {};
  const row = id => rows[id] ?? (rows[id] = {
    cardId: id, inDecks: 0, copies: 0, drawn: 0, played: 0, deadInHand: 0, roundSum: 0, fuelSpent: 0,
    decidedInDeck: 0, winsInDeck: 0, decidedPlayed: 0, winsPlayed: 0,
  });
  for (const r of records) {
    const decided = isDecided(r);
    for (const role of ROLES) {
      for (const [id, c] of Object.entries(r.players?.[role]?.cards ?? {})) {
        const x = row(id);
        x.copies += c.copies ?? 0;
        x.drawn += c.drawn ?? 0;
        x.played += c.played ?? 0;
        x.deadInHand += c.inHandAtEnd ?? 0;
        x.roundSum += c.roundSum ?? 0;
        x.fuelSpent += c.fuelSpent ?? 0;
        if ((c.copies ?? 0) > 0) {
          x.inDecks++;
          if (decided) { x.decidedInDeck++; if (r.winner === role) x.winsInDeck++; }
        }
        if ((c.played ?? 0) > 0 && decided) { x.decidedPlayed++; if (r.winner === role) x.winsPlayed++; }
      }
    }
  }
  return Object.values(rows).map(x => ({
    cardId: x.cardId,
    name: cardName(x.cardId),
    inDecks: x.inDecks,
    copies: x.copies,
    drawn: x.drawn,
    played: x.played,
    playRatePct: pct(x.played, x.drawn),
    winPctInDeck: pct(x.winsInDeck, x.decidedInDeck),
    winPctWhenPlayed: pct(x.winsPlayed, x.decidedPlayed),
    avgRoundPlayed: round2(avg(x.roundSum, x.played)),
    avgFuel: round2(avg(x.fuelSpent, x.played)),
    deadInHand: x.deadInHand,
  })).sort((a, b) => b.played - a.played);
}

export function heroRows(records, cardName = id => id) {
  const rows = {};
  const row = id => rows[id] ?? (rows[id] = { heroId: id, rosters: 0, deployed: 0, deployRoundSum: 0, activations: 0, fuelSpent: 0, decidedDeployed: 0, winsDeployed: 0 });
  for (const r of records) {
    const decided = isDecided(r);
    for (const role of ROLES) {
      const p = r.players?.[role] ?? {};
      for (const id of toArray(p.heroRoster)) row(id).rosters++;
      for (const [id, h] of Object.entries(p.heroes ?? {})) {
        const x = row(id);
        if (h.deployedRound != null) {
          x.deployed++;
          x.deployRoundSum += h.deployedRound;
          if (decided) { x.decidedDeployed++; if (r.winner === role) x.winsDeployed++; }
        }
        x.activations += h.activations ?? 0;
        x.fuelSpent += h.fuelSpent ?? 0;
      }
    }
  }
  return Object.values(rows).map(x => ({
    heroId: x.heroId,
    name: cardName(x.heroId),
    rosters: x.rosters,
    deployed: x.deployed,
    deployPct: pct(x.deployed, x.rosters),
    avgDeployRound: round2(avg(x.deployRoundSum, x.deployed)),
    activations: x.activations,
    activationsPerDeploy: round2(avg(x.activations, x.deployed)),
    avgFuelPerActivation: round2(avg(x.fuelSpent, x.activations)),
    winPctWhenDeployed: pct(x.winsDeployed, x.decidedDeployed),
  })).sort((a, b) => b.deployed - a.deployed);
}

export function objectiveSlotRows(records, mapName = id => id) {
  const rows = {};
  for (const r of records) {
    for (const [slot, o] of Object.entries(r.objectives ?? {})) {
      const key = `${r.mapId}|${slot}`;
      const x = rows[key] ?? (rows[key] = { map: mapName(r.mapId), slot: slotLabel(slot), matches: 0, first: 0, second: 0, none: 0, backbone: 0, decided: 0, winnerHeld: 0 });
      x.matches++;
      for (const role of ROLES) {
        x[seatOf(r, role)] += o.turnsHeld?.[role] ?? 0;
        x.backbone += o.backbone?.[role] ?? 0;
      }
      x.none += o.turnsHeld?.none ?? 0;
      if (isDecided(r)) { x.decided++; if (o.heldAtEnd === r.winner) x.winnerHeld++; }
    }
  }
  return Object.values(rows).map(x => {
    const turns = x.first + x.second + x.none;
    return {
      map: x.map,
      slot: x.slot,
      matches: x.matches,
      heldFirstPct: pct(x.first, turns),
      heldSecondPct: pct(x.second, turns),
      neutralPct: pct(x.none, turns),
      backbonePerMatch: round2(avg(x.backbone, x.matches)),
      winnerHeldAtEndPct: pct(x.winnerHeld, x.decided),
    };
  }).sort((a, b) => String(a.map).localeCompare(String(b.map)) || a.slot.localeCompare(b.slot));
}

export function objectiveCardRows(records, cardName = id => id) {
  const rows = {};
  for (const r of records) {
    for (const o of Object.values(r.objectives ?? {})) {
      const x = rows[o.cardId] ?? (rows[o.cardId] = { cardId: o.cardId, matches: 0, activations: 0, backbone: 0, fuel: 0, draws: 0, held: 0, turns: 0, decided: 0, winnerHeld: 0 });
      x.matches++;
      x.activations += sum(Object.values(o.activations ?? {}));
      x.backbone += sum(Object.values(o.backbone ?? {}));
      x.fuel += sum(Object.values(o.fuel ?? {}));
      x.draws += sum(Object.values(o.draws ?? {}));
      x.held += (o.turnsHeld?.p1 ?? 0) + (o.turnsHeld?.p2 ?? 0);
      x.turns += sum(Object.values(o.turnsHeld ?? {}));
      if (isDecided(r)) { x.decided++; if (o.heldAtEnd === r.winner) x.winnerHeld++; }
    }
  }
  return Object.values(rows).map(x => ({
    cardId: x.cardId,
    name: cardName(x.cardId),
    matches: x.matches,
    activationsPerMatch: round2(avg(x.activations, x.matches)),
    backbonePerMatch: round2(avg(x.backbone, x.matches)),
    fuelPerMatch: round2(avg(x.fuel, x.matches)),
    drawsPerMatch: round2(avg(x.draws, x.matches)),
    heldPct: pct(x.held, x.turns),
    winnerHeldAtEndPct: pct(x.winnerHeld, x.decided),
  })).sort((a, b) => a.cardId.localeCompare(b.cardId));
}

export function tradeRows(records) {
  const rows = {};
  for (const r of records) {
    for (const role of ROLES) {
      for (const [attacker, targets] of Object.entries(r.players?.[role]?.trades ?? {})) {
        for (const [target, result] of Object.entries(targets)) {
          const x = rows[`${attacker}|${target}`] ?? (rows[`${attacker}|${target}`] = { attacker, target, suppressed: 0, destroyed: 0, armorAbsorbed: 0 });
          x.suppressed += result.suppressed ?? 0;
          x.destroyed += result.destroyed ?? 0;
          x.armorAbsorbed += result.armorAbsorbed ?? 0;
        }
      }
    }
  }
  return Object.values(rows)
    .map(x => ({ ...x, destroyedPerMatch: round2(avg(x.destroyed, records.length)) }))
    .sort((a, b) => b.destroyed - a.destroyed);
}

export function triggerRows(records, cardName = id => id) {
  const rows = {};
  for (const r of records) {
    for (const role of ROLES) {
      for (const [keyword, byCard] of Object.entries(r.players?.[role]?.triggers ?? {})) {
        for (const [cardId, count] of Object.entries(byCard)) {
          const x = rows[`${keyword}|${cardId}`] ?? (rows[`${keyword}|${cardId}`] = { keyword, cardId, count: 0 });
          x.count += count;
        }
      }
    }
  }
  return Object.values(rows)
    .map(x => ({ keyword: x.keyword, cardId: x.cardId, name: cardName(x.cardId), count: x.count, perMatch: round2(avg(x.count, records.length)) }))
    .sort((a, b) => b.count - a.count);
}

export function craftRows(records) {
  const picks = records.flatMap(r => ROLES.flatMap(role => toArray(r.players?.[role]?.craftPicks)));
  const rows = {};
  for (const p of picks) {
    const line = p.fixedLine ? 'fixed 6/6/6/6' : 'random';
    const key = `${p.keyword}|${p.drawback}|${line}`;
    const x = rows[key] ?? (rows[key] = { keyword: p.keyword, drawback: p.drawback, line, picks: 0 });
    x.picks++;
  }
  return Object.values(rows)
    .map(x => ({ ...x, sharePct: pct(x.picks, picks.length) }))
    .sort((a, b) => b.picks - a.picks);
}

export function matchRows(records, mapName = id => id) {
  return records.map(r => ({
    matchId: r.matchId,
    date: r.startedAt ? new Date(r.startedAt).toISOString().slice(0, 16).replace('T', ' ') : '',
    mode: r.mode,
    source: r.source,
    build: r.buildLabel,
    map: mapName(r.mapId),
    winnerSeat: r.winnerSeat,
    endReason: r.endReason,
    rounds: r.rounds,
    minutes: Number.isFinite(r.durationMs) ? round2(r.durationMs / 60000) : null,
    debugUsed: r.debugUsed ? 'yes' : '',
    included: r.included ? 'yes' : '',
    note: r.note ?? '',
  }));
}

// columns: [[key, label], ...]
export function toCsv(columns, rows) {
  const cell = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    columns.map(([, label]) => cell(label)).join(','),
    ...rows.map(row => columns.map(([key]) => cell(row[key])).join(',')),
  ].join('\n');
}
