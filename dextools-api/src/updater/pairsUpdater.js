const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { stringify, parse } = require("zipson/lib/index.js");

const dotenv = require("dotenv");
const { getPGClient } = require("../helper");
dotenv.config();

const PAIRS_TABLE = process.env.PAIRS_TABLE || false;
const TOKENS_TABLE = process.env.TOKENS_TABLE || false;
const ddbClient = new DynamoDBClient({
  region: "us-east-1",
  endpoint: process.env.AWS_ENDPOINT || undefined,
});

const getTokenResp = async (pgClient) => {
  console.log("getting tokens and closes");
  const s = await pgClient.query(
    `SELECT * FROM (
      SELECT ticker, close, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY timestamp DESC) as seq                                                                      FROM candles
     WHERE timestamp > NOW()-INTERVAL '2 minute'
    ) t WHERE t.seq=1;`
  );
  console.log("got token and closes");
  return s;
};

const getVolume = async (pgClient) => {
  console.log("Getting volume");
  const volumeR = await pgClient.query(`SELECT ticker, SUM(volume) as volume
  FROM candles
  WHERE timestamp <= NOW() 
  AND timestamp >= NOW()-INTERVAL '1 day' 
  AND volume != 'NaN'
  GROUP BY ticker`);

  console.log("got volume");
  return volumeR.rows.reduce((p, c) => {
    p[c.ticker] = parseFloat(c.volume);
    return p;
  }, {});
};

const getTokenIntervals = async (pgClient) => {
  console.log("getting toke intervals");
  const intervalR = await pgClient.query(`
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
`);

  console.log("got toke intervals");
  return intervalR.rows.reduce((p, c) => {
    if (!(c.interval in p)) {
      p[c.interval] = {};
    }
    p[c.interval][c.ticker] = parseFloat(c.close);
    return p;
  }, {});
};

const getTokens = async () => {
  const item = {
    TableName: TOKENS_TABLE,
    Key: {
      id: "TOKENS",
    },
  };
  const value = await ddbClient.send(new GetCommand(item));
  const { Item } = value;
  const { cachedValue } = Item;
  const tokens =
    typeof cachedValue === "string" || cachedValue instanceof String
      ? parse(cachedValue)
      : cachedValue;

  return Object.keys(tokens).map((k) => tokens[k]);
};

const getAllTokenExtraInfo = async (pgClient) => {
  console.log("getting HL for tokens");
  const getHLR = await pgClient.query(`SELECT * FROM at_price`);
  console.log("got HL for tokens");
  const tokenHL = getHLR.rows.reduce((p, c) => {
    p[c.ticker] = {
      allTimeHigh: parseFloat(c.high),
      allTimeLow: parseFloat(c.low),
    };
    return p;
  }, {});

  console.log("get all tokens");
  const data = await getTokens();
  console.log("got all tokens");
  const token = data.reduce((p, c) => {
    const { code, logoUrl, symbol, totalSupply, circulatingSupply, socials } =
      c;
    p[symbol] = {
      totalSupply: parseFloat(totalSupply),
      circulatingSupply: parseFloat(circulatingSupply),
      socials: socials ? socials : [],
      address: code,
      image: logoUrl,
      ...tokenHL[symbol],
    };
    return p;
  }, {});
  return token;
};

const getPriceChange = (from, to) => {
  if (!from) {
    return null;
  }
  const fromValue = parseFloat(from);
  return (to - fromValue) / fromValue;
};

const getPair = (ticker, close, volume, intervalsMap, extraInfo) => {
  return {
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
  };
};

const buildPairs = async (pgClient) => {
  console.log(`BUILDING pairs`);
  const [tokensResp, volume, intervalsMap, extraInfos] = await Promise.all([
    getTokenResp(pgClient),
    getVolume(pgClient),
    getTokenIntervals(pgClient),
    getAllTokenExtraInfo(pgClient),
  ]);

  console.log("GOT ALL");
  const response = tokensResp.rows.reduce((p, token) => {
    const { ticker, close } = token;
    const v = volume[ticker];
    const extraInfo = extraInfos[ticker];
    p[ticker] = getPair(ticker, close, v, intervalsMap, extraInfo);
    return p;
  }, {});
  return response;
};

const pairsUpdater = async (signer) => {
  console.log("STARTING PAIRS UPDATE");
  const pgClient = await getPGClient(signer, 5);
  try {
    const pairs = await buildPairs(pgClient);
    const item = {
      TableName: PAIRS_TABLE,
      Item: {
        id: "PAIRS",
        cachedValue: stringify(pairs, { fullPrecisionFloats: true }),
      },
    };
    console.log("UPLOADING");
    await ddbClient.send(new PutCommand(item));
  } catch (e) {
    console.log(`ERROR WHILE UPDATING ${e.message}`);
  }

  return null;
};

module.exports = pairsUpdater;
