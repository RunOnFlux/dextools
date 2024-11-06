const { default: axios } = require('axios');
const { DateTime } = require('luxon');
const { connectPg } = require('../clients/pg');
const format = require('pg-format');
require('dotenv').config();

/**
 * KDA Price Historical Data Fetcher
 *
 * Fetches historical KDA-USDT price data from Kucoin exchange and stores it in the database.
 * The script:
 * 1. Gets minute-level candle data in chunks (90000 seconds each)
 * 2. Processes from a start date (May 16, 2022) up to current time
 * 3. Extracts closing prices from each candle
 * 4. Saves timestamps and prices to kda_price table
 *
 * Data handling:
 * - Sources data from Kucoin's public API
 * - Each record contains a timestamp and closing price
 * - Uses upsert: overwrites existing prices if timestamps match
 * - Processes data in chunks to handle API limits
 */

const client = connectPg();

const insertQuery = `
INSERT INTO kda_price(timestamp, price)
VALUES %L
ON CONFLICT (timestamp) DO UPDATE SET price = excluded.price
RETURNING *
`;

const API_URL = 'https://www.kucoin.com/_api/order-book/candles?symbol=KDA-USDT&type=1min';

const INTERVAL = 90000;

// O H L C _ V
(async () => {
  let start = 1652659200;
  const humanDate = new Date(start * 1000);
  console.log(`Starting: ${humanDate}`);
  const end = DateTime.now().startOf('minute').minus({ minutes: 1 }).toSeconds();
  while (start < end) {
    const realEnd = start + INTERVAL > end ? end : start + INTERVAL;
    console.log(`Starting: ${start}`);
    const resp = await axios.get(`${API_URL}&begin=${start}&end=${realEnd}`);
    const data = resp.data;
    const candles = data.data;
    const values = candles.map((candle) => {
      const [strTime, , , , strClose, ,] = candle;
      const timestamp = parseInt(strTime);
      const close = parseFloat(strClose);
      const date = new Date(timestamp * 1000);
      return [date, close];
    });
    console.log(`Trying: ${values.length} rows`);
    const row = await client.query(format(insertQuery, values));

    start = start + INTERVAL;
    console.log(`Added: ${row.rowCount} rows`);
    console.log(`New Start: ${start}`);
  }

  console.log('Done');
  process.exit();
})();
