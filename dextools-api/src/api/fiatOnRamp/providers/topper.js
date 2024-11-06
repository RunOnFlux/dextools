const { randomUUID, createPrivateKey } = require("crypto");
const { promisify } = require("util");
const jsonwebtoken = require("jsonwebtoken");
const axios = require("axios");

const TOPPER_API_URL = "https://api.sandbox.topperpay.com";
const TOPPER_CHECKOUT_URL = "https://app.sandbox.topperpay.com";

const getTopperPayload = ({ account, amountToSpend, fiatCurrency }) => ({
  jti: randomUUID(),
  sub: process.env.FIAT_ON_RAMP_TOPPER_WIDGET_ID,
  source: {
    amount: amountToSpend.toFixed(2),
    asset: fiatCurrency,
  },
  target: {
    address: account,
    asset: "ETH",
    network: "ethereum",
    label: "Ecko Wallet - Buy Crypto",
  },
});

const getTopperBootstrapToken = async ({
  account,
  amountToSpend,
  fiatCurrency,
}) => {
  const payload = getTopperPayload({ account, amountToSpend, fiatCurrency });
  const privateKeyJwk = JSON.parse(
    Buffer.from(
      process.env.FIAT_ON_RAMP_TOPPER_BASE64_PRIVATE_KEY,
      "base64"
    ).toString("utf-8")
  );
  const sign = promisify(jsonwebtoken.sign);
  const privateKey = createPrivateKey({
    format: "jwk",
    key: privateKeyJwk,
  });
  const options = {
    algorithm: "ES256",
    keyid: process.env.FIAT_ON_RAMP_TOPPER_KEY_ID,
  };
  return await sign(payload, privateKey, options);
};

const sendTopperRequest = async ({ method, url, data }) => {
  const config = {
    method,
    url: `${TOPPER_API_URL}${url}`,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    data: JSON.stringify(data),
  };
  try {
    const response = await axios.request(config);
    return response.data;
  } catch (error) {
    throw error.response?.data || error.message;
  }
};

const getQuote = async ({
  account,
  amountToSpend,
  fiatCurrency,
  cryptoToBuy,
}) => {
  try {
    const bootstrapToken = await getTopperBootstrapToken({
      account,
      amountToSpend,
      fiatCurrency,
    });

    const response = await sendTopperRequest({
      method: "POST",
      url: "/simulations",
      data: { bootstrapToken },
    });

    const freshBootstrapToken = await getTopperBootstrapToken({
      account,
      amountToSpend,
      fiatCurrency,
    });

    const totalFees = response.simulation.fees
      .reduce((total, fee) => total + parseFloat(fee.amount), 0)
      ?.toFixed(2);

    return {
      account,
      fiatCurrency,
      fiatTotalAmount: parseFloat(response.simulation.origin.amount).toFixed(2),
      fiatBaseAmount: (
        parseFloat(response.simulation.origin.amount) - totalFees
      ).toFixed(2),
      cryptoCurrency: cryptoToBuy,
      cryptoAmount: response.simulation.destination.amount,
      totalFees,
      bootstrapToken: freshBootstrapToken,
    };
  } catch (error) {
    return {
      error: error || "Failed to get quote from Topper",
    };
  }
};

const getFiatCurrencyLimits = async () => {
  try {
    const paymentMethodsResponse = await sendTopperRequest({
      method: "GET",
      url: "/payment-methods/crypto-onramp",
    });
    const paymentMethodsData = paymentMethodsResponse;
    const currencies = paymentMethodsData.paymentMethods.filter(
      (method) => method.type === "credit-card"
    );
    const assetsResponse = await sendTopperRequest({
      method: "GET",
      url: "/assets/crypto-onramp",
    });

    return {
      currencies: assetsResponse.assets.source.map((ass) => {
        const limit =
          currencies.find((c) => c.billingAsset === ass.code) ||
          currencies.find((c) => c.billingAsset === "USD");
        return {
          ...ass,
          maximum: limit.limits.find((l) => l.asset === ass.code).maximum,
          minimum: limit.limits.find((l) => l.asset === ass.code).minimum,
        };
      }),
    };
  } catch (error) {
    throw error.response?.data || error.message;
  }
};

module.exports = { getQuote, getFiatCurrencyLimits };
