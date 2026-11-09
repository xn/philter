# Philter fork: skip uncategorized, autosell bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Philter never stops on uncategorized items and sends tradeable AUTO items to the autosell bot instead of autoselling them locally.

**Architecture:** Two edits inside `packages/cli`: the planner drops the `userConfirm`/MallDangerously branch and collects skipped items for one red line; the autosell action splits its map by `isTradeable` and kmails the tradeable half with kolmafia-util's `sendToPlayer` (already used by the mall-multi path). The bot name is a ZLib var read with `getvar`, like `BaleOCD_Stock`, so `PhilterConfig`, the API and the Manager UI are untouched.

**Tech Stack:** TypeScript 4.3, rollup 2 + buble (Rhino target), yarn classic (`npx -y yarn@1.22.22`), gts eslint. No unit-test runner exists in the repo; verification is lint, build, a grep of the bundle, and a KoLmafia simulation run.

**Spec:** `docs/superpowers/specs/2026-11-09-fork-design.md`

## Global Constraints

- Build with `npx -y yarn@1.22.22 build:cli` from the repo root; output is `release/scripts/philter.js` (committed).
- Lint must stay clean: `npx -y yarn@1.22.22 workspace @philter/cli lint`.
- Only `packages/cli/src` and `packages/common/src/kol/config.ts` change. No API/Manager edits.
- Red line copy (exact): `Philter: N uncategorized item(s) skipped (categorize in Philter Manager): a, b, c`
- Bot var: `BaleOCD_AutosellBot`, default `autosell`; kmail message `Philter autosell`.
- Never run `philter` in KoLmafia while `loop` is running (gCLI commands collide with the running script). The sim run waits for an idle mafia.

## Review Focus

1. An AUTO item that is tradeable in some copies only: impossible, tradeability is per item, but an item that is tradeable yet not kmailable (`isTradeable` false, `isGiftable` true) must go local, not into a gift package → Task 2 keeps gift-only items local by testing `isTradeable` alone.
2. Bot name set to `false`/`False` (the upstream mall-multi "False" bug) → Task 2 treats an empty or `false` (case-insensitive) name as "local autosell" and warns once.
3. Kmail failure mid-run (recipient restricted, KoL error): `sendToPlayer` throws; the remaining tradeable items stay in inventory and the local autosell of non-tradeable items has not happened yet → Task 2 orders local autosell first, then the bot kmail, so a bot failure loses nothing locally sellable.
4. Simulation mode: nothing may leave inventory → Task 2 gates both `autosell()` and `sendToPlayer` on `!config.simulateOnly`; verified in the mafia sim run (Task 4).
5. Uncategorized items covered by a stocking rule should not be listed (upstream exempted them from the dialog) → Task 1 keeps that exemption in the skip list.

---

### Task 1: Planner skips uncategorized items

**Files:**
- Modify: `packages/cli/src/planner.ts` (CleanupPlanner: `shouldAskAboutUncategorizedItems`, `checkStopForRelay`, the two `default`/`else` branches in `makePlan`)
- Modify: `packages/common/src/kol/config.ts` (drop the `BaleOCD_MallDangerously` setvar and comment)
- Modify: `packages/cli/src/cleanup/mall.ts` (comment only: the "may be mallselling items that do not have a rule" note is no longer true; keep the assert)

**Interfaces:**
- Produces: `CleanupPlanner.makePlan(cleanupRules, stockingRules): CleanupPlan` (no longer `| null`). `CleanupPlan` gains `uncategorized: Item[]` (sorted by name).
- Produces: `CleanupPlanner.printUncategorized(plan): void` is NOT added; the red line is printed inside `makePlan` after the loop, so every replan reprints only if the list is non-empty. Use `logger.error`.

- [ ] **Step 1: Rewrite the uncategorized branch**

In `makePlan`, replace `checkStopForRelay` calls with: if `isCleanable(doodad)` and no stocking rule with `fullAmount(doodad) <= stockingRule.amount`, push `doodad` to `plan.uncategorized`. Delete `checkStopForRelay`, `shouldAskAboutUncategorizedItems`, the `userConfirm`, `toBoolean` and `getvar` imports if now unused. Return type becomes `CleanupPlan`.

- [ ] **Step 2: Print the red line**

After the loop, when `plan.uncategorized.length > 0`, sort by name and `logger.error(`Philter: ${n} uncategorized item(s) skipped (categorize in Philter Manager): ${names.join(', ')}`)`.

- [ ] **Step 3: Remove the null handling in `philter.ts`**

`doPhilter`: `let plan = planner.makePlan(...)` with no `if (!plan)` checks (two sites).

- [ ] **Step 4: Remove the MallDangerously default and fix the mall.ts comment**

- [ ] **Step 5: Lint and build**

Run: `cd /Users/xn/sites/KOL/philter && npx -y yarn@1.22.22 workspace @philter/cli lint && npx -y yarn@1.22.22 build:cli`
Expected: both `Done`, no errors. `grep -c MallDangerously release/scripts/philter.js` prints `0`; `grep -c "userConfirm(" release/scripts/philter.js` prints `2` (the Ronin check in index.ts and the mall-multi "False" guard).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src packages/common/src/kol/config.ts release/scripts/philter.js
git commit -m "Skip uncategorized items with a red list instead of asking"
```

### Task 2: AUTO items go to the autosell bot

**Files:**
- Modify: `packages/cli/src/cleanup/autosell.ts`
- Modify: `packages/common/src/kol/config.ts` (`setvar('BaleOCD_AutosellBot', 'autosell')` under the "not exposed yet" block, with a comment pointing at https://autosell.lib.co.nz/)

**Interfaces:**
- Consumes: `plan.autosell: Map<Item, number>`, `config.simulateOnly`, `getvar('BaleOCD_AutosellBot')`, `sendToPlayer({recipent, message, items})` from `kolmafia-util`, `isTradeable` from `kolmafia`.
- Produces: `cleanupAutosell: CleanupActionFunction` (unchanged signature). New local helper `splitForBot(items: ReadonlyMap<Item, number>): {bot: Map<Item, number>; local: Map<Item, number>}` using `isTradeable`.

- [ ] **Step 1: Read the bot name**

`const bot = getvar('BaleOCD_AutosellBot').trim();` If `bot === ''` or `bot.toLowerCase() === 'false'`, behave exactly as upstream (all local). On `'false'`, `logger.warn` once that the bot name is invalid and local autosell is used.

- [ ] **Step 2: Split and log**

`splitForBot` → `local` printed with the existing `printAutosell` (prefix `autosell`), `bot` printed with the same chunking as `send to autosell bot '${bot}': 3 foo, 12 bar`. `Total autosale = N` sums `autosellPrice × amount` over both maps.

- [ ] **Step 3: Execute**

When `!config.simulateOnly`: local map through the existing `safeBatchItems`/`autosell` block first; then if `bot.size > 0`, `sendToPlayer({recipent: bot, message: 'Philter autosell', items: bot})`. Return `{shouldReplan: false, profit}`.

- [ ] **Step 4: Lint and build**

Run: same commands as Task 1 Step 5. Expected: clean. `grep -c "BaleOCD_AutosellBot" release/scripts/philter.js` prints `2` or more (default + read).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/cleanup/autosell.ts packages/common/src/kol/config.ts release/scripts/philter.js
git commit -m "Send tradeable AUTO items to the autosell bot"
```

### Task 3: Startup noise

**Files:**
- Modify: `packages/cli/src/index.ts` (remove the two alpha `logger.warn` lines and `wait(10)`; drop the `wait` import)
- Modify: `README.md` (one short "Fork changes" section: the two features, the var, the deploy line)

- [ ] **Step 1: Edit, lint, build** (same commands). Expected: clean; `grep -c "currently in alpha" release/scripts/philter.js` prints `0`.
- [ ] **Step 2: Commit** `git commit -am "Drop the alpha warning wait; document the fork"`

### Task 4: Deploy and verify

- [ ] **Step 1: Push** `git push origin main` (confirm branch name with `git branch --show-current` first).
- [ ] **Step 2: Wait for mafia to be idle** (loop not running: tail of today's session log shows the loop end or rollover, or the user says so).
- [ ] **Step 3: In the gCLI** (via relay `sideCommand` or the user): `git delete Loathing-Associates-Scripting-Society-philter-main` then `git checkout https://github.com/xn/philter.git`. Expected: `git list` shows `xn-philter-main`; `~/Library/Application Support/KoLmafia/scripts/philter.js` md5 equals the fork's `release/scripts/philter.js`.
- [ ] **Step 4: Simulation run**: `zlib BaleOCD_Sim = true`, `philter`, `zlib BaleOCD_Sim = false`. Expected in the gCLI: no dialog; a red `Philter: … skipped` line if anything is uncategorized; `send to autosell bot 'autosell': …` lines for tradeable AUTO items; `autosell …` for the rest; nothing leaves inventory (closet/inventory counts unchanged).
- [ ] **Step 5: Loop side** (repo `/Users/xn/sites/KOL/loop`): in `src/tasks/pvp.ts` remove `philterUncategorized` and the `fileToBuffer`/`getInventory`/`myName` imports it alone used; the Philter task `do` becomes `cliExecute("philter"); markLegDone(...)`. Update the task comment and `main.ts` `philter` flag help. Run `yarn check && npx eslint src && npx prettier --check src && yarn build`; `grep -c philterUncategorized dist/scripts/loop/loop.js` prints `0`. Do not commit loop (user commits on request).
- [ ] **Step 6: Brain write-back**: `scripts/loop.md` log_check for the Philter line changes to the fork's red copy; `scripts/loop-notes.md` gets a 2026-11-09 entry; a new script card `scripts/philter.md` from `_templates/script-card.md` (fork path, build, deploy, the bot var, the watch item). `sh tools/check-layer-a.sh loop` OK, `python3 -I tools/build-index.py` OK, commit the brain.
