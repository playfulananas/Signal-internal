// All cards. Set 1 truth-lock (SIGNAL Claude Handoff package, docs 00-09, 24-31 Aug 2026).
// IDs use the canonical class-prefixed scheme from doc 03 (SIGNAL Card Truth & Migration) and
// the SIGNAL_Set1_RecommendedDecksList spreadsheet — I1-I22 (Infantry), T23-T39 (Tank),
// AR40-AR53 (Artillery), A54-A65 (Aircraft), H01-H25 (Heroes), C01-C35 (Commands). This
// replaces the old numeric id scheme (1-147ish) used before the 2026-08-31 Run 1 migration —
// see js/archive/legacy_cards.js for every card that isn't part of this active 125-card pool.
//
// Units: { id, name, cls, rarity, type:"unit", cost, copies, keyword, n, e, s, w, ability }
//   `keyword` is a single string or an array of strings for multi-keyword Units.
//   `copies` is the authoritative deck-construction copy limit (mostly 2, some 1s); `rarity`
//   is derived from it (2 copies -> Common, 1 copy -> Rare) purely for card-frame display.
// Commands: { id, name, cls:"General"|class-name, rarity, type:"command", cost, copies, effect }
//   Commands are always 2 copies. `cls` is "General" for universal Commands or a Unit class
//   name for class-locked ones (Infantry/Tank/Artillery/Aircraft), matching doc 03 Part III.
// Heroes: { id, name, rarity, type:"hero", implemented:true, scope:"column"|"board", powerType:"active"|"passive"|"hybrid",
//   activeCost, ability }
//   Heroes are always 1 copy, in a separate 4-Hero roster, never shuffled into the 30-card deck
//   (see getDeckPool in decks.js). All 25 are implemented — Run 1 builds every mechanic this
//   pool actually uses (see combat.js/state.js), not a "parked" subset.
//
// MIGRATION NOTE (2026-08-31): this file was fully replaced during Run 1 of the Set 1 surgical
// update. The prior pool (143 cards: old 65 active Units across 5 classes including Naval, 30
// Heroes, 29 Commands, 13 retired Missions, 8 Objectives, plus the 2026-08-19 Deathrattle batch)
// does not match the new locked truth and has been archived in full, not deleted — see
// js/archive/legacy_cards.js and its manifest for exactly what moved and why. Objectives (5,
// down from 8) stay in this file per the existing convention; Maps/Objective data migration
// itself is Run 2 scope — only the card *records* for the 3 cut Objectives (Bridge, Radar
// Station, Fortification) are archived here in Run 1 as part of the general content cutover.

export const CARDS = [
  // ── UNITS — INFANTRY (22) ────────────────────────────────────────────────
  { id:"I1",  name:"Rifle Squad",         cls:"Infantry", rarity:"Common", type:"unit", cost:1, copies:2, keyword:null, n:5, e:4, s:3, w:2, ability:null },
  { id:"I2",  name:"Militia",             cls:"Infantry", rarity:"Common", type:"unit", cost:2, copies:2, keyword:null, n:3, e:6, s:5, w:4, ability:null },
  { id:"I3",  name:"Regular Infantry",    cls:"Infantry", rarity:"Common", type:"unit", cost:3, copies:2, keyword:null, n:4, e:4, s:8, w:5, ability:null },
  { id:"I4",  name:"Veteran Infantry",    cls:"Infantry", rarity:"Common", type:"unit", cost:4, copies:2, keyword:null, n:8, e:4, s:6, w:7, ability:null },
  { id:"I5",  name:"Elite Infantry",      cls:"Infantry", rarity:"Common", type:"unit", cost:5, copies:2, keyword:null, n:7, e:8, s:7, w:8, ability:null },
  { id:"I6",  name:"Shield Bearers",      cls:"Infantry", rarity:"Common", type:"unit", cost:1, copies:2, keyword:"Guard", n:3, e:4, s:3, w:1, ability:null },
  { id:"I7",  name:"Frontline Guard",     cls:"Infantry", rarity:"Common", type:"unit", cost:2, copies:2, keyword:"Guard", n:5, e:3, s:2, w:4, ability:null },
  { id:"I8",  name:"Veteran Guard",       cls:"Infantry", rarity:"Common", type:"unit", cost:3, copies:2, keyword:"Guard", n:2, e:4, s:6, w:5, ability:null },
  { id:"I9",  name:"Motivator",           cls:"Infantry", rarity:"Common", type:"unit", cost:2, copies:2, keyword:"Inspire", n:5, e:4, s:3, w:5, ability:"Inspire: adjacent friendly Units get +1 all sides while this Unit is on the battlefield." },
  { id:"I10", name:"Sergeant",            cls:"Infantry", rarity:"Common", type:"unit", cost:3, copies:2, keyword:"Inspire", n:5, e:4, s:4, w:4, ability:"Inspire: adjacent friendly Units get +1 all sides while this Unit is on the battlefield." },
  { id:"I11", name:"Company Leader",      cls:"Infantry", rarity:"Common", type:"unit", cost:4, copies:2, keyword:"Inspire", n:5, e:6, s:5, w:5, ability:"Inspire: adjacent friendly Units get +1 all sides while this Unit is on the battlefield." },
  { id:"I12", name:"Assault Trooper",     cls:"Infantry", rarity:"Common", type:"unit", cost:2, copies:2, keyword:"Rally", n:4, e:3, s:4, w:4, ability:"Rally: draw 1 card." },
  { id:"I13", name:"Combat Engager",      cls:"Infantry", rarity:"Common", type:"unit", cost:3, copies:2, keyword:"Rally", n:4, e:5, s:5, w:4, ability:"Rally: a random other friendly Infantry gains +1 all sides permanently." },
  { id:"I14", name:"Veteran Raider",      cls:"Infantry", rarity:"Common", type:"unit", cost:4, copies:2, keyword:"Rally", n:6, e:5, s:5, w:6, ability:"Rally: all adjacent friendly Units gain +1 all sides permanently." },
  { id:"I15", name:"Green Recruit",       cls:"Infantry", rarity:"Common", type:"unit", cost:2, copies:2, keyword:"Muster", n:1, e:1, s:1, w:1, ability:"Muster: +1 all sides for each other friendly Infantry you control." },
  { id:"I16", name:"Infantry Line",       cls:"Infantry", rarity:"Common", type:"unit", cost:4, copies:2, keyword:"Muster", n:3, e:4, s:4, w:3, ability:"Muster: +1 all sides for each other friendly Infantry you control." },
  { id:"I17", name:"Brigade Veterans",    cls:"Infantry", rarity:"Rare",   type:"unit", cost:6, copies:1, keyword:"Muster", n:6, e:5, s:5, w:6, ability:"Muster: +1 all sides for each other friendly Infantry you control." },
  { id:"I18", name:"Last Stand Soldier",  cls:"Infantry", rarity:"Common", type:"unit", cost:2, copies:2, keyword:"Last Stand", n:3, e:4, s:4, w:3, ability:"Last Stand: draw 1 card." },
  { id:"I19", name:"Final Defender",      cls:"Infantry", rarity:"Common", type:"unit", cost:4, copies:2, keyword:"Last Stand", n:5, e:5, s:5, w:6, ability:"Last Stand: a random friendly Infantry gains +1 all sides permanently." },
  { id:"I20", name:"Shock Trooper",       cls:"Infantry", rarity:"Common", type:"unit", cost:4, copies:2, keyword:"Double Attack", n:5, e:5, s:4, w:4, ability:null },
  { id:"I21", name:"Commanding Infantry", cls:"Infantry", rarity:"Rare",   type:"unit", cost:5, copies:1, keyword:["Muster","Inspire","Rally"], n:4, e:4, s:5, w:4, ability:"Muster/Inspire use the standard definitions. Rally: all other friendly Infantry gain +1 all sides permanently." },
  { id:"I22", name:"Field Commander",     cls:"Infantry", rarity:"Common", type:"unit", cost:3, copies:2, keyword:["Guard","Last Stand"], n:4, e:3, s:3, w:5, ability:"Last Stand: adjacent friendly Infantry gain +1 all sides until end of turn." },

  // ── UNITS — TANK (17) ────────────────────────────────────────────────────
  { id:"T23", name:"Panzer III",          cls:"Tank", rarity:"Common", type:"unit", cost:2, copies:2, keyword:null, n:5, e:4, s:5, w:5, ability:null },
  { id:"T24", name:"Panzer IV",           cls:"Tank", rarity:"Common", type:"unit", cost:3, copies:2, keyword:null, n:5, e:6, s:5, w:6, ability:null },
  { id:"T25", name:"Sherman Tank",        cls:"Tank", rarity:"Common", type:"unit", cost:4, copies:2, keyword:null, n:7, e:6, s:7, w:6, ability:null },
  { id:"T26", name:"Heavy Tank",          cls:"Tank", rarity:"Common", type:"unit", cost:5, copies:2, keyword:null, n:8, e:8, s:8, w:7, ability:null },
  { id:"T27", name:"King Tiger",          cls:"Tank", rarity:"Rare",   type:"unit", cost:6, copies:1, keyword:null, n:9, e:9, s:9, w:9, ability:null },
  { id:"T28", name:"Blitz Tank",          cls:"Tank", rarity:"Common", type:"unit", cost:3, copies:2, keyword:"Armor", n:4, e:5, s:4, w:5, ability:null },
  { id:"T29", name:"Vanguard Tank",       cls:"Tank", rarity:"Common", type:"unit", cost:4, copies:2, keyword:"Armor", n:6, e:5, s:6, w:5, ability:null },
  { id:"T30", name:"Panzer Brigade",      cls:"Tank", rarity:"Common", type:"unit", cost:5, copies:2, keyword:"Heavy Armor", n:6, e:6, s:5, w:6, ability:null },
  { id:"T31", name:"Tiger I",             cls:"Tank", rarity:"Common", type:"unit", cost:6, copies:2, keyword:"Heavy Armor", n:7, e:7, s:8, w:5, ability:null },
  { id:"T32", name:"Tank Hunter",         cls:"Tank", rarity:"Common", type:"unit", cost:3, copies:2, keyword:"Breakthrough", n:6, e:4, s:4, w:5, ability:"Breakthrough: this Unit gains +1 all sides permanently." },
  { id:"T33", name:"Tank Destroyer",      cls:"Tank", rarity:"Common", type:"unit", cost:4, copies:2, keyword:"Breakthrough", n:5, e:6, s:5, w:6, ability:"Breakthrough: your next Tank costs 1 Fuel (set-cost; other reductions can still apply)." },
  { id:"T34", name:"Breakthrough Tank",   cls:"Tank", rarity:"Common", type:"unit", cost:5, copies:2, keyword:"Breakthrough", n:6, e:7, s:6, w:7, ability:"Breakthrough: this Unit gains Armor." },
  { id:"T35", name:"Ace Tank",            cls:"Tank", rarity:"Common", type:"unit", cost:6, copies:2, keyword:"Breakthrough", n:6, e:6, s:9, w:6, ability:"Breakthrough: this Unit gains Double Attack." },
  { id:"T36", name:"Flak Halftrack",      cls:"Tank", rarity:"Common", type:"unit", cost:4, copies:2, keyword:"Double Attack", n:5, e:5, s:4, w:7, ability:null },
  { id:"T37", name:"Mobile Command Tank", cls:"Tank", rarity:"Common", type:"unit", cost:5, copies:2, keyword:"Guard", n:7, e:6, s:7, w:6, ability:null },
  { id:"T38", name:"Armored Spearhead",   cls:"Tank", rarity:"Common", type:"unit", cost:5, copies:2, keyword:["Armor","Breakthrough"], n:6, e:5, s:6, w:6, ability:"Breakthrough: this Unit gains +1 all sides permanently." },
  { id:"T39", name:"Mobile Fortress",     cls:"Tank", rarity:"Rare",   type:"unit", cost:7, copies:1, keyword:["Guard","Heavy Armor"], n:5, e:8, s:5, w:8, ability:null },

  // ── UNITS — ARTILLERY (14) ───────────────────────────────────────────────
  { id:"AR40", name:"Ranging Section",       cls:"Artillery", rarity:"Common", type:"unit", cost:1, copies:2, keyword:null, n:2, e:2, s:6, w:2, ability:null },
  { id:"AR41", name:"Field Gun",             cls:"Artillery", rarity:"Common", type:"unit", cost:2, copies:2, keyword:null, n:3, e:7, s:3, w:3, ability:null },
  { id:"AR42", name:"Self-Propelled Gun",    cls:"Artillery", rarity:"Common", type:"unit", cost:3, copies:2, keyword:null, n:8, e:4, s:4, w:4, ability:null },
  { id:"AR43", name:"Field Howitzer",        cls:"Artillery", rarity:"Common", type:"unit", cost:2, copies:2, keyword:"Bombard", n:1, e:1, s:1, w:7, ability:null },
  { id:"AR44", name:"Heavy Howitzer",        cls:"Artillery", rarity:"Common", type:"unit", cost:4, copies:2, keyword:"Bombard", n:3, e:3, s:9, w:3, ability:null },
  { id:"AR45", name:"Long-Range Battery",    cls:"Artillery", rarity:"Common", type:"unit", cost:5, copies:2, keyword:"Bombard", n:4, e:10, s:4, w:4, ability:null },
  { id:"AR46", name:"Mortar Battery",        cls:"Artillery", rarity:"Common", type:"unit", cost:2, copies:2, keyword:"Blast", n:2, e:6, s:2, w:2, ability:"Blast: on a successful Hit, also Hit enemy Units directly left/right of the target relative to attack direction." },
  { id:"AR47", name:"Siege Gun",             cls:"Artillery", rarity:"Common", type:"unit", cost:4, copies:2, keyword:"Blast", n:3, e:3, s:8, w:3, ability:"Blast: on a successful Hit, also Hit enemy Units directly left/right of the target relative to attack direction." },
  { id:"AR48", name:"Rocket Battery",        cls:"Artillery", rarity:"Common", type:"unit", cost:3, copies:2, keyword:"Barrage", n:2, e:2, s:2, w:6, ability:"Barrage: on a successful Hit, also Hit enemy Units farther along the forward attack ray beyond the target." },
  { id:"AR49", name:"Heavy Rocket Battery",  cls:"Artillery", rarity:"Rare",   type:"unit", cost:5, copies:1, keyword:"Barrage", n:8, e:3, s:3, w:3, ability:"Barrage: on a successful Hit, also Hit enemy Units farther along the forward attack ray beyond the target." },
  { id:"AR50", name:"Anti-Tank Gun",         cls:"Artillery", rarity:"Common", type:"unit", cost:2, copies:2, keyword:"Guard", n:3, e:3, s:7, w:3, ability:null },
  { id:"AR51", name:"Rapid-Fire Gun",        cls:"Artillery", rarity:"Common", type:"unit", cost:3, copies:2, keyword:"Double Attack", n:3, e:3, s:3, w:8, ability:null },
  { id:"AR52", name:"Rocket Launcher",       cls:"Artillery", rarity:"Common", type:"unit", cost:3, copies:2, keyword:["Bombard","Double Attack"], n:1, e:1, s:1, w:5, ability:null },
  { id:"AR53", name:"Grand Battery",         cls:"Artillery", rarity:"Rare",   type:"unit", cost:5, copies:1, keyword:["Bombard","Barrage","Blast"], n:9, e:1, s:1, w:1, ability:"Combines ranged, forward-ray, and side-splash Hits on a single successful attack; primary Hit resolves first." },

  // ── UNITS — AIRCRAFT (12) ────────────────────────────────────────────────
  { id:"A54", name:"Fighter",               cls:"Aircraft", rarity:"Common", type:"unit", cost:3, copies:2, keyword:null, n:6, e:5, s:4, w:5, ability:null },
  { id:"A55", name:"Tactical Fighter",      cls:"Aircraft", rarity:"Common", type:"unit", cost:3, copies:2, keyword:"Maneuver", n:3, e:3, s:7, w:4, ability:"On Play: Maneuver 1 other friendly Unit to another legal position." },
  { id:"A56", name:"Escort Fighter",        cls:"Aircraft", rarity:"Common", type:"unit", cost:4, copies:2, keyword:["Precision","Maneuver"], n:4, e:5, s:2, w:8, ability:"On Play: Maneuver 1 other friendly Unit to another legal position." },
  { id:"A57", name:"Ace Pilot",             cls:"Aircraft", rarity:"Rare",   type:"unit", cost:5, copies:1, keyword:["Precision","Double Attack"], n:4, e:8, s:3, w:6, ability:null },
  { id:"A58", name:"Medium Bomber",         cls:"Aircraft", rarity:"Common", type:"unit", cost:4, copies:2, keyword:null, n:7, e:5, s:6, w:6, ability:null },
  { id:"A59", name:"Heavy Bomber",          cls:"Aircraft", rarity:"Common", type:"unit", cost:5, copies:2, keyword:"Bombard", n:9, e:6, s:7, w:3, ability:null },
  { id:"A60", name:"Pathfinder Bomber",     cls:"Aircraft", rarity:"Common", type:"unit", cost:3, copies:2, keyword:"Precision", n:4, e:5, s:4, w:6, ability:null },
  { id:"A61", name:"Strategic Bomber",      cls:"Aircraft", rarity:"Rare",   type:"unit", cost:8, copies:1, keyword:["Precision","Bombard","Maneuver","Double Attack"], n:3, e:8, s:8, w:3, ability:"On Play: Maneuver 1 other friendly Unit to another legal position." },
  { id:"A62", name:"Fighter-Bomber",        cls:"Aircraft", rarity:"Common", type:"unit", cost:4, copies:2, keyword:"Maneuver", n:5, e:4, s:5, w:6, ability:"On Play: Maneuver 1 other friendly Unit to another legal position." },
  { id:"A63", name:"Strike Aircraft",       cls:"Aircraft", rarity:"Common", type:"unit", cost:5, copies:2, keyword:["Precision","Maneuver"], n:5, e:5, s:5, w:5, ability:"On Play: Maneuver 1 other friendly Unit to another legal position." },
  { id:"A64", name:"Dive Bomber",           cls:"Aircraft", rarity:"Common", type:"unit", cost:4, copies:2, keyword:"Double Attack", n:5, e:4, s:3, w:3, ability:null },
  { id:"A65", name:"Ground-Attack Aircraft", cls:"Aircraft", rarity:"Common", type:"unit", cost:5, copies:2, keyword:["Maneuver","Bombard"], n:4, e:4, s:6, w:4, ability:"On Play: Maneuver 1 other friendly Unit to another legal position." },

  // ── COMMANDS — GENERAL (23) ──────────────────────────────────────────────
  { id:"C01", name:"Field Medic",            cls:"General",   rarity:"Common", type:"command", cost:1, copies:2, effect:"Remove Suppression from 1 friendly Unit." },
  { id:"C02", name:"Improvised Position",    cls:"General",   rarity:"Common", type:"command", cost:1, copies:2, effect:"Give 1 friendly Unit without Armor +2 all sides until your next turn." },
  { id:"C03", name:"Rally Cry",              cls:"General",   rarity:"Common", type:"command", cost:1, copies:2, effect:"Up to 2 friendly Units get +1 all sides until end of turn." },
  { id:"C04", name:"Forward Observer",       cls:"General",   rarity:"Common", type:"command", cost:1, copies:2, effect:"Look at the top 3 cards of your deck: 1 to hand, 1 on top, 1 on bottom. Requires at least 2 cards in deck; with exactly 2, look at both, 1 to hand, other stays on top." },
  { id:"C05", name:"Recon",                  cls:"General",   rarity:"Common", type:"command", cost:2, copies:2, effect:"Draw 2 cards." },
  { id:"C06", name:"Coordinated Strike",     cls:"General",   rarity:"Common", type:"command", cost:2, copies:2, effect:"Choose 2 friendly Units that both currently have the same enemy Unit as a legal attack target. Each gains 1 additional legal attack this turn." },
  { id:"C07", name:"Combined Arms Doctrine", cls:"General",   rarity:"Common", type:"command", cost:3, copies:2, effect:"Remove Suppression from all friendly Units and draw 1 card." },
  { id:"C08", name:"Second Wind",            cls:"General",   rarity:"Common", type:"command", cost:2, copies:2, effect:"Remove Suppression from 1 friendly Unit; it gets +2 all sides until end of turn." },
  { id:"C09", name:"Overrun",                cls:"General",   rarity:"Common", type:"command", cost:2, copies:2, effect:"For the rest of this turn, enemy Units Suppressed after this resolves deal 1 HQ damage; enemy normal Units destroyed after this resolves deal 3 HQ damage instead of 2. Not retroactive." },
  { id:"C10", name:"Hold Position",          cls:"General",   rarity:"Common", type:"command", cost:2, copies:2, effect:"Up to 2 friendly Units get +2 all sides until your next turn." },
  { id:"C11", name:"Tactical Withdrawal",    cls:"General",   rarity:"Common", type:"command", cost:1, copies:2, effect:"Return 1 friendly Unit to your hand." },
  { id:"C12", name:"Dig In",                 cls:"General",   rarity:"Common", type:"command", cost:1, copies:2, effect:"Give 1 friendly Unit Guard until your next turn." },
  { id:"C13", name:"Industrial Surge",       cls:"General",   rarity:"Common", type:"command", cost:1, copies:2, effect:"Gain 2 extra Fuel at the start of your next turn." },
  { id:"C14", name:"Priority Orders",        cls:"General",   rarity:"Common", type:"command", cost:1, copies:2, effect:"Your next Hero Active ability this turn costs 2 Fuel less." },
  { id:"C15", name:"Command Shuffle",        cls:"General",   rarity:"Common", type:"command", cost:1, copies:2, effect:"Move 1 Hero to another unoccupied Hero column, or swap the columns of 2 Heroes." },
  { id:"C16", name:"Change Formation",       cls:"General",   rarity:"Common", type:"command", cost:1, copies:2, effect:"Rotate 1 friendly Unit left or right." },
  { id:"C17", name:"Coordinated Order",      cls:"General",   rarity:"Common", type:"command", cost:2, copies:2, effect:"Reset your Hero ability state: used Active abilities become available again, and limited Passive per-turn triggers may trigger again this turn. Does not rewind persistent Hero state (e.g. Long War Commander's Power, Chief Aircraft Engineer's activation cost)." },
  { id:"C18", name:"Sacrifice Play",         cls:"General",   rarity:"Common", type:"command", cost:1, copies:2, effect:"Destroy 1 friendly Unit; draw 2 cards." },
  { id:"C19", name:"Scorched Earth Raid",    cls:"General",   rarity:"Common", type:"command", cost:2, copies:2, effect:"Destroy 1 friendly Unit. Deal 2 enemy-HQ damage instead of that Unit's normal friendly-destruction HQ result. Applies even if the destroyed Unit has Guard." },
  { id:"C20", name:"Total Mobilization",     cls:"General",   rarity:"Common", type:"command", cost:2, copies:2, effect:"All Units, friendly and enemy, gain +1 all sides permanently." },
  { id:"C21", name:"Forced March",           cls:"General",   rarity:"Common", type:"command", cost:2, copies:2, effect:"Maneuver 1 friendly Unit, then draw 1 card." },
  { id:"C22", name:"Objective Push",         cls:"General",   rarity:"Common", type:"command", cost:2, copies:2, effect:"Choose an Objective. Friendly Units orthogonally adjacent to it gain +1 all sides permanently." },
  { id:"C23", name:"Emergency Supply",       cls:"General",   rarity:"Common", type:"command", cost:2, copies:2, effect:"Gain 3 Fuel for this turn and deal 2 damage to your HQ. Unused Fuel gained this way expires at end of turn after Direct HQ." },

  // ── COMMANDS — CLASS-LOCKED (12) ─────────────────────────────────────────
  { id:"C24", name:"Suppressing Fire",   cls:"Infantry",  rarity:"Common", type:"command", cost:1, copies:2, effect:"Give 1 friendly Infantry +1 all sides permanently." },
  { id:"C25", name:"Entrench",           cls:"Infantry",  rarity:"Common", type:"command", cost:2, copies:2, effect:"All friendly Infantry get +2 all sides until end of turn." },
  { id:"C26", name:"General Offensive",  cls:"Infantry",  rarity:"Common", type:"command", cost:3, copies:2, effect:"All friendly Infantry gain +1 all sides permanently. Escalate: +2 instead." },
  { id:"C27", name:"Blitzkrieg Order",   cls:"Tank",      rarity:"Common", type:"command", cost:2, copies:2, effect:"Maneuver 1 friendly Tank to another legal position and give it Armor. Escalate: affect up to 2 friendly Tanks instead." },
  { id:"C28", name:"Field Repairs",      cls:"Tank",      rarity:"Common", type:"command", cost:1, copies:2, effect:"Give 1 friendly Tank Armor. If it already has Armor, give Heavy Armor instead. If already Heavy Armor, nothing happens." },
  { id:"C29", name:"Armored Offensive",  cls:"Tank",      rarity:"Common", type:"command", cost:1, copies:2, effect:"Your next Tank played this turn costs 2 Fuel less." },
  { id:"C30", name:"Artillery Barrage",  cls:"Artillery", rarity:"Common", type:"command", cost:2, copies:2, effect:"Give 1 friendly Artillery Barrage until end of turn." },
  { id:"C31", name:"Target Coordinates", cls:"Artillery", rarity:"Common", type:"command", cost:1, copies:2, effect:"Give 1 friendly Artillery Precision until end of turn." },
  { id:"C32", name:"Fire for Effect",    cls:"Artillery", rarity:"Common", type:"command", cost:3, copies:2, effect:"Give 1 friendly Artillery Blast and Barrage until end of turn. Escalate: affect up to 2 friendly Artillery instead." },
  { id:"C33", name:"Air Strike",         cls:"Aircraft",  rarity:"Common", type:"command", cost:3, copies:2, effect:"All friendly Aircraft gain 1 additional legal attack until end of turn." },
  { id:"C34", name:"Air Superiority",    cls:"Aircraft",  rarity:"Common", type:"command", cost:2, copies:2, effect:"All friendly Aircraft get +1 all sides and Precision until end of turn. Escalate: +2 instead." },
  { id:"C35", name:"Scramble",           cls:"Aircraft",  rarity:"Common", type:"command", cost:2, copies:2, effect:"Maneuver 1 friendly Aircraft and reset its persistent attack allowance." },

  // ── OBJECTIVES (5) ────────────────────────────────────────────────────────
  // Effect text below is current-implementation reference; the shared 1/1/2/2 HQ backbone
  // (Gameplay Truth §20) and the exact Map/slot geometry migration are Run 2 scope.
  { id:"O1", name:"Factory",             type:"objective", category:"Economy/Vehicle",     l1:"Gain 1 Fuel.", l2:"Your next Unit played this turn costs 1 less.", l3:"Your next Tank played this turn costs 2 less.", l4:"Your next Unit played this turn costs 2 less." },
  { id:"O2", name:"Airfield",            type:"objective", category:"Air/Tempo",           l1:"1 random friendly Aircraft gets +1 all sides this turn.", l2:"Maneuver 1 friendly Unit.", l3:"Draw 1 card.", l4:"2 random friendly Aircraft each gain 1 additional legal attack this turn." },
  { id:"O3", name:"Supply Depot",        type:"objective", category:"Resource",            l1:"Remove Suppression from 1 friendly Unit adjacent to Supply Depot.", l2:"Gain 1 Fuel.", l3:"Draw 1 card.", l4:"Gain 2 Fuel." },
  { id:"O4", name:"City",                type:"objective", category:"Infantry/Defense",    l1:"Give 1 friendly Unit Guard until your next turn.", l2:"2 random adjacent friendly Units +1 all sides until your next turn.", l3:"2 random adjacent friendly Infantry +1 all sides permanently.", l4:"2 random adjacent friendly Units +2 all sides until your next turn." },
  { id:"O5", name:"Artillery Position",  type:"objective", category:"Damage",              l1:"Rotate 1 friendly Unit left/right.", l2:"1 random friendly Unit adjacent to Artillery Position gains Bombard this turn.", l3:"1 random friendly Artillery gains Precision this turn.", l4:"1 random friendly Artillery gains 1 additional legal attack this turn." },

  // ── HEROES (25) ───────────────────────────────────────────────────────────
  { id:"H01", name:"Quartermaster General",         rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"active",  activeCost:2,    ability:"Draw 1 card." },
  { id:"H02", name:"Logistics Chief",               rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"passive", activeCost:null, ability:"Your normal Fuel-step threshold is 11 instead of 9. Effect-generated Fuel may exceed that threshold." },
  { id:"H03", name:"Tactical Commander",            rarity:"Common", type:"hero", implemented:true, scope:"column", powerType:"active",  activeCost:1,    ability:"Give 1 friendly Unit in this Hero's column +1 all sides permanently." },
  { id:"H04", name:"Objective Marshal",             rarity:"Common", type:"hero", implemented:true, scope:"column", powerType:"passive", activeCost:null, ability:"The first friendly Unit you play each turn adjacent to an Objective in this Hero's column gets +1 all sides until your next turn." },
  { id:"H05", name:"Recovery Officer",              rarity:"Common", type:"hero", implemented:true, scope:"column", powerType:"active",  activeCost:1,    ability:"Remove Suppression from 1 friendly Unit in this Hero's column." },
  { id:"H06", name:"Counteroffensive General",      rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"passive", activeCost:null, ability:"The first friendly Unit that becomes Suppressed each turn gets +1 all sides until end of your next turn." },
  { id:"H07", name:"Armored Commander",             rarity:"Common", type:"hero", implemented:true, scope:"column", powerType:"active",  activeCost:2,    ability:"Your next Tank played in this Hero's column this turn costs 3 Fuel less." },
  { id:"H08", name:"Infantry Commander",            rarity:"Common", type:"hero", implemented:true, scope:"column", powerType:"passive", activeCost:null, ability:"The first Infantry played in this Hero's column each turn gets +2 all sides until your next turn." },
  { id:"H09", name:"Command Specialist",            rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"active",  activeCost:1,    ability:"Your next Command this turn costs 2 Fuel less." },
  { id:"H10", name:"Conventional Warfare Commander",rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"active",  activeCost:1,    ability:"Give 1 friendly Vanilla Unit (no keyword) +3 all sides until end of turn." },
  { id:"H11", name:"Field Coordinator",             rarity:"Common", type:"hero", implemented:true, scope:"column", powerType:"active",  activeCost:1,    ability:"Rotate 1 friendly Unit in this Hero's column left or right." },
  { id:"H12", name:"Fire Support Officer",          rarity:"Common", type:"hero", implemented:true, scope:"column", powerType:"active",  activeCost:1,    ability:"Give 1 friendly Unit in this Hero's column Bombard until end of turn." },
  { id:"H13", name:"Supreme Commander",             rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"passive", activeCost:null, ability:"Your other Heroes ignore their Column restrictions — every other column-scoped Hero power affects your whole board instead." },
  { id:"H14", name:"Graves Registration Officer",   rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"passive", activeCost:null, ability:"Your Last Stand effects trigger twice; each resolution is separate and may independently choose the same random target." },
  { id:"H15", name:"Strike Commander",              rarity:"Common", type:"hero", implemented:true, scope:"column", powerType:"active",  activeCost:1,    ability:"Deal 1 Hit to 1 enemy Unit in this Hero's column." },
  { id:"H16", name:"Maneuver Commander",            rarity:"Common", type:"hero", implemented:true, scope:"column", powerType:"active",  activeCost:2,    ability:"Maneuver 1 friendly Unit in this Hero's column to another legal position and reset its persistent attacks." },
  { id:"H17", name:"HQ Assault Commander",          rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"active",  activeCost:2,    ability:"Deal 1 damage to the enemy HQ." },
  { id:"H18", name:"Artillery Commander",           rarity:"Common", type:"hero", implemented:true, scope:"column", powerType:"active",  activeCost:1,    ability:"Give 1 friendly Artillery in this Hero's column Blast until end of turn." },
  { id:"H19", name:"Training Officer",              rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"active",  activeCost:2,    ability:"Give all 1- and 2-cost Units currently in your hand +1 all sides permanently." },
  { id:"H20", name:"Ruthless Strategist",           rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"passive", activeCost:null, ability:"Whenever you play a Command, after it fully resolves: draw 1 card, then deal 1 damage to your HQ." },
  { id:"H21", name:"Emergency Logistics Officer",   rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"passive", activeCost:null, ability:"The first time you play a Unit each turn, after its own On Play resolves: gain 1 Fuel, then deal 1 damage to your HQ." },
  { id:"H22", name:"Frontline Marshal",             rarity:"Common", type:"hero", implemented:true, scope:"column", powerType:"active",  activeCost:3,    ability:"All Units currently in this Hero's column, friendly and enemy, gain +2 all sides permanently." },
  { id:"H23", name:"Army Group Commander",          rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"active",  activeCost:4,    ability:"All friendly Units gain +1 all sides permanently." },
  { id:"H24", name:"Long War Commander",            rarity:"Common", type:"hero", implemented:true, scope:"column", powerType:"hybrid",  activeCost:1,    ability:"Passive: starts at Power 1; gains +1 Power at the end of each of your turns. Active (1 Fuel): repeat Power times — each repetition independently gives a random friendly Unit in this Hero's column +1 to a random side, permanently. Multiple/all repetitions may choose the same Unit." },
  { id:"H25", name:"Chief Aircraft Engineer",       rarity:"Common", type:"hero", implemented:true, scope:"board",  powerType:"active",  activeCost:5,    ability:"Craft: generate 3 candidate Aircraft (one stats package + one of Bombard/Double Attack/Armor + one drawback each), choose 1 to add to hand (costs 1 Fuel to play, no copy-limit accounting). After each activation, this ability's cost reduces by 1 for the rest of the match, to a minimum of 1." },
];

export const CARD_BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));

// ── Craft (H25 Chief Aircraft Engineer) generated-card registry ────────────
// Generated Aircraft are runtime-only card definitions, not part of the static 125-card
// pool — no copy-limit accounting, never in getDeckPool(). CARD_BY_ID is a plain mutable
// object, so registering a generated card is just adding a key to it; no schema/lookup
// change needed anywhere else that reads CARD_BY_ID[cardId].
//
// Online play: each client's `nextGeneratedCardSeq` is its own local counter, so the id is
// namespaced by `role` ('p1'/'p2') to guarantee two independent clients generating a card in
// the same match never collide on the same id (both would otherwise start at `Craft-1`). The
// card's full definition also has to travel through Firebase alongside its id (see
// `generatedCards` on the shared game state, threaded through in game.js) — CARD_BY_ID itself
// is per-client, in-memory only, and the receiving client never sees a bare id get registered.
let nextGeneratedCardSeq = 1;
export function registerGeneratedCard(cardWithoutId, role) {
  const id = `Craft-${role}-${nextGeneratedCardSeq++}`;
  const card = { ...cardWithoutId, id, generated: true };
  CARD_BY_ID[id] = card;
  return card;
}

// Merges a generated card definition received from the network (or replayed from state that
// round-tripped through Firebase) into this client's own CARD_BY_ID, if not already present.
// Idempotent and order-independent — safe to call for every entry on every state update,
// regardless of which client originally generated the card.
export function ensureGeneratedCard(id, definition) {
  if (!CARD_BY_ID[id]) CARD_BY_ID[id] = { ...definition, id, generated: true };
  return CARD_BY_ID[id];
}
