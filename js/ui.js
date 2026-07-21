import { CARD_BY_ID } from './cards.js?v=1784635194';
import { getKeywords, maxArmorHits } from './state.js?v=1784635194';
import { getTerrain } from './maps.js?v=1784635194';

const TERRAIN_SHORT = { plains: 'P', forest: 'F', water: 'W', desert: 'D', city: 'C' };

// ── Board rendering ───────────────────────────────────────────────────────────

// Render the 4x4 board from state into the #board element.
// selectedTileKey: tile currently selected/highlighted (string or null)
// validDropKeys: Set of tile keys where the selected hand card can be placed (or null)
export function renderBoard(state, selectedTileKey, validDropKeys, changedKeys = null, flip = false) {
  const board = document.getElementById('board');
  board.innerHTML = '';

  const rows = flip ? [3,2,1,0] : [0,1,2,3];
  const cols = flip ? [3,2,1,0] : [0,1,2,3];

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

          // Hover tooltip
          const tooltip = document.createElement('div');
          tooltip.className = 'objective-tooltip';
          if (c >= 2) { tooltip.style.right = '100px'; tooltip.style.left = 'auto'; }
          else         { tooltip.style.left  = '100px'; tooltip.style.right = 'auto'; }
          const ctrlLabel = ctrl
            ? `<div class="obj-ctrl ${ctrl}">${ctrl.toUpperCase()} CONTROLS</div>`
            : `<div class="obj-ctrl neutral">NEUTRAL</div>`;
          const levels = [objCard.l1, objCard.l2, objCard.l3, objCard.l4];
          const levelHtml = levels.map((eff, i) => {
            const isCurrent = (i + 1) === obj.level;
            return `<div class="obj-tt-level${isCurrent ? ' current' : ''}"><span class="obj-tt-lnum">L${i+1}</span> ${eff ?? '—'}</div>`;
          }).join('');
          tooltip.innerHTML = `<div class="obj-tt-name">${objCard.name}</div>${ctrlLabel}${levelHtml}`;
          tile.appendChild(tooltip);
        }
      }

      // Unit on tile
      if (unit) {
        // Destroyed units are still shown (greyed out) so board state is clear
        tile.classList.add('has-unit');
        const viewer = flip ? 'p2' : 'p1';
        tile.appendChild(buildBoardCard(unit, viewer));
      } else if (validDropKeys?.has(key)) {
        tile.classList.add('valid-drop');
      }

      if (key === selectedTileKey) {
        tile.classList.add('highlight');
      }

      board.appendChild(tile);
    }
  }
}

function buildBoardCard(unit, viewer = 'p1') {
  const card = CARD_BY_ID[unit.cardId];
  const el = document.createElement('div');
  const buffed = unit.tempSideBonus > 0 || unit.grantedSideBonus > 0 || unit.debugSideBonus > 0 || (unit.tempKeywords?.length > 0) || (unit.grantedKeywords?.length > 0);
  const opponent = unit.owner !== viewer;
  el.className = `board-card ${unit.owner} ${unit.state}${buffed ? ' buffed' : ''}${opponent ? ' opponent-card' : ''}`;

  const kwList = getKeywords(unit);
  const kwHtml = kwList.map(k => `<span class="bc-kw-tag">${k}</span>`).join('');
  const abilityHtml = card.ability
    ? `<span class="bc-ability-pip">⚡<span class="bc-ability-tip">${card.ability}</span></span>`
    : '';
  const bonus = (unit.tempSideBonus || 0) + (unit.grantedSideBonus || 0) + (unit.objSideBonus || 0) + (unit.debugSideBonus || 0);
  const objBonus = unit.objSideBonus || 0;
  const maxArmor = maxArmorHits(unit);
  const remaining = maxArmor - unit.armorHits;
  const armorPips = maxArmor > 0
    ? Array.from({ length: maxArmor }, (_, i) =>
        `<span class="armor-pip ${i < remaining ? 'full' : 'spent'}">◆</span>`
      ).join('')
    : '';

  const CLS_ABBR = { Infantry:'INF', Tank:'TNK', Artillery:'ART', Aircraft:'AIR', Commander:'CMD', Naval:'NAV' };
  const dc = objBonus > 0 ? ' class="bc-dir-buffed"' : '';
  const dn = (opponent ? card.s : card.n) + bonus;
  const ds = (opponent ? card.n : card.s) + bonus;
  const de = (opponent ? card.w : card.e) + bonus;
  const dw = (opponent ? card.e : card.w) + bonus;
  if (card && card.type === 'unit') {
    el.innerHTML = `
      <div class="bc-name">${card.name}</div>
      <div class="bc-dirs">
        <div></div>
        <div${dc}>${dn}</div>
        <div></div>
        <div${dc}>${dw}</div>
        <div class="bc-cls">${CLS_ABBR[card.cls] ?? card.cls}</div>
        <div${dc}>${de}</div>
        <div></div>
        <div${dc}>${ds}</div>
        <div></div>
      </div>
      ${(kwHtml || abilityHtml) ? `<div class="bc-keyword-row">${kwHtml}${abilityHtml}</div>` : ''}
      ${armorPips ? `<div class="bc-armor">${armorPips}</div>` : ''}
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
      const tankDiscount = card.cls === 'Tank' ? Math.min(card.cost, extras.tankDiscount || 0) : 0;
      const displayCost = card.cost - tankDiscount;
      const costHtml = tankDiscount > 0
        ? `<span class="hc-cost-discounted">${displayCost} ⛽</span>`
        : `${displayCost} ⛽`;
      if (tankDiscount > 0) div.classList.add('hc-tank-discounted');
      div.innerHTML = `
        <div class="hc-header">${card.name}</div>
        <div class="hc-cost">${costHtml}</div>
        <div class="hc-type">${card.cls}</div>
        <div class="hc-dirs">
          <div></div><div>${card.n}</div><div></div>
          <div>${card.w}</div><div style="color:#444">·</div><div>${card.e}</div>
          <div></div><div>${card.s}</div><div></div>
        </div>
        ${(() => {
        const kws = card.keyword ? (Array.isArray(card.keyword) ? card.keyword : [card.keyword]) : [];
        const kwTags = kws.map(k => `<span class="bc-kw-tag">${k}</span>`).join('');
        const abilityTag = card.ability ? `<span class="bc-ability-pip">⚡<span class="bc-ability-tip">${card.ability}</span></span>` : '';
        return (kwTags || abilityTag) ? `<div class="bc-keyword-row">${kwTags}${abilityTag}</div>` : '';
      })()}
      `;
    } else if (card.type === 'command') {
      div.classList.add('hc-command');
      div.innerHTML = `
        <div class="hc-header">${card.name}</div>
        <div class="hc-cost">${card.cost} ⛽</div>
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

// ── HQ / fuel / turn display ──────────────────────────────────────────────────

// Update #p1-hq, #p2-hq, #p1-fuel, #p2-fuel, #turn-display.
export function renderHQ(state) {
  document.getElementById('p1-hq').textContent = state.p1.hq;
  document.getElementById('p2-hq').textContent = state.p2.hq;
  document.getElementById('p1-fuel').textContent = `${state.p1.fuel} / 6 Fuel`;
  document.getElementById('p2-fuel').textContent = `${state.p2.fuel} / 6 Fuel`;
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
