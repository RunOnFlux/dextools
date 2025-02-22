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

const getTokensBatch = async (chainId) => {
  const pactCode = `(let
    ((all-tokens
       (lambda (contract:object)
         (let*
           ((module-name (at 'name contract))
            (interfaces (if (contains 'interfaces contract)
                            (at 'interfaces contract)
                            (if (contains 'interface contract)
                                (at 'interface contract)
                                [])))
            (is-implementing-fungible-v2 (contains "fungible-v2" interfaces))
           )
           (if is-implementing-fungible-v2 module-name "")
         )
       )
     )
    )
    (filter (!= "") (map (all-tokens) (map (describe-module) (list-modules))))
  )`;

  const res = await makePactCall(chainId.toString(), pactCode);

  if (res?.result?.status === 'success' && Array.isArray(res?.result?.data)) {
    return res.result.data;
  } else {
    throw new Error(`Batch approach failed on chain ${chainId}: ${res?.result?.error?.message}`);
  }
};

const getTokensFallback = async (chainId) => {
  console.log(`[CHAIN ${chainId}] Fallback: describing each module...`);
  const listRes = await makePactCall(chainId.toString(), '(list-modules)');
  if (listRes?.result?.status !== 'success' || !Array.isArray(listRes.result?.data)) {
    console.error(`[CHAIN ${chainId}] Fallback list-modules failed`);
    return [];
  }

  const modules = listRes.result.data;
  console.log(`[CHAIN ${chainId}] Fallback found ${modules.length} modules`);
  const fungibleTokens = [];
  let i = 1;
  for (const mod of modules) {
    try {
      const descRes = await makePactCall(chainId.toString(), `(describe-module "${mod}")`);
      if (descRes?.result?.status === 'success') {
        const data = descRes.result?.data;
        const interfaces = data?.interfaces || data?.interface || [];
        if (interfaces.includes('fungible-v2')) {
          console.log(`[CHAIN ${chainId}] ${i}/${modules.length} Found fungible token: ${data.name}`);
          fungibleTokens.push(data.name);
        } else {
          console.log(`[CHAIN ${chainId}] ${i}/${modules.length} Skipping non-fungible token: ${data.name}`);
        }
      }
    } catch (err) {
      console.error(`[CHAIN ${chainId}] Fallback error describing ${mod}`, err);
    }
    i++;
  }
  return fungibleTokens;
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

const updateKadenaTokens = async (chainId) => {
  const invalidChainTokens = [];
  let tokens = [];

  try {
    tokens = await getTokensBatch(chainId);
    console.log(`[CHAIN ${chainId}] BATCH FOUND ${tokens?.length} tokens`);
  } catch (err) {
    console.error(`[CHAIN ${chainId}] Batch approach failed or returned no data:`, err.message);
    tokens = await getTokensFallback(chainId);
    console.log(`[CHAIN ${chainId}] Fallback found ${tokens.length} tokens`);
  }

  if (!tokens.length) {
    console.error(`NO TOKENS FOUNDED ON CHAIN ${chainId}`);
    return;
  }

  const storedTokens = await getStoredKadenaTokensByChain(chainId);
  console.log(`[CHAIN ${chainId}] ${storedTokens?.length} tokens already saved`);
  const difference = tokens.filter((t) => !storedTokens.includes(t));

  if (!difference.length) {
    console.log(`[CHAIN ${chainId}] No new tokens to add.`);
    return;
  }

  console.log(`[CHAIN ${chainId}] FOUND ${difference.length} new tokens: ${difference.join(', ')}`);

  const validChainTokens = [...storedTokens];
  let tokenCount = 1;

  for (const token of difference) {
    try {
      const isTokenWorking = await makePactCall(chainId.toString(), `(${token}.get-balance "k:alice")`);
      // await sleep(500);
      if (
        isTokenWorking?.result?.status === 'success' ||
        isTokenWorking?.result?.error?.message?.includes('row not found') ||
        isTokenWorking?.result?.error?.message?.includes('No value found in table')
      ) {
        console.log(`[CHAIN ${chainId}] TOKEN ${tokenCount}/${tokens.length}: ${token} IS VALID`);
        validChainTokens.push(token);
      } else {
        console.error(`[CHAIN ${chainId}] TOKEN ${tokenCount}/${tokens.length}: ${token} IS NOT VALID`);
        invalidChainTokens.push(token);
      }
    } catch (err) {
      console.error(`FETCH ERROR ${token}:`, err);
    }

    tokenCount += 1;
  }

  console.log(`[CHAIN ${chainId}] invalid TOKENS: ${invalidChainTokens.length}/${tokens.length}`);

  try {
    const { db } = await mongoConnect();
    const collection = db.collection(COLLECTION_NAME);

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
    console.log(`[CHAIN ${chainId}] SAVED TOKENS => ${validChainTokens.length} total`);
  } catch (dbErr) {
    console.error(`[CHAIN ${chainId}] Error saving to Mongo:`, dbErr);
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

module.exports = {
  allKadenaTokenUpdate,
  getStoredKadenaTokensByChain,
};
