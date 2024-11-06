const axios = require("axios");
const EventSource = require("eventsource");
const axiosRetry = require("axios-retry");
axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

const HOST = "https://kadena.dapp.runonflux.io";

const UPDATES_URL = `${HOST}/chainweb/0.0/mainnet01/header/updates`;

class ChainwebUpdateClient {
  constructor(pgClient) {
    this.pgClient = pgClient;
    this.dexMap = {
      2: "kaddex",
    };
  }

  getReserve(tokenData) {
    return parseFloat(tokenData.decimal ? tokenData.decimal : tokenData);
  }

  async getRelevantTransactions(chain, payloadHash, retry) {
    if (retry >= 5) {
      throw Error("failed to find payloadhash");
    }
    try {
      const d = await axios.get(
        `${HOST}/chainweb/0.0/mainnet01/chain/${chain}/payload/${payloadHash}`
      );
      const { transactions } = await d.data;
      const relevantTransactions = transactions.map((tx) => {
        const buf = Buffer.from(tx, "base64");
        return JSON.parse(buf.toString());
      });
      return relevantTransactions;
    } catch (e) {
      if (axios.default.isAxiosError(e)) {
        console.log(
          `Failed payload call, ${e.response.data.reason} Retry: ${retry + 1}`
        );
      } else {
        console.log(`Failed payload call, ${e} Retry: ${retry + 1}`);
      }
      await new Promise((r) => setTimeout(r, 2000));
      return this.getRelevantTransactions(chain, payloadHash, retry + 1);
    }
  }

  parseTxData(tx) {
    const cmd = JSON.parse(tx.cmd);
    return {
      requestKey: tx.hash,
      timestamp: cmd.meta.creationTime,
    };
  }

  getTokenAddressFromRef(spec) {
    return spec.namespace ? `${spec.namespace}.${spec.name}` : spec.name;
  }

  async getSwapRate(chain, transactions, retry) {
    if (retry >= 5) {
      throw Error("failed to get swapRate");
    }
    const txs = transactions.map((tx) => this.parseTxData(tx));
    const body = { requestKeys: txs.map((tx) => tx.requestKey) };
    const kdaPrice = await this.pgClient.getKDAPrice();
    try {
      const pollResp = await axios.post(
        `${HOST}/chainweb/0.0/mainnet01/chain/${chain}/pact/api/v1/poll`,
        body
      );
      const txResultMap = pollResp.data;
      if (Object.keys(txResultMap).length !== txs.length) {
        throw Error(
          `txMap not fully fetched, got: ${
            Object.keys(txResultMap).length
          } expected: ${txs.length}`
        );
      }
      const successResults = txs.reduce((prev, tx) => {
        const txResult = txResultMap[tx.requestKey];
        if (!(txResult.result && txResult.result.status === "success")) {
          return prev;
        }
        const swaps = txResult.events.filter((event) => event.name === "SWAP");
        if (swaps.length === 0) {
          return prev;
        }
        const tranformed = swaps.map((swap, i) => {
          const { params } = swap;
          const [_, account, fromAmount, fromSpec, toAmount, toSpec] = params;
          const fromAddress = this.getTokenAddressFromRef(fromSpec.refName);
          const toAddress = this.getTokenAddressFromRef(toSpec.refName);
          const from = this.getReserve(fromAmount);
          const to = this.getReserve(toAmount);
          const fromDetails = {
            tokenAddress: fromAddress,
            amount: from,
          };
          const toDetails = {
            tokenAddress: toAddress,
            amount: this.getReserve(to),
          };
          const volume =
            fromDetails.tokenAddress === "coin"
              ? fromDetails.amount * kdaPrice
              : toDetails.amount * kdaPrice;

          const priceInKDA =
            fromDetails.tokenAddress === "coin"
              ? fromDetails.amount / toDetails.amount
              : toDetails.amount / fromDetails.amount;

          const priceInUSD = priceInKDA * kdaPrice;
          return {
            dex: this.dexMap[chain],
            fromDetails,
            toDetails,
            volume,
            priceInKDA,
            priceInUSD,
            address: account,
            eventId: i + 1,
            ...tx,
          };
        });
        return prev.concat(tranformed);
      }, []);
      return successResults;
    } catch (e) {
      console.log(e.message);
      return this.getSwapRate(chain, transactions, retry + 1);
    }
  }

  async listen() {
    let updates = new EventSource(UPDATES_URL);
    updates.onopen = (e) => console.log("Started Listening to Header Updates");
    updates.addEventListener("BlockHeader", async (event) => {
      try {
        const json = JSON.parse(event.data);
        const {
          chainId,
          payloadHash,
          height,
          creationTime: blockTime,
        } = json.header;
        const { txCount } = json;
        if (chainId in this.dexMap && txCount > 0) {
          const txs = await this.getRelevantTransactions(
            chainId,
            payloadHash,
            0
          );
          const successTxs = await this.getSwapRate(chainId, txs);
          if (successTxs.length === 0) {
            console.log(`Block: ${height} Chain: ${chainId} SwapCount: N/A`);
          } else {
            console.log(
              `Block: ${height} Chain: ${chainId} SwapCount: ${successTxs.length}`
            );
            await this.pgClient.upsertTransactionInfo(
              blockTime,
              this.dexMap[chainId],
              successTxs
            );
          }
        }
      } catch (e) {
        if (axios.default.isAxiosError(e)) {
          console.log(e.response.data);
        } else {
          console.log(e);
        }

        console.log("skipping a block");
      }
    });

    updates.onerror = (err) => {
      console.error("EventSource failed:", err);
      updates.close();
      this.listen();
    };
  }
}

module.exports = ChainwebUpdateClient;
