const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { GetCommand } = require("@aws-sdk/lib-dynamodb");
const { parse } = require("zipson/lib");
const CACHE_TABLE = process.env.PAIRS_TABLE || false;
const { Pool } = require("pg");
const dotenv = require("dotenv");
dotenv.config();

const ddbClient = new DynamoDBClient({
  region: "us-east-1",
  endpoint: process.env.AWS_ENDPOINT || undefined,
});

const getTickerFromID = (id) => id.substring(id.indexOf(":") + 1);

const getAllPairs = async () => {
  const item = {
    TableName: CACHE_TABLE,
    Key: {
      id: "PAIRS",
    },
  };

  const value = await ddbClient.send(new GetCommand(item));
  const { Item } = value;
  const { cachedValue } = Item;
  return parse(cachedValue);
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

const supported_resolutions = [
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

const addHeader = (response) => {
  response.headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };
  return response;
};

const buildResponse = (statusCode, body) => {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    },
  };
};

const getPGClient = async (signer, size = 2) => {
  const pgClient = new Pool({
    host: process.env.PGHOST,
    port: 5432,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    max: size,
  });
  await pgClient.connect();
  return pgClient;
};

module.exports = {
  getTickerFromID,
  getAllPairs,
  getSymbol,
  supported_resolutions,
  buildResponse,
  addHeader,
  getPGClient,
};
