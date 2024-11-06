const { Pool } = require('pg');
require('dotenv').config();
const format = require('pg-format');

/**
 * Hourly Candle Aggregator
 *
 * Aggregates minute-level candles into hourly candles by:
 * 1. Grouping data by ticker and hour
 * 2. Taking the first price of the hour as open
 * 3. Taking the last price of the hour as close
 * 4. Finding the highest high and lowest low
 * 5. Summing up the volume
 *
 * Data handling:
 * - Reads from 'candles' table (minute data)
 * - Writes to 'hour_candles' table
 * - Uses upsert: overwrites existing hourly candles if they exist
 */

const mainClient = new Pool({
  max: 2,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  ssl: process.env.POSTGRES_SSL === 'true',
});
mainClient.connect();

const getAndStore = async () => {
  console.log(`getting data`);
  const d = await mainClient.query(`
  SELECT
    ticker,
    date_trunc('hour', timestamp) as timestamp,
    (array_agg(open ORDER BY timestamp))[1] as open,
    MAX(high) as high,
    MIN(low) as low,
    (array_agg(close ORDER BY timestamp DESC))[1] as close,
    SUM(volume) as volume
  FROM candles
  GROUP BY ticker, date_trunc('hour', timestamp)
  ORDER by timestamp;
  `);

  console.log(`got ${d.rowCount}`);
  const candles = d.rows.map((c) => [c.ticker, c.timestamp, c.low, c.high, c.open, c.close, c.volume]);
  const insertQuery = `
  INSERT INTO hour_candles (ticker, timestamp, low, high, open, close, volume) 
  VALUES %L 
  ON CONFLICT ON CONSTRAINT hour_candles_pkey
  DO UPDATE SET (ticker, timestamp, low, high, open, close, volume) = (EXCLUDED.ticker, EXCLUDED.timestamp, EXCLUDED.low, EXCLUDED.high, EXCLUDED.open, EXCLUDED.close, EXCLUDED.volume);
`;
  const s = await mainClient.query(format(insertQuery, candles));
  console.log(`inserted ${s.rowCount}`);
};

(async () => {
  await getAndStore();
})();
