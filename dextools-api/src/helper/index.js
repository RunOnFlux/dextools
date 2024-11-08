// src/utils/helpers.js
const { parse } = require("zipson/lib");
const { mongoConnect } = require("../../clients/mongo");

const getTickerFromID = (id) => id.substring(id.indexOf(":") + 1);

const getAllPairs = async () => {
  try {
    const { db } = await mongoConnect();
    const result = await db.collection("pairs").findOne({ id: "PAIRS" });
    if (!result) return [];

    return parse(result.cachedValue);
  } catch (error) {
    console.error("Error getting pairs:", error);
    throw error;
  }
};

const getSymbol = (symbol) => {
  const splitSymbol = symbol.split(":");
  if (splitSymbol.length !== 3) {
    throw new Error(`Unknown symbol ${symbol}`);
  }
  return {
    ticker: splitSymbol[0],
    base: splitSymbol[1],
    group: splitSymbol[2],
  };
};

const SUPPORTED_RESOLUTIONS = [
  "1",
  "3",
  "5",
  "15",
  "30",
  "60",
  "120",
  "240",
  "1D",
  "1W",
  "1M",
];

module.exports = {
  getTickerFromID,
  getAllPairs,
  getSymbol,
  SUPPORTED_RESOLUTIONS,
};
