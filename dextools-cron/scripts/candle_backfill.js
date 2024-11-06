require('dotenv').config();
const { connectPg, queryPg } = require('../clients/pg');
const { DateTime } = require('luxon');
const format = require('pg-format');
const { getKDAMap, getNearestKDAPrice, getAllTokensFromDB, getCandleOrBuild } = require('../helpers');

/**
 * Candlestick Builder for Crypto Tokens
 *
 * This script builds minute-by-minute candlesticks (OHLC) for crypto tokens by:
 * 1. Fetching transactions from the database in weekly chunks
 * 2. Converting prices to USD using KDA as intermediate currency
 * 3. Building candles with price and volume data
 * 4. Saving to candle_master table
 *
 * Data handling:
 * - If a candle already exists for a given ticker and timestamp,
 *   it will be completely overwritten with new values (upsert)
 * - Empty minutes (no transactions) get filled with the previous close price
 *   and zero volume
 *
 */

const mainClient = connectPg();

const selectQuery = `
 SELECT * FROM transactions WHERE from_token = $1 OR to_token = $2 AND timestamp >= $3 AND timestamp < $4 ORDER BY timestamp ASC`;

const END_DATE = DateTime.now().startOf('minute').minus({ minutes: 1 });

(async () => {
  console.log('Getting KDA Prices');
  const kdaPriceMap = await getKDAMap(mainClient);
  console.log('Built KDA Price Map');

  const tokenMap = await getAllTokensFromDB();
  const tokens = Object.keys(tokenMap);

  for (let token of tokens) {
    console.log(`Processing ${token}`);
    const firstCandle = await getCandleOrBuild(mainClient, kdaPriceMap, tokenMap[token], token, 'ASC');
    let firstCandleDate = DateTime.fromJSDate(firstCandle.timestamp, {
      zone: 'utc',
    })
      .startOf('minute')
      .plus({ minutes: 1 });
    let start = firstCandleDate;
    let candles = [
      [
        tokenMap[token],
        firstCandle.timestamp,
        parseFloat(firstCandle.low),
        parseFloat(firstCandle.high),
        parseFloat(firstCandle.open),
        parseFloat(firstCandle.close),
        parseFloat(firstCandle.volume),
      ],
    ];

    let startCandle = candles[0];
    while (start < END_DATE) {
      const addedEnd = start.plus({ weeks: 1 });
      let end = addedEnd > END_DATE ? END_DATE : addedEnd;
      console.log(`Getting TX of ${token} for ${start.toJSDate()} to ${end.toJSDate()}`);

      const transactionsR = await mainClient.query(selectQuery, [token, token, start.toJSDate(), end.toJSDate()]);

      const transactionsMap = transactionsR.rows.reduce((p, row) => {
        const { timestamp, from_token, from_amount, to_amount, volume } = row;
        if (volume < 0.00000001) {
          return p;
        }
        const fromAmount = parseFloat(from_amount);
        const toAmount = parseFloat(to_amount);
        const v = volume;
        const luxonTime = DateTime.fromJSDate(timestamp, { zone: 'utc' });
        const minuteStart = luxonTime.startOf('minute').toJSDate();
        const priceInKDA = from_token === 'coin' ? fromAmount / toAmount : toAmount / fromAmount;

        const kdaPrice = getNearestKDAPrice(kdaPriceMap, minuteStart);
        const priceInUSD = priceInKDA * kdaPrice;
        const price = priceInUSD;

        if (!(minuteStart in p)) {
          p[minuteStart] = {
            volume: parseFloat(v),
            timestamp,
            close: price,
            low: price,
            high: price,
          };
        } else {
          const candle = p[minuteStart];
          candle.volume += parseFloat(volume);
          candle.close = price;
          candle.low = Math.min(candle.low, price);
          candle.high = Math.max(candle.high, price);
          p[minuteStart] = candle;
        }

        return p;
      }, {});

      let tempCandles = [startCandle];
      while (start < end) {
        const prevClose = tempCandles[tempCandles.length - 1][5];
        if (start.toJSDate() in transactionsMap) {
          const info = transactionsMap[start.toJSDate()];
          tempCandles.push([
            tokenMap[token],
            start.toJSDate(),
            Math.min(info.low, prevClose),
            Math.max(info.high, prevClose),
            prevClose,
            info.close,
            info.volume,
          ]);
        } else {
          tempCandles.push([tokenMap[token], start.toJSDate(), prevClose, prevClose, prevClose, prevClose, 0]);
        }

        start = start.plus({ minutes: 1 });
      }
      console.log(`Built ${tempCandles.length} candles for ${token} `);
      const insertedCandles = await mainClient.query(
        format(
          `INSERT INTO candle_master (ticker, timestamp, low, high, open, close, volume) VALUES %L 
          ON CONFLICT ON CONSTRAINT candle_master_pkey
          DO UPDATE 
          SET (ticker, timestamp, low, high, open, close, volume) = (EXCLUDED.ticker, EXCLUDED.timestamp, EXCLUDED.low, EXCLUDED.high, EXCLUDED.open, EXCLUDED.close, EXCLUDED.volume);`,
          tempCandles
        )
      );
      console.log(`Inserted ${insertedCandles.rowCount} candles for token ${token}`);

      startCandle = tempCandles[tempCandles.length - 1];
    }
  }
  console.log('Done');
  process.exit();
})();
