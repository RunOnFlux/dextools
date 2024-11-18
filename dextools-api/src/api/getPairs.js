const { getAllPairs, getTickerFromID } = require("../helper");

const getSortKey = (sort) => {
  switch (sort) {
    case "hour":
      return "pricePercChange1h";
    case "day":
      return "pricePercChange24h";
    case "week":
      return "pricePercChange7d";
    case "price":
      return "price";
    case "marketcap":
      return "marketCap";
    default:
      return "volume24h";
  }
};

const getPairs = async (queryParams = {}) => {
  const id = queryParams.id;
  const exchange = queryParams.exchange;
  const sort = queryParams.sort;
  const allPairs = await getAllPairs();
  const result = {
    statusCode: 400,
    body: JSON.stringify({ error: "Please define both id & exchange or none" }),
  };

  if (!id && !exchange) {
    const pairs = Object.values(allPairs)
      .map((pair) => pair)
      .sort(
        (tokenA, tokenB) => tokenB[getSortKey(sort)] - tokenA[getSortKey(sort)]
      );
    return pairs;
  }

  if (id && exchange) {
    const dex = exchange.toLowerCase();
    if (dex !== "kaddex") {
      result.body = JSON.stringify({
        error: `exchange: ${dex} not known (kaddex only)`,
      });
      result.statusCode = 400;
      return result;
    }
    const ticker = getTickerFromID(id);
    const pair = allPairs[ticker] ? allPairs[ticker] : null;
    return pair
      ? pair
      : { error: `dex: ${dex} ticker: ${ticker} does not exist` };
  }
  return result;
};

module.exports = getPairs;
