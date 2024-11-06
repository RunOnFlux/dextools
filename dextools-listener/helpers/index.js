const { DateTime } = require("luxon");

const getKDAPriceMap = async client => {
  console.log("getting kda prices");
  const kdaPriceR = await client.query(
    "SELECT timestamp, price FROM kda_price WHERE price != 'NaN'"
  );
  const kdaPriceMap = kdaPriceR.rows.reduce((p, row) => {
    const { timestamp, price } = row;
    p[timestamp] = parseFloat(price);
    return p;
  }, {});
  console.log(`built kda price map`);
  return kdaPriceMap;
}

const getKDAPriceForTime = (timestamp, priceMap) => {
  let kdaMinute = timestamp;
  while(!(kdaMinute in priceMap)) {
    kdaMinute = DateTime.fromJSDate(kdaMinute).minus({minutes:1}).toJSDate();
  }

  return priceMap[kdaMinute];
}

module.exports = {
  getKDAPriceMap,
  getKDAPriceForTime,
}