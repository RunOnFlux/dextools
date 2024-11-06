const { stringify } = require('zipson');
const pairs = require('../pairs.json');
const { addTokenInfo } = require('../helpers/token');
const tokens = require('../constants/tokens.json');
const { mongoConnect } = require('../clients/mongo');

const COLLECTION_NAME = 'tokens';

const getAllTokens = async () => {
  const allTokens = tokens.reduce((p, c) => {
    const { token1, token2 } = c;
    if (!(token1.code in p)) {
      p[token1.code] = token1;
    }
    if (!(token2.code in p)) {
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
