const Pact = require('pact-lang-api');
const { DateTime } = require('luxon');
const { mongoConnect } = require('../clients/mongo');
const { parse } = require('zipson');

const CACHE_TABLE = process.env.TOKENS_TABLE || 'tokens-table';

const GAS_PRICE = 0.00000001;
const KADENA_CHAINS_COUNT = 20;
const creationTime = () => Math.round(new Date().getTime() / 1000) - 10;
const TTL = 1000000;

const CHAINWEB_HOSTS = ['https://kadena2.app.runonflux.io', 'https://api.chainweb.com'];

const getNetwork = (url, chainId) => `${url}/chainweb/0.0/mainnet01/chain/${chainId}/pact`;

const getReserve = (tokenData) => {
  return parseFloat(tokenData.decimal ? tokenData.decimal : tokenData);
};

const makeCMD = (chainId, pactCode, gasLimit) => {
  return {
    pactCode,
    keyPairs: Pact.crypto.genKeyPair(),
    meta: Pact.lang.mkMeta('', chainId, GAS_PRICE, gasLimit, creationTime(), TTL),
  };
};

const makePactCallWithFallback = async (chainId, pactCode, gasLimit, urlIndex = 0) => {
  if (urlIndex === CHAINWEB_HOSTS.length) {
    throw new Error(`could not fetch from all hosts`);
  }
  const host = CHAINWEB_HOSTS[urlIndex];
  const chainwebUrl = getNetwork(host, chainId);

  return Pact.fetch
    .local(makeCMD(chainId, pactCode, gasLimit), chainwebUrl)
    .then((data) => {
      if (data.result && data.result.status) {
        console.log(`Success: ${chainwebUrl}`);
        return data;
      }
      throw new Error(`failed to fetch from ${chainwebUrl}`);
    })
    .catch((e) => {
      if (e.message !== `failed to fetch from ${chainwebUrl}`) {
        console.log(`Failed: ${chainwebUrl}: ${e}`);
      }
      return makePactCallWithFallback(chainId, pactCode, gasLimit, urlIndex + 1);
    });
};

const makePactCall = async (chainId, pactCode, gasLimit = 30000000) => {
  return await makePactCallWithFallback(chainId, pactCode, gasLimit, 0);
};

const getTokenAddressFromRef = (spec) => {
  return spec.namespace ? `${spec.namespace}.${spec.name}` : spec.name;
};

const getKDAMap = async (client) => {
  const kdaPriceR = await client.query(`SELECT timestamp, price FROM kda_price WHERE timestamp > '2021-08-01 00:00:00'::TIMESTAMP`);
  const kdaPriceMap = kdaPriceR.rows.reduce((p, row) => {
    const { timestamp, price } = row;
    p[timestamp] = parseFloat(price);
    return p;
  }, {});

  return kdaPriceMap;
};

const getNearestKDAPrice = (kdaPriceMap, date) => {
  let kdaMinute = date;
  while (!(kdaMinute in kdaPriceMap)) {
    kdaMinute = DateTime.fromJSDate(kdaMinute).minus({ minutes: 1 }).toJSDate();
  }
  return kdaPriceMap[kdaMinute];
};

const getAllTokensFromDB = async () => {
  const { db } = await mongoConnect();

  const result = await db.collection('tokens').findOne({ id: 'TOKENS' });

  if (!result) {
    console.warn('No tokens found in database');
    return {};
  }

  const tokens = parse(result.cachedValue);

  const symbolMap = Object.keys(tokens).reduce((p, c) => {
    if (!c || !tokens[c] || !tokens[c].symbol) {
      return p;
    }
    p[c] = tokens[c].symbol;
    return p;
  }, {});

  return symbolMap;
};

const buildFirstCandle = async (client, kdaPriceMap, ticker, tokenAddress) => {
  const firstTXN = await client.query(`SELECT * FROM transactions WHERE from_token=$1 OR to_token=$2 ORDER BY timestamp asc LIMIT 1`, [
    tokenAddress,
    tokenAddress,
  ]);
  const { timestamp, from_token, from_amount, to_amount, volume } = firstTXN.rows[0];

  const dateTime = DateTime.fromJSDate(timestamp);
  const kdaPrice = getNearestKDAPrice(kdaPriceMap, dateTime.startOf('minute').toJSDate());
  const priceInKDA = from_token === 'coin' ? from_amount / to_amount : to_amount / from_amount;
  const priceInUSD = priceInKDA * kdaPrice;
  const candle = [ticker, dateTime.startOf('minute').toJSDate(), priceInUSD, priceInUSD, priceInUSD, priceInUSD, parseFloat(volume)];
  await client.query(
    `INSERT INTO candle_master (ticker, timestamp, low, high, open, close, volume) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT ON CONSTRAINT candle_master_pkey DO NOTHING`,
    candle
  );
};

const getCandleOrBuild = async (client, kdaPriceMap, ticker, tokenAddress, order) => {
  const hasCandle = await client.query('SELECT * FROM candles WHERE ticker=$1 ORDER BY timestamp LIMIT 1', [ticker]);
  if (hasCandle.rowCount === 0) {
    await buildFirstCandle(client, kdaPriceMap, ticker, tokenAddress);
  }
  const candle = await client.query(`SELECT * FROM candles WHERE ticker=$1 ORDER BY timestamp ${order} LIMIT 1`, [ticker]);
  return candle.rows[0];
};

const sleep = async (ms) => await new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  makePactCall,
  getReserve,
  getTokenAddressFromRef,
  getKDAMap,
  getNearestKDAPrice,
  getAllTokensFromDB,
  getCandleOrBuild,
  sleep,
  constants: {
    KADENA_CHAINS_COUNT,
  },
};
