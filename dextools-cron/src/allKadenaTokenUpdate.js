require('dotenv').config();
const { mongoConnect } = require('../clients/mongo');
const { stringify, parse } = require('zipson');
const { makePactCall } = require('../helpers/pact');
const {
  sleep,
  constants: { KADENA_CHAINS_COUNT },
} = require('../helpers');

const COLLECTION_NAME = 'kadenaTokens';

const dbName = process.env.MONGO_DB || 'dextools';

let mongoClient = null;
let db = null;

const updateKadenaTokens = async (chainId) => {
  const pactCode = `(let
    ((all-tokens
       (lambda (contract:object)
         (let*
           ((module-name (at 'name contract))
            (interfaces (if (contains 'interfaces contract) (at 'interfaces contract) (if (contains 'interface contract) (at 'interface contract) [])))
            (is-implementing-fungible-v2 (contains "fungible-v2" interfaces))
           )
         (if is-implementing-fungible-v2 module-name "")
         )
       )
     )
    )
    (filter (!= "") (map (all-tokens) (map (describe-module) (list-modules))))
  )`;
  const invalidChainTokens = [];

  try {
    const { db } = await mongoConnect();
    const collection = db.collection(COLLECTION_NAME);

    const res = await makePactCall(chainId.toString(), pactCode);
    if (res?.result?.data?.length > 0) {
      console.log(`[CHAIN ${chainId}] FOUND ${res?.result?.data?.length} tokens`);
      const storedTokens = await getStoredKadenaTokensByChain(chainId);
      console.log(`[CHAIN ${chainId}] ${storedTokens?.length} tokens already saved`);
      const difference = res?.result?.data?.filter((t) => !storedTokens.includes(t));

      if (difference.length) {
        console.log(`[CHAIN ${chainId}] FOUNDED ${difference.length} new tokens: ${difference.join(', ')}`);
        const validChainTokens = storedTokens;
        let tokenCount = 1;

        for (const token of difference) {
          try {
            const isTokenWorking = await makePactCall(chainId.toString(), `(${token}.get-balance "k:alice")`);
            await sleep(500);
            if (isTokenWorking?.result?.status === 'success' || isTokenWorking?.result?.error?.message?.includes('row not found')) {
              validChainTokens.push(token);
            } else {
              console.error(`[CHAIN ${chainId}] TOKEN ${token} IS NOT VALID`);
              invalidChainTokens.push(token);
            }
          } catch (err) {
            console.error(`FETCH ERROR ${token}:`, err);
          }

          tokenCount += 1;
        }

        console.log(`[CHAIN ${chainId}] invalid TOKENS: ${invalidChainTokens.length}/${res?.result?.data?.length}`);

        // Upsert in MongoDB
        await collection.updateOne(
          { chainId: chainId.toString() },
          {
            $set: {
              tokens: stringify(validChainTokens),
              lastUpdate: new Date().toISOString(),
            },
          },
          { upsert: true }
        );
        console.log('UPLOADING TOKENS ON CHAIN ' + chainId);
      }
    } else {
      console.error(`NO TOKENS FOUNDED ON CHAIN ${chainId} `, res);
    }
  } catch (err) {
    console.error(`ERROR FETCHING TOKENS ON CHAIN ${chainId}`);
    console.log(err);
  }
};

const getStoredKadenaTokensByChain = async (chainId) => {
  try {
    const { db } = await mongoConnect();
    const collection = db.collection(COLLECTION_NAME);

    const result = await collection.findOne({ chainId: chainId.toString() });
    return result?.tokens ? parse(result.tokens) : [];
  } catch (err) {
    console.error('Error fetching stored tokens:', err);
    return [];
  }
};

const allKadenaTokenUpdate = async () => {
  try {
    for (let chainId = 0; chainId < KADENA_CHAINS_COUNT; chainId++) {
      await updateKadenaTokens(chainId);
    }
  } finally {
    if (mongoClient) {
      await mongoClient.close();
      mongoClient = null;
      db = null;
    }
  }
};

module.exports = { allKadenaTokenUpdate, getStoredKadenaTokensByChain };
