const { mongoConnect } = require("../../clients/mongo");
const { client, GET_ACCOUNT_TRANSACTIONS } = require("../../clients/graphql");
const { parse } = require("zipson");

const getAccountTransactionHistoryGraphQL = async (queryParams) => {
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

    let cursor = null;
    let allTransactions = [];
    let hasNextPage = true;
    let totalFetched = 0;
    let targetFetchCount = Number(skip) + Number(limit);

    while (hasNextPage && totalFetched < targetFetchCount) {
      const chunkSize = Math.min(50, targetFetchCount - totalFetched);
      const data = await client.request(GET_ACCOUNT_TRANSACTIONS, {
        accountName: account,
        first: chunkSize,
        after: cursor,
      });

      if (!data || !data.transfers || !data.transfers.edges) {
        break;
      }

      const edges = data.transfers.edges;
      if (edges.length === 0) {
        break;
      }

      allTransactions.push(...edges);
      totalFetched += edges.length;

      hasNextPage = data.transfers.pageInfo.hasNextPage;
      cursor = data.transfers.pageInfo.endCursor;

      if (totalFetched >= 10000) {
        console.warn("Reached maximum fetch limit of 10000 transactions");
        break;
      }
    }

    if (allTransactions.length === 0) {
      return [];
    }

    const { db } = await mongoConnect();
    const tokensDoc = await db.collection("tokens").findOne({ id: "TOKENS" });
    const tokensData = tokensDoc ? parse(tokensDoc.cachedValue) : null;

    let transactions = allTransactions
      .map((edge) => edge.node)
      .filter((tx) => {
        if (modulename && tx.moduleName !== modulename) {
          return false;
        }

        if (requestkey && tx.requestKey !== requestkey) {
          return false;
        }

        if (direction === "IN" && tx.receiverAccount !== account) {
          return false;
        }
        if (direction === "OUT" && tx.senderAccount !== account) {
          return false;
        }

        if (status === "SUCCESS" && tx.transaction?.result?.error) {
          return false;
        }
        if (status === "FAIL" && !tx.transaction?.result?.error) {
          return false;
        }

        return true;
      })
      .map((tx) => {
        let ticker = null;
        if (tx.moduleName === "coin") {
          ticker = "KDA";
        } else if (tokensData && tokensData[tx.moduleName]) {
          ticker = tokensData[tx.moduleName].symbol;
        } else if (tx.moduleName?.split(".").length === 2) {
          ticker = tx.moduleName?.split(".")[1].toUpperCase();
        }

        let transactionType = "TRANSFER";
        const code = tx.transaction?.cmd?.payload?.code || "";
        if (
          code.includes("coin.transfer") ||
          code.includes(".transfer") ||
          code.includes("transfer-create")
        ) {
          transactionType = "TRANSFER";
        } else if (code.includes("swap-exact-in")) {
          transactionType = "SWAP";
        }

        let direction = null;
        if (tx.receiverAccount === account) {
          direction = "IN";
        } else if (tx.senderAccount === account) {
          direction = "OUT";
        }

        const status = tx.transaction?.result?.goodResult ? "SUCCESS" : "FAIL";
        const continuation = tx.transaction?.result?.continuation
          ? JSON.parse(tx.transaction?.result?.continuation)
          : null;

        const targetChainId =
          continuation?.step === 0
            ? continuation?.yield?.provenance?.targetChainId
            : null;
        const meta = tx.transaction?.cmd?.meta;

        return {
          ticker,
          requestkey: tx.requestKey,
          amount: tx.amount,
          chainid: tx.transaction?.result?.block?.chainId?.toString(),
          from_acct: tx.senderAccount,
          to_acct: tx.receiverAccount,
          modulename: tx.moduleName,
          code: tx.transaction?.cmd?.payload?.code
            ? JSON.parse(tx.transaction?.cmd?.payload?.code)
            : null,
          error: tx.transaction?.result?.badResult,
          creationtime: meta?.creationTime,
          gas: tx.transaction?.result?.gas,
          gaslimit: meta?.gasLimit,
          gasprice: meta?.gasPrice,
          status,
          direction,
          transactionType,
          targetChainId,
        };
      });

    if (skip > 0) {
      transactions = transactions.slice(skip);
    }

    if (limit > 0) {
      transactions = transactions.slice(0, limit);
    }

    return transactions;
  } catch (error) {
    console.error("Error in getAccountTransactionHistoryGraphQL:", error);
    throw error;
  }
};

module.exports = getAccountTransactionHistoryGraphQL;
