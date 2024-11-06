const { DateTime } = require('luxon');
const { Client } = require('pg');
const { connectPg } = require('../clients/pg');
const format = require('pg-format');
const { getReserve, getTokenAddressFromRef, getKDAMap, getNearestKDAPrice } = require('../helpers');
require('dotenv').config();

const chainwebDB = new Client({
  host: process.env.CHAINWEB_DB_HOST,
  database: process.env.CHAINWEB_DB_NAME,
  user: process.env.CHAINWEB_DB_USER,
  password: process.env.CHAINWEB_DB_PASSWORD,
  ssl: process.env.CHAINWEB_DB_SSL === 'true',
});

const client = connectPg();

const insertQuery = `
INSERT INTO transactions(requestKey,timestamp,creationtime,from_token,from_amount,to_token,to_amount,volume,address,event_id)
VALUES %L
ON CONFLICT ON CONSTRAINT transactions_pkey
DO NOTHING
RETURNING *
`;

(async () => {
  console.log('Starting Transaction Backfill');
  console.log('Connecting to DBs');
  await chainwebDB.connect();

  console.log('Connected');

  console.log('Getting KDA Prices first');
  const kdaPriceMap = await getKDAMap(client);
  console.log('Done');

  console.log('Getting all transactions');
  const getChainwebSwapR = await chainwebDB.query(
    `SELECT requestkey, paramtext, creationtime FROM events e INNER JOIN blocks b ON e.block=b.hash WHERE e.chainid=2 AND qualname='kaddex.exchange.SWAP' ORDER BY e.height`
  );
  console.log('Got all transactions');

  const chainwebSwaps = getChainwebSwapR.rows;
  const requestKeyMap = {};

  console.log('Building transactions');
  const adjustedSwaps = chainwebSwaps.reduce((p, c) => {
    const { requestkey, paramtext, creationtime } = c;
    const parsedParams = JSON.parse(paramtext);
    const [_, sender, fromAmountR, fromSpec, toAmountR, toSpec] = parsedParams;
    const fromAmount = getReserve(fromAmountR);
    const toAmount = getReserve(toAmountR);
    const fromToken = getTokenAddressFromRef(fromSpec.refName);
    const toToken = getTokenAddressFromRef(toSpec.refName);
    const creationDate = DateTime.fromJSDate(creationtime).startOf('minute').toJSDate();
    const kdaPrice = getNearestKDAPrice(kdaPriceMap, creationDate);
    const volume = fromToken === 'coin' ? fromAmount * kdaPrice : toAmount * kdaPrice;

    const eventNumber = requestkey in requestKeyMap ? requestKeyMap[requestkey] + 1 : 0;
    requestKeyMap[requestkey] = eventNumber;
    p.push([requestkey, creationtime, creationtime, fromToken, fromAmount, toToken, toAmount, volume, sender, eventNumber]);
    return p;
  }, []);
  console.log('Done Building transactions', adjustedSwaps.length);
  console.log('Inserting');
  const insert = await client.query(format(insertQuery, adjustedSwaps));
  console.log('Inserted', insert.rowCount);
  process.exit();
})();
