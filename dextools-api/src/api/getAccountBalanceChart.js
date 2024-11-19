const { mongoConnect } = require("../../clients/mongo");
const { parse } = require("zipson");
const {
  hash,
  hexToBin,
  verifySig,
  base64UrlDecodeArr,
} = require("@kadena/cryptography-utils");

const ADD_ME_MESSAGE = "please-add-me-to-ecko-balance-tracking";

const verifyAndAddAccount = async (account, xSignature) => {
  try {
    const { db } = await mongoConnect();

    const existingAccount = await db
      .collection("kadenaAccounts")
      .findOne({ account });

    if (!existingAccount) {
      if (!xSignature) {
        return false;
      }
      const publicKey = account?.split("k:")[1];
      if (publicKey?.length !== 64) {
        throw new Error(`Invalid public key`);
      }

      const hashString = hash(ADD_ME_MESSAGE);
      const isValidSig = verifySig(
        base64UrlDecodeArr(hashString),
        hexToBin(xSignature),
        hexToBin(publicKey)
      );

      if (isValidSig) {
        await db.collection("kadenaAccounts").insertOne({ account });
      } else {
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error("Error verifying and adding account:", error);
    return false;
  }
};

const fillMissingDates = (items, getFullData) => {
  let lastValidValue = 0;
  items = items.map((item) => {
    if (
      item.totalUsdValue === null ||
      item.totalUsdValue === undefined ||
      isNaN(item.totalUsdValue)
    ) {
      item.totalUsdValue = lastValidValue;
    } else {
      lastValidValue = item.totalUsdValue;
    }
    return item;
  });

  const dateMap = items.reduce((acc, item) => {
    acc[item.date] = item;
    return acc;
  }, {});

  const filledItems = [];
  let previousItem = null;

  items.forEach((item, index) => {
    const currentDate = new Date(item.date);
    if (index > 0) {
      let previousDate = new Date(items[index - 1].date);
      previousDate.setDate(previousDate.getDate() + 1);
      while (previousDate < currentDate) {
        const dateStr = previousDate.toISOString().split("T")[0];
        filledItems.push({
          date: dateStr,
          totalUsdValue: previousItem.totalUsdValue,
          data: getFullData ? previousItem.data : undefined,
        });
        previousDate.setDate(previousDate.getDate() + 1);
      }
    }
    filledItems.push(item);
    previousItem = item;
  });

  return filledItems;
};

const getAccountBalanceChart = async (
  queryParams = {},
  body = {},
  headers = {}
) => {
  const { account, from, to, getFullData } = queryParams;

  if (!account || !from || !to) {
    throw new Error("Please define params: account, from, to");
  }

  const xSignature = headers["x-signature"] ?? null;

  const isValidAccountOrSignature = await verifyAndAddAccount(
    account,
    xSignature
  );
  if (!isValidAccountOrSignature) {
    throw new Error("Invalid signature");
  }

  try {
    const { db } = await mongoConnect();

    const items = await db
      .collection("kadenaAccountsBalance")
      .find({
        account: account,
        date: {
          $gte: from,
          $lte: to,
        },
      })
      .sort({ date: 1 })
      .toArray();

    const mappedItems = items.map((item) => ({
      date: item.date,
      totalUsdValue: item.totalUsdValue,
      data: getFullData ? parse(item.balances) : undefined,
    }));

    const filledItems = fillMissingDates(mappedItems, getFullData);

    return filledItems;
  } catch (error) {
    console.error("Error fetching account balance chart data:", error);
    throw new Error(
      "An error occurred while fetching account balance chart data"
    );
  }
};

module.exports = getAccountBalanceChart;
