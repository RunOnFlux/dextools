const { DateTime } = require("luxon");
const { query } = require("../../clients/pg");
const { getSymbol } = require("../helper");

const INTERVALS = {
  1: "minute",
  60: "hour",
  "1D": "day",
};

const CUSTOM_INTERVALS = {
  15: 15,
  30: 30,
};

const QUERIES = {
  hourBars: `
   SELECT *
   FROM hour_candles
   WHERE 
     ticker = $1 AND 
     timestamp >= $2 AND 
     timestamp < $3 
   ORDER BY timestamp
 `,

  standardBars: (interval) => `
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
     ticker = $1 AND 
     timestamp >= $2 AND 
     timestamp < $3 
   GROUP BY ticker, date_trunc('${interval}', timestamp)
   ORDER BY timestamp
 `,

  customBars: (interval) => `
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
     ticker = $1 AND 
     timestamp >= $2 AND 
     timestamp < $3 
   GROUP BY ticker, date_trunc('hour', timestamp) + (((date_part('minute', timestamp)::INTEGER / ${interval}::INTEGER) * ${interval}::INTEGER) || ' minutes')::INTERVAL
 `,
};

const calculateTimeRange = ({ from, to, resolution, countback }) => {
  const interval = INTERVALS[resolution] || "day";
  const fromDate = DateTime.fromSeconds(parseFloat(from)).startOf(interval);
  const toDate = DateTime.fromSeconds(parseFloat(to));
  const diff = toDate.startOf(interval).diff(fromDate, interval);

  if (countback > diff[interval]) {
    return {
      from: toDate.minus({ [interval]: countback }).toJSDate(),
      to: toDate.toJSDate(),
    };
  }

  return {
    from: fromDate.toJSDate(),
    to: toDate.toJSDate(),
  };
};

const formatBarsResponse = (bars) => {
  if (!bars.length) {
    return {
      t: [],
      c: [],
      o: [],
      l: [],
      h: [],
      v: [],
      s: "no_data",
    };
  }

  const response = bars.reduce(
    (acc, bar) => {
      acc.t.push(DateTime.fromJSDate(bar.timestamp).toSeconds());
      acc.c.push(bar.close);
      acc.o.push(bar.open);
      acc.l.push(bar.low);
      acc.h.push(bar.high);
      acc.v.push(bar.volume);
      return acc;
    },
    { t: [], c: [], o: [], l: [], h: [], v: [] }
  );

  return { s: "ok", ...response };
};

const getHistory = async (queryParams) => {
  const { symbol, resolution } = queryParams;
  const { ticker } = getSymbol(symbol);
  const timeRange = calculateTimeRange(queryParams);

  const intervalValue = CUSTOM_INTERVALS[resolution] || 1;
  let bars;

  if (resolution === "60") {
    bars = await query(QUERIES.hourBars, [
      ticker,
      timeRange.from,
      timeRange.to,
    ]);
  } else if (intervalValue === 1) {
    const interval = INTERVALS[resolution] || "day";
    bars = await query(QUERIES.standardBars(interval), [
      ticker,
      timeRange.from,
      timeRange.to,
    ]);
  } else {
    bars = await query(QUERIES.customBars(intervalValue), [
      ticker,
      timeRange.from,
      timeRange.to,
    ]);
  }

  return formatBarsResponse(bars.rows);
};

module.exports = getHistory;
