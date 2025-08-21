require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const cron = require("node-cron");

const pairsUpdater = require("./src/updater/pairsUpdater");
const getAccountBalanceChart = require("./src/api/getAccountBalanceChart");
const getAccountTransactionHistory = require("./src/api/getAccountTransactionHistory");
const getAccountTransactionHistoryGraphQL = require("./src/api/getAccountTransactionHistoryGraphQL");
const getPerformanceSummary = require("./src/api/getPerformanceSummary");
const getPairs = require("./src/api/getPairs");
const getTransactions = require("./src/api/getTransactions");
const getConfig = require("./src/udf/getConfig");
const getSymbols = require("./src/udf/getSymbols");
const getHistory = require("./src/udf/getHistory");
const { getQuote, getFiatCurrencyLimits } = require("./src/api/fiatOnRamp");
const { getTokenIcon } = require("./src/api/getTokenIcon");

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: "*",
    credentials: false,
  })
);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  })
);

app.use(morgan("dev"));
app.use(compression());
app.use(express.json());
app.use(
  "/public",
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res, filePath) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With, Accept, Origin"
      );
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);

const asyncHandler = (fn) => async (req, res, next) => {
  try {
    const result = await fn(req.query, req.body, req.headers);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

app.get("/udf/config", asyncHandler(getConfig));
app.get("/udf/symbols", asyncHandler(getSymbols));
app.get("/udf/history", asyncHandler(getHistory));

app.get("/api/account-balance-chart", asyncHandler(getAccountBalanceChart));
app.get(
  "/api/account-transaction-history",
  asyncHandler(getAccountTransactionHistoryGraphQL)
);
// app.get(
//   "/api/account-transaction-history-graphql",
//   asyncHandler(getAccountTransactionHistoryGraphQL)
// );
app.get("/api/performance-summary", asyncHandler(getPerformanceSummary));
app.get("/api/pairs", asyncHandler(getPairs));
app.get("/api/transactions", asyncHandler(getTransactions));
app.post("/api/fiat-on-ramp/quote", asyncHandler(getQuote));
app.get("/api/fiat-on-ramp/currencies", asyncHandler(getFiatCurrencyLimits));

app.get("/api/token-icon", async (req, res, next) => {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With, Accept, Origin"
    );
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    const result = await getTokenIcon(req.query);

    if (!result.success) {
      return res.status(404).json({ error: "Icon not found" });
    }

    const ext = path.extname(result.iconPath).toLowerCase();
    const mimeTypes = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };

    const mimeType = mimeTypes[ext] || "image/png";
    const fileName = path.basename(result.iconPath);
    const tokenName = result.token.includes(".")
      ? result.token.split(".").pop()
      : result.token;

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${tokenName}-icon${ext}"`
    );

    if (result.fallback) {
      res.setHeader("X-Fallback", "true");
    }

    res.sendFile(result.iconPath);
  } catch (error) {
    console.error("Error serving token icon:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/health", async (req, res) => {
  try {
    const { query } = require("./clients/pg");
    await query("SELECT 1");

    const { mongoConnect, mongoCloseConnection } = require("./clients/mongo");
    const { db } = await mongoConnect();
    await db.command({ ping: 1 });
    await mongoCloseConnection();

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(503).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

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
