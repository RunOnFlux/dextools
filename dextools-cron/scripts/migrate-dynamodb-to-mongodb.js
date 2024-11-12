require('dotenv').config();
const { DynamoDB } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
const { mongoConnect } = require('../clients/mongo');

const dynamodb = new DynamoDB({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const ddbDoc = DynamoDBDocument.from(dynamodb);

const TABLES = [
  {
    dynamo: 'kadena-tokens-table',
    mongo: 'kadenaTokens',
    indexes: [
      {
        keys: { chainId: 1 },
        options: { unique: true },
      },
    ],
  },
  {
    dynamo: 'pairs-table',
    mongo: 'pairs',
    indexes: [
      {
        keys: { id: 1 },
        options: { unique: true },
      },
    ],
  },
  {
    dynamo: 'tokens-table',
    mongo: 'tokens',
    indexes: [
      {
        keys: { id: 1 },
        options: { unique: true },
      },
    ],
  },
  {
    dynamo: 'kadena-accounts',
    mongo: 'kadenaAccounts',
    indexes: [
      {
        keys: { account: 1 },
        options: { unique: true },
      },
    ],
  },
  {
    dynamo: 'kadena-accounts-balance',
    mongo: 'kadenaAccountsBalance',
    indexes: [
      {
        keys: { account: 1, date: 1 },
        options: { unique: true },
      },
      {
        keys: { account: 1 },
        options: {},
      },
      {
        keys: { date: 1 },
        options: {},
      },
    ],
  },
];

async function scanDynamoTable(tableName) {
  const items = [];
  let lastEvaluatedKey = null;

  do {
    const params = {
      TableName: tableName,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
    };

    try {
      const data = await ddbDoc.scan(params);
      items.push(...data.Items);
      lastEvaluatedKey = data.LastEvaluatedKey;
      console.log(`Scanned ${items.length} items from ${tableName}`);
    } catch (error) {
      console.error(`Error scanning table ${tableName}:`, error);
      throw error;
    }
  } while (lastEvaluatedKey);

  return items;
}

async function createIndexes(collection, indexes) {
  for (const index of indexes) {
    try {
      await collection.createIndex(index.keys, index.options);
      console.log(`Created index ${JSON.stringify(index.keys)} on collection ${collection.collectionName}`);
    } catch (error) {
      console.error(`Error creating index on ${collection.collectionName}:`, error);
      throw error;
    }
  }
}

async function migrateData() {
  try {
    const { db } = mongoConnect();

    for (const table of TABLES) {
      console.log(`\nMigrating ${table.dynamo} to ${table.mongo}...`);

      // Scan DynamoDB table
      const items = await scanDynamoTable(table.dynamo);
      console.log(`Found ${items.length} items in DynamoDB table ${table.dynamo}`);

      if (items.length > 0) {
        // Drop existing collection if exists
        try {
          await db.collection(table.mongo).drop();
          console.log(`Dropped existing collection ${table.mongo}`);
        } catch (error) {
          // Collection might not exist, ignore error
        }

        // Insert into MongoDB
        const result = await db.collection(table.mongo).insertMany(items);
        console.log(`Inserted ${result.insertedCount} documents into ${table.mongo}`);

        // Create indexes
        if (table.indexes) {
          await createIndexes(db.collection(table.mongo), table.indexes);
        }
      }
    }

    console.log('\nMigration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoClient.close();
  }
}

migrateData().catch(console.error);
