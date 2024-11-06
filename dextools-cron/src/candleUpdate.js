const { DateTime } = require('luxon');
const format = require('pg-format');
const { getAllTokensFromDB, getKDAMap, getNearestKDAPrice } = require('../helpers');
const { connectPg } = require('../clients/pg');

const getTransactionMap = async (client, kdaPriceMap, startMinute, endMinute) => {
  // GET Transactions from the DB
  const transactionsResp = await client.query(`SELECT * FROM transactions WHERE timestamp >= $1 AND timestamp <= $2 ORDER BY timestamp ASC`, [
    startMinute.toJSDate(),
    endMinute.toJSDate(),
  ]);

  // Convert Result to Map format where key is Ticker and value is a Map of TIMESTAMP to candle
  const transactionMap = transactionsResp.rows.reduce((p, row) => {
    const { timestamp, from_token, to_token, from_amount, to_amount, volume } = row;
    let v = volume;
    const fromAmount = parseFloat(from_amount);
    const toAmount = parseFloat(to_amount);
    if (parseFloat(v) < 0.00000001) {
      return p;
    }
    const address = from_token === 'coin' ? to_token : from_token;
    const date = DateTime.fromJSDate(new Date(timestamp)).startOf('minute').toJSDate();
    const priceInKDA = from_token === 'coin' ? fromAmount / toAmount : toAmount / fromAmount;

    const kdaPrice = getNearestKDAPrice(kdaPriceMap, date);
    const finalPrice = priceInKDA * kdaPrice;
    if (address in p) {
      const transactions = p[address];
      if (date in transactions) {
        transactions[date].volume += parseFloat(v);
        transactions[date].close = finalPrice;
        transactions[date].low = Math.min(transactions[date].low, finalPrice);
        transactions[date].high = Math.max(transactions[date].high, finalPrice);
        p[address] = transactions;
      } else {
        p[address][date] = {
          volume: parseFloat(v),
          timestamp,
          close: finalPrice,
          low: finalPrice,
          high: finalPrice,
        };
      }
    } else {
      p[address] = {};
      p[address][date] = {
        volume: parseFloat(v),
        timestamp,
        close: finalPrice,
        low: finalPrice,
        high: finalPrice,
      };
    }

    return p;
  }, {});

  return transactionMap;
};

const candleUpdate = async () => {
  const client = connectPg();
  console.log(`Running candle update`);
  const endMinute = DateTime.now().startOf('minute');
  let startMinute = endMinute.minus({ minutes: 4 });

  // GET Tokens
  const tokenMap = await getAllTokensFromDB();
  const tokens = Object.keys(tokenMap);

  // GET KDA Price
  console.log(`get kda prices`);
  const kdaPriceMap = await getKDAMap(client);
  console.log(`built kda price map`);

  // GET All transactions within the minute
  const transactionMap = await getTransactionMap(client, kdaPriceMap, startMinute, endMinute);

  // FOR ALL TOKENS
  for (let token of tokens) {
    const ticker = tokenMap[token];
    console.log(`Processing for ${ticker}`);
    let start = startMinute;
    const transactions = transactionMap[token];
    let candles = [];
    while (start <= endMinute) {
      let prevClose;
      if (start.equals(startMinute)) {
        const prevCloseR = await client.query(
          `SELECT close FROM candle_master WHERE ticker = $1 AND timestamp < $2 ORDER BY timestamp DESC LIMIT 1`,
          [ticker, startMinute.toJSDate()]
        );
        if (prevCloseR.rows.length === 0 || !prevCloseR.rows[0]) {
          prevClose = 0;
        } else {
          prevClose = parseFloat(prevCloseR.rows[0].close);
        }
      } else {
        prevClose = candles[candles.length - 1][5];
      }
      if (transactions && start.toJSDate() in transactions) {
        const info = transactions[start.toJSDate()];
        candles.push([ticker, start.toJSDate(), Math.min(info.low, prevClose), Math.max(info.high, prevClose), prevClose, info.close, info.volume]);
      } else {
        candles.push([ticker, start.toJSDate(), prevClose, prevClose, prevClose, prevClose, 0]);
      }

      start = start.plus({ minutes: 1 });
    }

    console.log(`built ${candles.length} candles for ${ticker}`);
    const insertQuery = `
      INSERT INTO candle_master (ticker, timestamp, low, high, open, close, volume) 
      VALUES %L 
      ON CONFLICT ON CONSTRAINT candle_master_pkey
      DO UPDATE SET (ticker, timestamp, low, high, open, close, volume) = (EXCLUDED.ticker, EXCLUDED.timestamp, EXCLUDED.low, EXCLUDED.high, EXCLUDED.open, EXCLUDED.close, EXCLUDED.volume);
    `;
    const s = await client.query(format(insertQuery, candles));
    console.log(`inserted ${s.rowCount} candles for ${ticker}`);
  }
};

module.exports = candleUpdate;
