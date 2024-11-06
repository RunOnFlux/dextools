const Pact = require('pact-lang-api');

const GAS_PRICE = 0.00000001;
const creationTime = () => Math.round(new Date().getTime() / 1000) - 10;
const TTL = 1000000;

const CHAINWEB_HOSTS = [`https://kadena.dapp.runonflux.io`, 'https://api.chainweb.com'];

const getNetwork = (url, chainId) => `${url}/chainweb/0.0/mainnet01/chain/${chainId}/pact`;

const getReserve = (tokenData) => {
  return parseFloat(tokenData.decimal ? tokenData.decimal : tokenData);
};

const makeCMD = (chainId, pactCode, gasLimit) => {
  return {
    pactCode,
    keyPairs: Pact.crypto.genKeyPair(),
    meta: Pact.lang.mkMeta('', chainId, GAS_PRICE, gasLimit, creationTime(), TTL),
  };
};

const makePactCallWithFallback = async (chainId, pactCode, gasLimit, urlIndex = 0) => {
  if (urlIndex === CHAINWEB_HOSTS.length) {
    throw new Error(`could not fetch from all hosts`);
  }
  const host = CHAINWEB_HOSTS[urlIndex];
  const chainwebUrl = getNetwork(host, chainId);

  return Pact.fetch
    .local(makeCMD(chainId, pactCode, gasLimit), chainwebUrl)
    .then((data) => {
      if (data.result && data.result.status) {
        console.log(`Success: ${chainwebUrl}`);
        return data;
      }
      throw new Error(`failed to fetch from ${chainwebUrl}`);
    })
    .catch((e) => {
      if (e.message !== `failed to fetch from ${chainwebUrl}`) {
        console.log(`Failed: ${chainwebUrl}: ${e}`);
      }
      return makePactCallWithFallback(chainId, pactCode, gasLimit, urlIndex + 1);
    });
};

const makePactCall = async (chainId, pactCode, gasLimit = 30000000) => {
  return await makePactCallWithFallback(chainId, pactCode, gasLimit, 0);
};

const isValidToken = async (token, chainId) => {
  const isTokenWorking = await makePactCall(chainId.toString(), `(${token}.get-balance "k:alice")`);
  await sleep(500);
  return isTokenWorking?.result?.status === 'success' || isTokenWorking?.result?.error?.message?.includes('row not found');
};

module.exports = {
  makePactCall,
  getReserve,
  isValidToken,
};
