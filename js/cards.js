// All cards. Each card has a stable numeric id.
// Units: { id, name, cls, rarity, type:"unit", cost, ap, keyword, n, e, s, w, ability }
// Commands: { id, name, rarity, type:"command", cost, ap, effect }
// Missions: { id, name, rarity, type:"mission", cost, ap, req, reward } — no turn limit
// Objectives: { id, name, type:"objective", category, l1, l2, l3, l4 }
// Heroes: { id, name, rarity, type:"hero", scope:"column"|"board", implemented, powerType:"active"|"passive", activeCost, ability, direction }
//   `scope` is authoritative — do NOT infer it from ability wording. 19 heroes are column-scoped,
//   11 are board-wide (30 total, launch pool + Week 3 additions). `implemented` marks the Tier 1
//   pool whose powers actually have behaviour; the rest are parked (not cut) pending mechanics
//   that don't exist yet — see each card's note.
//   — added 2026-07-30 (v0.4 Hero command layer, from Denis's Doc 02 handoff). Heroes are
//   never shuffled into the 30-card deck (see getDeckPool in decks.js) — they belong to a
//   separate 4-Hero roster per deck. Hero Phase/activation/reinforcement logic is wired
//   (see game.js's runHeroPhase/tryActivateHero/applyHeroPower) — `implemented:false` now
//   means specifically "this Hero's own power has no case in applyHeroPower yet", not that
//   the surrounding system is missing.
// Optional `retired: true` on any card excludes it from the deck pool/validator
// (getDeckPool/validateDeck in decks.js) without deleting its data or logic.
// Deathrattle keyword (added 2026-08-19, from Denis's "DeathRattle Brainstorm" tab): a unit
// keyword whose effect fires via checkDeathrattle (combat.js) whenever that unit transitions
// to state:"destroyed", by combat OR by a self-destroy Command (Sacrifice Play 140, Scorched
// Earth Rally 141) — never by Suppression alone, and never by leaving the board un-destroyed
// (Tactical Withdrawal). Supreme Commander/Grand Marshal/Graves Registration Officer (143/146/147)
// are the only Heroes whose effect is "modify how another card's own effect resolves" rather
// than a self-contained buff — see their `direction` notes.

export const CARDS = [
  // ── UNITS ──────────────────────────────────────────────────────────────
  { id:1,  name:"Rifle Squad",         cls:"Infantry",  rarity:"Common", type:"unit", cost:1, ap:1,  keyword:null,           n:4, e:3, s:4, w:3, ability:null },
  { id:2,  name:"Riflemen",            cls:"Infantry",  rarity:"Common", type:"unit", cost:1, ap:1,  keyword:"Guard",         n:4, e:3, s:2, w:3, ability:null },
  { id:3,  name:"Fallschirmjäger",     cls:"Infantry",  rarity:"Common", type:"unit", cost:2, ap:2,  keyword:"Airborne",      n:5, e:5, s:2, w:2, ability:null },
  { id:4,  name:"Mortar Team",         cls:"Infantry",  rarity:"Common", type:"unit", cost:2, ap:2,  keyword:"Bombard",       n:5, e:2, s:4, w:2, ability:null },
  { id:5,  name:"Supply Runner",       cls:"Infantry",  rarity:"Common", type:"unit", cost:1, ap:2,  keyword:null,           n:3, e:3, s:3, w:3, ability:"Start of your turn: if on an objective you control, gain 1 Fuel." },
  { id:6,  name:"Halftrack",           cls:"Tank",      rarity:"Common", type:"unit", cost:2, ap:2,  keyword:"Armor",         n:5, e:4, s:1, w:4, ability:null },
  { id:7,  name:"Blitz Tank",          cls:"Tank",      rarity:"Common", type:"unit", cost:3, ap:4,  keyword:"Breakthrough",  n:5, e:5, s:5, w:5, ability:null, retired:true }, // Retired 2026-08-13 — Breakthrough not implemented/balanced; not converted to vanilla since its stats were priced assuming the keyword discount.
  { id:8,  name:"Tank Hunter",         cls:"Tank",      rarity:"Common", type:"unit", cost:3, ap:3,  keyword:"Double Attack", n:5, e:5, s:3, w:2, ability:null },
  { id:9,  name:"Heavy Tank",          cls:"Tank",      rarity:"Common", type:"unit", cost:4, ap:4,  keyword:"Heavy Armor",   n:5, e:4, s:4, w:4, ability:null },
  { id:10, name:"Field Howitzer",      cls:"Artillery", rarity:"Common", type:"unit", cost:2, ap:1,  keyword:"Bombard",       n:4, e:3, s:4, w:3, ability:null },
  { id:11, name:"Anti-Tank Gun",       cls:"Artillery", rarity:"Common", type:"unit", cost:2, ap:2,  keyword:"Guard",         n:2, e:6, s:2, w:6, ability:null },
  { id:12, name:"Fighter",             cls:"Aircraft",  rarity:"Common", type:"unit", cost:3, ap:3,  keyword:"Airborne",      n:7, e:6, s:5, w:1, ability:null },
  { id:13, name:"Dive Bomber",         cls:"Aircraft",  rarity:"Common", type:"unit", cost:3, ap:4,  keyword:"Double Attack", n:6, e:1, s:6, w:2, ability:null },
  { id:14, name:"Field Commander",     cls:"Commander", rarity:"Rare",   type:"unit", cost:4, ap:4,  keyword:"Inspire",       n:6, e:6, s:6, w:6, ability:null, retired:true }, // Retired 2026-08-13 — Commander class parked now that Heroes cover the out-of-grid strategic-presence role.
  { id:15, name:"River Gunboat",       cls:"Naval",     rarity:"Common", type:"unit", cost:2, ap:1,  keyword:"Bombard",       n:2, e:5, s:2, w:5, ability:null },
  { id:34, name:"Scouts",              cls:"Infantry",  rarity:"Common", type:"unit", cost:1, ap:1,  keyword:null,           n:5, e:5, s:1, w:1, ability:null },
  { id:35, name:"Mountain Troops",     cls:"Infantry",  rarity:"Common", type:"unit", cost:2, ap:2,  keyword:null,           n:4, e:5, s:4, w:5, ability:null },
  { id:36, name:"Heavy Machine Gun Team", cls:"Infantry", rarity:"Common", type:"unit", cost:2, ap:2, keyword:"Guard",        n:6, e:2, s:6, w:2, ability:null },
  { id:37, name:"Paratrooper Veterans",cls:"Infantry",  rarity:"Common", type:"unit", cost:3, ap:3,  keyword:"Airborne",      n:5, e:5, s:2, w:6, ability:null },
  { id:38, name:"Panzer II",           cls:"Tank",      rarity:"Common", type:"unit", cost:1, ap:1,  keyword:null,           n:5, e:2, s:5, w:2, ability:null },
  { id:39, name:"Sherman Tank",        cls:"Tank",      rarity:"Common", type:"unit", cost:3, ap:3,  keyword:"Armor",         n:7, e:6, s:4, w:1, ability:null },
  { id:40, name:"Flak Halftrack",      cls:"Tank",      rarity:"Common", type:"unit", cost:2, ap:2,  keyword:"Bombard",       n:6, e:5, s:2, w:1, ability:null },
  { id:41, name:"Tank Destroyer",      cls:"Tank",      rarity:"Common", type:"unit", cost:4, ap:4,  keyword:"Breakthrough",  n:9, e:3, s:9, w:3, ability:null, retired:true }, // Retired 2026-08-13 — Breakthrough not implemented/balanced; not converted to vanilla since its stats were priced assuming the keyword discount.
  { id:42, name:"Rocket Launcher",     cls:"Artillery", rarity:"Common", type:"unit", cost:3, ap:4,  keyword:["Bombard","Double Attack"], n:5, e:1, s:1, w:1, ability:null },
  { id:43, name:"Anti-Aircraft Gun",   cls:"Artillery", rarity:"Common", type:"unit", cost:2, ap:2,  keyword:"Guard",         n:6, e:5, s:4, w:1, ability:null },
  { id:44, name:"Recon Plane",         cls:"Aircraft",  rarity:"Common", type:"unit", cost:2, ap:3,  keyword:"Airborne",      n:6, e:4, s:4, w:1, ability:null },
  { id:45, name:"Heavy Bomber",        cls:"Aircraft",  rarity:"Common", type:"unit", cost:4, ap:5,  keyword:"Bombard",       n:6, e:6, s:6, w:6, ability:null },
  { id:46, name:"Landing Craft",       cls:"Naval",     rarity:"Common", type:"unit", cost:1, ap:1,  keyword:null,           n:7, e:4, s:2, w:1, ability:null },
  { id:47, name:"Destroyer",           cls:"Naval",     rarity:"Common", type:"unit", cost:3, ap:2,  keyword:"Armor",         n:8, e:1, s:8, w:1, ability:null },
  { id:48, name:"Ace Pilot",           cls:"Aircraft",  rarity:"Common", type:"unit", cost:4, ap:4,  keyword:"Double Attack", n:7, e:7, s:3, w:3, ability:null },
  { id:59, name:"Storm Squad",         cls:"Infantry",  rarity:"Common", type:"unit", cost:2, ap:2,  keyword:"Double Attack", n:3, e:1, s:5, w:2, ability:null },
  { id:60, name:"Vanguard Tank",       cls:"Tank",      rarity:"Common", type:"unit", cost:2, ap:2,  keyword:"Breakthrough",  n:6, e:5, s:4, w:1, ability:null, retired:true }, // Retired 2026-08-13 — Breakthrough not implemented/balanced; not converted to vanilla since its stats were priced assuming the keyword discount.
  { id:61, name:"Shock Troopers",      cls:"Infantry",  rarity:"Common", type:"unit", cost:1, ap:1,  keyword:"Double Attack", n:2, e:2, s:3, w:1, ability:null },
  { id:62, name:"Bunker Crew",         cls:"Infantry",  rarity:"Common", type:"unit", cost:3, ap:2,  keyword:"Guard",         n:7, e:2, s:7, w:2, ability:null },
  { id:63, name:"Self-Propelled Gun",  cls:"Artillery", rarity:"Common", type:"unit", cost:3, ap:3,  keyword:"Armor",         n:9, e:1, s:1, w:4, ability:null },
  { id:64, name:"Veteran Garrison",    cls:"Infantry",  rarity:"Common", type:"unit", cost:4, ap:4,  keyword:"Guard",         n:7, e:6, s:7, w:4, ability:null },
  { id:65, name:"Panzer Brigade",      cls:"Tank",      rarity:"Common", type:"unit", cost:3, ap:3,  keyword:"Heavy Armor",   n:5, e:4, s:2, w:2, ability:null },
  { id:66, name:"King Tiger",          cls:"Tank",      rarity:"Common", type:"unit", cost:5, ap:4,  keyword:"Heavy Armor",   n:4, e:7, s:6, w:6, ability:null },
  { id:67, name:"Battleship",          cls:"Naval",     rarity:"Common", type:"unit", cost:4, ap:3,  keyword:"Heavy Armor",   n:5, e:5, s:5, w:1, ability:null },
  { id:68, name:"Chief of Staff",      cls:"Commander", rarity:"Rare",   type:"unit", cost:3, ap:3,  keyword:"Inspire",       n:1, e:8, s:6, w:1, ability:null, retired:true }, // Retired 2026-08-13 — Commander class parked now that Heroes cover the out-of-grid strategic-presence role.
  { id:69, name:"Quartermaster",       cls:"Infantry",  rarity:"Common", type:"unit", cost:1, ap:1,  keyword:null,           n:1, e:1, s:4, w:4, ability:"Start of your turn: if you control every objective on the map, draw a card." },
  { id:70, name:"Trench Runners",      cls:"Infantry",  rarity:"Common", type:"unit", cost:1, ap:1,  keyword:null,           n:4, e:1, s:6, w:1, ability:null },
  { id:71, name:"Light Skirmishers",   cls:"Infantry",  rarity:"Common", type:"unit", cost:1, ap:1,  keyword:null,           n:1, e:5, s:2, w:5, ability:null },
  { id:72, name:"Reserve Infantry",    cls:"Infantry",  rarity:"Common", type:"unit", cost:2, ap:2,  keyword:null,           n:1, e:6, s:5, w:6, ability:null },
  { id:86, name:"Grenadiers",          cls:"Infantry",  rarity:"Common", type:"unit", cost:3, ap:3,  keyword:null,           n:6, e:6, s:6, w:6, ability:null },

  // ── UNITS — v0.4 launch filler (2026-07-30, from Denis's Doc 03 handoff) ──
  // Abilities referencing "friendly Hero" are inert until Hero Phase logic exists (see cards.js header).
  { id:111, name:"Radio Operator",       cls:"Infantry",  rarity:"Common", type:"unit", cost:1, ap:1, keyword:null,         n:4, e:3, s:3, w:2, ability:"On Play: If a friendly Hero is in this column, look at the top 2 cards of your deck. Put one on top and one on the bottom." },
  { id:112, name:"Combat Engineers",     cls:"Infantry",  rarity:"Common", type:"unit", cost:2, ap:2, keyword:null,         n:5, e:4, s:4, w:2, ability:"On Play: If a friendly Hero is in this column, remove Suppression from another friendly Unit in this column." },
  { id:113, name:"Recon Jeep",           cls:"Tank",      rarity:"Common", type:"unit", cost:1, ap:1, keyword:null,         n:6, e:4, s:2, w:1, ability:null },
  { id:114, name:"Mobile Command Halftrack", cls:"Tank",  rarity:"Common", type:"unit", cost:3, ap:3, keyword:"Armor",      n:6, e:4, s:4, w:2, ability:"On Play: You may move a Hero into this column if its Hero Zone is empty." },
  { id:115, name:"Liaison Aircraft",     cls:"Aircraft",  rarity:"Common", type:"unit", cost:1, ap:1, keyword:"Airborne",   n:4, e:3, s:2, w:2, ability:null },
  { id:116, name:"Fighter-Bomber",       cls:"Aircraft",  rarity:"Common", type:"unit", cost:4, ap:4, keyword:"Airborne",   n:7, e:6, s:5, w:3, ability:null },
  { id:117, name:"Heavy Artillery Battery", cls:"Artillery", rarity:"Common", type:"unit", cost:4, ap:4, keyword:"Bombard", n:8, e:3, s:7, w:3, ability:null },
  { id:118, name:"Heavy Cruiser",        cls:"Naval",     rarity:"Common", type:"unit", cost:5, ap:5, keyword:"Heavy Armor", n:7, e:6, s:6, w:2, ability:null },
  { id:119, name:"Veteran Signal Corps", cls:"Infantry",  rarity:"Rare",   type:"unit", cost:3, ap:3, keyword:null,         n:6, e:5, s:5, w:4, ability:"On Play: If you activated a Hero Power last turn, draw 1 card." },
  { id:120, name:"Strategic Bomber",     cls:"Aircraft",  rarity:"Rare",   type:"unit", cost:5, ap:5, keyword:"Bombard",    n:8, e:6, s:5, w:4, ability:"The first time this Unit destroys an enemy, draw 1 card." },

  // ── UNITS — Deathrattle (added 2026-08-19, from Denis's "DeathRattle Brainstorm" tab on the
  // Card List Sheet). Card names invented — the brainstorm rows had no names. D1-D4 were all
  // drafted as Artillery (asymmetric vs. one each for the other 4 classes); shipped as-is per
  // Denis's call rather than trimmed to one. Deathrattle triggers whenever the unit is
  // Destroyed by ANY means (combat or a self-destroy Command like Sacrifice Play/Scorched Earth
  // Rally), not combat-kills only — see checkDeathrattle in combat.js.
  { id:131, name:"Forward Gun Crew",   cls:"Artillery", rarity:"Common", type:"unit", cost:2, ap:2, keyword:"Deathrattle", n:4, e:4, s:4, w:4,   ability:"Deathrattle: Draw 1 card." },
  { id:132, name:"Salvage Battery",    cls:"Artillery", rarity:"Common", type:"unit", cost:3, ap:3, keyword:"Deathrattle", n:5, e:2, s:2, w:6,   ability:"Deathrattle: Summon a random 1-cost friendly Artillery from your deck onto this tile." },
  { id:133, name:"Ranging Section",    cls:"Artillery", rarity:"Common", type:"unit", cost:1, ap:1, keyword:"Deathrattle", n:7, e:1, s:1, w:1,   ability:"Deathrattle: Give a random friendly Artillery (that doesn't already have it) Bombard until your next turn." },
  { id:134, name:"Veteran Battery",    cls:"Artillery", rarity:"Common", type:"unit", cost:4, ap:4, keyword:"Deathrattle", n:10,e:2, s:1, w:1,   ability:"Deathrattle: Give a random friendly Artillery +1 all sides (until your next turn)." },
  { id:135, name:"Rearguard Squad",    cls:"Infantry",  rarity:"Common", type:"unit", cost:2, ap:2, keyword:"Deathrattle", n:3, e:4, s:3, w:4,   ability:"Deathrattle: Give an adjacent friendly Unit +1 all sides (until your next turn)." },
  { id:136, name:"Salvage Crew",       cls:"Tank",      rarity:"Common", type:"unit", cost:2, ap:2, keyword:"Deathrattle", n:4, e:5, s:5, w:4,   ability:"Deathrattle: Your next Tank costs 1 less Fuel." },
  { id:137, name:"Squadron Reserve",   cls:"Aircraft",  rarity:"Common", type:"unit", cost:4, ap:4, keyword:"Deathrattle", n:6, e:2, s:3, w:4,   ability:"Deathrattle: Summon a random 2-cost friendly Aircraft from your deck onto this tile." },
  { id:138, name:"Convoy Escort",      cls:"Naval",     rarity:"Common", type:"unit", cost:2, ap:2, keyword:"Deathrattle", n:2, e:2, s:5, w:5,   ability:"Deathrattle: Your next Naval Unit played gets +1 all sides (until your next turn)." },

  // ── COMMANDS ───────────────────────────────────────────────────────────
  { id:16, name:"Artillery Barrage",   rarity:"Common", type:"command", cost:2, ap:1, effect:"Remove Armor from 1 enemy unit and Suppress it." },
  { id:17, name:"Blitzkrieg Order",    rarity:"Common", type:"command", cost:2, ap:2, effect:"Choose 1 friendly Tank. It may attack 1 adjacent enemy immediately, as if just deployed." },
  { id:18, name:"Field Medic",         rarity:"Common", type:"command", cost:1, ap:1, effect:"Remove Suppression from 1 friendly unit." },
  { id:19, name:"Tactical Withdrawal", rarity:"Common", type:"command", cost:1, ap:1, effect:"Return 1 friendly unit to your hand. It loses Suppression. Draw 1 card." },
  { id:20, name:"Air Strike",          rarity:"Common", type:"command", cost:3, ap:3, effect:"Deal 1 hit to a single enemy unit for each friendly Aircraft you control." },
  { id:21, name:"Coordinated Strike",  rarity:"Common", type:"command", cost:2, ap:2, effect:"Choose 2 friendly units. Each may attack 1 adjacent enemy this turn." },
  { id:22, name:"Recon",               rarity:"Common", type:"command", cost:2, ap:1, effect:"Draw 3 cards." },
  { id:49, name:"Smoke Screen",        rarity:"Common", type:"command", cost:1, ap:1, effect:"Choose 1 friendly unit. It gains Guard until your next turn." },
  { id:50, name:"Improvised Position", rarity:"Common", type:"command", cost:1, ap:1, effect:"Choose 1 friendly vanilla unit. It gains Armor until your next turn." },
  { id:51, name:"Rally Cry",           rarity:"Common", type:"command", cost:1, ap:1, effect:"Choose up to 2 friendly units. Each gains +1 to all sides for 2 turns. (Click each unit separately, or press Done to stop after 1.)" },
  { id:52, name:"Forward Observer",    rarity:"Common", type:"command", cost:1, ap:1, effect:"Draw 3 cards. Put 1 on top of your deck and 1 on the bottom. Keep 1." },
  { id:53, name:"Pincer Maneuver",     rarity:"Common", type:"command", cost:3, ap:1, effect:"Choose 2 friendly units on opposite sides of 1 enemy unit. Both attack it." },
  { id:54, name:"Last Stand",          rarity:"Common", type:"command", cost:2, ap:1, effect:"Remove Suppression from 1 friendly unit. It gains Guard until your next turn." },
  { id:73, name:"Overrun",             rarity:"Common", type:"command", cost:2, ap:2, effect:"This turn, every time you Suppress or Destroy an enemy unit, deal 1 additional HQ damage." },
  { id:74, name:"Dig In",              rarity:"Common", type:"command", cost:1, ap:1, effect:"Choose 1 friendly unit adjacent to an objective you control. It gains Guard and Armor until your next turn." },
  { id:75, name:"Hold Position",       rarity:"Common", type:"command", cost:2, ap:1, effect:"Up to 2 friendly units adjacent to an objective you control gain Armor until your next turn." },
  { id:76, name:"Industrial Surge",    rarity:"Common", type:"command", cost:1, ap:1, effect:"At the start of your next turn, gain 2 Fuel. This gain may exceed your Fuel storage cap." },
  { id:78, name:"Combined Arms Doctrine", rarity:"Common", type:"command", cost:3, ap:3, effect:"Remove Suppression from all units on the board. For each unit cleared this way, your HQ gains 2 HP." },
  { id:79, name:"Suppressing Fire",    rarity:"Common", type:"command", cost:4, ap:4, effect:"Deal 1 hit to a single enemy unit for each friendly Infantry you control." },
  { id:80, name:"Entrench",            rarity:"Common", type:"command", cost:2, ap:2, effect:"Friendly Infantry you control gain +2 to all sides until your next turn." },

  // ── COMMANDS — v0.4 launch filler (2026-07-30, from Denis's Doc 03 handoff) ──
  // Hero Phase logic now exists (2026-08-17) — Priority Orders/Command Shuffle/Radio
  // Interference/Change Formation are all live. Coordinated Orders retired below: the base
  // Hero Power Activation Economy now lets every deployed Hero activate once per turn, which
  // is exactly what that card used to grant as a one-time bonus — its effect is baseline now.
  { id:121, name:"Priority Orders",    rarity:"Common", type:"command", cost:1, ap:1, effect:"Your next Hero Power this turn costs 2F less, minimum 0." },
  { id:122, name:"Command Shuffle",    rarity:"Common", type:"command", cost:1, ap:1, effect:"Move 1 Hero or swap 2 Heroes. This does not count as your normal Hero reposition this turn." },
  { id:123, name:"Radio Interference", rarity:"Common", type:"command", cost:2, ap:2, effect:"Choose an enemy Hero. Its Activated Hero Power costs +1F during its controller's next turn." },
  { id:124, name:"Change Formation",   rarity:"Common", type:"command", cost:1, ap:1, effect:"Rotate one unsuppressed friendly Unit 90 degrees, in either direction (your choice)." },
  { id:125, name:"Field Reserves",     rarity:"Common", type:"command", cost:2, ap:2, effect:"Look at the top 4 cards of your deck. You may reveal a Unit and put it into your hand. Put the rest on the bottom." },
  { id:126, name:"Coordinated Orders", rarity:"Rare",   type:"command", cost:3, ap:3, effect:"You may activate one additional Hero Power this turn using a different Hero. Pay that Hero Power's normal Fuel cost.", retired:true }, // Retired 2026-08-17 — the Activation Economy change (multiple Heroes per turn) made this baseline behavior.

  // ── COMMANDS — Deathrattle support (added 2026-08-19, from Denis's "DeathRattle Brainstorm" tab) ──
  { id:139, name:"Grim Requisition",     rarity:"Common", type:"command", cost:1, ap:1, effect:"Draw a random Deathrattle Unit from your deck." },
  { id:140, name:"Sacrifice Play",       rarity:"Common", type:"command", cost:2, ap:2, effect:"Destroy 1 friendly Unit (triggers its Deathrattle). Deal 2 HQ damage to your opponent instead of yourself." },
  { id:141, name:"Scorched Earth Rally", rarity:"Common", type:"command", cost:3, ap:3, effect:"Destroy 1 friendly Unit (triggers its Deathrattle; you take 2 HQ damage as normal). Give all other friendly Units +1 all sides until your next turn." },

  // ── MISSIONS (retired 2026-07-30 — parked, not deleted; see cards.js header) ──
  { id:23, name:"Hold the Line",       rarity:"Common", type:"mission", cost:0, ap:0, req:"Control all objectives at end of your turn.",                                          reward:"Heal 5 HQ HP.", retired:true },
  { id:24, name:"Deep Strike",         rarity:"Common", type:"mission", cost:1, ap:2, req:"Have a friendly unit adjacent to 2+ enemy units simultaneously.",                      reward:"Deal 2 HQ damage.", retired:true },
  { id:25, name:"Blitz Assault",       rarity:"Common", type:"mission", cost:0, ap:0, req:"Destroy 2 enemy units in a single turn.",                                              reward:"Draw 2 cards and gain 1 Fuel.", retired:true },
  { id:55, name:"Armored Spearhead",   rarity:"Common", type:"mission", cost:1, ap:2, req:"Have 2 or more friendly Tanks on the board at the same time.",                        reward:"Your next Tank costs 2 less Fuel.", retired:true },
  { id:56, name:"Total Air Superiority",rarity:"Common", type:"mission", cost:1, ap:2, req:"Destroy an enemy unit with a friendly Aircraft.",                                    reward:"Deal 2 HQ damage.", retired:true },
  { id:57, name:"Fortify the Line",    rarity:"Common", type:"mission", cost:1, ap:1, req:"Control 2+ objectives at end of your turn.",                                           reward:"Remove Suppression from 1 friendly unit and give it Armor.", retired:true },
  { id:58, name:"Encirclement",        rarity:"Common", type:"mission", cost:1, ap:1, req:"A friendly unit is adjacent to 1 enemy unit on 2+ sides simultaneously.",              reward:"Deal 1 hit to that enemy unit.", retired:true },
  { id:81, name:"Total Onslaught",     rarity:"Common", type:"mission", cost:1, ap:2, req:"Destroy 3 enemy units since this mission was played.",                                  reward:"Deal 2 HQ damage.", retired:true },
  { id:84, name:"Overwhelming Force",  rarity:"Common", type:"mission", cost:1, ap:2, req:"Destroy an enemy unit with a friendly Heavy Armor unit.",                              reward:"Deal 2 HQ damage.", retired:true },

  // ── MISSIONS — v0.4 launch filler (2026-07-30, from Denis's Doc 03 handoff) ──
  // Added retired:true immediately, consistent with Missions being parked for v0.4 (Batch 1).
  { id:127, name:"Command Network",    rarity:"Common", type:"mission", cost:1, ap:1, req:"Activate Hero Powers from 2 different Heroes after playing this Mission.", reward:"Draw 2 cards.", retired:true },
  { id:128, name:"Joint Operations",   rarity:"Common", type:"mission", cost:1, ap:1, req:"Play Units from 3 different Classes after playing this Mission.",          reward:"Gain 2 Fuel and draw 1 card.", retired:true },
  { id:129, name:"Hold Every Sector",  rarity:"Common", type:"mission", cost:0, ap:0, req:"At end of your turn, have at least one unsuppressed friendly Unit in all 4 columns.", reward:"Draw 2 cards.", retired:true },
  { id:130, name:"Counteroffensive",   rarity:"Common", type:"mission", cost:1, ap:1, req:"Remove Suppression from a friendly Unit, then Destroy an enemy Unit during the same turn.", reward:"Give one friendly Unit +1 all sides until your next turn and draw 1 card.", retired:true },

  // ── OBJECTIVES ─────────────────────────────────────────────────────────
  { id:26, name:"Factory",             type:"objective", category:"Economy/Vehicle",  l1:"Gain 1 Fuel.",                                         l2:"Gain 1 Fuel. Next Tank costs 1 less.",              l3:"Gain 2 Fuel. Tanks +1 all sides.",                    l4:"Gain 2 Fuel. Tanks +2 all sides. Deal 2 HQ damage." },
  { id:27, name:"Airfield",            type:"objective", category:"Air/Tempo",        l1:"Aircraft attack twice on placement this turn.",         l2:"Deal 1 HQ damage.",                                l3:"Deal 1 HQ damage. Draw 1 card.",                      l4:"Deal 4 HQ damage." },
  { id:28, name:"Supply Depot",        type:"objective", category:"Resource",          l1:"Gain 1 Fuel.",                                         l2:"Gain 2 Fuel.",                                     l3:"Gain 2 Fuel. Draw 1 card.",                           l4:"Gain 3 Fuel. Draw 1 card. Deal 2 HQ damage." },
  { id:29, name:"Bridge",              type:"objective", category:"Positioning",       l1:"Return 1 friendly unit to hand, remove Suppression.",  l2:"Same. Draw 1 card.",                               l3:"Return up to 2 units, remove Suppression.",           l4:"Return up to 2, remove Suppression. Draw 1 card. Deal 2 HQ damage." },
  { id:30, name:"Radar Station",       type:"objective", category:"Information",       l1:"Look at opponent's hand.",                             l2:"Look at hand. Draw 1 card.",                       l3:"Look; opponent discards 1 you choose.",                l4:"Look; opponent discards 1. Draw 1 card. Deal 2 HQ damage." },
  { id:31, name:"City",                type:"objective", category:"Infantry/Defense",  l1:"Adjacent Infantry gain Guard this turn.",               l2:"Adjacent Infantry +1 all sides this turn.",        l3:"Adjacent Infantry gain Guard, +1 all sides.",         l4:"Adjacent Infantry gain Guard, +2 all sides. Deal 2 HQ damage." },
  { id:32, name:"Artillery Position",  type:"objective", category:"Damage",            l1:"Deal 1 HQ damage.",                                    l2:"Deal 1 hit to 1 enemy unit.",                      l3:"Deal 2 HQ damage.",                                   l4:"Deal 3 HQ damage. Deal 1 hit to 1 enemy unit." },
  { id:33, name:"Fortification",       type:"objective", category:"Defense",           l1:"Adjacent units gain Fortified this turn.",              l2:"Adjacent units gain Fortified until next turn.",   l3:"Adjacent units gain Fortified, +1 all sides.",        l4:"Adjacent units gain Fortified, +2 all sides. Deal 2 HQ damage." },

  // ── HEROES (v0.4, added 2026-07-30 — from Denis's Doc 02 handoff, 24-Hero launch pool) ──
  // Excluded from getDeckPool() in decks.js — never shuffled into the 30-card deck.
  // No Hero Phase/activation/reinforcement logic wired yet; see cards.js header.
  { id:87,  name:"Quartermaster General",        rarity:"Common", type:"hero", scope:"board",  implemented:true,  powerType:"active",  activeCost:2, ability:"Draw 1 card.", direction:"Universal value; starter-readable." },
  { id:88,  name:"Operations Planner",           rarity:"Rare",   type:"hero", scope:"board",  implemented:false, powerType:"passive", activeCost:null, ability:"The first card you draw each turn may be put on the bottom of your deck. If you do, draw the next card.", direction:"Consistency without raw card advantage." },
  { id:89,  name:"Logistics Chief",              rarity:"Rare",   type:"hero", scope:"board",  implemented:true,  powerType:"passive", activeCost:null, ability:"Your maximum stored Fuel is 11 instead of 9.", direction:"Expensive/ramp decks." },
  { id:90,  name:"Intelligence Officer",         rarity:"Rare",   type:"hero", scope:"board",  implemented:false, powerType:"active",  activeCost:1, ability:"Look at the opponent's hand.", direction:"Information/control. Needs an opponent hand-reveal UI (also blocks Radar Station)." },
  { id:91,  name:"Field Engineer",               rarity:"Rare",   type:"hero", scope:"column", implemented:true,  powerType:"active",  activeCost:1, ability:"Rotate one unsuppressed friendly Unit in this Hero's column 90 degrees, in either direction (your choice).", direction:"Signature SIGNAL positioning. Wired up 2026-08-17 — reuses Change Formation's (124) rotation mechanic." },
  { id:92,  name:"Tactical Commander",           rarity:"Common", type:"hero", scope:"column", implemented:true,  powerType:"active",  activeCost:1, ability:"A friendly Unit in this Hero's column gets +1 all sides this turn.", direction:"Simple positional starter Hero." },
  { id:93,  name:"Mobile Warfare Commander",     rarity:"Rare",   type:"hero", scope:"column", implemented:false, powerType:"passive", activeCost:null, ability:"After this Hero changes zones due to your Hero Phase reposition, the first Unit you play in this Hero's column this turn costs 1F less.", direction:"Rewards command movement. Wording normalised 2026-08-01 from 'its new column' — it was column-scoped in substance but read as board-scoped." },
  { id:94,  name:"Objective Marshal",            rarity:"Rare",   type:"hero", scope:"column", implemented:true,  powerType:"passive", activeCost:null, ability:"The first friendly Unit you play each turn in this Hero's column on or adjacent to an Objective gets +1 all sides until your next turn.", direction:"Objective control." },
  { id:95,  name:"Blitz Commander",              rarity:"Rare",   type:"hero", scope:"column", implemented:false, powerType:"passive", activeCost:null, ability:"The first time each turn you Suppress an enemy through combat in this Hero's column, gain 1 temporary Fuel.", direction:"Attack -> momentum -> deployment. Needs a temporary/overflow Fuel concept." },
  { id:96,  name:"Overrun Commander",            rarity:"Rare",   type:"hero", scope:"column", implemented:false, powerType:"passive", activeCost:null, ability:"The first enemy Unit you Destroy in this Hero's column each turn deals +1 additional HQ damage.", direction:"Aggro/finisher. Needs a destroy hook at 4-5 separate inline sites." },
  { id:97,  name:"Assault Coordinator",          rarity:"Rare",   type:"hero", scope:"column", implemented:false, powerType:"active",  activeCost:2, ability:"Your next Unit played in this Hero's column this turn may make one additional placement attack. A unit already making two placement attacks gains no third attack.", direction:"Tempo/placement. Needs an extra-placement-attack mechanic." },
  { id:98,  name:"Encirclement Officer",         rarity:"Rare",   type:"hero", scope:"column", implemented:false, powerType:"passive", activeCost:null, ability:"The first time each turn you attack an enemy in this Hero's column that is adjacent to at least 2 friendly Units, the attacker gets +1 all sides this turn.", direction:"Surrounding/position." },
  { id:99,  name:"Garrison Commander",           rarity:"Common", type:"hero", scope:"board",  implemented:true,  powerType:"active",  activeCost:1, ability:"A friendly Unit adjacent to an Objective gains Guard until your next turn.", direction:"Defensive starter Hero." },
  { id:100, name:"Recovery Officer",             rarity:"Rare",   type:"hero", scope:"column", implemented:true,  powerType:"active",  activeCost:1, ability:"Remove Suppression from one friendly Unit in this Hero's column.", direction:"Recovery/control." },
  { id:101, name:"Counteroffensive General",     rarity:"Rare",   type:"hero", scope:"board",  implemented:true,  powerType:"passive", activeCost:null, ability:"The first friendly Unit that gets Suppressed each turn gets +1 all sides until end of turn.", direction:"Turns recovery into tempo." },
  { id:102, name:"Reserve Commander",            rarity:"Rare",   type:"hero", scope:"column", implemented:false, powerType:"passive", activeCost:null, ability:"The first time a friendly Unit in this Hero's column is Destroyed each round, your next Unit played in that column costs 1F less.", direction:"Soft rebuild/comeback. Needs the same destroy hook as 96." },
  { id:103, name:"Armored Commander",            rarity:"Rare",   type:"hero", scope:"board",  implemented:true,  powerType:"active",  activeCost:2, ability:"Your next Tank played this turn costs 3F less.", direction:"Net economy gain is normally 1F." },
  { id:104, name:"Infantry Commander",           rarity:"Rare",   type:"hero", scope:"column", implemented:true,  powerType:"passive", activeCost:null, ability:"The first Infantry played in this Hero's column each turn gets +1 all sides until your next turn.", direction:"Infantry/go-wide." },
  { id:105, name:"Air Marshal",                  rarity:"Rare",   type:"hero", scope:"column", implemented:false, powerType:"active",  activeCost:2, ability:"Your next Aircraft played in this Hero's column this turn may make one additional placement attack; no third attack.", direction:"Air tempo. Needs the same extra-placement-attack mechanic as 97." },
  { id:106, name:"Artillery Commander",          rarity:"Rare",   type:"hero", scope:"column", implemented:false, powerType:"active",  activeCost:2, ability:"Choose a friendly Bombard Unit in this Hero's column. It may make one additional attack this turn.", direction:"Ranged attrition. Needs an extra-attack mechanic." },
  { id:107, name:"Command Specialist",           rarity:"Rare",   type:"hero", scope:"board",  implemented:true,  powerType:"active",  activeCost:1, ability:"Your next Command this turn costs 2F less.", direction:"Command-heavy decks." },
  { id:108, name:"Mission Commander",            rarity:"Rare",   type:"hero", scope:"board",  implemented:false, retired:true, powerType:"passive", activeCost:null, ability:"The first Mission you complete each turn gives you 1 Fuel.", direction:"Mission engine. Retired 2026-08-01 — dead card while Missions are retired; unpark if Missions return." },
  { id:109, name:"Combined Arms General",        rarity:"Rare",   type:"hero", scope:"board",  implemented:false, retired:true, powerType:"passive", activeCost:null, ability:"The first Unit you play each turn whose Class is different from the previous Unit you played gets +1 all sides until your next turn.", direction:"Mixed-class army. Retired 2026-08-14 — cut from the launch Hero roster." },
  { id:110, name:"Conventional Warfare Commander", rarity:"Rare", type:"hero", scope:"column", implemented:true,  powerType:"passive", activeCost:null, ability:"The first Vanilla Unit you play in this Hero's column each turn gets +1 all sides until your next turn.", direction:"Makes no-keyword units a strategy." },

  // ── HEROES — Week 3 batch (added 2026-08-19, from Denis's Heroes_Week3 tab). Card names
  // invented — the brainstorm rows had no names. One Week 3 draft ("Rotate a friendly Unit in
  // this Column", 1F Active) was NOT added — it duplicates Field Engineer (91), already shipped.
  // The "Weird AirCraft" crafting Hero (250) and its random roll table are explicitly parked,
  // not implemented — see the Weird AirCraft tab and CLAUDE.md's Open design questions.
  { id:142, name:"Fire Support Officer", rarity:"Rare", type:"hero", scope:"column", implemented:true, powerType:"active",  activeCost:1, ability:"Give a friendly Unit in this Hero's column Bombard until end of turn.", direction:"Column-scoped ranged-attack enabler." },
  { id:143, name:"Supreme Commander",    rarity:"Rare", type:"hero", scope:"board",  implemented:true, powerType:"passive", activeCost:null, ability:"Your other Heroes' column-scoped powers affect your whole board instead of just their own column.", direction:"Board-wide payoff for stacking column Heroes. Column-scoped heroTargetKeys/applyHeroPower cases and combat.js's checkHeroPassivesOnPlace all check for this Hero via a shared column-freedom helper." },
  { id:144, name:"Field Marshal",        rarity:"Rare", type:"hero", scope:"board",  implemented:true, powerType:"active",  activeCost:1, ability:"Give all friendly Units +N all sides (permanent), where N is 1 the first time you activate this Hero, 2 the second time, 3 the third, and so on.", direction:"Brainstorm text read '1 side stat, repeat, repeat amount increase each turn' — interpreted as all-sides for consistency with every other Hero buff in the set (no existing precedent for a single random/chosen side), and as an escalating Active power gated by the normal once-per-turn Hero activation lock (matches its 'Active' Power Type in the sheet) rather than an automatic, uncapped per-turn trigger. Flagged as a balance risk — unbounded scaling over a long game — watch closely in playtesting." },
  { id:145, name:"Sector Commander",     rarity:"Rare", type:"hero", scope:"column", implemented:true, powerType:"active",  activeCost:3, ability:"All friendly Units in this Hero's column get +2 all sides until your next turn.", direction:"Brainstorm text said 'All Units' with no friendly/enemy qualifier — every other card in the set qualifies 'friendly' explicitly, so treated as an omission and restricted to friendly Units." },
  { id:146, name:"Grand Marshal",        rarity:"Rare", type:"hero", scope:"board",  implemented:true, powerType:"passive", activeCost:null, ability:"If you activate Field Marshal (144) this turn, its bonus applies twice.", direction:"Brainstorm text: 'End of the turn trigger twice.' The only real end-of-turn-style trigger in this batch is Field Marshal's escalating buff, so this doubles that specifically rather than a generic (and currently nonexistent) end-of-turn trigger queue." },
  { id:147, name:"Graves Registration Officer", rarity:"Rare", type:"hero", scope:"board", implemented:true, powerType:"passive", activeCost:null, ability:"Your Deathrattle effects trigger twice.", direction:"Brainstorm text: 'DeathRattle trigger twice.' Historically-flavored name (Graves Registration was a real WW2 unit role)." },
];

export const CARD_BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
