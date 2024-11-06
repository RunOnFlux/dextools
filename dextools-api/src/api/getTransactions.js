const { DateTime } = require("luxon");
const { getTickerFromID, getAllPairs, getPGClient } = require("../helper");

const dotenv = require("dotenv");
dotenv.config();

const getTransactions = async (queryParams, signer) => {
  const pgClient = await getPGClient(signer, 2)
  try {
    const { id, fromTime, toTime, limit, exchange } = queryParams;

    if (!id || !exchange) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Please specify (id, exchange)" }),
      };
    }

    const toDate = toTime
      ? DateTime.fromSeconds(parseFloat(toTime))
      : DateTime.now();
    const fromDate = fromTime
      ? DateTime.fromSeconds(parseFloat(fromTime))
      : null;

    if (toDate && fromDate && fromDate >= toDate) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "toTime has to be greater than fromTime",
        }),
      };
    }

    const allPairs = await getAllPairs();
    const actualLimit = limit && limit < 100 ? limit : 100;
    const ticker = getTickerFromID(id);
    const pair =   allPairs[ticker] ? allPairs[ticker] : null;
    if (!pair) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `ID: ${id} error: token ${ticker} not found` }),
      };
    }
    const { address } = pair.token0;
    let transactionsInPage;
    if (!fromDate) {
      transactionsInPage = await pgClient.query(
        `
        SELECT * FROM transactions WHERE (from_token = $1 OR to_token = $2) AND timestamp < $3 ORDER BY timestamp DESC LIMIT $4`,
        [address, address, toDate.toJSDate(), actualLimit]
      );
    } else {
      transactionsInPage = await pgClient.query(
        `
          SELECT * FROM transactions WHERE (from_token = $1 OR to_token = $2) AND timestamp > $3 AND timestamp < $4 ORDER BY timestamp DESC LIMIT $5`,
        [address, address, fromDate.toJSDate(), toDate.toJSDate(), actualLimit]
      );
    }

    if (transactionsInPage.rowCount === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify([]),
      }
    }
    const txTo = DateTime.fromJSDate(transactionsInPage.rows[0].timestamp)
      .startOf("minute")
      .plus({ minutes: 10 });
    const txFrom = DateTime.fromJSDate(
      transactionsInPage.rows[transactionsInPage.rowCount - 1].timestamp
    )
      .startOf("minute")
      .minus({ minutes: 30 });
    const kdaPriceR = await pgClient.query(
      "SELECT * FROM kda_price WHERE timestamp > $1 AND timestamp < $2",
      [txFrom.toJSDate(), txTo.toJSDate()]
    );

    const kdaPriceMap = kdaPriceR.rows.reduce((p, c) => {
      p[c.timestamp] = parseFloat(c.price);
      return p;
    }, {});
    const transactions = transactionsInPage.rows.map((row) => {
      const {
        requestkey,
        timestamp,
        from_token,
        from_amount,
        to_amount,
        volume,
        address: send,
        event_id,
      } = row;
      const type = from_token === address ? "SELL" : "BUY";

      const token0 = {
        ticker,
        address,
        img: allPairs[ticker].token0.img,
      };

      token0.amount =
        from_token === address
          ? parseFloat(from_amount)
          : parseFloat(to_amount);
      const token1 = {
        ticker: "KDA",
        address: "coin",
        img: "https://swap.kaddex.com/images/crypto/kda-crypto.svg",
      };

      token1.amount =
        from_token === address
          ? parseFloat(to_amount)
          : parseFloat(from_amount);

      const priceInKDA =
        token0.address === "coin"
          ? token0.amount / token1.amount
          : token1.amount / token0.amount;

      let kdaMinute = DateTime.fromJSDate(timestamp)
        .startOf("minute")
        .toJSDate();
      while (!(kdaMinute in kdaPriceMap)) {
        kdaMinute = DateTime.fromJSDate(kdaMinute)
          .minus({ minutes: 1 })
          .toJSDate();
      }
      const priceInUSD = priceInKDA * kdaPriceMap[kdaMinute];

      return {
        requestkey,
        timestamp,
        type,
        token0,
        token1,
        amount: parseFloat(volume),
        address: send,
        price: priceInUSD,
        eventId: parseFloat(event_id),
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify(transactions),
    }
  } catch (e) {
    console.log(e.message);
    return {
      statusCode: 500,
      body: JSON.stringify(e.message),
    };
  }
};

module.exports = getTransactions;