const { stringify } = require('zipson');
const { addTokenInfo } = require('../helpers/token');
const tokens = require('../constants/tokens.json');
const { mongoConnect } = require('../clients/mongo');

const ECKO_PAIRS_URL = 'https://api.ecko.finance/token-data/pairs';

const COLLECTION_NAME = 'tokens';

const getAllTokens = async () => {
  let sourcePairs;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(ECKO_PAIRS_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error('Invalid response shape: expected array');
    }
    sourcePairs = data;
  } catch (error) {
    console.warn(`Failed to fetch pairs from ${ECKO_PAIRS_URL}. Falling back to constants/tokens.json. Reason: ${error?.message || error}`);
    sourcePairs = tokens;
  }

  const allTokens = sourcePairs.reduce((p, c) => {
    const { token1, token2 } = c;
    if (token1 && token1.code && !(token1.code in p)) {
      p[token1.code] = token1;
    }
    if (token2 && token2.code && !(token2.code in p)) {
      p[token2.code] = token2;
    }
    return p;
  }, {});
  delete allTokens.coin;
  return allTokens;
};

const allTokenUpdate = async () => {
  try {
    const { db } = await mongoConnect();

    const allTokens = await getAllTokens();
    const finalTokens = await addTokenInfo(allTokens);

    const result = await db.collection(COLLECTION_NAME).updateOne(
      { id: 'TOKENS' },
      {
        $set: {
          id: 'TOKENS',
          cachedValue: stringify(finalTokens, { fullPrecisionFloats: true }),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    console.log(`TOKENS UPDATED - Modified: ${result.modifiedCount}, Inserted: ${result.upsertedCount}`);
  } catch (error) {
    console.error('Error updating tokens:', error);
    throw error;
  }
};

module.exports = allTokenUpdate;
