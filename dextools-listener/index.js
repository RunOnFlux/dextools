require("dotenv").config();

process.env.TZ = "Etc/UTC";
const ChainwebUpdateClient = require("./clients/chainweb");
const PriceDBClient = require("./clients/pg");

(async () => {
  const postgresClient = new PriceDBClient();
  const chainwebClient = new ChainwebUpdateClient(postgresClient);
  await chainwebClient.listen();
})();
