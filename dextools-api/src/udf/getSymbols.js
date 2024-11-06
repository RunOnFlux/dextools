const dotenv = require("dotenv");
const { getSymbol, getPGClient, getAllPairs } = require("../helper");
const { supported_resolutions } = require("../helper");
dotenv.config();;

const getSymbols = async (queryParams, signer) => {
  const client = await getPGClient(signer, 2)
  const { symbol } = queryParams;
  if (!symbol) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "please specify the required fields" }),
    };
  }
  const symbolInfo = getSymbol(symbol);
  const { ticker, group } = symbolInfo;
  const closeQuery = `SELECT close FROM candles WHERE ticker=$1 ORDER BY timestamp DESC LIMIT 1` 
  const currentPrice = await client.query(closeQuery, [ticker])
  const allPairs = await getAllPairs();
  if (!(ticker in allPairs)) {
    return {
      statusCode: 200,
      body: JSON.stringify({}),
    };
  }
  const pairs = allPairs[ticker];
  const { close } = currentPrice.rows[0];
  const numZeros = -Math.floor(Math.log10(parseFloat(close)) + 1) + 4;
  const pricescale = 10 ** numZeros > 1000 ? 10 ** numZeros : 1000;
  return {
    statusCode: 200,
    body: JSON.stringify({
      symbol,
      description: pairs.token0.name,
      ticker: symbol,
      pricescale,
      type: "crypto",
      "has-no-volume": false,
      "exchange-listed": group,
      "exchange-traded": group,
      minmovement: 1,
      "has-dwm": true,
      "has-intraday": true,
      timezone: "Etc/UTC",
      supported_resolutions,
      has_intraday: true,
      intraday_multipliers: ["1", "15", "30", "60"],
      "session-regular": "24x7",
    }),
  };
};

module.exports = getSymbols;
