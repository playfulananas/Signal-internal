import { CARD_BY_ID } from './cards.js?v=1788275462';
import { getKeywords, maxArmorHits, discountFor, fuelCapOf, rotatedDir } from './state.js?v=1788275462';
import { getTerrain } from './maps.js?v=1788275462';
import { nextCraftCost } from './combat.js?v=1788275462';

const TERRAIN_SHORT = { plains: 'P', forest: 'F', water: 'W', desert: 'D', city: 'C' };

// Player-facing keyword rules text for the hover tooltip on .bc-kw-tag badges — see GDD
// Section 7. Only mapped keywords get a data-tip attribute; an unmapped one (e.g. a future
// keyword not yet documented here) silently shows no tooltip rather than an empty bubble.
const KEYWORD_TEXT = {
  'Armor': 'Absorbs 1 hit before Suppression — 3 hits total to destroy.',
  'Heavy Armor': 'Absorbs 2 hits before Suppression — 4 hits total to destroy.',
  'Guard': 'Adjacent enemies must attack this unit first.',
  'Double Attack': 'This unit resolves two attacks per activation.',
  'Bombard': 'Can attack any enemy in its row or column, not just adjacent tiles.',
  'Airborne': 'Ignores terrain placement restrictions.',
  'Deathrattle': 'When this Unit is Destroyed, its effect triggers immediately.',
};

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
export function renderBoard(state, selectedTileKey, validDropKeys, changedKeys = null, transitionFlags = null) {
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
        tile.appendChild(buildBoardCard(unit, 'p1', transitionFlags?.get(key)));
      } else {
        if (validDropKeys?.has(key)) tile.classList.add('valid-drop');
        // A destroyed unit is nulled out of state.board the instant it dies (see applyHit /
        // resolveSingleAttack) — there's no lingering "destroyed" card to animate, so the
        // flash plays on the now-empty tile itself instead.
        if (transitionFlags?.get(key) === 'destroyed') tile.classList.add('tile-just-destroyed');
      }

      if (key === selectedTileKey) {
        tile.classList.add('highlight');
      }

      board.appendChild(tile);
    }
  }
}

function buildBoardCard(unit, viewer = 'p1', transitionFlag = null) {
  const card = CARD_BY_ID[unit.cardId];
  const el = document.createElement('div');
  const buffed = unit.tempSideBonus > 0 || unit.grantedSideBonus > 0 || unit.debugSideBonus > 0 || unit.dynamicSideBonus > 0 || (unit.tempKeywords?.length > 0) || (unit.grantedKeywords?.length > 0) || (unit.permanentKeywords?.length > 0);
  const opponent = unit.owner !== viewer;
  const justSuppressed = transitionFlag === 'suppressed' ? ' just-suppressed' : '';
  el.className = `board-card ${unit.owner} ${unit.state}${buffed ? ' buffed' : ''}${opponent ? ' opponent-card' : ''}${justSuppressed}`;

  const kwList = getKeywords(unit);
  const kwHtml = kwList.map(k => `<span class="bc-kw-tag"${KEYWORD_TEXT[k] ? ` data-tip="${esc(KEYWORD_TEXT[k])}"` : ''}>${k}</span>`).join('');
  const abilityHtml = card.ability
    ? `<span class="bc-ability-pip" data-tip="${esc(card.ability)}">⚡</span>`
    : '';
  const bonus = (unit.tempSideBonus || 0) + (unit.grantedSideBonus || 0) + (unit.objSideBonus || 0) + (unit.debugSideBonus || 0) + (unit.dynamicSideBonus || 0);
  const maxArmor = maxArmorHits(unit);
  const remaining = maxArmor - unit.armorHits;
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
  const dn = baseN + bonus;
  const ds = baseS + bonus;
  const de = baseE + bonus;
  const dw = baseW + bonus;
  // Any side no longer matching its printed value is flagged gold (increased) or red
  // (decreased) — every stat-changing effect (objective bonuses, Hero bonuses, command
  // effects, Inspire/Muster's live recalculation, the debug panel) funnels through the same
  // tempSideBonus/grantedSideBonus/objSideBonus/debugSideBonus/dynamicSideBonus fields, so
  // one comparison per side covers all of them.
  const dirClass = (val, base) => val > base ? ' class="bc-dir-up"' : val < base ? ' class="bc-dir-down"' : '';
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
      ${(kwHtml || abilityHtml) ? `<div class="bc-keyword-row">${kwHtml}${abilityHtml}</div>` : ''}
      ${armorPips ? `<div class="bc-armor">${armorPips}</div>` : ''}
      ${unit.rotation ? `<div class="bc-rotation" title="Rotated ${unit.rotation}°">⟳${unit.rotation}°</div>` : ''}
      ${unit.state === 'suppressed' ? '<div class="bc-state">SUP</div>' : ''}
      ${unit.state === 'destroyed' ? '<div class="bc-state">DEAD</div>' : ''}
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
    div.className = 'hand-card';
    if (cardId === selectedCardId) div.classList.add('selected');
    div.dataset.cardId = cardId;

    if (card.type === 'unit') {
      // col=null — no tile chosen yet, so a column-restricted discount shows optimistically.
      const discount = extras.playerState ? discountFor(extras.playerState, card, null) : 0;
      const displayCost = card.cost - discount;
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
      const cmdCostHtml = cmdDiscount > 0
        ? `<span class="hc-cost-discounted">${cmdDisplayCost} ⛽</span>`
        : `${cmdDisplayCost} ⛽`;
      div.innerHTML = `
        <div class="hc-header">${card.name}</div>
        <div class="hc-cost">${cmdCostHtml}</div>
        <div class="hc-type hc-command-label">COMMAND</div>
        <div class="hc-effect">${card.effect || ''}</div>
      `;
    } else if (card.type === 'mission') {
      div.classList.add('hc-mission');
      div.innerHTML = `
        <div class="hc-header">${card.name}</div>
        <div class="hc-cost">${card.cost} ⛽</div>
        <div class="hc-type hc-mission-label">MISSION</div>
        <div class="hc-req">${card.req || ''}</div>
        <div class="hc-reward-strip">
          <div class="hc-reward-label">REWARD</div>
          <div class="hc-reward-text">${card.reward || card.effect || ''}</div>
        </div>
      `;
    } else {
      // objective (shouldn't normally be in hand, but handle gracefully)
      div.innerHTML = `
        <div class="hc-header">${card.name}</div>
        <div class="hc-type">Objective</div>
      `;
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
export function renderHeroZones(state, selectedZone = null) {
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
      return `<div class="hero-zone-slot filled${isDropTarget ? ' drop-target' : ''}" data-hero-zone="${role}-${col}">${heroPlacedHtml(card, role, { ready, spent, picked, effectiveCost })}</div>`;
    }).join('');
  }
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
    } else if (text.includes('COMPLETE')) {
      div.classList.add('log-mission');
    } else if (text.includes('mission active') || /L[1-4]:/.test(text)) {
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
