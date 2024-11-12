const { query } = require("../../clients/pg");
const { mongoConnect } = require("../../clients/mongo");
const { parse } = require("zipson");

const getPerformanceSummary = async (queryParams) => {
  const interval = queryParams.interval || "1D";

  let intervalQuery;
  switch (interval.toUpperCase()) {
    case "1D":
      intervalQuery = "timestamp > NOW() - INTERVAL '1 day'";
      break;
    case "1W":
      intervalQuery = "timestamp > NOW() - INTERVAL '1 week'";
      break;
    case "1M":
      intervalQuery = "timestamp > NOW() - INTERVAL '1 month'";
      break;
    case "1Y":
      intervalQuery = "timestamp > NOW() - INTERVAL '1 year'";
      break;
    default:
      throw new Error("Invalid interval parameter. Use 1D, 1W, 1M or 1Y.");
  }

  const queryNonKDA = `
   SELECT
     ticker,
     MIN(timestamp) as open_time,
     MAX(timestamp) as close_time,
     (array_agg(open ORDER BY timestamp ASC))[1] as open,
     (array_agg(close ORDER BY timestamp DESC))[1] as close,
     MIN(low) as low,
     MAX(high) as high,
     SUM(volume) as volume
   FROM
     hour_candles
   WHERE
     ${intervalQuery}
   GROUP BY
     ticker
 `;

  const queryKDA = `
   SELECT
     'KDA' as ticker,
     MIN(timestamp) as open_time,
     MAX(timestamp) as close_time,
     (array_agg(price ORDER BY timestamp ASC))[1] as open,
     (array_agg(price ORDER BY timestamp DESC))[1] as close,
     MIN(price) as low,
     MAX(price) as high
   FROM
     kda_price
   WHERE
     ${intervalQuery}
 `;

  const queryTransactionsCount = `
 WITH unified_tokens AS (
       SELECT
         timestamp,
         from_token AS ticker
       FROM transactions
       WHERE
         ${intervalQuery}
       
       UNION ALL
     
       SELECT
         timestamp,
         to_token AS ticker
       FROM transactions
       WHERE
         ${intervalQuery}
     )
 
 SELECT
   ticker,
   COUNT(*) AS transaction_count
 FROM unified_tokens
 GROUP BY ticker
 ORDER BY ticker;  
 `;

  try {
    const [resNonKDA, resKDA, resTransactionCount] = await Promise.all([
      query(queryNonKDA),
      query(queryKDA),
      query(queryTransactionsCount),
    ]);

    const { db } = await mongoConnect();
    const tokensDoc = await db.collection("tokens").findOne({ id: "TOKENS" });
    const tokensData = tokensDoc ? parse(tokensDoc.cachedValue) : null;

    return {
      tickers: [
        ...resNonKDA.rows.map((row) => {
          const tokenModuleName = Object.keys(tokensData).find(
            (key) => tokensData[key].symbol === row.ticker
          );
          return {
            ...row,
            diff: ((row.close - row.open) / row.open) * 100,
            transactionCount: Number(
              resTransactionCount?.rows?.find(
                (r) => r.ticker === tokenModuleName
              )?.transaction_count ?? 0
            ),
          };
        }),
        ...resKDA.rows.map((row) => ({
          ...row,
          diff: ((row.close - row.open) / row.open) * 100,
          transactionCount: Number(
            resTransactionCount?.rows?.find((r) => r.ticker === "coin")
              ?.transaction_count ?? 0
          ),
        })),
      ],
    };
  } catch (error) {
    console.error("Failed to fetch performance summary:", error);
    throw error;
  }
};

module.exports = getPerformanceSummary;
