"use strict";

const { Signer } = require("@aws-sdk/rds-signer");
const { Pool } = require("pg");
const dotenv = require("dotenv");
dotenv.config();

const signer = new Signer({
  hostname: process.env.PGHOST,
  username: process.env.PGUSER,
  port: 5432,
});

const pgChainwebClientPool = new Pool({
  host: process.env.CHAINWEB_DB_HOST,
  database: process.env.CHAINWEB_DB_NAME,
  user: process.env.CHAINWEB_DB_USER,
  password: process.env.CHAINWEB_DB_PASSWORD,
  idleTimeoutMillis: 10000,
  max: 80,
});

const pairsUpdater = require("./src/updater/pairsUpdater");
const pairsUpdaterHandler = async (event) => {
  await pairsUpdater(signer);
};

const getAccountBalanceChart = require("./src/api/getAccountBalanceChart");
const getAccountBalanceChartHandler = async (event) => {
  const { queryStringParameters, headers } = event;
  const queryParams = queryStringParameters ? queryStringParameters : {};
  const xSignature = headers["x-signature"] || headers["X-Signature"];
  const result = await getAccountBalanceChart(queryParams, xSignature);
  return addHeader(result);
};

const getAccountTransactionHistory = require("./src/api/getAccountTransactionHistory");
const getAccountTransactionHistoryHandler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const { queryStringParameters } = event;
  const queryParams = queryStringParameters ? queryStringParameters : {};
  const result = await getAccountTransactionHistory(
    queryParams,
    pgChainwebClientPool
  );
  return addHeader(result);
};

const getPerformanceSummary = require("./src/api/getPerformanceSummary");
const getPerformanceSummaryHandler = async (event) => {
  const { queryStringParameters } = event;
  const queryParams = queryStringParameters ? queryStringParameters : {};
  const result = await getPerformanceSummary(queryParams?.interval, signer);
  return addHeader(result);
};

const getPairs = require("./src/api/getPairs");
const getPairsHandler = async (event) => {
  const { queryStringParameters } = event;
  const queryParams = queryStringParameters ? queryStringParameters : {};
  const result = await getPairs(queryParams);
  return addHeader(result);
};

const getTransactions = require("./src/api/getTransactions");
const getTransactionsHandler = async (event) => {
  const { queryStringParameters } = event;
  const queryParams = queryStringParameters ? queryStringParameters : {};
  const result = await getTransactions(queryParams, signer);
  return addHeader(result);
};

const getConfig = require("./src/udf/getConfig");
const getConfigHandler = async (event) => {
  const result = getConfig();
  return buildResponse(200, result);
};

const getSymbols = require("./src/udf/getSymbols");
const getSymbolsHandler = async (event) => {
  const { queryStringParameters } = event;
  const queryParams = queryStringParameters ? queryStringParameters : {};
  const result = await getSymbols(queryParams, signer);
  return addHeader(result);
};

const searchHandler = async (event) => {
  return buildResponse(200, {});
};

const getHistory = require("./src/udf/getHistory");
const { addHeader, buildResponse } = require("./src/helper");
const getHistoryHandler = async (event) => {
  const { queryStringParameters } = event;
  const queryParams = queryStringParameters ? queryStringParameters : {};
  const result = await getHistory(queryParams, signer);
  return addHeader(result);
};

const { getQuote, getFiatCurrencyLimits } = require("./src/api/fiatOnRamp");
const getQuoteHandler = async (event) => {
  const bodyParams = JSON.parse(event.body ?? {});
  const result = await getQuote(bodyParams);
  return addHeader(result);
};
const getFiatCurrencyLimitsHandler = async (event) => {
  const { queryStringParameters } = event;
  const queryParams = queryStringParameters ? queryStringParameters : {};
  const result = await getFiatCurrencyLimits(queryParams);
  return addHeader(result);
};

module.exports = {
  pairsUpdaterHandler,
  getAccountBalanceChartHandler,
  getPairsHandler,
  getTransactionsHandler,
  getConfigHandler,
  getSymbolsHandler,
  searchHandler,
  getHistoryHandler,
  getAccountTransactionHistoryHandler,
  getPerformanceSummaryHandler,
  getQuoteHandler,
  getFiatCurrencyLimitsHandler,
};

// module.exports.hello = async (event) => {
//   return {
//     statusCode: 200,
//     body: JSON.stringify(
//       {
//         message: 'Go Serverless v1.0! Your function executed successfully!',
//         input: event,
//       },
//       null,
//       2
//     ),
//   };

//   // Use this code if you don't use the http event with the LAMBDA-PROXY integration
//   // return { message: 'Go Serverless v1.0! Your function executed successfully!', event };
// };
