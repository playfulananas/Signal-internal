# Multiplayer test plan — 2026-09-01

Manual (or Playwright-scripted, two independent contexts) verification of online play. Can't be
folded into `selfplay_test.mjs`'s bot-vs-bot loop — that runs one page against itself locally;
this needs two real, independently-authenticated clients synced through the live Firebase
project (`signal-prototype-1eead` — no emulator exists in this repo, every run hits real
internet/Firebase).

## Setup

- `npm run dev` (serves on :3000).
- Two independent browser contexts so anonymous-auth identity and `localStorage` (display name,
  custom decks) don't collide — a normal window + an Incognito/private window, or
  `browser.newContext()` twice in Playwright (see `open_lobby_test.mjs` at repo root for the
  existing automated template of the open-lobby half of this).
- Both tabs point at `http://localhost:3000/index.html`.

## What's already known going in (don't re-discover, just confirm still true)

- **Lobby setup order bug (STATUS.md Open Items)**: code-share P1 sees Deck→Map→Wait; P2 sees
  Deck only, no map picker ever. Open-lobby P1 sees Map (on index.html)→Deck→Wait; P2 still sees
  Deck only. This is a known, unfixed gap — the test should confirm it reproduces exactly this
  way (not worse) rather than trying to fix it.
- **No disconnect detection on tab-close/crash** — only an explicit "Exit" button click notifies
  the other client (`setPlayerLeft` → `_playerLeft` flag → disconnect screen). Killing a tab or
  losing network leaves the other side hanging with no message. Confirm this is the actual
  behavior, not a regression.
- **No reconnect/resume** — reloading `game.html?game=...&role=...` mid-match restarts the picker
  flow rather than resuming. Confirm this is expected, not a crash.
- **Hero rosters and both hands sit in a world-writable Firebase node** — no privacy layer. Not
  something to fix here, just don't be surprised opening devtools shows the opponent's hand.

## New risk this session's work surfaces — test this first

Today's fix for H25 Craft (`CHANGELOG.md`, 2026-09-01) was for a **single-client** bug: browser
module-instance fragmentation from inconsistent `?v=` import strings, which caused a dynamically
registered card (`registerGeneratedCard` in `combat.js`, used by Craft and by Training Officer's
hand-buff) to be invisible to lookups from a different module instance *on the same page*.

That fix does **not** address a separate, likely-real problem across the network: `pushState`
(`firebase.js`) sends the whole game-state object as-is — a Craft-generated card sits in it only
as a bare string id like `"Craft-7"`. `registerGeneratedCard` mutates `CARD_BY_ID` at runtime
*only on the client that crafted it*. `normalizeFirebaseState` / `receiveRemoteState` (`game.js`)
never re-register anything into `CARD_BY_ID` on the *receiving* client. So the opponent's client
has no idea what `Craft-7` is.

**Predicted failure**: Player A activates H25 Craft, picks a candidate, and plays it onto the
board. Player B's client receives the new state, tries to render that board tile
(`CARD_BY_ID[unit.cardId]` inside `buildBoardCard`/`ui.js`), gets `undefined`, and either crashes
or renders a broken/blank card. Same risk for Training Officer's hand-buff clones the moment one
is placed.

**Test it explicitly**: get H25 or H19 into a real online match (fastest path: debug panel on
whichever client has the hero deployed — `TARGET: P1`/`TARGET: P2` buttons let you drive either
side's debug actions from one browser, but the actual craft/buff/place clicks still need to
happen through each respective client's own UI so the push/receive path is genuinely exercised).
Craft a candidate, play it to the board, and watch the **other tab's console and board render**
for the exact moment that card should appear. If this breaks, it's a real, separate bug from
today's fix — not something to patch inside this test session unless asked, just confirm and log
it clearly (repro steps + which line throws, if any).

## Core scenarios

1. **Open-lobby happy path, full game to a win.** Host (index.html) picks a map → deck; joiner
   sees the lobby row (map name only, no deck/hand leak) → joins → deck. Both mulligan
   independently. Play through at least one Hero deployment at round 2 on both sides, at least
   one Command, one Hero Active, a few attacks, and Direct HQ triggering naturally at end of turn
   — confirm both clients' boards/HQ/Fuel numbers match after every exchange, not just at the end.
   Play to an actual win and confirm both clients show the correct game-over screen (not just the
   winner's side).
2. **Code-share happy path**, same depth as #1, specifically to confirm the *different* (and
   already-known-different) lobby flow doesn't error anywhere P1/P2's screens diverge.
3. **Own-push echo check.** While one client acts, watch that client's own log/HQ update exactly
   once (not twice) — confirms the `_pushId` self-ignore logic (`game.js`) is still working after
   today's changes touched `game.js` extensively.
4. **Explicit Exit.** Either player clicks Exit mid-game; confirm the other client shows the
   disconnect screen and the match is unrecoverable (matches known behavior, not a regression).
5. **Hard tab close.** Kill one tab without clicking Exit; confirm the other client is silently
   left hanging (known gap — just confirm it's still exactly this, not worse, e.g. not an
   uncaught error spamming the console).
6. **A second, independent Craft/H19 check from the other player's side.** Confirmed by reading
   `cards.js`: `nextGeneratedCardSeq` (the counter behind `Craft-N` ids) is a plain per-page
   module-level `let`, starting at 1 on every fresh load — not derived from shared/pushed state.
   Two independent clients each crafting once will *both* produce a card literally named
   `Craft-1`, with unrelated stats/keywords, under the same id. Even a fix for issue #0's
   cross-client lookup gap that just "transmits the definition and re-registers by id" would
   break here, since the id isn't unique across clients. Test both players crafting/buffing at
   least once each in the same match and see what actually happens when both `Craft-1`s exist.

## After the run

Log results the same way this session's other findings were logged: real bugs go into
`CHANGELOG.md` with a fix + verification note; anything confirmed-as-already-known-and-unfixed
gets a one-line "still true" confirmation added to `STATUS.md`'s Open Items rather than a new
paragraph.
