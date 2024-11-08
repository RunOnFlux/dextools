const { Client } = require("pg");

let client = null;

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

async function closePg() {
  if (client) {
    await client.close();
    client = null;
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

module.exports = {
  connectPg,
  closePg,
  query,
};
