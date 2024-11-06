const { providers } = require("./providers");

/**
 * Get a quote for a specific provider
 * @param {*} body
 * @returns {Promise<{statusCode: number, body: string}>}
 */
const getQuote = async (body) => {
  const { account, fiatCurrency, amountToSpend, cryptoToBuy, provider } = body;
  if (!account || !fiatCurrency || !amountToSpend || !provider) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error:
          "Please define params: account, fiatCurrency, amountToSpend, cryptoToBuy, provider",
      }),
    };
  }
  if (!providers[provider]) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Invalid provider",
      }),
    };
  }
  const result = await providers[provider].getQuote({
    account,
    fiatCurrency,
    amountToSpend,
    cryptoToBuy,
  });
  if (result.error) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: result.error ?? "Failed to get quote",
      }),
    };
  }
  return {
    statusCode: 200,
    body: JSON.stringify({
      ...result,
    }),
  };
};

/**
 * Get currency list and limits for a specific provider
 * @param {*} queryParams
 * @returns {Promise<{statusCode: number, body: string}>}
 */
const getFiatCurrencyLimits = async (queryParams = {}) => {
  const { provider } = queryParams;
  if (!providers[provider]) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Invalid provider",
      }),
    };
  }
  const result = await providers[provider].getFiatCurrencyLimits();
  if (result.error) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: result.error ?? "Failed to get fiat currency limits",
      }),
    };
  }
  return {
    statusCode: 200,
    body: JSON.stringify({
      ...result,
    }),
  };
};

module.exports = { getQuote, getFiatCurrencyLimits };
