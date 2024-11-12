const { Client } = require("pg");

let client = null;
let chainwebClient = null;

function connectPg() {
  if (!client) {
    client = new Client({
      host: process.env.POSTGRES_HOST,
      database: process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      ssl: process.env.POSTGRES_SSL === "true",
    });
    client.connect();
  }
  return client;
}

function connectChainwebPg() {
  if (!chainwebClient) {
    chainwebClient = new Client({
      host: process.env.CHAINWEB_DB_HOST,
      database: process.env.CHAINWEB_DB_NAME,
      user: process.env.CHAINWEB_DB_USER,
      password: process.env.CHAINWEB_DB_PASSWORD,
      ssl: false,
    });
    chainwebClient.connect();
  }
  return chainwebClient;
}

async function closePg() {
  if (client) {
    await client.end();
    client = null;
  }
  if (chainwebClient) {
    await chainwebClient.end();
    chainwebClient = null;
  }
}

async function query(text, params) {
  const client = await connectPg();
  try {
    return await client.query(text, params);
  } catch (error) {
    console.error("Database query error:", error);
    throw error;
  }
}

async function chainwebQuery(text, params) {
  const client = await connectChainwebPg();
  try {
    return await client.query(text, params);
  } catch (error) {
    console.error("Chainweb database query error:", error);
    throw error;
  }
}

module.exports = {
  connectPg,
  connectChainwebPg,
  closePg,
  query,
  chainwebQuery,
};
