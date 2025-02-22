const { mongoConnect, mongoCloseConnection } = require('../clients/mongo');
const { Client } = require('pg');
const { getStoredKadenaTokensByChain } = require('./allKadenaTokenUpdate');
const { makePactCall, getReserve } = require('../helpers/pact');
const {
  sleep,
  constants: { KADENA_CHAINS_COUNT },
} = require('../helpers');
const { parse, stringify } = require('zipson/lib');

const ACCOUNTS_COLLECTION = 'kadenaAccounts';
const ACCOUNTS_BALANCE_COLLECTION = 'kadenaAccountsBalance';
const TOKENS_COLLECTION = 'tokens';

const mainClient = new Client({
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  ssl: process.env.POSTGRES_SSL === 'true',
});

mainClient.connect();

const ACCOUNTS_CHUNK_SIZE = 3;

const getAllTickerLastPrices = async () => {
  const selectQuery = `SELECT cm.ticker, cm.timestamp, cm.close
                      FROM candles cm
                      INNER JOIN (
                        SELECT
                            ticker,
                            MAX(timestamp) as last_timestamp
                        FROM
                            candles
                        GROUP BY
                            ticker
                      ) as latest ON cm.ticker = latest.ticker AND cm.timestamp = latest.last_timestamp;
  `;
  const tokenResponse = await mainClient.query(selectQuery);
  const kdaResponse = await mainClient.query(`SELECT * FROM kda_price ORDER BY timestamp DESC LIMIT 1`);
  const kdaCandle = kdaResponse?.rows[0];
  return [{ ticker: 'KDA', timestamp: kdaCandle?.timestamp, close: kdaCandle?.price }, ...(tokenResponse?.rows ?? [])];
};

const updateAccountsBalance = async () => {
  console.log('Starting accounts balance update');

  try {
    const { db } = await mongoConnect();
    const lastTokenPrices = await getAllTickerLastPrices();
    console.log('Token prices fetched', lastTokenPrices);
    // Fetch tokens data from MongoDB
    const tokensData = await db.collection(TOKENS_COLLECTION).findOne({});
    const tokensCached = tokensData ? parse(tokensData.cachedValue) : {};
    console.log('Tokens fetched');

    const getTokenSymbolByModuleName = (module) => (module === 'coin' ? 'KDA' : tokensCached[module]?.symbol ?? null);

    const getTokenPriceByModuleName = (module) => lastTokenPrices.find((token) => token.ticker === getTokenSymbolByModuleName(module))?.close ?? 0;

    // Fetch all accounts in chunks
    const cursor = db.collection(ACCOUNTS_COLLECTION).find({}).batchSize(ACCOUNTS_CHUNK_SIZE);

    while (await cursor.hasNext()) {
      const accountsBatch = [];
      for (let i = 0; i < ACCOUNTS_CHUNK_SIZE && (await cursor.hasNext()); i++) {
        const account = await cursor.next();
        accountsBatch.push(account.account);
      }

      if (accountsBatch.length) {
        const dataToPersist = accountsBatch.reduce((acc, key) => {
          acc[key] = [];
          return acc;
        }, {});

        const chainPromises = Array.from({ length: KADENA_CHAINS_COUNT }, async (_, chainId) => {
          let tokens = await getStoredKadenaTokensByChain(chainId);
          const isValidPactString = (str) => /^[a-zA-Z0-9._-]+$/.test(str);
          tokens = tokens.filter((token) => isValidPactString(token));
          const getTokenAlias = (tokenName) => tokenName.replace(/\./g, '');

          const pactCode = `
            (
              let* (
                    ${accountsBatch
                      .map(
                        (account, j) => `
                      ${tokens?.map((ft) => `(${getTokenAlias(ft)}_${j} (try 0.0 (${ft}.get-balance "${account}")))`).join('\n')}`
                      )
                      .join('\n')}
                  )
                   
                    {${accountsBatch
                      .map(
                        (acc, j) => `
                      "${acc}": {
                        ${tokens?.map((ft) => `"${ft}": ${getTokenAlias(ft)}_${j}`).join(', ')}
                      }
                      `
                      )
                      .join(', ')}}
            )`;

          try {
            const res = await makePactCall(chainId.toString(), pactCode);
            if (res?.result?.status === 'success') {
              Object.keys(res?.result?.data).forEach((accountString) => {
                if (dataToPersist[accountString]) {
                  const balances = Object.keys(res?.result?.data[accountString]).map((token) => {
                    const balance = getReserve(res?.result?.data[accountString][token]);
                    const price = getTokenPriceByModuleName(token);
                    if (isNaN(price)) {
                      console.log(`ERROR PRICE NaN for token: ${token}`);
                    }
                    const usdBalance = parseFloat((balance * parseFloat(price)).toFixed(2));
                    return {
                      token,
                      balance,
                      price: price ?? 0,
                      usdBalance,
                    };
                  });
                  dataToPersist[accountString].push({
                    chainId,
                    balances,
                    usdValue: balances.reduce((acc, token) => acc + token.usdBalance, 0),
                  });
                }
              });
            } else {
              console.error(`ERROR on chain ${chainId}`);
              console.error(res?.result?.error?.message);
            }
          } catch (err) {
            console.error(`ERROR on chain ${chainId}`);
            console.log(err);
            console.log(err.stack);
          }
        });

        await Promise.all(chainPromises);

        // Persist to MongoDB
        const bulkOps = Object.keys(dataToPersist).map((account) => ({
          updateOne: {
            filter: {
              account,
              date: new Date().toISOString().split('T')[0],
            },
            update: {
              $set: {
                totalUsdValue: dataToPersist[account].reduce((total, current) => total + current.usdValue, 0),
                balances: stringify(dataToPersist[account]),
              },
            },
            upsert: true,
          },
        }));

        if (bulkOps.length > 0) {
          await db.collection(ACCOUNTS_BALANCE_COLLECTION).bulkWrite(bulkOps);
        }
      }
    }

    console.log('ACCOUNTS BALANCE UPDATE DONE');
  } catch (error) {
    console.error('Error updating accounts balance:', error);
  } finally {
    await mongoCloseConnection();
  }
};

module.exports = updateAccountsBalance;
