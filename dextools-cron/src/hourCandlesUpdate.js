const format = require('pg-format');
const { connectPg } = require('../clients/pg');

const hourCandlesUpdate = async () => {
  const client = connectPg();
  console.log(`Running hour bar update`);

  for (let i = 0; i < 5; i++) {
    const candlesR = await client.query(`
  SELECT
      ticker,
      date_trunc('hour', timestamp) as timestamp,
      (array_agg(open ORDER BY timestamp))[1] as open,
      MAX(high) as high,
      MIN(low) as low,
      (array_agg(close ORDER BY timestamp DESC))[1] as close,
      SUM(volume) as volume
    FROM candles
    WHERE timestamp >= date_trunc('hour', NOW())
    GROUP BY ticker, date_trunc('hour', timestamp)
    ORDER by timestamp;
  `);
    if (candlesR.rowCount !== 0) {
      const candles = candlesR.rows.map((c) => [c.ticker, c.timestamp, c.low, c.high, c.open, c.close, c.volume]);
      const insertQuery = `
      INSERT INTO hour_candles (ticker, timestamp, low, high, open, close, volume) 
      VALUES %L 
      ON CONFLICT ON CONSTRAINT hour_candles_pkey
      DO UPDATE SET (ticker, timestamp, low, high, open, close, volume) = (EXCLUDED.ticker, EXCLUDED.timestamp, EXCLUDED.low, EXCLUDED.high, EXCLUDED.open, EXCLUDED.close, EXCLUDED.volume);
    `;
      const s = await client.query(format(insertQuery, candles));
      console.log(`inserted ${s.rowCount}`);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
};

module.exports = hourCandlesUpdate;
