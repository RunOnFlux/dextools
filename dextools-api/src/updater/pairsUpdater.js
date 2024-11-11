const { query } = require("../../clients/pg");
const { mongoConnect } = require("../../clients/mongo");
const { stringify, parse } = require("zipson/lib/index.js");

const QUERIES = {
  recentCandles: `
    SELECT * FROM (
      SELECT ticker, close, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY timestamp DESC) as seq                                                                      
      FROM candles
      WHERE timestamp > NOW()-INTERVAL '2 minute'
    ) t WHERE t.seq=1
  `,

  dailyVolume: `
    SELECT ticker, SUM(volume) as volume
    FROM candles
    WHERE timestamp <= NOW() 
    AND timestamp >= NOW()-INTERVAL '1 day' 
    AND volume != 'NaN'
    GROUP BY ticker
  `,

  intervals: `
    SELECT ticker, close, t.interval
    FROM candles k
    INNER JOIN (
      SELECT '1 hour' as interval, date_trunc('minute', NOW()) - INTERVAL '1 hour' as timestamp
      UNION ALL
      SELECT '1 day' as interval, date_trunc('minute', NOW()) - INTERVAL '1 day' as timestamp
      UNION ALL
      SELECT '7 days' as interval, date_trunc('minute', NOW()) - INTERVAL '7 days' as timestamp
    ) t
    ON k.timestamp = t.timestamp
  `,

  highLow: `SELECT * FROM at_price`,
};

const getTokenResp = async () => {
  const { rows } = await query(QUERIES.recentCandles);
  return rows;
};

const getVolume = async () => {
  const { rows } = await query(QUERIES.dailyVolume);
  return rows.reduce((p, c) => {
    p[c.ticker] = parseFloat(c.volume);
    return p;
  }, {});
};

const getTokenIntervals = async () => {
  const { rows } = await query(QUERIES.intervals);
  return rows.reduce((p, c) => {
    if (!(c.interval in p)) {
      p[c.interval] = {};
    }
    p[c.interval][c.ticker] = parseFloat(c.close);
    return p;
  }, {});
};

const getTokens = async () => {
  const { db } = await mongoConnect();
  const result = await db.collection("tokens").findOne({ id: "TOKENS" });
  if (!result) return [];

  const tokens =
    typeof result.cachedValue === "string"
      ? parse(result.cachedValue)
      : result.cachedValue;
  return Object.keys(tokens).map((k) => tokens[k]);
};

const getAllTokenExtraInfo = async () => {
  const [getHLR, data] = await Promise.all([
    query(QUERIES.highLow),
    getTokens(),
  ]);

  const tokenHL = getHLR.rows.reduce((p, c) => {
    p[c.ticker] = {
      allTimeHigh: parseFloat(c.high),
      allTimeLow: parseFloat(c.low),
    };
    return p;
  }, {});

  return data.reduce((p, c) => {
    const { code, logoUrl, symbol, totalSupply, circulatingSupply, socials } =
      c;
    p[symbol] = {
      totalSupply: parseFloat(totalSupply),
      circulatingSupply: parseFloat(circulatingSupply),
      socials: socials || [],
      address: code,
      image: logoUrl,
      ...tokenHL[symbol],
    };
    return p;
  }, {});
};

const getPriceChange = (from, to) => {
  if (!from) return null;
  const fromValue = parseFloat(from);
  return (to - fromValue) / fromValue;
};

const getPair = (ticker, close, volume, intervalsMap, extraInfo) => ({
  id: `KDA:${ticker}`,
  symbol: `${ticker}:USD:KADDEX`,
  token0: {
    name: ticker,
    address: extraInfo.address,
    img: extraInfo.image,
  },
  token1: {
    name: "KDA",
    address: "coin",
    img: `https://swap.kaddex.com/images/crypto/kda-crypto.svg`,
  },
  exchange: {
    name: "KADDEX",
    img: `https://swap.kaddex.com/images/crypto/kaddex-crypto.svg`,
  },
  pair: `KDA/${ticker}`,
  price: parseFloat(close),
  pricePercChange1h: getPriceChange(intervalsMap["1 hour"][ticker], close),
  pricePercChange24h: getPriceChange(intervalsMap["1 day"][ticker], close),
  pricePercChange7d: getPriceChange(intervalsMap["7 days"][ticker], close),
  volume24h: volume,
  totalSupply: extraInfo.totalSupply,
  circulatingSupply: extraInfo.circulatingSupply,
  socials: extraInfo.socials,
  allTimeHigh: extraInfo.allTimeHigh,
  allTimeLow: extraInfo.allTimeLow,
});

const buildPairs = async () => {
  const [tokensResp, volume, intervalsMap, extraInfos] = await Promise.all([
    getTokenResp(),
    getVolume(),
    getTokenIntervals(),
    getAllTokenExtraInfo(),
  ]);

  return tokensResp.reduce((p, token) => {
    const { ticker, close } = token;
    const v = volume[ticker];
    const extraInfo = extraInfos[ticker];
    p[ticker] = getPair(ticker, close, v, intervalsMap, extraInfo);
    return p;
  }, {});
};

const pairsUpdater = async () => {
  try {
    const pairs = await buildPairs();
    const { db } = await mongoConnect();

    await db.collection("pairs").updateOne(
      { id: "PAIRS" },
      {
        $set: {
          id: "PAIRS",
          cachedValue: stringify(pairs, { fullPrecisionFloats: true }),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (error) {
    console.error(`Error updating pairs: ${error.message}`);
    throw error;
  }
};

module.exports = pairsUpdater;
