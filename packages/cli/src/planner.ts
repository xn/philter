import {CleanupRule, StockingRule} from '@philter/common';
import {
  isCleanable,
  logger,
  ReadonlyCleanupRules,
  ReadonlyStockingRules,
  toItemMap,
} from '@philter/common/kol';
import {
  availableAmount,
  closetAmount,
  creatableAmount,
  getInventory,
  getProperty,
  haveDisplay,
  itemAmount,
  myPath,
  retrieveItem,
  toItem,
} from 'kolmafia';
import {getvar} from 'zlib.ash';
import {countIngredient, fullAmount} from './util';

/**
 * Cleanup execution plan generated from the cleanup rules by examining the
 * player's inventory, closet, storage, etc.
 */
export interface CleanupPlan {
  /** Items to break apart. */
  breakBricko: Map<Item, number>;
  /** Items to transform into other items. */
  make: Map<
    Item,
    {
      /** Amount to use */
      amount: number;
      /** Amount used per craft */
      amountUsedPerCraft: number;
      /** Item to craft into */
      targetItem: Item;
    }
  >;
  /** Items to untinker. */
  untinker: Map<Item, number>;
  /** Items to use. */
  use: Map<Item, number>;
  /** Items to pulverize. */
  mallsell: Map<Item, number>;
  /** Items to autosell. */
  autosell: Map<Item, number>;
  /** Items to discard. */
  discard: Map<Item, number>;
  /** Items to put in the display case. */
  displayCase: Map<Item, number>;
  /** Items to put in the closet. */
  closet: Map<Item, number>;
  /** Items to put in the clan stash. */
  clanStash: Map<Item, number>;
  /** Items to display reminder message(s). */
  reminder: Map<Item, number>;
  /**
   * Items to send to another player.
   * Maps target player name => item => quantity.
   */
  gift: Map<string, Map<Item, number>>;
  /** Cleanable items with no rule, left alone and listed once (sorted by name). */
  uncategorized: Item[];

  /** Cleanup rules used to generate this plan. */
  cleanupRules: ReadonlyCleanupRules;
  /** Stocking rules used to generate this plan. */
  stockingRules: ReadonlyStockingRules;
}

/**
 * Computes the actual amount of `item` to clean up based on its cleanup and
 * stocking rules.
 * This considers equipment in terrarium (but not equipped) for cleanup.
 * @param item Item to check
 * @param cleanupRule Cleanup rule for the item
 * @param stockingRule Stocking rule for the item, if any
 * @return Amount of the item to cleanup
 */
export function cleanupAmount(
  item: Item,
  cleanupRule: Readonly<CleanupRule> | undefined,
  stockingRule: Readonly<StockingRule> | undefined
): number {
  if (cleanupRule?.action === 'KEEP') return 0;
  const full = fullAmount(item);
  // Unequip item from terrarium or equipment if necessary to process it.
  const keepAmount = cleanupRule?.keepAmount || 0;
  if (full > keepAmount && availableAmount(item) > itemAmount(item)) {
    retrieveItem(Math.min(full - keepAmount, availableAmount(item)), item);
  }
  // Don't clean up items that are part of stock. Stock can always be satisfied
  // by closet.
  const keep =
    getvar('BaleOCD_Stock') === '0'
      ? keepAmount
      : Math.max(
          keepAmount,
          (stockingRule?.amount || 0) -
            (getProperty('autoSatisfyWithCloset') === 'false'
              ? 0
              : closetAmount(item))
        );
  // Philter is limited by itemAmount(it) since we don't want to purchase
  // anything and closeted items may be off-limit, but if there's something in
  // the closet, it counts against the amount you own.
  return Math.min(full - keep, itemAmount(item));
}

export class CleanupPlanner {
  /**
   * Records an item that has no cleanup rule. Upstream asked the user whether
   * to abort here; this fork never asks and never sells: the item stays, and
   * `makePlan()` lists it once. Quest/untouchable items and items a stocking
   * rule still wants more of are not listed.
   */
  noteUncategorized(
    plan: CleanupPlan,
    item: Item,
    stockingRules: ReadonlyStockingRules
  ): void {
    if (!isCleanable(item)) return;
    const stockingRule = stockingRules.get(item);
    if (stockingRule && fullAmount(item) <= stockingRule.amount) return;
    plan.uncategorized.push(item);
  }

  /**
   * Examines the inventory and generates an appropriate execution plan.
   * Uncategorized items are skipped and listed in one red line.
   * @param cleanupRules Cleanup rules to use
   * @param stockingRules Stocking rules to use
   */
  makePlan(
    cleanupRules: ReadonlyCleanupRules,
    stockingRules: ReadonlyStockingRules
  ): CleanupPlan {
    const plan: CleanupPlan = {
      breakBricko: new Map(),
      make: new Map(),
      untinker: new Map(),
      use: new Map(),
      mallsell: new Map(),
      autosell: new Map(),
      discard: new Map(),
      displayCase: new Map(),
      closet: new Map(),
      clanStash: new Map(),
      reminder: new Map(),
      gift: new Map(),
      uncategorized: [],
      cleanupRules,
      stockingRules,
    };

    for (const doodad of toItemMap(getInventory()).keys()) {
      const rule = cleanupRules.get(doodad);
      const excess = cleanupAmount(doodad, rule, stockingRules.get(doodad));

      if (rule) {
        if (excess > 0) {
          switch (rule.action) {
            case 'BREAK':
              plan.breakBricko.set(doodad, excess);
              break;
            case 'MAKE': {
              const targetItem = toItem(rule.targetItem);
              const amountUsedPerCraft = countIngredient(doodad, targetItem);
              if (amountUsedPerCraft === 0) {
                logger.error(
                  `You cannot transform an ${doodad} into a ${rule.targetItem}. There's a problem with your data file or your crafting ability.`
                );
                break;
              }
              let amountToUse = excess;
              if (amountUsedPerCraft > 1) {
                amountToUse = amountToUse - (amountToUse % amountUsedPerCraft);
              }

              if (rule.shouldUseCreatableOnly) {
                amountToUse = Math.min(
                  amountToUse,
                  creatableAmount(targetItem) * amountUsedPerCraft
                );
              }
              if (amountToUse !== 0)
                plan.make.set(doodad, {
                  amount: amountToUse,
                  amountUsedPerCraft,
                  targetItem,
                });
              break;
            }
            case 'UNTN':
              plan.untinker.set(doodad, excess);
              break;
            case 'USE':
              if (myPath() === 'Bees Hate You' && doodad.name.includes('b'))
                break;
              plan.use.set(doodad, excess);
              break;
            case 'PULV':
              // No-op since act_pulverize() does its own logging
              break;
            case 'MALL':
              plan.mallsell.set(doodad, excess);
              break;
            case 'AUTO':
              plan.autosell.set(doodad, excess);
              break;
            case 'DISC':
              plan.discard.set(doodad, excess);
              break;
            case 'DISP':
              // TODO: Move this check to execution stage, where we can print a
              // warning about not having a Display Case
              if (haveDisplay()) plan.displayCase.set(doodad, excess);
              // else KEEP
              break;
            case 'CLST':
              plan.closet.set(doodad, excess);
              break;
            case 'CLAN':
              plan.clanStash.set(doodad, excess);
              break;
            case 'GIFT': {
              let giftMap = plan.gift.get(rule.recipent);
              if (!giftMap) {
                plan.gift.set(rule.recipent, (giftMap = new Map()));
              }
              giftMap.set(doodad, excess);
              break;
            }
            case 'TODO':
              plan.reminder.set(doodad, excess);
              break;
            case 'KEEP':
              break;
            default:
              this.noteUncategorized(plan, doodad, stockingRules);
          }
        }
      } else {
        this.noteUncategorized(plan, doodad, stockingRules);
      }
    }

    if (plan.uncategorized.length > 0) {
      const names = plan.uncategorized
        .map(item => item.name)
        .sort((a, b) => a.localeCompare(b));
      logger.error(
        `Philter: ${
          names.length
        } uncategorized item(s) skipped (categorize in Philter Manager): ${names.join(
          ', '
        )}`
      );
    }
    return plan;
  }
}
