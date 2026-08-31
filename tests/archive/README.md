# Archived tests

Moved here 2026-08-31 (Run 1 of the Set 1 surgical update) — each file tested a mechanic or
card set that is fully gone from the new Set 1 truth, not renamed/relocated to a new mechanic
(per the Run 1 plan's conservative test-archival rule: rewrite tests that map to a *current*
mechanic under a new name, archive only genuinely dead coverage).

- `deathrattle.test.mjs.archived` — tested the Deathrattle keyword/card batch (old ids
  131-138, 139-141, 147), which does not appear anywhere in the new truth's 125-card list. See
  `js/archive/legacy_cards.js` for the archived card data these tests exercised.
- `new_cards.test.mjs.archived` — tested two 2026-07-30 v0.4 launch-filler Units (Veteran
  Signal Corps id 119, Combat Engineers id 112) that are not part of the new 65-Unit list.

Renamed with a `.archived` suffix (not `.test.mjs`) so `npm test`'s `tests/*.test.mjs` glob
skips them automatically, in addition to living outside `tests/`.
