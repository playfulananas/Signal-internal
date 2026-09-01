# Manual test checklist — everything from 2026-08-31 and 2026-09-01

Covers Run 1 (card content + rules engine migration), Run 2 (maps/objectives), the doc 02 rules
audit, the full card-by-card verification pass, and today's multiplayer work. Organized by what
to actually *do*, not by which commit fixed it — see `digital/CHANGELOG.md` for the full
blow-by-blow if you want the "why" behind any item.

**Where to play:** `https://playfulananas.github.io/Signal-internal/` — always current, no setup.
Local hotseat and vs-AI need only one browser tab; online multiplayer needs two (one Incognito).

## A. Five-minute sanity pass (do this first)

- [ ] Start a local hotseat game — map picker appears **before** the deck picker.
- [ ] Click a card in your hand — it responds (selects/shows placement). This exact thing was
      completely dead for most of Run 1 (a leftover `Number(cardId)` bug turned every hand-card
      id into `NaN`) — if clicking a card ever does nothing, this is priority-one.
- [ ] Place a unit, attack with it, end the turn. Basic loop works.
- [ ] Play to round 2 or later and confirm a Hero deployment prompt appears.

## B. Local / vs-AI — mechanics that were built or fixed

Play at least one full game (hotseat or vs AI) hitting as many of these as you can:

- [ ] **Guard** — a Guard unit forces adjacent attackers to hit it first, even if it's Suppressed.
- [ ] **Precision** — a Precision unit can bypass an enemy Guard.
- [ ] **Blast** (splash left/right) and **Barrage** (splash forward) each hit the extra tiles they're
      supposed to.
- [ ] **Rally, Inspire, Muster** — trigger each at least once (attack-declare, adjacency-aura,
      count-based respectively) and confirm the stated bonus actually applies.
- [ ] **Last Stand + Breakthrough** — destroy a Last Stand unit and separately have a Breakthrough
      unit destroy something; both should fire their card-specific effect.
- [ ] **Maneuver** — an Aircraft's "On Play: Maneuver 1 other friendly Unit" actually lets you pick
      a source and destination (this was entirely unwired before Run 1's closure pass).
- [ ] **Escalate** — play the same Escalate command twice in a match; the second use should be the
      boosted version.
- [ ] **Craft (H25 Chief Aircraft Engineer)** — activate it, pick one of 3 candidates, place it.
      Cost should start at 5 and drop by 1 each activation (5→4→3→2→1→1...) — check the Hero Zone
      display updates to match what's actually charged.
- [ ] **H22 Frontline Marshal** — activate it. Used to crash the page outright.
- [ ] **H24 Long War Commander** — activate its Active a couple of times; its Power should visibly
      affect combat (used to silently do nothing).
- [ ] **H19 Training Officer** — activate it with some 1-2 cost Units in hand; they should get
      buffed clones.
- [ ] **C16 Change Formation** and **C06 Coordinated Strike** — both used to crash or not work.
- [ ] **C18 Sacrifice Play** on a Guard unit — should deal 0 self-HQ damage (Guard blocks it),
      unlike **C19 Scorched Earth Raid**, which should deal its HQ effect even through Guard.
- [ ] **Direct HQ** — end a turn where a unit has no legal target; it should convert its remaining
      attack(s) into HQ damage automatically, but never on the very first player's very first turn.
- [ ] **Drawing from an empty deck** (Fatigue) — deal yourself down to an empty deck (or use the
      debug panel) and draw again; should deal escalating HQ damage (1, then 2, then 3...) instead
      of silently doing nothing.
- [ ] **Objectives** — control one of each of the 5 (Factory/Airfield/Supply Depot/City/Artillery
      Position) across a game or two and confirm both the universal HQ damage tick *and* the
      named secondary effect fire every level-up. These did literally nothing for a while after
      Run 1 (a stale numeric-id switch never matched the new card ids).
- [ ] Play on all 4 maps at least once (Stalingrad, Kursk, El Alamein, Ardennes) — Normandy and
      Midway are intentionally gone.

## C. Online multiplayer (today's work) — needs two browser windows

- [ ] **Lobby order**: host sees Map → Deck → Wait. Joiner only ever sees Deck (never a map
      picker), but the deck screen should show the map's name.
- [ ] **Simultaneous mulligan**: both windows land on their own mulligan screen at the same time,
      with no dependency on each other. Try it both ways — confirm quickly on one side while the
      other takes their time, and reverse who goes first on a second game.
- [ ] **Craft/Training Officer in a real match**: craft or buff a card, place/use it, and check the
      *other* window renders it correctly (this was a real crash — "Cannot read properties of
      undefined" — earlier today).
- [ ] **A full game to an actual win** — none of my automated checks played one all the way
      through. Worth doing once for real, watching that both windows' HQ/Fuel/board stay in sync
      after every action, not just your own.
- [ ] **Disconnect**: click Exit on one side mid-game, confirm the other shows "OPPONENT
      DISCONNECTED." Separately, just close a tab without clicking Exit — the other side goes
      quiet with no message. That's a known, accepted gap, not something to report.

## D. Known gaps — don't report these, they're intentional/tracked separately

- No custom deck-builder UI (8 fixed starter decks only).
- Hero rosters and both hands are technically readable by anyone with the game code/devtools
  (no privacy layer online) — flagged, not fixed, needs a bigger architecture change if it
  matters for real competitive play.
- Reloading mid-match restarts setup rather than resuming.
- Closing a tab (vs. clicking Exit) doesn't notify the other player.
