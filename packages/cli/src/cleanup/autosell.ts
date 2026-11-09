import {logger} from '@philter/common/kol';
import {autosell, autosellPrice, isTradeable} from 'kolmafia';
import {assert, sendToPlayer} from 'kolmafia-util';
import {getvar, rnum} from 'zlib.ash';
import {splitItemsSorted} from '../util';
import {CleanupActionFunction, safeBatchItems} from './base';

/** Kmail message sent with each batch to the autosell bot. */
const BOT_MESSAGE = 'Philter autosell';

/**
 * Name of the autosell bot (https://autosell.lib.co.nz/), or `''` to autosell
 * locally as upstream Philter does. The bot wears selling shorts (+5% autosell
 * value), takes no cut, and kmails the meat, a receipt and anything it cannot
 * handle back. A name of "false" is the upstream mall-multi bug and is treated
 * as empty.
 */
function autosellBotName(): string {
  const bot = getvar('BaleOCD_AutosellBot').trim();
  if (bot.toLowerCase() === 'false') {
    logger.warn(
      `Invalid autosell bot name ("${bot}"); autoselling locally instead.`
    );
    return '';
  }
  return bot;
}

/**
 * Splits AUTO items into those the bot can receive by kmail (tradeable) and
 * those that must be autosold locally.
 */
export function splitForBot(items: ReadonlyMap<Item, number>): {
  bot: Map<Item, number>;
  local: Map<Item, number>;
} {
  const bot = new Map<Item, number>();
  const local = new Map<Item, number>();
  for (const [item, amount] of items) {
    (isTradeable(item) ? bot : local).set(item, amount);
  }
  return {bot, local};
}

/** Logs `prefix` + items, 11 per line, and returns their local autosell value. */
function printItems(prefix: string, items: ReadonlyMap<Item, number>): number {
  let total = 0;

  for (const chunk of splitItemsSorted(items, 11)) {
    const messages: string[] = [];
    let lineValue = 0;

    for (const [item, amount] of chunk) {
      lineValue += amount * autosellPrice(item);
      messages.push(`${amount} ${item}`);
    }

    logger.info(`${prefix} ${messages.join(', ')}`);
    logger.info(' ');
    total += lineValue;
  }

  return total;
}

/**
 * Cleanup action that autosells items, locally or through the autosell bot.
 */
export const cleanupAutosell: CleanupActionFunction = (plan, config) => {
  const items = plan.autosell;
  if (items.size === 0) return {shouldReplan: false, profit: 0};

  const botName = autosellBotName();
  const {bot, local} = botName
    ? splitForBot(items)
    : {bot: new Map<Item, number>(), local: new Map(items)};

  const profit =
    printItems('autosell', local) +
    printItems(`send to autosell bot '${botName}':`, bot);
  logger.info(`Total autosale = ${rnum(profit)}`);

  if (!config.simulateOnly) {
    // Local first: a kmail failure then costs nothing that could be sold here.
    safeBatchItems(
      local,
      chunk => {
        for (const [item, amount] of chunk) {
          assert.ok(
            autosell(amount, item),
            `Failed to batch: autosell(${amount}, Item.get(\`${item}\`))`
          );
        }
      },
      chunk => assert.fail(`Failed to autosell ${chunk.size} item(s)`)
    );
    if (bot.size > 0) {
      sendToPlayer({recipent: botName, message: BOT_MESSAGE, items: bot});
    }
  }

  return {shouldReplan: false, profit};
};
