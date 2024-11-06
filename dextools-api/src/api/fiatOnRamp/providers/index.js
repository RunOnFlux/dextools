const { getQuote, getFiatCurrencyLimits } = require("./topper");

const providers = {
  simplex: {
    getQuote: async (body) => {
      const { account, fiatCurrency, amountToSpend, cryptoToBuy, provider } =
        body;
    },
    getFiatCurrencyLimits: (body) => {
      const { payment, provider } = body;
    },
  },
  topper: {
    getQuote,
    getFiatCurrencyLimits,
  },
};

module.exports = { providers };
