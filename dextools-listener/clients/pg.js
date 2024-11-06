const { Client } = require("pg");
const { getPriceFromCoinGecko } = require("../helper");
const format = require("pg-format");
const { DateTime } = require("luxon");

class PriceDBClient {
  constructor() {
    this.client = new Client();
    this.client.connect();
    this.tokenMap = {};
  }

  async upsertTransactionInfo(blockTime, dex, transactions) {
    console.log(`DB Query: Upsert ${transactions.length}txs DEX: ${dex}`);
    const upsertQueryTpl = `
INSERT INTO transactions(requestKey,timestamp,creationtime,from_token,from_amount,to_token,to_amount,volume,address,event_id)
VALUES %L
ON CONFLICT ON CONSTRAINT transactions_pkey DO NOTHING
RETURNING *
`;

    const values = transactions.map(
      ({
        fromDetails,
        toDetails,
        volume,
        requestKey,
        timestamp,
        address,
        eventId,
      }) => [
        requestKey,
        new Date(new Date(blockTime / 1000).toUTCString()),
        new Date(new Date(timestamp * 1000).toUTCString()),
        fromDetails.tokenAddress,
        fromDetails.amount,
        toDetails.tokenAddress,
        toDetails.amount,
        volume,
        address,
        eventId,
      ]
    );
    const upsertQuery = format(upsertQueryTpl, values);
    const res = await this.client.query(upsertQuery);
    console.log(`DB Query: Upserted ${res.rows.length}txs DEX: ${dex}`);
  }

  async getKDAPrice() {
    try {
      const res = await this.client.query(`
      SELECT price from kda_price WHERE price != 'NaN'
      ORDER BY timestamp DESC LIMIT 1`);
      const price = res.rows[0].price;
      return parseFloat(price);
    } catch (e) {
      console.log(e);
      console.log("failed to fetch from db, calling back to coingecko api");
      const price = await getPriceFromCoinGecko();
      return price;
    }
  }
}

module.exports = PriceDBClient;
