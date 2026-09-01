# SIGNAL — Gameplay UI & Visual Feedback Upgrade Plan

**Status:** Planning only — nothing in this doc has been implemented. No code has been changed
as part of producing this plan.

**Scope:** `digital/` prototype only — battlefield/board rendering, card preview, combat log,
Hero zones, HQ/Fuel display. Every fact below was verified directly against
`js/ui.js`, `js/game.js`, `js/combat.js`, `js/state.js`, `css/game.css`, and `ARCHITECTURE.md` /
`STATUS.md` on 2026-09-01 — this is not a generic "what a card game usually needs" doc.

---

## 1. Executive Summary

SIGNAL's rules engine is far ahead of its feedback layer. `STATUS.md` confirms all 16 keywords,
all 25 Hero powers, all 35 Commands, and the full Objective/Direct-HQ system are real and
tested — but the UI was built incrementally alongside a much simpler ruleset and never caught
up. Today the board communicates almost everything through one channel — **the text log** —
with exactly two moments (Suppression, Destruction) getting a dedicated one-shot animation, and
the "why does this card have these numbers" question **cannot currently be answered by the UI at
all** for a unit on the board (see §2, Card Preview row).

The good news: the visual language SIGNAL needs is already half-built and just needs to be
**named and finished**, not invented from scratch. Gold, red, and a teal-blue are already used
inconsistently for buff/damage/armor across the codebase — formalizing that into one documented
system (§5) and building 3-4 reusable primitives (§20) closes most of the gap without a rewrite.
The layout also already has the right bones: a dedicated left-side "CARD DETAIL" preview panel
sits right next to the board, unused for its full potential — it just shows static card-template
text today instead of the live, modified state of what's hovered.

Recommended sequencing: fix the highest-frequency, lowest-cost gaps first (§21 P0) — keyword
tooltip coverage, the suppression color contradiction, and turning the preview panel into a real
stat-source inspector — before touching anything animation-sequencing-related (§16), which is
the one part of this plan with real architectural cost.

---

## 2. Audit — Current Gameplay Feedback Systems

Verified against `js/ui.js` (`buildBoardCard`, `renderBoard`, `renderHand`, `renderHeroZones`),
`js/game.js` (`showCardPreview`, `showAttackPreview`, `commitState`/`transitionFlags`), and
`css/game.css`.

| System | Trigger | What the player sees | Clear? | Needs work? |
|---|---|---|---|---|
| **Owner border/bg color** | Unit is P1's or P2's | Blue border (P1) / red border (P2) on every board card | Yes | No — works well, keep |
| **Suppressed state** | `unit.state === 'suppressed'` | Card opacity 0.55, dashed border, small "SUP" text bottom-right | Partially | Yes — no icon, easy to miss at a glance across a full board (§7) |
| **Destroyed state** | `unit.state === 'destroyed'` | CSS class exists (`opacity:0.25, grayscale`) | N/A | **Effectively dead code** — `applyHit`/`resolveSingleAttack` null the tile the instant a unit dies, so a `board-card.destroyed` node is never actually rendered in normal play. Confirm before deleting. |
| **One-shot suppress flash** | Unit transitions to Suppressed this commit (`transitionFlags`) | 0.5s **gold** brightness+glow pulse (`suppress-flash`) | No | Gold is the game's positive/buff color everywhere else — flashing gold on a *debuff* actively contradicts the color language (§4 finding) |
| **One-shot destroy flash** | Unit transitions to Destroyed this commit | 0.45s red inset flash **on the now-empty tile** (unit is already gone) | Partially | Reads as "something happened here," not "this specific unit died" — no card-shaped moment, no cause attribution (§8) |
| **Buffed glow** | Any of `tempSideBonus/grantedSideBonus/debugSideBonus/dynamicSideBonus > 0` OR extra temp/granted/permanent keywords | Persistent gold box-shadow halo around the card | Partially | Binary only — a unit with +1 looks identical to a unit with +5; no equivalent halo exists for *debuffs* (§4, §7) |
| **Per-side stat arrows** | Displayed side value ≠ card's printed base for that side | Gold digit (increased) or red digit (decreased) per N/E/S/W | Yes, per-side | Good, cheap, keep — but tells you *that* it changed, never *why* (§11) |
| **Armor pips** | `maxArmorHits(unit) > 0` | Diamond ◆ icons top-right, gold = remaining, dim = spent, count = 1 (Armor) or 2 (Heavy Armor) | Yes for count/state | No feedback at all on the moment a hit is absorbed — no flash, no `transitionFlags` case for it (§7) |
| **Rotation indicator** | `unit.rotation` set (Change Formation / Field Engineer) | "⟳90°" text bottom-left | Yes | Fine as-is for a low-frequency effect |
| **Keyword tags + tooltip** | Unit/hand card has a keyword | Gold-outlined tag; hover shows rules text — **only for 5 of the 16 live keywords** (`KEYWORD_TEXT` in `ui.js` covers Armor, Heavy Armor, Guard, Double Attack, Bombard; also 2 dead entries for retired Airborne/Deathrattle) | No | Precision, Blast, Barrage, Breakthrough, Rally, Inspire, Muster, Last Stand, Maneuver, Escalate, Craft — 11 keywords — show a tag with **no tooltip at all** (§6, cheapest fix in this whole plan) |
| **Ability pip (⚡)** | Card has `card.ability` text | Hover tooltip with the raw ability text | Yes | Static only — never says whether/how it's currently relevant |
| **Objective tile system** | Tile has an objective | Header badge, controller-colored background, 4 level-dots (done/active/future), rich hover tooltip with all 4 levels and current one highlighted | Yes | Best-built feedback system in the game today. No "just captured" or "just leveled up" moment though — control/level changes render silently between turns (§4 finding) |
| **"Changed tile" (opponent's last move)** | Tracked board-diff since last render | Gold inset outline on the tile | Yes, subtle | Board-only — doesn't cover hand size, Hero Zone, or Fuel changes |
| **Turn-start toast** | Turn changes | Full-screen centered "ROUND N — PX TO PLAY" banner, 1.2s flash-and-fade | Yes | Only feedback system with real timing/animation polish — good reference point for what "restrained but noticeable" should look like elsewhere |
| **Card preview panel ("CARD DETAIL")** | Hover hand card / board unit / Hero / objective | Name, cost, N/E/S/W, keyword tags, ability text | **No, for board units** | **Biggest single gap in the game.** `showCardPreview(unit.cardId)` reads only `CARD_BY_ID` — the static template. A board unit with +3 from three different sources, Suppressed, with 1 armor pip left, shows **exactly the same panel as its unplayed hand copy.** No current values, no state, no armor, nothing (§11) |
| **Attack (targeting) preview** | Hovering a legal target while an attacker is selected | Live `getSideValue`-computed attack/defense numbers, HIT/BLOCKED badge, outcome text ("Armor absorbs", "Suppressed — 1 HQ damage", etc.) | Yes | The one place live combat math is actually shown — good model to extend elsewhere |
| **Direct HQ damage** | End-of-turn `evaluateDirectHQ` sweep | A log line only | No | **Zero dedicated visual feedback of any kind** — no flash on the HQ number, no toast, nothing distinguishes it from any other HQ damage source (§9) |
| **Fuel / HQ numbers** | Any change | Plain text update, no transition | No | No delta popup, no color flash on drop, no distinction between "spent on a card" vs "lost to fatigue" vs "Direct HQ" |
| **Active-turn stat block** | `state.initiative` | Border/glow highlight on the active player's stat block | Yes | Fine, low-frequency |
| **Hero Zone ready/spent/picked** | Hero Power availability this turn | Gold glow (ready) / dim (spent) / gold border (picked for reposition) | Yes for state | No moment marks the instant a Hero Power actually **fires** — a passive triggering (Inspire, Objective Marshal, Counteroffensive General, etc.) produces zero visual cue at the source, only a result glow on whatever it affected (§10) |
| **Combat log color-coding** | Text-content string matching in `appendLog` (`ui.js`) | 8 color categories: turn marker, win, warning, damage, suppressed, absorbed, positive, mission/objective | Yes, readable | Purely sequential text; no link back to the battlefield tile/card it describes (§14, §18) |
| **Hand card afford/discount state** | Fuel available; active discount sources | Dimmed + `cant-afford` if unaffordable; gold-highlighted discounted cost | Yes | Good, keep as-is |
| **`.opponent-card` CSS hook** | `unit.owner !== viewer` | Class is applied in `buildBoardCard` | N/A | **Dead code** — no matching CSS rule exists anywhere in `game.css`. Confirm intent before either wiring it up or removing it |
| **Terrain restriction feedback** | Attempting to place a Tank in Forest | Nothing — the tile simply isn't in `validDropKeys`, so it looks identical to a tile blocked for any other reason (occupied, etc.) | No | No distinct "blocked by terrain" affordance exists at all (§4 finding) |

---

## 3. Problems With the Current Feedback System

Ranked roughly by how often a player would hit the gap in a normal match:

1. **Board-unit hover tells you nothing live.** The single most-used inspection surface in the
   game (hover any unit) reads from the static card template, not the actual `BoardUnit`. This
   is the direct blocker for the GDD-level ask "why is this unit's Attack 5 instead of 3."
2. **11 of 16 keywords have no tooltip.** A new player sees "RALLY" or "MUSTER" as an opaque
   gold tag with no way to learn what it does without leaving the game.
3. **Armor absorbing a hit — arguably the single most tactically important moment in a fight
   with Armor units — has no feedback whatsoever.** No flash, no popup, no log-tile link. It's
   invisible except as a one-line log entry.
4. **The suppression flash is gold**, the game's established "good thing happened" color,
   applied to a debuff. This isn't a taste nitpick — it will actively teach players the wrong
   association the moment a second, real positive-flash system is introduced elsewhere.
5. **Direct HQ has zero distinguishing treatment.** It's arguably the mechanic most likely to
   confuse a new player ("why did my HQ take damage, nothing attacked it?") and it gets the
   least feedback of any HQ-damage source in the game.
6. **Hero/passive causality is invisible.** The result of a passive (a stat glow, a card drawn)
   is visible; the *source* never lights up. A player who didn't read every card's ability text
   has no way to learn "oh, that was Objective Marshal."
7. **Debuffs are visually second-class.** Buffs get a persistent halo (`.buffed`); debuffs get
   only a per-side red digit, no card-level frame. A unit debuffed on 3 of 4 sides doesn't read
   as "this card is currently weak" the way a buffed unit reads as "this card is currently strong."
8. **No terrain-blocked affordance.** A player dragging a Tank toward Forest gets no feedback
   explaining *why* those tiles won't light up green.
9. **No "just captured" / "just leveled up" moment for Objectives**, despite Objectives having
   the best *ongoing*-state UI in the game. Control and level are recalculated silently between
   turns.
10. **Log and battlefield are two disconnected systems.** Nothing links a log line back to the
    tile/card it describes — no hover-to-highlight, no click-to-jump.
11. **No sequencing model at all.** Every mutation from a single action (e.g., an attack that
    triggers Blast + breaks Armor + triggers Rally + kills a unit + fires Last Stand) resolves
    in one synchronous state update. The board just redraws in its final state; the *order* in
    which things logically happened is only reconstructable by reading the log top-to-bottom.
    This isn't a "make it prettier" gap — for a multi-effect turn, it's currently the only reason
    a player wouldn't just be confused. See §16.
12. **Destroyed-unit CSS is dead code** and **`.opponent-card` is an inert hook** — small
    findings, but worth a cleanup pass alongside this work so nobody debugs a "why doesn't this
    class do anything" mystery later.

---

## 4. Complete Gameplay Event/State Inventory

Organized by category, grounded in the actual implemented systems (`STATUS.md`,
`ARCHITECTURE.md`'s Keyword Resolution table, `combat.js`, `game.js`). "Current" = what §2 found;
blank means nothing exists today.

### Damage & Combat
| Event | Source | Current feedback |
|---|---|---|
| Normal hit → Suppressed | Any successful attack, 1st hit | Log line + `just-suppressed` flash (gold — see finding) |
| Normal hit → Destroyed | Any successful attack, 2nd hit (post-Suppressed) | Log line + tile flash |
| Armor absorbs a hit | Attack vs Armor/Heavy Armor unit, hits remaining | Log line only |
| Failed attack (blocked) | Attacker value < defender value, or Guard blocks | Log line only (attack preview shows it *before* the click, nothing *after*) |
| Direct HQ damage | End-of-turn sweep, unit with no legal target | Log line only |
| Objective HQ backbone (1/1/2/2) | Controlled objective, resolved every turn | Log line only |
| Objective secondary effect (per O1-O5, per level) | Same | Log line only |
| Blast secondary hits | Successful hit with Blast | Log lines, indented `(secondary) ->` prefix (only chained-effect log convention that exists today) |
| Barrage secondary hits | Successful hit with Barrage | Same as Blast |
| Double Attack 2nd hit | Unit with Double Attack completes 1st attack | Re-enters normal attack flow, no distinct marker that "this is hit 2 of 2" |
| Fatigue damage (empty-deck draw) | Failed draw, escalating 1/2/3 | Log line only |

### Protection
| Event | Source | Current feedback |
|---|---|---|
| Armor granted (printed or via effect) | Card has Armor/Heavy Armor, or a granting effect | Persistent pip display |
| Armor consumed (see above) | — | none beyond log |
| Guard blocking legal targets | Any Guard unit adjacent and not Suppressed | No board indicator that "you must attack this unit" beyond `getAttackableTargets` silently filtering |

### Buffs / Debuffs / Stat Changes
| Event | Source | Current feedback |
|---|---|---|
| Temporary stat bonus (Command, Hero Power, "until your next turn") | `tempSideBonus` | Gold halo + per-side gold digit |
| Permanent stat bonus | `grantedSideBonus`/`permanentKeywords` route | Same, visually identical to temporary — no way to tell "this is forever" vs "this expires next turn" |
| Dynamic aura bonus (Inspire, Muster) | Recalculated live via `recalculateDynamicStats` | Folds into the same generic bonus number — no attribution to Inspire vs Muster vs a Command |
| Objective-granted bonus (`objSideBonus`) | Controlling certain Objectives | Same generic bucket |
| Debuff (negative `tempSideBonus`, e.g. enemy-applied) | Command/Hero effect | Red per-side digit only, **no card-level frame** |
| Temporary keyword grant | e.g. Dig In's Guard grant, cleared `startOfTurn` | Keyword tag appears, visually identical to a printed keyword |
| Permanent keyword grant | e.g. Breakthrough/Blitzkrieg Order grants | Same, no distinction from temp grant |
| Cost discount (hand) | `discountFor` — Tank/Command discounts, Hero Command Specialist | Gold-highlighted discounted cost text |
| Cost tax/increase (Hero Zone) | Radio Interference etc. | `hp-cost-up` class exists in `heroPlacedHtml` |
| Fuel cap increase (Logistics Chief) | Hero deployed | Text only (`X / 11 Fuel` vs `X / 9`) |
| Rotation (Change Formation / Field Engineer) | On-play choice | Persistent "⟳90°" label |

### Keywords (all 16 live — see ARCHITECTURE.md)
| Keyword | Current feedback beyond a static tag |
|---|---|
| Guard | none (tooltip exists) |
| Precision | none (no tooltip) |
| Armor / Heavy Armor | pips (tooltip exists) |
| Bombard | none beyond wider targeting UI (tooltip exists) |
| Blast / Barrage | indented log lines only (no tooltip) |
| Double Attack | none (tooltip exists) |
| Breakthrough | none (no tooltip) |
| Rally | none (no tooltip) |
| Inspire / Muster | folds into generic stat bonus (no tooltip, no "currently affecting N units" info) |
| Last Stand | none (no tooltip) |
| Maneuver | 2-click UI flow exists, no post-move flourish (no tooltip) |
| Escalate | none — no indicator a card is now in its "upgraded" state (no tooltip) |
| Craft | modal exists for the pick (no tooltip on the resulting keyword tag) |

### Movement / Positional
| Event | Source | Current feedback |
|---|---|---|
| Unit placed | Hand → board | Card renders on tile, no entrance animation |
| Unit moved (Maneuver) | On-play or Hero/Command effect | Instant re-render at new tile, no travel animation |
| Rotation | Change Formation / Field Engineer | Text label only |

### Resource / Economy
| Event | Source | Current feedback |
|---|---|---|
| Fuel gain (turn start, +3) | `startOfTurn` | Text update only |
| Fuel spent (playing a card / activating a Hero) | Any paid action | Text update only |
| Fuel capped (gain clamped at cap) | Over-cap gain | Nothing distinguishes "you gained less than expected" |
| Pending/delayed Fuel gain | Industrial Surge-type effects | Nothing until it actually lands |
| Max Fuel changed | Logistics Chief deploy/undeploy | Text only |
| Draw a card | Any draw effect | Hand re-renders, no card-arrival flourish |
| Discard (hand-cap overflow) | Hand at 10, new card would enter | Nothing — nothing currently reads the Discard Pile, per `STATUS.md` |

### Hero Layer
| Event | Source | Current feedback |
|---|---|---|
| Hero deployed to a zone | Hero Phase | Zone fills, no entrance flourish |
| Hero repositioned | Reposition action | Instant re-render |
| Active Power activated | Player click, cost paid | Zone flips ready→spent, no fire moment |
| Passive Power triggers | Various conditions (Objective Marshal, Infantry Commander, Counteroffensive General, Emergency Logistics Officer) | Result-only (whatever it affected gets its normal stat-change feedback); source never highlighted |

### Objectives
| Event | Source | Current feedback |
|---|---|---|
| Control gained/lost | Majority-adjacent recalculation | Background color changes on next render, no transition |
| Level escalates (L1→L2 etc.) | Turn count | Dot track updates, no transition |
| Multiple objectives resolving same turn | Column-major fixed order | Sequential log lines, no visual ordering cue |
| Lethal-stop (objective damage kills) | Backbone/secondary would overkill | Log-only |

### Terrain
| Event | Source | Current feedback |
|---|---|---|
| Placement blocked by terrain (Forest vs Tank) | `canPlaceOnTerrain` | None — tile just isn't highlighted |

---

## 5. Proposed Visual Feedback Language

**Core recommendation: formalize what already exists rather than invent a parallel system.**
The codebase already, informally, uses:

| Token (existing CSS var) | Value | Already means | Formalize as |
|---|---|---|---|
| `--gold` `#f0c030` | positive/ready/active/buffed | **Positive** (buff, repair, bonus, Inspire, ready, capture) |
| `--red` `#dd3344` | damage, decreased stat | **Negative** (debuff, damage, danger) |
| `--log-absorb` `#4488aa` (teal-blue) | already used for "armor absorbed" log lines only | **Protection** (Armor, Heavy Armor, damage prevention) |
| `bc-rotation`'s `#88ccff` (light blue) | already used for rotation label only | **Movement** (move, rotate, forced movement) |
| `--p1` `#5599ff` / `--p2` `#ff5555` | player identity | **reserved — never reused for state/category meaning** |

Two additions needed, since nothing currently fills these roles:

| New token | Suggested value | Category |
|---|---|---|
| `--destroy` | a darker/more saturated crimson than `--red`, e.g. `#a81f2e` | **Destruction** — distinct from ordinary damage-red so a kill reads as more severe than a stat debuff |
| `--trigger` | reuse `--gold` at higher intensity/faster pulse rather than a new hue | **Triggered ability** (passive/Hero/keyword activation) — sharing gold with "positive" is fine since triggers are usually beneficial to their owner; distinguish by *motion* (pulse from source) not color |

### Category → treatment matrix

| Category | Color | Icon language | Frame treatment | Timing | Battlefield indicator | Tooltip/history |
|---|---|---|---|---|---|---|
| **Positive** | gold | ▲ / + | persistent halo while active | 300-400ms arrival flash, then settles to persistent halo | per-side gold digit (exists) | preview panel breakdown (§11) |
| **Negative** | red | ▼ / − | persistent dim/red-tinted frame (new — parity with buff halo) | same as positive | per-side red digit (exists) | preview panel breakdown |
| **Protection** | teal-blue | ◆ pip (exists) | outer ring/frame, segment count = hits remaining | 250ms "crack" flash per pip consumed | pip count (exists, needs the flash) | keyword tooltip: "N hits absorbed of M" |
| **Damage** | red → crimson for lethal-tier | numeric floater ("-1 HQ") | tile inset flash (exists for destroy) | 300-450ms | flash on target + HQ number if HQ-directed | log (exists) |
| **Destruction** | crimson (`--destroy`) | ✕ or shatter icon | full-card scale/fade sequence (needs the node held one extra frame — see §8) | 600-800ms, Tier 1 | tile flash (exists, strengthen) | log (exists) |
| **Triggered ability** | gold, faster pulse | ability's own icon (⚡ ability pip already exists) | source glow (new) | 200ms source pulse → 200ms travel → 300ms target arrival | connector line/pulse source→target (new, optional) | preview panel + tooltip |
| **Movement/positional** | light blue | ⟳ (exists for rotation) | brief outline trail | 300-400ms | ghost trail or simple fade-move | none needed |
| **Resource/economy** | gold (gain) / red (loss) | ⛽ | number tick, no frame | <150ms, Tier 3 | small floating "+1"/"-1" near the fuel readout | none needed |

---

## 6. Keyword Tooltips

Extend `KEYWORD_TEXT` in `ui.js` to cover all 16 live keywords (currently 5 of 16, plus 2 dead
entries for retired Airborne/Deathrattle that should be removed). This is the cheapest, highest
ROI fix in the entire plan — pure content, zero architecture change.

Draft copy (rules-accurate per `ARCHITECTURE.md`'s Keyword Resolution table — tighten wording
against the GDD before shipping, this is a first pass):

- **Precision** — Ignores Guard. Can target any legal enemy directly.
- **Blast** — On a successful hit, also hits the enemies directly left/right of the target.
- **Barrage** — On a successful hit, also hits enemies further along the same line, no blocker.
- **Breakthrough** — When this unit destroys an enemy, a bonus effect triggers.
- **Rally** — Triggers whenever this unit attacks, whether or not the attack succeeds.
- **Inspire** — Adjacent friendly units get +1 to all sides for each adjacent Inspire source.
- **Muster** — +1 to all sides for every other friendly Infantry you control, anywhere on the board.
- **Last Stand** — Triggers an effect the moment this unit is destroyed.
- **Maneuver** — Move a friendly unit to any empty legal tile.
- **Escalate** — This card's effect upgrades after its first use each match.
- **Craft** — Generates aircraft candidates to choose from; cost drops with each use.

**Dynamic augmentation (Medium effort, do after the static pass):** Inspire/Muster tooltips
should append live state, e.g. *"Inspire — currently boosting 2 adjacent units."* This needs
`computeDynamicSideBonus`/`recalculateDynamicStats` (`combat.js`) to also return which tiles
it's currently affecting, not just the summed bonus — a small return-shape addition, not a
rewrite.

---

## 7. Suppression — Concepts & Recommendation

Current: opacity 0.55 + dashed border + "SUP" text + a **gold** one-shot flash (see §3 finding #4).

**Concepts considered:**
1. *Overlay icon only* — a static badge (e.g. a broken-radio or "!" icon) in a fixed corner.
   Cheap, but weak at a glance across a crowded board.
2. *Desaturation + icon* (recommended) — combine the existing opacity/grayscale-lean with a
   single unambiguous icon badge, replacing the small text label (a text label competes with
   the armor pips and keyword tags for the same limited card real estate at ~90px card width).
3. *Frame modification* — dashed border (already exists) is a reasonable "reduced/damaged"
   language and should stay; it reads well at a glance once paired with an icon.
4. *Full reskin (grayscale + heavy desaturation)* — rejected: at card sizes this small, heavy
   desaturation makes the keyword tags/armor pips hard to read exactly when the player most
   needs to check them (a Suppressed unit's remaining armor still matters for objective-control
   math).

**Recommendation:** keep opacity 0.55 + dashed border (already correct), replace "SUP" text with
a small icon badge (top-left, mirroring armor pips' top-right position), and **recolor the
transition flash from gold to red** — this single fix directly resolves finding #4. On
suppression *removal* (a real event today — the un-suppressed log line already exists and is
color-coded), add a matching brief **gold** flash (correctly positive this time) as the state
clears, currently unanimated.

---

## 8. Destruction — Treatment

**Constraint that shapes this section:** `resolveSingleAttack`/`applyHit` null the board tile
the instant a unit is Destroyed — there is no "destroyed but still rendered" state to animate in
the current data model. Today's flash lives on the *empty tile*, which is why it reads as weaker
than it should.

**Recommended sequence (Tier 1, ~700ms total):**
1. **Impact (0-150ms):** brief crimson flash directly on the dying card (requires holding the
   node for one extra render — see Complexity note below).
2. **Shake (100-250ms):** a short, small-amplitude shake on the card — communicates "hit," not
   "explosion." Restrained, matches the tactical tone.
3. **Collapse (250-550ms):** card scales down slightly and fades out — this is the "this unit is
   gone" beat.
4. **Settle (550-700ms):** tile clears to empty, matching the existing (kept) `tile-just-destroyed`
   red inset flash as a trailing confirmation.

**Complexity note:** step 1-3 require the render pipeline to know "this tile *was* occupied by
this unit and is dying," not just "this tile is now empty." Cleanest approach: `commitState`
already builds a `transitionFlags` map — extend it so a `'destroyed'` entry also carries the
last-known `BoardUnit`/card data, and have `renderBoard` render that ghost card for one
animation-length render pass before the tile goes fully empty. This is a real (if small)
architecture change, not pure CSS — flagged **Medium**, not Small, unlike most of §6-7.

**Fallback if the above is deprioritized:** strengthen the current empty-tile flash with a
card-silhouette icon + the destroyed unit's name as a floating text ("Panzer IV destroyed"),
which needs no held-node change since it can read straight from the log entry that's already
generated at the same moment.

---

## 9. Direct HQ Hits — Treatment

Currently zero dedicated feedback (§3 finding #5) — this is likely the single most confusing
moment for a new player, since "my HQ took damage and nothing visibly attacked it" has no
on-screen explanation without reading the log.

**Recommended (Tier 1, restrained — no arcade flourish, matches the "tactical WW2" tone):**
- Brief **"DIRECT HIT"** text stamp, appears near the affected player's stat block (not
  screen-center — keep it attributable to *whose* HQ, avoid ambiguity in a 2-player layout where
  both stat blocks are on-screen simultaneously).
- The HQ number itself gets a short scale-pulse + red flash, reusing the same flash mechanism as
  suppression/destruction rather than a bespoke animation.
- No screen-shake, no full-screen flash — those read as arcade-y and this is a tactical game
  where both players' full state stays visible at all times; a screen-wide effect would
  needlessly obscure the board mid-effect.
- Sound cue (optional, P2/deferred per §21): a short, low "thud" distinct from the normal
  attack-hit sound if/when sound is added at all — SIGNAL currently has no audio layer.

This reuses the exact same flash primitive recommended in §5/§20 (`FxFlash`), just applied to
the HQ number element instead of a board tile — no new animation system needed, just a new
target for the existing one.

---

## 10. Buff/Debuff/Stat-Source Inspection

This is the direct fix for §2's biggest finding: board-unit hover shows the static card
template, not live state.

**Recommendation: rebuild `showCardPreview` for board units to read the live `BoardUnit`, not
just `CARD_BY_ID`.** Put the breakdown in the existing `card-preview` panel (`#cp-dirs`) rather
than a new floating element — the panel already sits directly left of the board for exactly this
purpose and is currently underused.

Cleanest layout given the panel's existing narrow-column constraints (see current `.cp-dir-row`
markup):

```
┌─ CARD DETAIL ──────────────┐
│ PANZER IV                  │
│ Tank · 2 Fuel               │
│ ──────────────────────────  │
│ N  5  (base 3, +1 Inspire,  │
│         +1 Objective L2)    │
│ E  2  (base 2)               │
│ S  4  (base 5, -1 Suppressed)│
│ W  2  (base 2)               │
│ ──────────────────────────  │
│ ◆ Armor: 1 of 2 remaining   │
│ STATE: Suppressed            │
│ ──────────────────────────  │
│ [Armor] [Bombard]            │
│ "Can attack any enemy in    │
│  its row or column..."       │
└─────────────────────────────┘
```

**Data-model requirement (this is the real cost here, Medium effort):** right now
`tempSideBonus`/`grantedSideBonus`/`objSideBonus`/`dynamicSideBonus` are just numbers — the
*reason* is only ever a string in a log line, never attached to the state itself. To show a
per-source breakdown, each bonus needs to become a small list of `{ amount, label }` entries
(e.g. `[{amount:1, label:'Inspire'}, {amount:1, label:'Objective L2'}]`) instead of a single
summed number, with the sum still derived from the list for `getSideValue`. This touches every
site in `combat.js`/`game.js` that currently does `tempSideBonus += n` — real but mechanical
work, not a redesign.

**For the other 8 hover cases the brief asks about:**

| Hover target | What should show (beyond what already works) |
|---|---|
| Normal unit | Base stats, no breakdown needed (current behavior is already fine here) |
| Buffed unit | Full breakdown as above, gold-tinted values |
| Debuffed unit | Same breakdown, red-tinted values |
| Suppressed unit | Breakdown + explicit "STATE: Suppressed — cannot attack" line |
| Armored unit | Breakdown + "Armor: N of M remaining" |
| Unit affected by another card | Same breakdown mechanism covers this — "another card" is just another `{amount, label}` entry |
| Hero | Already works (ability text) — add: for a *deployed* Hero, whether its power is ready/spent this turn |
| Keyword (tag hover) | Covered by §6 |
| Objective | Already the best-built system in the game (§2) — no change needed |

---

## 11. (folded into §10 above per the brief's own numbering — see §10 for the full
stat-source design; kept as a pointer so section numbers stay traceable to the brief.)

---

## 12. Passive Effects — Trigger Visualization

The brief calls this out as particularly important, and the audit agrees (§3 finding #6): a
passive changing the game with zero attribution is the single biggest "invisible causality" risk
in a game with this many Hero/Objective/dynamic-aura interactions.

**Recommended reusable pattern ("causality pulse"), applied uniformly to every passive/Hero/
keyword trigger:**

1. **Source glow (~200ms):** the triggering element (Hero Zone slot, or the board unit carrying
   Inspire/Muster/Rally/etc.) gets a brief gold outline pulse.
2. **Optional connector (~150ms, P2/stretch — see §21):** a simple line or traveling dot from
   source to each affected target. Skippable/omittable without losing comprehension — the
   before/after stat change already carries most of the information; the connector is a nice-to-
   have for legibility in a crowded board, not load-bearing.
3. **Target arrival (~250ms):** affected unit(s) get the same one-shot arrival flash used for
   Suppression removal (§7) — reusing `FxFlash`, not a new animation.
4. **Log entry** (already exists, keep) fires in the same beat as step 3, not before it — so the
   log and the board never disagree about sequencing.

Applies directly to: Objective Marshal (H04), Infantry Commander (H08), Emergency Logistics
Officer (H21), Counteroffensive General (H06), Inspire, Muster, Rally, Breakthrough, Last Stand,
Escalate's upgrade-state change. All of these currently produce a result with no attributable
source (§4's Hero Layer / Keywords tables).

---

## 13. Cause → Effect Communication

The brief's SOURCE → EFFECT → TARGET → RESULT chain maps directly onto the causality-pulse
pattern in §12, generalized as the one reusable sequencing primitive this whole plan leans on:

```
SOURCE glow  →  (optional connector)  →  TARGET flash  →  stat/state changes  →  log line
   ~200ms            ~150ms                  ~250ms           (instant, same frame)      (same beat)
```

Two concrete worked examples from the brief, using SIGNAL's actual systems:

**Hero passive (Objective Marshal, on-place trigger):**
```
Unit placed
  → checkHeroPassivesOnPlace fires (combat.js)
      → Objective Marshal's Hero Zone slot glows (SOURCE)
          → affected unit(s) get arrival flash (TARGET)
              → stat/keyword change renders
                  → log line appends: "Objective Marshal: <unit> +1 all sides (permanent)"
```

**Tank attacks Armored Infantry:**
```
Attack declared, resolves as a hit
  → Armor absorbs (armorHits < maxArmorHits)
      → the specific armor pip "cracks" (protection-category flash, §5)
          → floating "ARMOR ABSORBED" text near the card
              → unit remains alive, state unchanged
                  → log line: "...armor absorbed — no HQ damage"
```

This is the model to apply everywhere in §4's inventory that currently ends at "log line only."

---

## 14. Animation Priority Hierarchy

Derived from actual match frequency and stakes, not a generic template:

### Tier 1 — Critical (full sequence, ~600-800ms ceiling each)
- Unit destroyed
- Direct HQ damage
- Objective captured / control flips
- Hero Active Power resolution
- Game win/loss

### Tier 2 — Important (short flash + badge, ~250-400ms each)
- Armor absorbed / broken
- Suppression applied or removed
- Significant buff/debuff (≥2 total magnitude, or any keyword grant/removal)
- Hero/Objective passive trigger (source pulse + target flash per §12)
- Rally / Breakthrough / Last Stand triggering
- Objective level escalation (L1→L2, etc.)

### Tier 3 — Informational (instant number tick + micro-flash, <150ms, no motion sequence)
- Minor stat adjustment (±1, single source)
- Fuel gain/loss
- Cost discount/tax display change
- Card drawn
- Rotation applied

This hierarchy is also the input to the sequencing/batching rules in §16 — Tier 3 events never
individually pause the sequence queue; they render inline with whatever Tier 1/2 event they're
part of.

---

## 15. Animation Sequencing Rules

(See §16 for the specific multi-effect edge case worked through against a real combat chain.)

- **One sequence queue per `commitState` call.** A single player action (one attack, one Command,
  one Hero Power) produces one ordered list of fx steps; the queue drains automatically.
- **Simultaneous identical effects batch into one wave.** Blast/Barrage hitting 2-3 tiles at once
  fire their Tier-2 flashes together, not staggered one-by-one — staggering would make a single
  attack take visibly longer than a single-target one for no informational gain.
- **Hard ceiling: ~1.5-2s total per action**, regardless of how many steps are queued. Beyond a
  soft cap (~6 discrete steps), remaining steps collapse into a single summary flash ("+3 more
  effects — see log") with full detail still in the log — the log is the permanent record; the
  board only needs to carry the *gist* of a large chain in real time.
- **Steps nested inside a Tier-1 chain run at compressed timing** (roughly half their standalone
  duration) — e.g., an Armor-break that happens as one step of a larger destroy-trigering attack
  shouldn't take as long as an Armor-break that's the entire event on its own.
- **Fully skippable.** Any click/keypress while a sequence is playing snaps all pending fx to
  their end state instantly and applies the final board state — SIGNAL is an 8-minute tactical
  game; a queue that can't be skipped will get complained about immediately by anyone who's
  played the match once already.
- **Never block input beyond the current queue.** The next legal action becomes clickable the
  instant the queue finishes (or is skipped) — no "wait for animation" lockout longer than the
  sequence itself.

---

## 16. Edge Case Walkthrough — Multiple Effects From One Action

Using the brief's own example, mapped onto SIGNAL's real systems (Breakthrough + Last Stand are
both real keywords per `ARCHITECTURE.md`):

```
Unit attacks and the hit destroys the defender, which has Last Stand;
the attacker has Breakthrough.

Step 1 (Tier 2, ~200ms) — Armor check on defender (if any) → absorb or pass through
Step 2 (Tier 1, ~700ms) — Destruction sequence on defender (§8's full sequence)
Step 3 (Tier 2, ~300ms, compressed to ~150ms since nested in Step 2's window)
        — Last Stand triggers on the JUST-destroyed unit → its own source pulse
          + whatever it affects gets a target flash
Step 4 (Tier 2, ~300ms, also compressed) — Breakthrough triggers on the attacker
          (resolveDestructionChain fires this after Last Stand, per ARCHITECTURE.md's
          locked ordering) → attacker source pulse + its target flash
Step 5 (instant) — any resulting stat changes render inline, Tier 3 rules apply
Total: ~1.1-1.3s, comfortably under the 2s ceiling, no manual batching needed
        since none of these are identical/simultaneous — the ordering IS the content.
```

This confirms the §15 rules are sufficient for SIGNAL's actual worst-case chains (the engine's
`resolveDestructionChain`/`applyPostDestructionEffects` already enforces a single fixed
resolution order — Last Stand before Breakthrough — so the sequencer doesn't need to invent an
ordering, only visualize the one the rules engine already guarantees).

---

## 17. Hover / Card-Preview Improvements

Covered in full in §10. Restating the three-layer philosophy the brief proposes, mapped onto
what already physically exists in `game.html`'s layout:

| Layer | Question it answers | Where it lives (already built) |
|---|---|---|
| **Battlefield** | What is happening? | `.board`, `.hero-zone-strip` — needs §5-§9's flash/badge work |
| **Preview panel** | Why is this happening? | `.preview-panel` / `#card-preview` — needs §10's live-state rebuild |
| **Combat log** | What happened previously? | `.log-panel` — needs §18's minor improvements |

No new panel or floating window is recommended — the layout is already correctly shaped for this
philosophy, it just isn't fed the right data yet.

---

## 18. Combat Log Improvements

The log itself is in reasonable shape (8-category color coding, readable). Two targeted
improvements, both optional/P2:

1. **Extend the existing indented-secondary-effect convention.** Line 804 of `combat.js`
   already prefixes Blast/Barrage secondary hits with `  (secondary) -> `. Apply that same
   convention consistently to every chained effect in §4's inventory (Rally, Breakthrough, Last
   Stand, Hero passives) instead of it being a one-off pattern — free, no new UI, just
   consistency in how log lines are generated.
2. **Log-to-battlefield linking (P2, nice-to-have):** hovering a log line briefly highlights the
   tile/card it refers to. Needs each log entry to carry a `tileKey`/`unitId` reference alongside
   its text, which it currently doesn't — a real (small) data change, not just CSS.

No structural log redesign needed — the brief's cause→effect ask is better solved on the
battlefield (§12-§13) than by restructuring the log itself.

---

## 19. Accessibility / Readability Considerations

- **Never rely on color alone.** Every category in §5 already has (or is recommended to keep) a
  non-color channel: icons (armor pips, keyword tags), text state labels, and shape (dashed vs
  solid border for Suppressed). Keep this discipline for every new addition — the destruction
  crimson (§5) and ordinary damage-red must stay distinguishable by more than hue for
  red-green-colorblind players (e.g., destruction gets the shake+collapse motion, ordinary
  damage doesn't).
- **Respect `prefers-reduced-motion`.** None of the current CSS checks for it. Every new
  keyframe animation in this plan should have a reduced-motion fallback that keeps the color/icon
  change but drops the shake/scale/pulse motion.
- **Card real estate is already tight.** Board cards render at ~85px square with 7-10px text.
  Any new persistent badge (§7's suppression icon, §5's protection ring) needs to be budgeted
  against the existing armor pips + keyword tags + rotation label already competing for the same
  corners — recommend a hard rule: **max 2 persistent status badges visible per card at once**;
  anything beyond that surfaces only in the preview panel (§10), not on the tiny board card.
  itself.
- **Sequencing must stay skippable** (§15) — this is as much an accessibility requirement as a
  pacing one; players who process animation more slowly need the option to let a sequence play
  out without being forced to.
- **Sound is explicitly out of scope for now** — SIGNAL has no audio layer today; adding one is
  a larger, separate decision (asset budget, mute/volume settings, mobile autoplay
  restrictions) that shouldn't ride along with this visual-feedback pass. Flagged optional/P2
  throughout rather than assumed.

---

## 20. Recommended Reusable UI Components

Named so future work references the same primitives instead of one-off animations per card:

| Component | Purpose | Status |
|---|---|---|
| **`FxFlash`** | The one generalized one-shot flash primitive (gold/red/crimson/teal variants) — replaces the current bespoke `suppress-flash`/`destroy-flash` keyframes with one parameterized system | New (generalizes 2 existing one-offs) |
| **`FxPopupText`** | Small floating text near a tile ("ARMOR ABSORBED", "DIRECT HIT", "+1"), fades/rises briefly | New — currently nothing like this exists anywhere in the codebase |
| **`StatusBadge`** | Consolidated persistent icon slot for Suppressed/Armor-remaining/Buffed-Debuffed, replacing today's mix of text labels (`bc-state`) and pips so corner real estate is managed by one system, not several independent ones | New (consolidates existing pips/labels) |
| **`CardPreviewPanel` (extended)** | The existing `#card-preview` panel, rebuilt to read live `BoardUnit` state with source breakdown (§10) | Extends existing |
| **`FloatingTip` (extended)** | The existing `data-tip`/`data-tip-html` system, extended to cover all 16 keywords (§6) and dynamic augmentation | Extends existing |
| **`FxConnector`** | Optional source→target line/pulse for passive causality (§12) | New, P2/stretch |
| **`SequenceQueue`** | The fx-step batching/timing/skip controller described in §15-§16 | New — the one genuinely architectural piece in this plan |

---

## 21. Implementation Priority — P0 / P1 / P2

**P0 — do first, highest frequency × lowest cost:**
- Keyword tooltip completeness (§6) — pure content
- Suppression flash color fix, gold → red (§7) — one CSS variable reference
- `.opponent-card`/destroyed-CSS dead-code cleanup (§2 findings) — housekeeping, do alongside
  whatever else touches `buildBoardCard`
- Live-state board-unit hover preview, including the bonus-source breakdown (§10) — highest
  single-line-item impact in this entire plan
- Armor-absorb feedback via `FxFlash` + `FxPopupText` (§5, §13) — currently the single most
  "invisible" Tier-2 event
- Direct HQ feedback (§9) — reuses `FxFlash`, no new system

**P1 — do once P0 primitives (`FxFlash`, extended preview panel) exist:**
- Destruction sequence upgrade, including the held-node change (§8)
- Passive/Hero/keyword causality pulses (§12-§13)
- Debuff persistent frame, parity with the existing buff halo (§5, §7 finding)
- Objective "just captured" / "just leveled" Tier-1 moment
- Terrain-blocked placement affordance (small, standalone — can slot in anywhere)

**P2 — polish / stretch, do only once P0-P1 are stable:**
- `FxConnector` source→target lines (§12)
- `SequenceQueue`'s full batching/compression rules for large multi-effect chains (§15-§16) —
  needed eventually, but nothing in P0/P1 strictly requires it; single-effect Tier 1/2 moments
  work fine without a queue
- Log-to-battlefield hover linking (§18)
- Sound cues (§19 — explicitly deferred, separate scope decision)
- Colorblind-mode / high-contrast pass beyond the baseline discipline already built into §5/§19

---

## 22. Estimated Implementation Complexity

| Feature | Size | Why |
|---|---|---|
| Keyword tooltip completeness | **Small** | Content-only addition to `KEYWORD_TEXT` |
| Suppression flash recolor | **Small** | One CSS value swap |
| Dead-code cleanup (`.opponent-card`, destroyed-CSS) | **Small** | Delete or wire up, either way trivial |
| Terrain-blocked placement affordance | **Small** | One more CSS class + one more `validDropKeys`-adjacent computed set |
| `FxFlash` primitive (generalized) | **Small-Medium** | Mostly consolidating 2 existing keyframes into a parameterized version |
| `FxPopupText` primitive | **Small-Medium** | New but self-contained — no data-model changes needed |
| Armor-absorb feedback | **Small-Medium** | Needs one new `transitionFlags` case (armor-absorbed) alongside the existing suppressed/destroyed ones |
| Direct HQ feedback | **Small-Medium** | Needs `evaluateDirectHQ`'s result threaded into a transition flag the same way; reuses `FxFlash` |
| Live-state board-unit hover preview (bonus-source breakdown) | **Medium** | Requires the `{amount, label}` data-model change across every bonus-setting site in `combat.js`/`game.js` |
| Debuff persistent frame | **Small** | Mirrors the existing `.buffed` class logic, inverted |
| Objective capture/level-up moment | **Small-Medium** | New transition-flag case for objectives, same pattern as suppressed/destroyed |
| Passive/Hero causality pulses | **Medium** | Needs source-attribution threaded through `checkHeroPassivesOnPlace`, dynamic-aura calc, and the Command/Hero dispatch switches — many call sites, but each change is mechanical |
| Destruction sequence (held-node) | **Medium** | The one place this plan asks for a render-pipeline change, not just new CSS/classes |
| `SequenceQueue` (full batching system) | **Large** | Genuinely new architecture — an ordered async queue sitting between `commitState` and `renderBoard`; touches every call site that currently calls `commitState` synchronously |
| `FxConnector` (source→target lines) | **Medium** | Needs on-screen coordinate math between two arbitrary DOM nodes (board tile ↔ Hero Zone slot), plus SVG/positioned-div plumbing |
| Log-to-battlefield linking | **Medium** | Needs log entries to carry structured tile/unit references, not just display strings |

**Overall read:** the large majority of this plan is Small-Medium, content-and-CSS-heavy work
achievable incrementally without touching the rules engine. The two genuinely architectural
pieces — the destruction held-node change (§8) and the full `SequenceQueue` (§15-16) — are both
correctly placed in P1/P2, not P0, so the highest-value fixes can ship without them.

---

## 23. Final Recommended Cohesive System

**One sentence version:** formalize the color language that already half-exists (§5), rebuild
the already-well-placed preview panel to show live state instead of static text (§10), give the
two currently-invisible Tier-2 events (armor absorb, Direct HQ) the same one-shot flash treatment
Suppression/Destruction already get but with the *correct* color (§7's fix), and only then invest
in the genuinely new architecture (sequencing, connectors) once those cheaper fixes have proven
out the visual language in real play.

**Why this ordering works for SIGNAL specifically:** the game already ships a working three-layer
structure (battlefield / preview panel / log — §17) and a mostly-consistent color instinct (§5) —
this is not a project that needs a redesign, it needs its existing feedback surfaces *finished*.
Every P0 item in §21 is achievable by extending code that already exists in `ui.js`/`game.css`
(`KEYWORD_TEXT`, `transitionFlags`, `buildBoardCard`, `showCardPreview`) rather than introducing
new systems, which keeps the work matched to a small team shipping a tactical prototype, not a
studio building a new UI framework.

**What "done" looks like for a new player, per the brief's own success criterion:** watching one
full turn with an Armor unit blocking a hit, a Hero passive triggering off it, and the resulting
kill triggering Last Stand should be readable *without* the log — source glows, a shield pip
visibly cracks, the destroyed card visibly collapses, and each of those beats lands in the fixed
order the rules engine already guarantees (§16) — while an experienced player hovering that same
unit mid-fight sees, in the existing preview panel, every number's exact source (§10) and every
keyword's exact rules text (§6) without leaving the board.
