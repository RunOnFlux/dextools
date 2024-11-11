const { mongoConnect } = require("../../clients/mongo");
const { chainwebQuery } = require("../../clients/pg");
const { parse } = require("zipson");

const getAccountTransactionHistory = async (queryParams) => {
  try {
    const {
      account,
      limit = 100,
      skip = 0,
      modulename = null,
      status = null,
      requestkey = null,
      direction = null,
    } = queryParams;

    if (!account) {
      throw new Error("Please define account param");
    }
    if (status && status !== "SUCCESS" && status !== "FAIL") {
      throw new Error("status can only be SUCCESS or FAIL");
    }
    if (direction && direction !== "IN" && direction !== "OUT") {
      throw new Error("direction can only be IN or OUT");
    }

    let query = `
   SELECT 
     ts.requestkey, ts.amount, ts.chainid, ts.from_acct, ts.to_acct, ts.modulename, 
     t.code, t.badresult as error, t.code, t.creationtime, t.gas, t.gaslimit, t.gasprice, t.continuation,
     CASE 
       WHEN t.badresult IS NULL THEN 'SUCCESS'
       ELSE 'FAIL'
     END AS status,
     CASE 
       WHEN ts.to_acct = $1 THEN 'IN'
       WHEN ts.from_acct = $1 THEN 'OUT'
     END AS direction
   FROM transfers ts 
   LEFT JOIN transactions t ON t.requestkey = ts.requestkey
   WHERE t.pactid IS NULL`;

    const pgParams = [];
    if (account) {
      pgParams.push(account);
      query += ` AND (ts.from_acct = $${pgParams.length} OR ts.to_acct = $${pgParams.length})`;
    }
    if (modulename) {
      pgParams.push(modulename);
      query += ` AND ts.modulename = $${pgParams.length}`;
    }
    if (requestkey) {
      pgParams.push(requestkey);
      query += ` AND ts.requestkey = $${pgParams.length}`;
    }
    if (direction === "IN") {
      query += " AND ts.to_acct = $1";
    }
    if (direction === "OUT") {
      query += " AND ts.from_acct = $1";
    }
    if (status === "SUCCESS") {
      query += " AND t.badresult IS NULL";
    } else if (status === "FAIL") {
      query += " AND t.badresult IS NOT NULL";
    }

    const finalLimit = Math.min(limit, 100);
    pgParams.push(finalLimit, skip);
    query += ` ORDER BY ts.height DESC LIMIT $${pgParams.length - 1} OFFSET $${
      pgParams.length
    }`;

    const transactions = await chainwebQuery(query, pgParams);

    const { db } = await mongoConnect();
    const tokensDoc = await db.collection("tokens").findOne({ id: "TOKENS" });
    const tokensData = tokensDoc ? parse(tokensDoc.cachedValue) : null;

    return transactions?.rows.map((tx) => {
      let ticker = null;
      if (tx.modulename === "coin") {
        ticker = "KDA";
      } else if (tokensData && tokensData[tx.modulename]) {
        ticker = tokensData[tx.modulename].symbol;
      } else if (tx.modulename?.split(".").length === 2) {
        ticker = tx.modulename?.split(".")[1].toUpperCase();
      }

      let transactionType = "???";
      if (
        tx?.code?.includes("coin.transfer") ||
        tx?.code?.includes(".transfer") ||
        tx?.code?.includes("transfer-create")
      ) {
        transactionType = "TRANSFER";
      } else if (tx?.code?.includes("swap-exact-in")) {
        transactionType = "SWAP";
      }

      const targetChainId =
        tx.continuation?.step === 0
          ? tx.continuation?.yield?.provenance?.targetChainId
          : null;

      delete tx?.continuation;

      return {
        ticker,
        ...tx,
        transactionType,
        targetChainId,
        error: tx?.error?.message ?? null,
      };
    });
  } catch (error) {
    console.error("Error in getAccountTransactionHistory:", error);
    throw error;
  }
};

module.exports = getAccountTransactionHistory;
