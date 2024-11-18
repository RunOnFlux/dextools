const { default: axios } = require('axios');
const { DateTime } = require('luxon');
const retryModule = require('async-retry');
const { connectPg } = require('../clients/pg');

const insertQuery = `
INSERT INTO kda_price(timestamp, price)
VALUES ($1, $2) 
ON CONFLICT (timestamp) DO UPDATE SET price = excluded.price
RETURNING *
`;

async function retry(func) {
  return retryModule(func, {
    retries: 3,
  });
}

async function get(endpoint) {
  return (await retry(async () => await axios.get(endpoint))).data;
}

const getLatestFromGate = async () => {
  const currMin = DateTime.now().startOf('minute');
  const begin = currMin.toSeconds();
  const end = currMin.plus({ minutes: 1 }).toSeconds();
  const priceRes = await axios.get(
    `https://www.gate.io/json_svr/query/?u=10&c=9646628&type=tvkline&symbol=kda_usdt&from=${begin}&to=${end}&interval=60`
  );
  const data = priceRes.data.split('\n');
  return parseFloat(data[1].split(',')[4]);
};

const getPriceFromCoinGecko = async () => {
  const resp = await get(`https://api.coingecko.com/api/v3/simple/price?ids=kadena&vs_currencies=usd`);
  const price = resp['kadena']['usd'];
  return price;
};

const kdaPriceUpdate = async () => {
  const client = connectPg();
  let retryTimes = 0;
  const currMinute = new Date();
  currMinute.setSeconds(0);
  currMinute.setMilliseconds(0);

  let done = false;
  // while (retryTimes < 5) {
  //   try {
  //     console.log('getting kda price');
  //     const kdaPrice = await getLatestFromGate();
  //     console.log('price is ' + kdaPrice);
  //     const values = [currMinute, kdaPrice];
  //     console.log(`adding values to postgres, ${currMinute}`);
  //     await client.query(insertQuery, values);
  //     done = true;
  //     console.log(`added`);
  //     break;
  //   } catch (e) {
  //     console.log(e);
  //     retryTimes += 1;
  //     await new Promise((r) => setTimeout(r, 1000));
  //     console.log('FAILED TO UPDATEe, RETRYING ' + retryTimes + ' times');
  //   }
  // }

  if (!done) {
    while (retryTimes < 10) {
      try {
        console.log('getting kda price from coingecko');
        const kdaPrice = await getPriceFromCoinGecko();
        console.log('price is ' + kdaPrice);
        const values = [currMinute, kdaPrice];
        console.log(`adding values to postgres, ${currMinute}`);
        await client.query(insertQuery, values);
        done = true;
        console.log(`added`);
        break;
      } catch (e) {
        retryTimes += 1;
        console.log(e);
        await new Promise((r) => setTimeout(r, 1000));
        console.log('FAILED TO UPDATE FROM CGKO, RETRYING ' + retryTimes + ' times');
      }
    }
  }
};

module.exports = kdaPriceUpdate;
