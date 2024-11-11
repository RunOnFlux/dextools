require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const cron = require("node-cron");

const pairsUpdater = require("./src/updater/pairsUpdater");
const getAccountBalanceChart = require("./src/api/getAccountBalanceChart");
const getAccountTransactionHistory = require("./src/api/getAccountTransactionHistory");
const getPerformanceSummary = require("./src/api/getPerformanceSummary");
const getPairs = require("./src/api/getPairs");
const getTransactions = require("./src/api/getTransactions");
const getConfig = require("./src/udf/getConfig");
const getSymbols = require("./src/udf/getSymbols");
const getHistory = require("./src/udf/getHistory");
const { getQuote, getFiatCurrencyLimits } = require("./src/api/fiatOnRamp");

const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(compression());
app.use(express.json());

const asyncHandler = (fn) => async (req, res, next) => {
  try {
    const result = await fn(req.query, req.body, req.headers);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

app.get("/udf/config", asyncHandler(getConfig));
app.get("/udf/symbols", asyncHandler(getSymbols));
app.get("/udf/history", asyncHandler(getHistory));
// app.get("/test", asyncHandler(pairsUpdater));

app.get("/api/account-balance-chart", asyncHandler(getAccountBalanceChart));
app.get(
  "/api/account-transaction-history",
  asyncHandler(getAccountTransactionHistory)
);
app.get("/api/performance-summary", asyncHandler(getPerformanceSummary));
app.get("/api/pairs", asyncHandler(getPairs));
app.get("/api/transactions", asyncHandler(getTransactions));
app.post("/api/fiat-on-ramp/quote", asyncHandler(getQuote));
app.get("/api/fiat-on-ramp/currencies", asyncHandler(getFiatCurrencyLimits));

cron.schedule("*/5 * * * *", async () => {
  try {
    await pairsUpdater();
    console.log("Pairs update completed");
  } catch (error) {
    console.error("Error updating pairs:", error);
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: err.message || "Internal Server Error",
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
});

process.on("SIGTERM", async () => {
  console.log("🛑 Received SIGTERM. Shutting down...");
  process.exit(0);
});
