# Philter fork: skip uncategorized items, sell through the autosell bot

Approved in chat 2026-11-09 (chartreusenator). Fork of
Loathing-Associates-Scripting-Society/philter at d3c81e9 (2021-08), remote
`xn/philter`.

## Why

The loop script runs Philter unattended at the end of each leg
(loop/docs/superpowers/specs/2026-11-08-pvp-design.md). Upstream Philter stops
on any uncategorized tradeable item with a `userConfirm` dialog that has no
timeout; the only switch around it, `BaleOCD_MallDangerously`, mall-sells the
unknown items. Neither is acceptable unattended. Separately, the AutoSell Bot
(https://autosell.lib.co.nz/, `autosell` #3877087, run by Irrat #3469406) pays
5% over local autosell value, takes no cut, and returns meat, a receipt and
anything it cannot handle by kmail.

## Feature 1: uncategorized items are skipped

- An inventory item with no cleanup rule is left alone. No dialog, ever.
- Philter prints one red line listing them, once per run, after planning:
  `Philter: N uncategorized item(s) skipped (categorize in Philter Manager): name, name, ...`
  Items counted are the ones upstream would have asked about: cleanable
  (`isCleanable`), not covered by a stocking rule that needs more of them.
- `BaleOCD_MallDangerously` is removed from the planner: unknown items are
  never sold. The variable is no longer set or read.
- Nothing else about planning changes.

## Feature 2: AUTO items go to the autosell bot

- New ZLib variable `BaleOCD_AutosellBot`, default `autosell`. Empty string
  restores upstream behaviour (local `autosell()`).
- When set, each AUTO item's excess is split by `isTradeable(item)`:
  - tradeable copies are kmailed to the bot through kolmafia-util
    `sendToPlayer` (already a dependency; 11 items per kmail), message
    `Philter autosell`;
  - non-tradeable copies are autosold locally as before. Kmail cannot carry
    them and a gift package would cost meat for a 5% gain.
- No value threshold: everything tradeable with an AUTO rule goes.
- Log lines: `send to autosell bot 'autosell': 3 foo, 12 bar` for the bot
  batch, `autosell 2 baz` for the local remainder; the existing
  `Total autosale = N` line keeps the local autosell value for both groups
  (the bot's 5% is not counted).
- Simulation mode (`BaleOCD_Sim`) prints the same lines and sends nothing.
- A kmail failure throws (kolmafia-util `kmail`, not `sendToPlayer`, which
  would fall back to paid gift packages). Items already sent stay sent.

## Also in the fork

- The 10-second "Philter.js is in alpha" warning and `wait(10)` at startup
  are removed.

## Deploy

- `release/` is committed build output, as upstream. Build, commit, push to
  `xn/philter`.
- In KoLmafia: `git delete Loathing-Associates-Scripting-Society-philter-main`,
  then `git checkout https://github.com/xn/philter.git chartreusenator` (the
  fork's working branch). `git update` pulls
  later changes; the Manager relay comes with it.
- Loop side (separate repo): `src/tasks/pvp.ts` drops the OCDdata-diff guard
  and just runs `philter`; loop's `philter` flag stays.

## Watch after the first live run

Items the bot returns as unhandled land back in inventory with their AUTO
rule and would be sent again the next day. Read the first receipt before
deciding on a rule change.

## Not in scope

Any other Philter behaviour, the Manager UI, upstream PR.
