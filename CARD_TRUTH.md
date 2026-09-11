# SIGNAL — Card Truth

**Generated file — do not hand-edit.** Regenerate with `node scripts/generate_card_truth.mjs`
any time `js/cards.js` changes. Every value here comes directly from `CARDS` in that file — the
code that actually runs — so this can never drift the way `card_list.csv` did (see CLAUDE.md).

Generated: 2026-09-11

65 Units • 25 Heroes • 35 Commands • 5 Objectives • 125 collectible

---

## Units — Infantry (22)

| ID | Name | Fuel | Copies | Keyword(s) | N/E/S/W | Ability |
|---|---|---|---|---|---|---|
| I1 | Rifle Squad | 1 | 2 | — | 5/4/2/2 | — |
| I2 | Militia | 2 | 2 | — | 3/6/5/4 | — |
| I3 | Regular Infantry | 3 | 2 | — | 4/4/8/5 | — |
| I4 | Veteran Infantry | 4 | 2 | — | 8/4/6/7 | — |
| I5 | Elite Infantry | 5 | 2 | — | 7/8/7/8 | — |
| I6 | Shield Bearers | 1 | 2 | Guard | 2/4/3/1 | — |
| I7 | Frontline Guard | 2 | 2 | Guard | 5/3/2/4 | — |
| I8 | Veteran Guard | 3 | 2 | Guard | 2/4/6/5 | — |
| I9 | Motivator | 2 | 2 | Inspire | 5/4/3/4 | Inspire: adjacent friendly Units get +1 all sides while this Unit is on the battlefield. |
| I10 | Sergeant | 3 | 2 | Inspire | 5/4/4/4 | Inspire: adjacent friendly Units get +1 all sides while this Unit is on the battlefield. |
| I11 | Company Leader | 4 | 2 | Inspire | 5/6/5/5 | Inspire: adjacent friendly Units get +1 all sides while this Unit is on the battlefield. |
| I12 | Assault Trooper | 2 | 2 | Rally | 4/2/4/4 | Rally: draw 1 card. |
| I13 | Combat Engager | 3 | 2 | Rally | 4/5/5/3 | Rally: a random other friendly Infantry gains +1 all sides permanently. |
| I14 | Veteran Raider | 4 | 2 | Rally | 6/5/5/6 | Rally: all adjacent friendly Units gain +1 all sides permanently. |
| I15 | Green Recruit | 2 | 2 | Muster | 1/1/1/1 | Muster: +1 all sides for each other friendly Infantry you control. |
| I16 | Infantry Line | 4 | 2 | Muster | 3/4/4/3 | Muster: +1 all sides for each other friendly Infantry you control. |
| I17 | Brigade Veterans | 6 | 1 | Muster | 6/5/5/6 | Muster: +1 all sides for each other friendly Infantry you control. |
| I18 | Last Stand Soldier | 2 | 2 | Last Stand | 2/4/4/3 | Last Stand: draw 1 card. |
| I19 | Final Defender | 4 | 2 | Last Stand | 5/5/5/6 | Last Stand: a random friendly Infantry gains +1 all sides permanently. |
| I20 | Shock Trooper | 4 | 2 | Double Attack | 5/5/3/4 | — |
| I21 | Commanding Infantry | 5 | 1 | Muster / Inspire / Rally | 4/4/5/4 | Muster/Inspire use the standard definitions. Rally: all other friendly Infantry gain +1 all sides permanently. |
| I22 | Field Commander | 3 | 2 | Guard / Last Stand | 4/2/3/5 | Last Stand: adjacent friendly Infantry gain +1 all sides until end of turn. |

## Units — Tank (17)

| ID | Name | Fuel | Copies | Keyword(s) | N/E/S/W | Ability |
|---|---|---|---|---|---|---|
| T23 | Panzer III | 2 | 2 | — | 5/4/5/5 | — |
| T24 | Panzer IV | 3 | 2 | — | 5/6/5/6 | — |
| T25 | Sherman Tank | 4 | 2 | — | 7/6/7/6 | — |
| T26 | Heavy Tank | 5 | 2 | — | 8/8/8/7 | — |
| T27 | King Tiger | 6 | 1 | — | 9/9/9/9 | — |
| T28 | Blitz Tank | 3 | 2 | Armor | 4/5/4/5 | — |
| T29 | Vanguard Tank | 4 | 2 | Armor | 6/5/6/5 | — |
| T30 | Panzer Brigade | 5 | 2 | Heavy Armor | 6/5/5/6 | — |
| T31 | Tiger I | 6 | 2 | Heavy Armor | 7/7/8/5 | — |
| T32 | Tank Hunter | 3 | 2 | Breakthrough | 6/4/3/5 | Breakthrough: this Unit gains +1 all sides permanently. |
| T33 | Tank Destroyer | 4 | 2 | Breakthrough | 5/6/5/6 | Breakthrough: your next Tank costs 1 Fuel (set-cost; other reductions can still apply). |
| T34 | Breakthrough Tank | 5 | 2 | Breakthrough | 6/7/6/7 | Breakthrough: this Unit gains Armor. |
| T35 | Ace Tank | 6 | 2 | Breakthrough | 6/6/9/6 | Breakthrough: this Unit gains Double Attack. |
| T36 | Flak Halftrack | 4 | 2 | Double Attack | 5/5/4/6 | — |
| T37 | Mobile Command Tank | 5 | 2 | Guard | 7/6/7/6 | — |
| T38 | Armored Spearhead | 5 | 2 | Armor / Breakthrough | 6/5/6/6 | Breakthrough: this Unit gains +1 all sides permanently. |
| T39 | Mobile Fortress | 7 | 1 | Guard / Heavy Armor | 5/8/5/8 | — |

## Units — Artillery (14)

| ID | Name | Fuel | Copies | Keyword(s) | N/E/S/W | Ability |
|---|---|---|---|---|---|---|
| AR40 | Ranging Section | 1 | 2 | — | 2/2/6/2 | — |
| AR41 | Field Gun | 2 | 2 | — | 3/7/3/3 | — |
| AR42 | Self-Propelled Gun | 3 | 2 | — | 8/4/4/4 | — |
| AR43 | Field Howitzer | 2 | 2 | Bombard | 1/1/1/7 | — |
| AR44 | Heavy Howitzer | 4 | 2 | Bombard | 3/3/9/3 | — |
| AR45 | Long-Range Battery | 5 | 2 | Bombard | 4/10/4/4 | — |
| AR46 | Mortar Battery | 2 | 2 | Blast | 2/6/2/2 | Blast: on a successful Hit, also Hit enemy Units directly left/right of the target relative to attack direction. |
| AR47 | Siege Gun | 4 | 2 | Blast | 3/3/8/3 | Blast: on a successful Hit, also Hit enemy Units directly left/right of the target relative to attack direction. |
| AR48 | Rocket Battery | 3 | 2 | Barrage | 2/2/2/6 | Barrage: on a successful Hit, also Hit enemy Units farther along the forward attack ray beyond the target. |
| AR49 | Heavy Rocket Battery | 5 | 1 | Barrage | 8/3/3/3 | Barrage: on a successful Hit, also Hit enemy Units farther along the forward attack ray beyond the target. |
| AR50 | Anti-Tank Gun | 2 | 2 | Guard | 3/3/7/3 | — |
| AR51 | Rapid-Fire Gun | 3 | 2 | Double Attack | 3/3/3/8 | — |
| AR52 | Rocket Launcher | 3 | 2 | Bombard / Double Attack | 1/1/1/5 | — |
| AR53 | Grand Battery | 5 | 1 | Bombard / Barrage / Blast | 9/1/1/1 | Combines ranged, forward-ray, and side-splash Hits on a single successful attack; primary Hit resolves first. |

## Units — Aircraft (12)

| ID | Name | Fuel | Copies | Keyword(s) | N/E/S/W | Ability |
|---|---|---|---|---|---|---|
| A54 | Fighter | 3 | 2 | — | 6/5/4/5 | — |
| A55 | Tactical Fighter | 3 | 2 | Maneuver | 3/3/7/4 | On Play: Maneuver 1 other friendly Unit to another legal position. |
| A56 | Escort Fighter | 4 | 2 | Precision / Maneuver | 4/5/2/8 | On Play: Maneuver 1 other friendly Unit to another legal position. |
| A57 | Ace Pilot | 5 | 1 | Precision / Double Attack | 4/8/3/6 | — |
| A58 | Medium Bomber | 4 | 2 | — | 7/5/6/6 | — |
| A59 | Heavy Bomber | 5 | 2 | Bombard | 9/6/7/3 | — |
| A60 | Pathfinder Bomber | 3 | 2 | Precision | 4/5/4/6 | — |
| A61 | Strategic Bomber | 8 | 1 | Precision / Bombard / Maneuver / Double Attack | 3/8/8/3 | On Play: Maneuver 1 other friendly Unit to another legal position. |
| A62 | Fighter-Bomber | 4 | 2 | Maneuver | 5/4/5/6 | On Play: Maneuver 1 other friendly Unit to another legal position. |
| A63 | Strike Aircraft | 5 | 2 | Precision / Maneuver | 5/5/5/5 | On Play: Maneuver 1 other friendly Unit to another legal position. |
| A64 | Dive Bomber | 4 | 2 | Double Attack | 5/4/3/3 | — |
| A65 | Ground-Attack Aircraft | 5 | 2 | Maneuver / Bombard | 4/4/6/4 | On Play: Maneuver 1 other friendly Unit to another legal position. |

## Heroes (25)

| ID | Name | Scope | Power Type | Fuel | Ability |
|---|---|---|---|---|---|
| H01 | Quartermaster General | board | active | 2⛽ | Look at 3 random cards from your deck, choose 1 to put into your hand; the others remain in the deck. |
| H02 | Logistics Chief | board | passive | — | Your normal Fuel-step threshold is 11 instead of 9. Effect-generated Fuel may exceed that threshold. |
| H03 | Tactical Commander | column | active | 1⛽ | Give 1 friendly Unit in this Hero's column +1 all sides permanently. |
| H04 | Objective Marshal | board | passive | — | The first friendly Unit you play each turn adjacent to an Objective gets +1 all sides until your next turn. |
| H05 | Recovery Officer | column | active | 1⛽ | Remove Suppression from 1 friendly Unit in this Hero's column. |
| H06 | Counteroffensive General | board | passive | — | The first friendly Unit that becomes Suppressed each turn gets +1 all sides until end of your next turn. |
| H07 | Armored Commander | column | active | 2⛽ | Your next Tank played in this Hero's column this turn costs 3 Fuel less. |
| H08 | Infantry Commander | column | passive | — | The first Infantry played in this Hero's column each turn gets +1 all sides until your next turn. |
| H09 | Command Specialist | board | active | 1⛽ | Your next Command this turn costs 2 Fuel less. |
| H10 | Conventional Warfare Commander | board | active | 1⛽ | Give 1 friendly Vanilla Unit (no keyword) +3 all sides until end of turn. |
| H11 | Field Coordinator | column | active | 1⛽ | Rotate 1 friendly Unit in this Hero's column left or right. |
| H12 | Fire Support Officer | column | active | 1⛽ | Give 1 friendly Unit in this Hero's column Bombard until end of turn. |
| H13 | Supreme Commander | board | passive | — | Your other Heroes ignore their Column restrictions — every other column-scoped Hero power affects your whole board instead. |
| H14 | Graves Registration Officer | board | passive | — | Your Last Stand effects trigger twice; each resolution is separate and may independently choose the same random target. |
| H15 | Strike Commander | column | active | 1⛽ | Deal 1 Hit to 1 enemy Unit in this Hero's column. |
| H16 | Maneuver Commander | column | active | 2⛽ | Maneuver 1 friendly Unit in this Hero's column to another legal position and reset its persistent attacks. |
| H17 | HQ Assault Commander | board | active | 2⛽ | Deal 2 damage to the enemy HQ. |
| H18 | Artillery Commander | column | active | 1⛽ | Give 1 friendly Artillery in this Hero's column Blast until end of turn. |
| H19 | Training Officer | board | active | 2⛽ | Give all 1- and 2-cost Units currently in your hand +1 all sides permanently. |
| H20 | Ruthless Strategist | board | passive | — | Whenever you play a Command, after it fully resolves: draw 1 card, then deal 1 damage to your HQ. |
| H21 | Emergency Logistics Officer | board | passive | — | The first time you play a Unit each turn, after its own On Play resolves: gain 1 Fuel, then deal 1 damage to your HQ. |
| H22 | Frontline Marshal | column | active | 3⛽ | All Units currently in this Hero's column, friendly and enemy, gain +2 all sides permanently. |
| H23 | Army Group Commander | board | active | 4⛽ | All friendly Units gain +1 all sides permanently. |
| H24 | Long War Commander | column | hybrid | — | Passive: starts at Power 1; gains +1 Power at the end of each of your turns. Active (1 Fuel): repeat Power times — each repetition independently gives a random friendly Unit in this Hero's column +1 to a random side, permanently. Multiple/all repetitions may choose the same Unit. |
| H25 | Chief Aircraft Engineer | board | active | 4⛽ | Craft: generate 3 candidate Aircraft (one stats package + one of Bombard/Double Attack/Armor + one drawback each), choose 1 to add to hand (costs 1 Fuel to play, no copy-limit accounting). After each activation, this ability's cost reduces by 1 for the rest of the match, to a minimum of 1. |

## Commands (35)

| ID | Name | Class | Fuel | Copies | Effect |
|---|---|---|---|---|---|
| C01 | Field Medic | General | 1⛽ | 2 | Remove Suppression from 1 friendly Unit. |
| C02 | Improvised Position | General | 1⛽ | 2 | Give 1 friendly Unit without Armor +2 all sides until your next turn. |
| C03 | Rally Cry | General | 1⛽ | 2 | Up to 2 friendly Units get +1 all sides until end of turn. |
| C04 | Forward Observer | General | 1⛽ | 2 | Look at the top 3 cards of your deck: 1 to hand, 1 on top, 1 on bottom. Requires at least 2 cards in deck; with exactly 2, look at both, 1 to hand, other stays on top. |
| C05 | Recon | General | 2⛽ | 2 | Draw 2 cards. |
| C06 | Coordinated Strike | General | 2⛽ | 2 | Choose 2 friendly Units that both currently have the same enemy Unit as a legal attack target. Each gains 1 additional legal attack this turn. |
| C07 | Combined Arms Doctrine | General | 3⛽ | 2 | Remove Suppression from all friendly Units and draw 1 card. |
| C08 | Second Wind | General | 2⛽ | 2 | Remove Suppression from 1 friendly Unit; it gets +2 all sides until end of turn. |
| C09 | Overrun | General | 2⛽ | 2 | For the rest of this turn, enemy Units Suppressed after this resolves deal 1 HQ damage; enemy normal Units destroyed after this resolves deal 3 HQ damage instead of 2. Not retroactive. |
| C10 | Hold Position | General | 2⛽ | 2 | Up to 2 friendly Units get +2 all sides until your next turn. |
| C11 | Tactical Withdrawal | General | 1⛽ | 2 | Return 1 friendly Unit to your hand. |
| C12 | Dig In | General | 1⛽ | 2 | Give 1 friendly Unit Guard until your next turn. |
| C13 | Industrial Surge | General | 1⛽ | 2 | Gain 2 extra Fuel at the start of your next turn. |
| C14 | Priority Orders | General | 1⛽ | 2 | Your next Hero Active ability this turn costs 2 Fuel less. |
| C15 | Command Shuffle | General | 1⛽ | 2 | Move 1 Hero to another unoccupied Hero column, or swap the columns of 2 Heroes. |
| C16 | Change Formation | General | 1⛽ | 2 | Rotate 1 friendly Unit left or right. |
| C17 | Coordinated Order | General | 2⛽ | 2 | Reset your Hero ability state: used Active abilities become available again, and limited Passive per-turn triggers may trigger again this turn. Does not rewind persistent Hero state (e.g. Long War Commander's Power, Chief Aircraft Engineer's activation cost). |
| C18 | Sacrifice Play | General | 1⛽ | 2 | Destroy 1 friendly Unit; draw 2 cards. |
| C19 | Scorched Earth Raid | General | 2⛽ | 2 | Destroy 1 friendly Unit. Deal 2 enemy-HQ damage instead of that Unit's normal friendly-destruction HQ result. Applies even if the destroyed Unit has Guard. |
| C20 | Total Mobilization | General | 2⛽ | 2 | All Units, friendly and enemy, gain +1 all sides permanently. |
| C21 | Forced March | General | 2⛽ | 2 | Maneuver 1 friendly Unit, then draw 1 card. |
| C22 | Objective Push | General | 2⛽ | 2 | Choose an Objective. Friendly Units orthogonally adjacent to it gain +1 all sides permanently. |
| C23 | Emergency Supply | General | 2⛽ | 2 | Gain 3 Fuel for this turn and deal 2 damage to your HQ. Unused Fuel gained this way expires at end of turn after Direct HQ. |
| C24 | Suppressing Fire | Infantry | 1⛽ | 2 | Give 1 friendly Infantry +1 all sides permanently. |
| C25 | Entrench | Infantry | 2⛽ | 2 | All friendly Infantry get +2 all sides until end of turn. |
| C26 | General Offensive | Infantry | 3⛽ | 2 | All friendly Infantry gain +1 all sides permanently. Escalate: +2 instead. |
| C27 | Blitzkrieg Order | Tank | 2⛽ | 2 | Maneuver 1 friendly Tank to another legal position and give it Armor. Escalate: affect up to 2 friendly Tanks instead. |
| C28 | Field Repairs | Tank | 1⛽ | 2 | Give 1 friendly Tank Armor. If it already has Armor, give Heavy Armor instead. If already Heavy Armor, nothing happens. |
| C29 | Armored Offensive | Tank | 1⛽ | 2 | Your next Tank played this turn costs 2 Fuel less. |
| C30 | Artillery Barrage | Artillery | 2⛽ | 2 | Give 1 friendly Artillery Barrage until end of turn. |
| C31 | Target Coordinates | Artillery | 1⛽ | 2 | Give 1 friendly Artillery Precision until end of turn. |
| C32 | Fire for Effect | Artillery | 3⛽ | 2 | Give 1 friendly Artillery Blast and Barrage until end of turn. Escalate: affect up to 2 friendly Artillery instead. |
| C33 | Air Strike | Aircraft | 3⛽ | 2 | All friendly Aircraft gain 1 additional legal attack until end of turn. |
| C34 | Air Superiority | Aircraft | 2⛽ | 2 | All friendly Aircraft get +1 all sides and Precision until end of turn. Escalate: +2 instead. |
| C35 | Scramble | Aircraft | 2⛽ | 2 | Maneuver 1 friendly Aircraft and reset its persistent attack allowance. |

## Objectives (5)

| ID | Name | Category | L1 | L2 | L3 | L4 |
|---|---|---|---|---|---|---|
| O1 | Factory | Economy/Vehicle | Gain 1 Fuel. | Your next Unit played this turn costs 1 less. | Your next Tank played this turn costs 2 less. | Your next Unit played this turn costs 2 less. |
| O2 | Airfield | Air/Tempo | 1 random friendly Aircraft gets +1 all sides this turn. | Maneuver 1 friendly Unit. | Draw 1 card. | 2 random friendly Aircraft each gain 1 additional legal attack this turn. |
| O3 | Supply Depot | Resource | Remove Suppression from 1 friendly Unit adjacent to Supply Depot. | Gain 1 Fuel. | Draw 1 card. | Gain 2 Fuel. |
| O4 | City | Infantry/Defense | Give 1 friendly Unit Guard until your next turn. | 2 random adjacent friendly Units +1 all sides until your next turn. | 2 random adjacent friendly Infantry +1 all sides permanently. | 2 random adjacent friendly Units +2 all sides until your next turn. |
| O5 | Artillery Position | Damage | Rotate 1 friendly Unit left/right. | 1 random friendly Unit adjacent to Artillery Position gains Bombard this turn. | 1 random friendly Artillery gains Precision this turn. | 1 random friendly Artillery gains 1 additional legal attack this turn. |
