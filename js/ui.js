import { CARD_BY_ID } from './cards.js?v=2026090402';
import { getKeywords, maxArmorHits, discountFor, fuelCapOf, rotatedDir, applyHit, remainingAttacks } from './state.js?v=2026090402';
import { getTerrain } from './maps.js?v=2026090402';
import { evaluateDirectHQ, getAttackableTargets, nextCraftCost } from './combat.js?v=2026090402';

const TERRAIN_SHORT = { plains: 'P', forest: 'F', water: 'W', desert: 'D', city: 'C' };

// Player-facing keyword rules text for the hover tooltip on .bc-kw-tag badges — see GDD
// Section 7. Only mapped keywords get a data-tip attribute; an unmapped one (e.g. a future
// keyword not yet documented here) silently shows no tooltip rather than an empty bubble.
// All 16 live Set-1 keywords are covered (see ARCHITECTURE.md's Keyword Resolution Decisions
// table) — previously only 5 were, leaving Precision/Blast/Barrage/Breakthrough/Rally/Inspire/
// Muster/Last Stand/Maneuver/Escalate/Craft tagged with no explanation at all. Airborne and
// Deathrattle are both cut entirely (doc 03) and no longer mapped here.
const KEYWORD_TEXT = {
  'Guard': 'Attacker must target this unit before any other legal target, regardless of range.',
  'Precision': 'Ignores Guard — may target any legal enemy directly.',
  'Armor': 'Absorbs 1 hit before Suppression — 3 hits total to destroy.',
  'Heavy Armor': 'Absorbs 2 hits before Suppression — 4 hits total to destroy.',
  'Bombard': 'Can attack any enemy in its row or column, not just adjacent tiles.',
  'Blast': 'On a successful hit, also hits the enemies directly beside the target.',
  'Barrage': 'On a successful hit, also hits enemies further along the same line.',
  'Double Attack': 'This unit resolves two attacks per activation.',
  'Breakthrough': 'When this unit destroys an enemy, a bonus effect triggers.',
  'Rally': 'Triggers whenever this unit attacks, whether or not the attack succeeds.',
  'Inspire': 'Adjacent friendly units get +1 all sides for each adjacent Inspire source.',
  'Muster': '+1 all sides for every other friendly Infantry you control, anywhere on the board.',
  'Last Stand': 'Triggers an effect the instant this unit is destroyed.',
  'Maneuver': 'Moves a friendly unit to any other empty, legal tile.',
  'Escalate': "This card's effect is upgraded after its first use each match.",
  'Craft': 'Generates aircraft candidates to choose from — activation cost drops with each use.',
};

// Pure attack-preview wording built from the same applyHit result combat uses. Keeping this out
// of game.js prevents the inspector from drifting when damage rules change (as happened when
// Suppression moved from 1 HQ damage to 0 and Guard began preventing destruction damage).
export function describeAttackOutcome(defender, hits, { overrun = false } = {}) {
  if (!hits) {
    return { badge: 'BLOCKED', outcome: 'Attack blocked — no effect', hqDamage: 0 };
  }

  const beforeState = defender.state;
  const beforeArmorHits = defender.armorHits ?? 0;
  const { newUnit, hqDamage: baseHqDamage } = applyHit(defender);
  const armorAbsorbed = newUnit != null &&
    newUnit.state === beforeState &&
    (newUnit.armorHits ?? 0) > beforeArmorHits;
  const destroyed = newUnit == null || newUnit.state === 'destroyed';

  if (armorAbsorbed) {
    return { badge: 'HIT', outcome: 'Armor absorbs the hit — no HQ damage', hqDamage: 0 };
  }

  // Overrun adds 1 to each newly-Suppressed or newly-Destroyed defender in the real attack
  // handler. Include it here so the pre-click preview and the eventual HQ number always agree.
  const overrunDamage = overrun && (destroyed || newUnit.state === 'suppressed') ? 1 : 0;
  const totalHqDamage = baseHqDamage + overrunDamage;
  const hqText = totalHqDamage === 0
    ? 'no HQ damage'
    : `${totalHqDamage} HQ damage to defender`;

  if (newUnit?.state === 'suppressed') {
    return { badge: 'HIT', outcome: `Suppressed — ${hqText}`, hqDamage: totalHqDamage };
  }

  if (destroyed) {
    const guardProtected = getKeywords(defender).includes('Guard') && baseHqDamage === 0;
    const guardText = guardProtected && overrunDamage === 0 ? 'Guard prevents HQ damage' : hqText;
    return { badge: 'HIT', outcome: `Destroyed — ${guardText}`, hqDamage: totalHqDamage };
  }

  return { badge: 'HIT', outcome: `Hit — ${hqText}`, hqDamage: totalHqDamage };
}

// Pure turn-readiness projection for the active player. This deliberately asks the combat
// engine which targets are legal and runs the same non-mutating Direct HQ evaluation used by
// End Turn, rather than recreating Guard/Bombard/Precision/turn-1/lethal rules in presentation
// code. The returned indicator map is consumed by renderBoard; the totals feed the End Turn
// forecast. "availableAttackCount" means attacks the player can still choose to make against a
// legal Unit right now — those attacks are forfeited, not converted, if the turn ends.
export function summarizeTurnReadiness(state, activePlayer = state?.initiative) {
  const targetPlayer = activePlayer === 'p1' ? 'p2' : 'p1';
  const directResult = evaluateDirectHQ(state, activePlayer);
  const totalDirectHqDamage = targetPlayer === 'p1'
    ? directResult.hqDamageToP1
    : directResult.hqDamageToP2;
  const indicators = new Map();
  const canAttack = [];

  for (const [key, boardUnit] of Object.entries(state.board)) {
    if (!boardUnit || boardUnit.owner !== activePlayer || boardUnit.state !== 'normal') continue;
    const remaining = remainingAttacks(boardUnit);
    if (remaining <= 0) continue;
    const targetCount = getAttackableTargets(state, key).length;
    if (targetCount <= 0) continue;
    const item = { key, remaining, targetCount };
    canAttack.push(item);
    indicators.set(key, { kind: 'attack', count: remaining, targetCount });
  }

  // The simulated post-sweep board is the most exact source of per-Unit Direct HQ damage:
  // subtracting remaining allowances before/after automatically reflects Double Attack,
  // temporary attacks, and the engine's immediate lethal stop across multiple Units.
  const directHq = directResult.sources.flatMap(({ key }) => {
    const before = state.board[key];
    const after = directResult.state.board[key];
    const damage = before && after
      ? Math.max(0, remainingAttacks(before) - remainingAttacks(after))
      : 0;
    if (damage <= 0) return [];
    indicators.set(key, { kind: 'direct', count: damage, targetPlayer });
    return [{ key, damage }];
  });

  const availableAttackCount = canAttack.reduce((sum, item) => sum + item.remaining, 0);
  const targetHq = state[targetPlayer]?.hq ?? Infinity;
  return {
    activePlayer,
    targetPlayer,
    canAttack,
    directHq,
    availableAttackCount,
    totalDirectHqDamage,
    lethal: totalDirectHqDamage > 0 && totalDirectHqDamage >= targetHq,
    indicators,
  };
}

// Small DOM renderer kept beside summarizeTurnReadiness so the forecast's wording and visual
// contract can be tested without loading game.js (which boots the full browser controller).
export function renderEndTurnSummary(el, summary) {
  if (!el) return;
  el.replaceChildren();
  el.className = 'end-turn-summary';

  const directDamage = summary?.totalDirectHqDamage ?? 0;
  const unusedAttacks = summary?.availableAttackCount ?? 0;
  if (directDamage <= 0 && unusedAttacks <= 0) {
    el.style.display = 'none';
    return;
  }

  const label = document.createElement('div');
  label.className = 'end-turn-summary-label';
  label.textContent = 'ENDING NOW';
  el.append(label);

  if (directDamage > 0) {
    const row = document.createElement('div');
    row.className = `end-turn-summary-row direct${summary.lethal ? ' lethal' : ''}`;
    row.textContent = summary.lethal
      ? `LETHAL · ${directDamage} automatic damage to ${summary.targetPlayer.toUpperCase()} HQ`
      : `HQ HIT · ${directDamage} automatic damage to ${summary.targetPlayer.toUpperCase()} HQ`;
    el.append(row);
  }

  if (unusedAttacks > 0) {
    const row = document.createElement('div');
    row.className = 'end-turn-summary-row warning';
    row.textContent = `⚔ ${unusedAttacks} usable attack${unusedAttacks === 1 ? '' : 's'} will be forfeited`;
    el.append(row);
  }

  el.style.display = 'block';
}

// ── Board rendering ───────────────────────────────────────────────────────────

// Render the 4x4 board from state into the #board element.
// selectedTileKey: tile currently selected/highlighted (string or null)
// validDropKeys: Set of tile keys where the selected hand card can be placed (or null)
// Board orientation is fixed for both players (row 0 = P2 side / top, row 3 = P1
// side / bottom — see maps.js) — no per-player/per-turn visual flip, reverted 2026-07-30
// to match the GDD's one-time pre-match map orientation rule rather than a continuously
// recomputed per-viewer rotation. Stats shown on a placed card also never flip by owner
// (see getSideValue in state.js) — a card's printed N/E/S/W always maps to physical
// N/E/S/W, same as in hand.
export function renderBoard(state, selectedTileKey, validDropKeys, changedKeys = null, transitionFlags = null, terrainBlockedKeys = null, objectiveTransitionFlags = null, actionIndicators = null) {
  const board = document.getElementById('board');
  board.innerHTML = '';

  const rows = [0,1,2,3];
  const cols = [0,1,2,3];

  for (const r of rows) {
    for (const c of cols) {
      const key = `${r},${c}`;
      const unit = state.board[key];
      const obj = state.objectives[key];

      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.key = key;

      // Terrain type
      const terrainType = getTerrain(state.mapId, r, c);
      tile.classList.add(`terrain-${terrainType}`);
      const tLbl = document.createElement('div');
      tLbl.className = 'terrain-label';
      tLbl.textContent = TERRAIN_SHORT[terrainType] ?? terrainType[0].toUpperCase();
      tile.appendChild(tLbl);

      if (changedKeys?.has(key)) tile.classList.add('changed-tile');

      // Objective tile — D design
      if (obj) {
        tile.classList.add('objective-tile');
        if (obj.controller === 'p1') tile.classList.add('obj-ctrl-p1');
        else if (obj.controller === 'p2') tile.classList.add('obj-ctrl-p2');
        const objCard = CARD_BY_ID[obj.cardId];
        const ctrl = obj.controller;
        // Control-flip/level-up flash — previously silent: control and level are both
        // recalculated at start of turn with no transition of any kind, so a player had to
        // notice the background color or dot track changed on their own. Same one-shot
        // mechanism as the unit transitionFlags, just a separate map since a tile can never
        // hold both a unit and an objective (getValidTiles excludes objective tiles from
        // placement) but conflating the two flag types would still read as more confusing.
        const objTransition = objectiveTransitionFlags?.get(key);
        if (objTransition === 'obj-captured') tile.classList.add('obj-just-captured');
        else if (objTransition === 'obj-leveled') tile.classList.add('obj-just-leveled');

        // Header: OBJECTIVE badge + controller
        const header = document.createElement('div');
        header.className = 'obj-header';
        header.innerHTML = `<span class="obj-type-badge">OBJECTIVE</span>${ctrl ? `<span class="obj-ctrl-badge ${ctrl}">${ctrl.toUpperCase()}</span>` : ''}`;
        tile.appendChild(header);

        if (objCard) {
          // Name (visible when no unit on tile)
          const nameEl = document.createElement('div');
          nameEl.className = 'obj-name-center';
          nameEl.textContent = objCard.name;
          tile.appendChild(nameEl);

          // Level dots
          const track = document.createElement('div');
          track.className = 'obj-level-track';
          for (let i = 1; i <= 4; i++) {
            const dotClass = i < obj.level ? 'done' : i === obj.level ? 'active' : 'future';
            const dot = document.createElement('div');
            dot.className = `obj-lvdot ${dotClass}`;
            dot.textContent = i;
            track.appendChild(dot);
          }
          tile.appendChild(track);

          // Hover tooltip — rendered through the shared #floating-tip (position:fixed,
          // body-level) instead of a tile-local absolute div, so it isn't clipped/scaled
          // by fitBoardArea's transform on #board-area-inner. See game.js's delegated
          // [data-tip]/[data-tip-html] mouseover listener.
          const ctrlLabel = ctrl
            ? `<div class="obj-ctrl ${ctrl}">${ctrl.toUpperCase()} CONTROLS</div>`
            : `<div class="obj-ctrl neutral">NEUTRAL</div>`;
          const levels = [objCard.l1, objCard.l2, objCard.l3, objCard.l4];
          const levelHtml = levels.map((eff, i) => {
            const isCurrent = (i + 1) === obj.level;
            return `<div class="obj-tt-level${isCurrent ? ' current' : ''}"><span class="obj-tt-lnum">L${i+1}</span> ${eff ?? '—'}</div>`;
          }).join('');
          tile.dataset.tipHtml = `<div class="obj-tt-name">${objCard.name}</div>${ctrlLabel}${levelHtml}`;
        }
      }

      // Unit on tile
      if (unit) {
        tile.classList.add('has-unit');
        const actionIndicator = actionIndicators?.get(key) ?? null;
        if (actionIndicator?.kind === 'attack') tile.classList.add('unit-action-ready');
        else if (actionIndicator?.kind === 'direct') tile.classList.add('unit-direct-ready');
        tile.appendChild(buildBoardCard(unit, 'p1', transitionFlags?.get(key), actionIndicator));
      } else {
        if (validDropKeys?.has(key)) tile.classList.add('valid-drop');
        // Empty and legal-to-target-terrain-wise but currently blocked for the selected
        // card specifically because of terrain (Forest vs Tank, etc.) — previously these
        // tiles looked identical to any other non-highlighted tile; a player had no way to
        // tell "blocked by terrain" from "just not selected" until clicking and reading the
        // log. Only meaningful while placing (terrainBlockedKeys is null otherwise).
        if (terrainBlockedKeys?.has(key)) tile.classList.add('terrain-blocked');
        // A destroyed unit is nulled out of state.board the instant it dies (see applyHit /
        // resolveSingleAttack) — there's no lingering "destroyed" card to animate, so the
        // flash plays on the now-empty tile itself instead.
        if (transitionFlags?.get(key) === 'destroyed') tile.classList.add('tile-just-destroyed');
      }

      if (key === selectedTileKey) {
        tile.classList.add('highlight');
      }

      board.appendChild(tile);
      // Capture popup — needs the tile's real screen position, so it has to fire after
      // appendChild (getBoundingClientRect is meaningless before the node is in the
      // document). Level-up gets the flash above but no popup — the level-dot track already
      // visibly advances on its own, and a popup on every 2-round escalation for every
      // objective on the map would be noise the capture moment doesn't have to compete with.
      if (obj && objectiveTransitionFlags?.get(key) === 'obj-captured' && obj.controller) {
        const objCard = CARD_BY_ID[obj.cardId];
        const rect = tile.getBoundingClientRect();
        showFxPopup(rect.left + rect.width / 2, rect.top, `${obj.controller.toUpperCase()} captured ${objCard?.name ?? 'Objective'}`);
      }
    }
  }
}

function buildBoardCard(unit, viewer = 'p1', transitionFlag = null, actionIndicator = null) {
  const card = CARD_BY_ID[unit.cardId];
  const el = document.createElement('div');
  // Sum of every side-bonus source (matches the `bonus` total computed below for the actual
  // displayed numbers — objSideBonus was previously missing from this specific check, so a
  // unit buffed only by an Objective wouldn't get the halo even though its numbers already
  // showed gold). A buffed unit gets a persistent gold halo; a debuffed one gets the same
  // treatment in red — previously only the positive case existed, so a unit weakened on every
  // side had no card-level tell, only the per-side red digits.
  const totalSideBonus = (unit.tempSideBonus || 0) + (unit.grantedSideBonus || 0) + (unit.permanentSideBonus || 0) + (unit.objSideBonus || 0) + (unit.debugSideBonus || 0) + (unit.dynamicSideBonus || 0);
  const hasKeywordGrant = (unit.tempKeywords?.length > 0) || (unit.grantedKeywords?.length > 0) || (unit.permanentKeywords?.length > 0);
  const buffed = totalSideBonus > 0 || hasKeywordGrant;
  const debuffed = totalSideBonus < 0;
  const opponent = unit.owner !== viewer;
  const justSuppressed = transitionFlag === 'suppressed' ? ' just-suppressed' : '';
  // Direct HQ source pulse — reuses the generic FxFlash primitive directly (gold/positive,
  // matching the causality-pulse "source glow" language) rather than adding another
  // semantic just-* wrapper class that would just re-point to the same animation.
  const directHqSource = transitionFlag === 'direct-hq' ? ' fx-flash-positive' : '';
  // Armor absorb — one-shot protection-blue flash (also FxFlash directly, no new wrapper).
  const armorAbsorbed = transitionFlag === 'armor-absorbed' ? ' fx-flash-protect' : '';
  // Causality pulse, source stage — the Rally/Breakthrough-triggering unit glows immediately;
  // the target(s) it affected flash a beat later via flashCausalityTarget (game.js), a direct
  // DOM className toggle rather than a second transitionFlags cycle (see UI_FEEDBACK_UPGRADE_
  // PLAN.md §14, "source glow -> target flash").
  const causalitySource = transitionFlag === 'causality-source' ? ' fx-flash-positive' : '';
  const actionReady = actionIndicator?.kind === 'attack' ? ' action-ready' : '';
  const directReady = actionIndicator?.kind === 'direct' ? ' direct-hq-ready' : '';
  // Protection ring — keyed off REMAINING protection (maxArmorHits - armorHits), not the
  // card's static max, so a Heavy Armor unit's inner ring disappears after its first absorbed
  // hit and the outer ring after its second, matching "a layer of protection being consumed"
  // rather than a fixed decoration. Kept alongside the existing armor pips (exact numeric
  // count) rather than replacing them — the ring is the fast "still protected?" glance, the
  // pips are the precise "how many hits left" readout.
  const maxArmor = maxArmorHits(unit);
  const remaining = maxArmor - unit.armorHits;
  const armorRing = maxArmor > 0 && remaining >= 1 ? ' armor-ring' : '';
  const armorRingHeavy = maxArmor > 1 && remaining >= 2 ? ' armor-ring-heavy' : '';
  el.className = `board-card ${unit.owner} ${unit.state}${buffed ? ' buffed' : ''}${debuffed ? ' debuffed' : ''}${opponent ? ' opponent-card' : ''}${justSuppressed}${directHqSource}${armorAbsorbed}${causalitySource}${actionReady}${directReady}${armorRing}${armorRingHeavy}`;

  // Armor / Heavy Armor are tiers, not stacking keywords (maxArmorHits treats them the same
  // way — Heavy Armor wins outright) — but a Unit that starts with printed/granted Armor and
  // then gets upgraded (e.g. Field Repairs) ends up with both strings sitting in its keyword
  // set, since nothing removes the old 'Armor' entry on upgrade. Collapsing at display time
  // only, here, covers every provenance combination without needing to touch every grant site.
  const rawKwList = getKeywords(unit);
  const kwList = rawKwList.includes('Heavy Armor') ? rawKwList.filter(k => k !== 'Armor') : rawKwList;
  // Provenance styling (§3): printed (today's look, unchanged) / permanently granted (filled
  // background) / temporarily granted (dashed border + ⧗ glyph). getKeywords already merges
  // base+temp+granted+permanent into one deduped list for gameplay logic — this re-derives
  // provenance per keyword straight from the same 4 already-populated fields (no new grant-site
  // plumbing needed), printed taking priority over permanent over temporary so a redundant
  // grant of an already-printed/permanent keyword never downgrades its badge.
  const printedKws = Array.isArray(card.keyword) ? card.keyword : (card.keyword ? [card.keyword] : []);
  const kwHtml = kwList.map(k => {
    const provenance = printedKws.includes(k) ? 'printed'
      : (unit.permanentKeywords || []).includes(k) ? 'permanent'
      : 'temporary'; // must be tempKeywords/grantedKeywords — the only remaining source
    const provClass = provenance === 'permanent' ? ' kw-permanent' : provenance === 'temporary' ? ' kw-temporary' : '';
    const glyph = provenance === 'temporary' ? '⧗ ' : '';
    return `<span class="bc-kw-tag${provClass}"${KEYWORD_TEXT[k] ? ` data-tip="${esc(KEYWORD_TEXT[k])}"` : ''}>${glyph}${k}</span>`;
  }).join('');
  const abilityHtml = card.ability
    ? `<span class="bc-ability-pip" data-tip="${esc(card.ability)}">⚡</span>`
    : '';
  const bonus = (unit.tempSideBonus || 0) + (unit.grantedSideBonus || 0) + (unit.permanentSideBonus || 0) + (unit.objSideBonus || 0) + (unit.debugSideBonus || 0) + (unit.dynamicSideBonus || 0);
  const armorPips = maxArmor > 0
    ? Array.from({ length: maxArmor }, (_, i) =>
        `<span class="armor-pip ${i < remaining ? 'full' : 'spent'}">◆</span>`
      ).join('')
    : '';

  const CLS_ABBR = { Infantry:'INF', Tank:'TNK', Artillery:'ART', Aircraft:'AIR' };
  // rotatedDir only (Change Formation 124 / Field Engineer 91) — no owner/viewer swap.
  // A card's printed N/E/S/W always shows at physical N/E/S/W, matching hand and getSideValue
  // (see state.js — the matching P2_FLIP there was removed 2026-08-14 for the same reason).
  const rn = rotatedDir('n', unit.rotation), re = rotatedDir('e', unit.rotation);
  const rs = rotatedDir('s', unit.rotation), rw = rotatedDir('w', unit.rotation);
  const baseN = card[rn], baseE = card[re], baseS = card[rs], baseW = card[rw];
  // Match getSideValue (state.js) exactly: include each side's own perm_${d} bonus (Long
  // War Commander, H24 — previously missing here entirely, so a deployed H24 bonus would
  // show on neither side's number even though combat resolution already used it) and floor
  // at 0 (doc 01 §16 / doc 02 Q127 — previously unclamped here, so the debug panel's negative
  // buff could show an impossible negative stat the real combat math would never produce).
  const dn = Math.max(0, baseN + bonus + (unit[`perm_${rn}`] || 0));
  const ds = Math.max(0, baseS + bonus + (unit[`perm_${rs}`] || 0));
  const de = Math.max(0, baseE + bonus + (unit[`perm_${re}`] || 0));
  const dw = Math.max(0, baseW + bonus + (unit[`perm_${rw}`] || 0));
  // Any side no longer matching its printed value is flagged gold (increased) or red
  // (decreased) — every stat-changing effect (objective bonuses, Hero bonuses, command
  // effects, Inspire/Muster's live recalculation, the debug panel) funnels through the same
  // tempSideBonus/grantedSideBonus/permanentSideBonus/objSideBonus/debugSideBonus/
  // dynamicSideBonus fields, so
  // one comparison per side covers all of them.
  const dirClass = (val, base) => val > base ? ' class="bc-dir-up"' : val < base ? ' class="bc-dir-down"' : '';
  // Status strip (suppressed/destroyed state + rotation) — a flow row between the stats
  // grid and the keyword row, NOT position:absolute. The old .bc-rotation/.bc-state were
  // both pinned to the same bottom corners the keyword row naturally occupies (bc-dirs is
  // flex:1, so bc-keyword-row is always pushed to the card's bottom edge), which meant a
  // suppressed+rotated card with any keyword tag would visibly overlap "SUP"/"⟳" on top of
  // the tag text. Putting both in their own flow row before the keyword row removes the
  // collision structurally instead of only for today's specific cards.
  const actionCount = Math.max(0, Number(actionIndicator?.count) || 0);
  const actionTip = actionIndicator?.kind === 'attack'
    ? `${actionCount} attack${actionCount === 1 ? '' : 's'} remaining — click this Unit to choose from ${actionIndicator.targetCount} legal target${actionIndicator.targetCount === 1 ? '' : 's'}`
    : actionIndicator?.kind === 'direct'
      ? `No legal target — ${actionCount} automatic damage to ${actionIndicator.targetPlayer.toUpperCase()} HQ when you end the turn`
      : '';
  const actionStatus = actionIndicator?.kind === 'attack'
    ? `<span class="bc-status-icon bc-status-action attack" data-tip="${esc(actionTip)}">⚔×${actionCount}</span>`
    : actionIndicator?.kind === 'direct'
      ? `<span class="bc-status-icon bc-status-action direct" data-tip="${esc(actionTip)}">HQ×${actionCount}</span>`
      : '';
  const statusLeft = unit.state === 'suppressed'
    ? '<span class="bc-status-icon bc-status-suppressed" title="Suppressed — cannot attack">⊘ SUP</span>'
    : unit.state === 'destroyed'
      ? '<span class="bc-status-icon bc-status-destroyed" title="Destroyed">DEAD</span>'
      : actionStatus;
  const statusRight = unit.rotation
    ? `<span class="bc-status-icon bc-status-rotation" title="Rotated ${unit.rotation}°">⟳${unit.rotation}°</span>`
    : '';
  const statusStripHtml = (statusLeft || statusRight)
    ? `<div class="bc-status-strip"><span class="bc-status-left">${statusLeft}</span><span class="bc-status-right">${statusRight}</span></div>`
    : '';
  if (card && card.type === 'unit') {
    el.innerHTML = `
      <div class="bc-name">${card.name}</div>
      <div class="bc-dirs">
        <div></div>
        <div${dirClass(dn, baseN)}>${dn}</div>
        <div></div>
        <div${dirClass(dw, baseW)}>${dw}</div>
        <div class="bc-cls">${CLS_ABBR[card.cls] ?? card.cls}</div>
        <div${dirClass(de, baseE)}>${de}</div>
        <div></div>
        <div${dirClass(ds, baseS)}>${ds}</div>
        <div></div>
      </div>
      ${statusStripHtml}
      ${(kwHtml || abilityHtml) ? `<div class="bc-keyword-row">${kwHtml}${abilityHtml}</div>` : ''}
      ${armorPips ? `<div class="bc-armor">${armorPips}</div>` : ''}
    `;
  } else {
    el.innerHTML = `<div class="bc-name">${card?.name ?? '?'}</div>`;
  }

  return el;
}

// ── Hand rendering ────────────────────────────────────────────────────────────

// Render a player's hand into the element with the given id.
// selectedCardId: cardId currently selected (or null)
export function renderHand(handCardIds, containerId, selectedCardId, extras = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';

  handCardIds.forEach(cardId => {
    const card = CARD_BY_ID[cardId];
    if (!card) return;

    const div = document.createElement('div');
    let effectiveCostForAffordability = null;
    div.className = 'hand-card';
    if (cardId === selectedCardId) div.classList.add('selected');
    div.dataset.cardId = cardId;

    if (card.type === 'unit') {
      // col=null — no tile chosen yet, so a column-restricted discount shows optimistically.
      const discount = extras.playerState ? discountFor(extras.playerState, card, null) : 0;
      const displayCost = card.cost - discount;
      effectiveCostForAffordability = displayCost;
      const costHtml = discount > 0
        ? `<span class="hc-cost-discounted">${displayCost} ⛽</span>`
        : `${displayCost} ⛽`;
      if (discount > 0) div.classList.add('hc-tank-discounted');
      // Pending stat buff (Deathrattle: Convoy Escort 138) — queued for the next matching
      // class played, ANY copy in hand (not just one arbitrarily marked). Sums every matching
      // entry (checkPendingUnitBuff in combat.js does the same when it's actually consumed) so
      // a doubled trigger shows the full stacked amount. Shown as boosted N/E/S/W numbers in
      // gold, same convention as buildBoardCard's bc-dir-up — not a separate badge (2026-08-20
      // correction, per Filip: "in hand all navals should have increased stats... not like now").
      const pendingBuff = (extras.playerState?.pendingUnitBuffs ?? [])
        .filter(b => b.appliesTo === card.cls)
        .reduce((sum, b) => sum + b.amount, 0);
      if (pendingBuff > 0) div.classList.add('hc-buff-pending');
      const dn = card.n + pendingBuff, de = card.e + pendingBuff, ds = card.s + pendingBuff, dw = card.w + pendingBuff;
      const dirClass = pendingBuff > 0 ? ' class="bc-dir-up"' : '';
      const dirTip = pendingBuff > 0 ? ` data-tip="Queued bonus: +${pendingBuff} all sides when this is played"` : '';
      div.innerHTML = `
        <div class="hc-header">${card.name}</div>
        <div class="hc-cost">${costHtml}</div>
        <div class="hc-type">${card.cls}</div>
        <div class="hc-dirs"${dirTip}>
          <div></div><div${dirClass}>${dn}</div><div></div>
          <div${dirClass}>${dw}</div><div style="color:#444">·</div><div${dirClass}>${de}</div>
          <div></div><div${dirClass}>${ds}</div><div></div>
        </div>
        ${(() => {
        const kws = card.keyword ? (Array.isArray(card.keyword) ? card.keyword : [card.keyword]) : [];
        const kwTags = kws.map(k => `<span class="bc-kw-tag"${KEYWORD_TEXT[k] ? ` data-tip="${esc(KEYWORD_TEXT[k])}"` : ''}>${k}</span>`).join('');
        const abilityTag = card.ability ? `<span class="bc-ability-pip" data-tip="${esc(card.ability)}">⚡</span>` : '';
        return (kwTags || abilityTag) ? `<div class="bc-keyword-row">${kwTags}${abilityTag}</div>` : '';
      })()}
      `;
    } else if (card.type === 'command') {
      div.classList.add('hc-command');
      // Same discount as units above (Command Specialist's Hero Power applies here — see
      // discountFor's 'command' appliesTo — previously shown at full price regardless).
      const cmdDiscount = extras.playerState ? discountFor(extras.playerState, card, null) : 0;
      const cmdDisplayCost = card.cost - cmdDiscount;
      effectiveCostForAffordability = cmdDisplayCost;
      const cmdCostHtml = cmdDiscount > 0
        ? `<span class="hc-cost-discounted">${cmdDisplayCost} ⛽</span>`
        : `${cmdDisplayCost} ⛽`;
      div.innerHTML = `
        <div class="hc-header">${card.name}</div>
        <div class="hc-cost">${cmdCostHtml}</div>
        <div class="hc-type hc-command-label">COMMAND</div>
        <div class="hc-effect">${card.effect || ''}</div>
      `;
    } else {
      // objective (shouldn't normally be in hand, but handle gracefully)
      div.innerHTML = `
        <div class="hc-header">${card.name}</div>
        <div class="hc-type">Objective</div>
      `;
    }

    if (
      extras.playerState &&
      effectiveCostForAffordability != null &&
      extras.playerState.fuel < effectiveCostForAffordability
    ) {
      const shortfall = effectiveCostForAffordability - extras.playerState.fuel;
      div.classList.add('cant-afford');
      div.setAttribute('aria-disabled', 'true');
      div.dataset.tip = `Need ${shortfall} more Fuel`;
    }

    el.appendChild(div);
  });
}

// ── Hero rendering ────────────────────────────────────────────────────────────
// Two states, mirroring how a unit has a hand card and a board tile:
//   heroCardHtml   — 92x126, used in the deploy modal / pickers
//   heroPlacedHtml — 112x50, used inside a Hero Zone slot on the board
// Both consume the .hero-card / .hero-placed classes in css/game.css.

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

export function heroCardHtml(card) {
  const cost = card.powerType === 'active'
    ? `<span class="hx-cost">${card.activeCost}⛽</span>`
    : `<span class="hx-passive">PASSIVE</span>`;
  return `<div class="hero-card" data-hero-id="${card.id}">
    <div class="hx-head"><span class="hx-rank">&#9650;</span>${esc(card.name)}</div>
    <div class="hx-costrow">${cost}<span class="hx-scope">${(card.scope ?? 'board').toUpperCase()}</span></div>
    <div class="hx-type">Hero · ${card.rarity}</div>
    <div class="hx-effect">${esc(card.ability)}</div>
  </div>`;
}

export function heroPlacedHtml(card, owner, { ready = false, spent = false, picked = false, effectiveCost = null } = {}) {
  // effectiveCost reflects Priority Orders' discount / Radio Interference's tax on THIS
  // player's THIS column, when known (see renderHeroZones) — falls back to the printed cost.
  const shownCost = effectiveCost ?? card.activeCost;
  const costChanged = effectiveCost != null && effectiveCost !== card.activeCost;
  const cost = card.powerType === 'active'
    ? `<span class="hp-cost${costChanged ? (shownCost < card.activeCost ? ' hp-cost-down' : ' hp-cost-up') : ''}">${shownCost}⛽</span>`
    : `<span class="hp-passive">PASSIVE</span>`;
  const cls = `${owner}${ready ? ' ready' : ''}${spent ? ' spent' : ''}${picked ? ' picked' : ''}`;
  return `<div class="hero-placed ${cls}" data-hero-id="${card.id}">
    <div class="hp-name">${esc(card.name)}</div>
    <div class="hp-body">${cost}
      <span class="hp-pip" data-tip="${esc(card.ability)}">&#9432;</span>
    </div>
  </div>`;
}

// Fills both Hero Zone strips from state. A zone holding a hero drops its dashed
// placeholder chrome (.filled); empty zones keep it.
export function renderHeroZones(state, selectedZone = null, justActivatedKey = null) {
  for (const role of ['p1', 'p2']) {
    const strip = document.getElementById(`hero-zone-${role}`);
    if (!strip) continue;
    const ps = state[role];
    const zones = ps?.heroZones ?? [null, null, null, null];
    const isTheirTurn = state.initiative === role;
    strip.innerHTML = zones.map((heroId, col) => {
      const card = heroId != null ? CARD_BY_ID[heroId] : null;
      // While a Hero is picked up for repositioning, empty zones read as drop targets.
      const isDropTarget = isTheirTurn && selectedZone != null && selectedZone !== col;
      if (!card) {
        return `<div class="hero-zone-slot${isDropTarget ? ' drop-target' : ''}" data-hero-zone="${role}-${col}">HERO</div>`;
      }
      // Gold glow marks an activated power still available — per-Hero now (2026-08-17): each
      // deployed Hero tracks its own activation, so a spent Hero no longer dims its column-mates.
      const activatedThisTurn = ps.heroesActivatedThisTurn ?? [];
      const alreadyUsed = activatedThisTurn.includes(heroId);
      const ready = isTheirTurn && card.powerType === 'active' && !alreadyUsed;
      const spent = isTheirTurn && card.powerType === 'active' && alreadyUsed;
      const picked = isTheirTurn && selectedZone === col;
      // Effective cost accounts for Priority Orders (121)/Radio Interference (123), so the
      // number shown before activating matches what actually gets charged — previously always
      // showed the flat printed cost, which read as "broken" when a discount/tax was pending.
      const discount = ps.pendingHeroDiscount ?? 0;
      const tax = (ps.heroTaxedColumns ?? {})[col] ?? 0;
      // H25's printed cost escalates down each activation (see nextCraftCost, combat.js) —
      // the displayed cost must track that, not the static printed activeCost, to match what
      // tryActivateHero (game.js) actually charges.
      const baseCost = heroId === 'H25' ? nextCraftCost(ps) : (card.activeCost ?? 0);
      const effectiveCost = card.powerType === 'active' ? Math.max(0, baseCost - discount + tax) : null;
      // One-shot fire flash — the ready→spent state above is persistent, but nothing
      // previously marked the instant a power actually resolved. Covers the ~22 of 25 Heroes
      // that resolve straight through applyHeroPower's instant/targeted paths; H11 (rotate
      // modal), H16 (2-step maneuver), and H25 (Craft picker modal) resolve through separate
      // flows and don't set this yet — documented gap, not an oversight.
      const justActivated = justActivatedKey === `${role}-${col}`;
      return `<div class="hero-zone-slot filled${isDropTarget ? ' drop-target' : ''}${justActivated ? ' just-activated' : ''}" data-hero-zone="${role}-${col}">${heroPlacedHtml(card, role, { ready, spent, picked, effectiveCost })}</div>`;
    }).join('');
  }
}

// ── FxPopupText ───────────────────────────────────────────────────────────────
// A small floating label that appears at a screen position and rises/fades — for one-shot
// "this just happened" text that doesn't warrant a full log-only response (e.g. a blocked
// action). position:fixed + appended at body level, same reasoning as #floating-tip: never
// clipped by a tile's own overflow:hidden or the board's fitBoardArea transform:scale().
// Removes itself after the animation ends (with a timeout fallback in case animationend
// never fires, e.g. under prefers-reduced-motion where the animation is disabled outright).
export function showFxPopup(x, y, text) {
  const el = document.createElement('div');
  el.className = 'fx-popup-text';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.textContent = text;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 2000); // safety net only — animationend removes it at 1.6s normally
}

// ── FxConnector ──────────────────────────────────────────────────────────────
// Draws a fading line + arrowhead from fromEl's center to toEl's center, into the shared
// #fx-connector-svg overlay (game.html) — makes "this unit caused that" visible directly
// instead of only implied by the two flashing near-simultaneously. Takes already-resolved DOM
// elements (not tile keys) so it works for both board tiles and non-tile targets like the HQ
// number (flashDirectHit's el). Caller is responsible for timing this alongside whatever flash
// it's paired with (see the Rally and Direct Hit call sites in game.js).
export function drawFxConnector(fromEl, toEl) {
  const svg = document.getElementById('fx-connector-svg');
  if (!svg || !fromEl || !toEl) return;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', a.left + a.width / 2);
  line.setAttribute('y1', a.top + a.height / 2);
  line.setAttribute('x2', b.left + b.width / 2);
  line.setAttribute('y2', b.top + b.height / 2);
  line.setAttribute('class', 'fx-connector-line');
  line.setAttribute('marker-end', 'url(#fx-connector-arrow)');
  svg.appendChild(line);
  setTimeout(() => line.remove(), 1200);
}

// ── HQ / fuel / turn display ──────────────────────────────────────────────────

// Update #p1-hq, #p2-hq, #p1-fuel, #p2-fuel, #turn-display.
export function renderHQ(state) {
  document.getElementById('p1-hq').textContent = state.p1.hq;
  document.getElementById('p2-hq').textContent = state.p2.hq;
  document.getElementById('p1-fuel').textContent = `${state.p1.fuel} / ${fuelCapOf(state.p1)} Fuel`;
  document.getElementById('p2-fuel').textContent = `${state.p2.fuel} / ${fuelCapOf(state.p2)} Fuel`;
  const p1CardEl = document.getElementById('p1-cards');
  const p2CardEl = document.getElementById('p2-cards');
  if (p1CardEl) p1CardEl.textContent = `${state.p1.hand.length} in hand · ${state.p1.deck.length} in deck`;
  if (p2CardEl) p2CardEl.textContent = `${state.p2.hand.length} in hand · ${state.p2.deck.length} in deck`;
  const round = Math.ceil(state.turn / 2);
  document.getElementById('turn-display').textContent =
    `Round ${round} — ${state.initiative.toUpperCase()} to play`;

  const p1Block = document.getElementById('stat-p1');
  const p2Block = document.getElementById('stat-p2');
  if (p1Block && p2Block) {
    p1Block.classList.toggle('active-turn', state.initiative === 'p1');
    p2Block.classList.toggle('active-turn', state.initiative === 'p2');
  }
}

// ── Log ───────────────────────────────────────────────────────────────────────

// Append an array of strings to #game-log and scroll to bottom.
export function appendLog(entries) {
  const log = document.getElementById('game-log');
  if (!log) return;
  entries.forEach(text => {
    const div = document.createElement('div');
    div.className = 'log-entry';

    if (text.startsWith('---')) {
      div.classList.add('turn-marker');
    } else if (text.includes('wins!')) {
      div.classList.add('win-msg');
    } else if (
      text.includes('Not enough Fuel') ||
      text.includes('cannot enter') ||
      text.includes('no valid') ||
      text.includes('No valid targets') ||
      text.includes('no friendly') ||
      text.includes('not yet implemented')
    ) {
      div.classList.add('log-warn');
    } else if (text.includes('Destroyed') || text.includes('HQ damage') || text.includes('HQ dmg')) {
      div.classList.add('log-damage');
    } else if (text.includes('Suppressed') && !text.includes('un-suppressed')) {
      div.classList.add('log-suppressed');
    } else if (text.includes('armor absorbed')) {
      div.classList.add('log-absorbed');
    } else if (/L[1-4]:/.test(text)) {
      div.classList.add('log-objective');
    } else if (
      text.includes('un-suppressed') ||
      text.includes('gains') ||
      text.includes('buffed') ||
      text.includes('Draw') ||
      text.startsWith('Placed') ||
      (text.includes('+') && (text.includes('Fuel') || text.includes('HQ') || text.includes('sides') || text.includes('HP')))
    ) {
      div.classList.add('log-positive');
    }

    div.textContent = text;
    log.appendChild(div);
  });
  log.scrollTop = log.scrollHeight;
}
