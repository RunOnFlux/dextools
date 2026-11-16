require('dotenv').config();
const { DateTime } = require('luxon');
const format = require('pg-format');
const { connectPg } = require('../clients/pg');
const { getAllTokensFromDB, getKDAMap, getNearestKDAPrice } = require('../helpers');

/**
 * Candle Gap Fill
 *
 * Rebuilds the minute candles of every token from FROM until now, for when the
 * Candle Update job could not write them (e.g. candle_master had no partition
 * for the month, so every insert failed).
 *
 * Usage: FROM=2026-02-01 node scripts/candle_gap_fill.js
 * (in the container: docker exec -e FROM=2026-02-01 dextools-cron node scripts/candle_gap_fill.js)
 *
 * Data handling:
 * - Same rules as src/candleUpdate.js: prices from transactions converted with
 *   the nearest KDA price, empty minutes carry the previous close with zero volume
 * - Creates any missing monthly partition first
 * - Goes month by month, so each month continues from the close of the month before
 * - Upserts, so it is safe to run again over the same range
 * - DRY_RUN=true builds the candles and prints a summary without writing
 */

const FROM = DateTime.fromISO(process.env.FROM || '');
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 5000;

const insertQuery = `
  INSERT INTO candle_master (ticker, timestamp, low, high, open, close, volume)
  VALUES %L
  ON CONFLICT ON CONSTRAINT candle_master_pkey
  DO UPDATE SET (ticker, timestamp, low, high, open, close, volume) = (EXCLUDED.ticker, EXCLUDED.timestamp, EXCLUDED.low, EXCLUDED.high, EXCLUDED.open, EXCLUDED.close, EXCLUDED.volume);
`;

const client = connectPg();

// token address -> minute -> candle, as getTransactionMap in src/candleUpdate.js
const buildTransactionMap = (rows, kdaPriceMap) =>
  rows.reduce((p, row) => {
    const { timestamp, from_token, to_token, from_amount, to_amount, volume } = row;
    if (parseFloat(volume) < 0.00000001) {
      return p;
    }
    const fromAmount = parseFloat(from_amount);
    const toAmount = parseFloat(to_amount);
    const address = from_token === 'coin' ? to_token : from_token;
    const date = DateTime.fromJSDate(new Date(timestamp)).startOf('minute').toJSDate();
    const priceInKDA = from_token === 'coin' ? fromAmount / toAmount : toAmount / fromAmount;
    const finalPrice = priceInKDA * getNearestKDAPrice(kdaPriceMap, date);
    if (!(address in p)) p[address] = {};
    const minute = p[address][date];
    if (minute) {
      minute.volume += parseFloat(volume);
      minute.close = finalPrice;
      minute.low = Math.min(minute.low, finalPrice);
      minute.high = Math.max(minute.high, finalPrice);
    } else {
      p[address][date] = { volume: parseFloat(volume), close: finalPrice, low: finalPrice, high: finalPrice };
    }
    return p;
  }, {});

const previousClose = async (ticker, before) => {
  const r = await client.query(`SELECT close FROM candle_master WHERE ticker = $1 AND timestamp < $2 ORDER BY timestamp DESC LIMIT 1`, [
    ticker,
    before.toJSDate(),
  ]);
  return r.rows.length ? parseFloat(r.rows[0].close) : 0;
};

const write = async (candles) => (DRY_RUN ? candles.length : (await client.query(format(insertQuery, candles))).rowCount);

// fills [from, to) for every token
const fillRange = async (tokenMap, kdaPriceMap, from, to) => {
  if (!DRY_RUN) await client.query(`SELECT cpine($1::timestamp)`, [from.toJSDate()]);
  const { rows } = await client.query(`SELECT * FROM transactions WHERE timestamp >= $1 AND timestamp < $2 ORDER BY timestamp ASC`, [
    from.toJSDate(),
    to.toJSDate(),
  ]);
  const transactionMap = buildTransactionMap(rows, kdaPriceMap);
  let written = 0;
  for (const [address, ticker] of Object.entries(tokenMap)) {
    let prevClose = await previousClose(ticker, from);
    const transactions = transactionMap[address] || {};
    let candles = [];
    for (let minute = from; minute < to; minute = minute.plus({ minutes: 1 })) {
      const date = minute.toJSDate();
      const info = transactions[date];
      if (info) {
        candles.push([ticker, date, Math.min(info.low, prevClose), Math.max(info.high, prevClose), prevClose, info.close, info.volume]);
        prevClose = info.close;
      } else {
        candles.push([ticker, date, prevClose, prevClose, prevClose, prevClose, 0]);
      }
      if (candles.length >= BATCH_SIZE) {
        written += await write(candles);
        candles = [];
      }
    }
    if (candles.length) written += await write(candles);
  }
  console.log(`${from.toISO()} -> ${to.toISO()}: ${rows.length} transactions, ${written} candles${DRY_RUN ? ' (dry run)' : ''}`);
};

(async () => {
  if (!FROM.isValid) {
    console.error('Set FROM to the first minute to rebuild, e.g. FROM=2026-02-01');
    process.exit(1);
  }
  const tokenMap = await getAllTokensFromDB();
  const kdaPriceMap = await getKDAMap(client);
  console.log(`Filling candles of ${Object.keys(tokenMap).length} tokens from ${FROM.toISO()}`);

  let from = FROM.startOf('minute');
  const end = DateTime.now().startOf('minute');
  while (from < end) {
    const to = DateTime.min(from.plus({ months: 1 }).startOf('month'), end);
    await fillRange(tokenMap, kdaPriceMap, from, to);
    from = to;
  }

  // the Candle Update job keeps running meanwhile and chains from whatever close it finds,
  // so redo the last minutes once more now that everything before them is filled
  await fillRange(tokenMap, await getKDAMap(client), end.minus({ minutes: 10 }), DateTime.now().startOf('minute'));

  console.log('Done');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
