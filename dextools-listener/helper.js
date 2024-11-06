const axios = require("axios");

const getPriceFromCoinGecko = async () => {
  const res = await axios.get(
    `https://api.coingecko.com/api/v3/simple/price?ids=kadena&vs_currencies=usd`
  );
  const data = await res.data;
  const price = data["kadena"]["usd"];
  return price;
};

module.exports = {
  getPriceFromCoinGecko,
};
