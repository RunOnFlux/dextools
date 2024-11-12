const { query } = require("../../clients/pg");
const { getSymbol, getAllPairs, SUPPORTED_RESOLUTIONS } = require("../helper");

const getSymbols = async (queryParams) => {
  const { symbol } = queryParams;

  if (!symbol) {
    throw new Error("Symbol is required");
  }

  try {
    const symbolInfo = getSymbol(symbol);
    const { ticker, group } = symbolInfo;

    const closeQuery = `SELECT close FROM candles WHERE ticker=$1 ORDER BY timestamp DESC LIMIT 1`;
    const {
      rows: [currentPrice],
    } = await query(closeQuery, [ticker]);

    const allPairs = await getAllPairs();
    if (!(ticker in allPairs)) {
      return {};
    }

    const pairs = allPairs[ticker];
    const { close } = currentPrice;

    const numZeros = -Math.floor(Math.log10(parseFloat(close)) + 1) + 4;
    const pricescale = 10 ** numZeros > 1000 ? 10 ** numZeros : 1000;

    return {
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
      supported_resolutions: SUPPORTED_RESOLUTIONS,
      has_intraday: true,
      intraday_multipliers: ["1", "15", "30", "60"],
      "session-regular": "24x7",
    };
  } catch (error) {
    console.error("Error in getSymbols:", error);
    throw error;
  }
};

module.exports = getSymbols;
