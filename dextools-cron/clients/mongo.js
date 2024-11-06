const { MongoClient } = require('mongodb');

const mongoUrl = `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_HOST}:27017/${process.env.MONGO_DB}?authSource=admin`;

let client = null;
let db = null;

async function mongoConnect() {
  if (!client) {
    client = new MongoClient(mongoUrl);
    await client.connect();
    db = client.db(process.env.MONGO_DB);
  }
  return { client, db };
}

async function mongoCloseConnection() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = {
  mongoConnect,
  mongoCloseConnection,
};
