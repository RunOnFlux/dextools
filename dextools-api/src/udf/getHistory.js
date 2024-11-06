const { DateTime } = require("luxon");
const dotenv = require("dotenv");
const { getSymbol, getPGClient } = require("../helper");
dotenv.config();

const getInterval = (interval) => {
  switch (interval) {
    case "1":
      return "minute";
    case "60":
      return "hour";
    case "1D":
      return "day";
    default:
      return "day";
  }
};

const getIntervalValue = (interval) => {
  switch (interval) {
    case "15":
      return 15;
    case "30":
      return 30;
    default:
      return 1;
  }
};

const getHourBars = () => `
SELECT
  *
FROM hour_candles
WHERE 
  ticker=$1 AND 
  timestamp >= $2 AND 
  timestamp < $3 
ORDER by timestamp;
`;

const getBarsQuery = (interval) => `
SELECT
  ticker,
  date_trunc('${interval}', timestamp) as timestamp,
  (array_agg(open ORDER BY timestamp))[1] as open,
  MAX(high) as high,
  MIN(low) as low,
  (array_agg(close ORDER BY timestamp DESC))[1] as close,
  SUM(volume) as volume
FROM candles
WHERE 
  ticker=$1 AND 
  timestamp >= $2 AND 
  timestamp < $3 
GROUP BY ticker, date_trunc('${interval}', timestamp)
ORDER by timestamp;
`;

const getBarsQueryCustom = (interval) => `
SELECT
  ticker,
  date_trunc('hour', timestamp) + (((date_part('minute', timestamp)::INTEGER / ${interval}::INTEGER) * ${interval}::INTEGER) || ' minutes')::INTERVAL as timestamp,
  (array_agg(open ORDER BY timestamp))[1] as open,
  MAX(high) as high,
  MIN(low) as low,
  (array_agg(close ORDER BY timestamp DESC))[1] as close,
  SUM(volume) as volume
FROM candles
WHERE 
  ticker=$1 AND 
  timestamp >= $2 AND 
  timestamp < $3 
GROUP BY ticker, date_trunc('hour', timestamp) + (((date_part('minute', timestamp)::INTEGER / ${interval}::INTEGER) * ${interval}::INTEGER) || ' minutes')::INTERVAL
`;

const getHistory = async (queryParams, signer) => {
  const pgClient = await getPGClient(signer, 5);
  const { symbol, from, to, resolution, countback } = queryParams;
  const { ticker } = getSymbol(symbol);
  const interval = getInterval(resolution);
  const plusObj = {};
  plusObj[interval] = 1;
  const fromDate = DateTime.fromSeconds(parseFloat(from)).startOf(interval);
  const toDate = DateTime.fromSeconds(parseFloat(to));
  const diff = toDate.startOf(interval).diff(fromDate, interval);
  let queryFrom;
  if (countback > diff[interval]) {
    const minusObj = {};
    minusObj[interval] = countback;
    queryFrom = toDate.minus(minusObj).toJSDate();
  } else {
    queryFrom = fromDate.toJSDate();
  }

  // eslint-disable-next-line
  const intervalValue = getIntervalValue(resolution);
  let bars;
  if (resolution === "60") {
    bars = await pgClient.query(getHourBars(), [
      ticker,
      queryFrom,
      toDate.toJSDate(),
    ]);
  } else if (intervalValue === 1) {
    bars = await pgClient.query(getBarsQuery(interval), [
      ticker,
      queryFrom,
      toDate.toJSDate(),
    ]);
  } else {
    bars = await pgClient.query(
      getBarsQueryCustom(intervalValue),
      [ticker, queryFrom, toDate.toJSDate()]
    );
  }
  if (bars.rowCount === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        t: [],
        c: [],
        o: [],
        l: [],
        h: [],
        v: [],
        s: "no_data",
      }),
    };
  }
  const barsResponse = bars.rows.reduce(
    (p, bar) => {
      p.t.push(DateTime.fromJSDate(bar.timestamp).toSeconds());
      p.c.push(bar.close);
      p.o.push(bar.open);
      p.l.push(bar.low);
      p.h.push(bar.high);
      p.v.push(bar.volume);
      return p;
    },
    {
      t: [],
      c: [],
      o: [],
      l: [],
      h: [],
      v: [],
    }
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      s: "ok",
      ...barsResponse,
    }),
  };
};

module.exports = getHistory;