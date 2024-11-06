require('dotenv').config();
const cron = require('node-cron');

const updateAccountsBalance = require('./src/accountsBalanceUpdate');
const { allKadenaTokenUpdate } = require('./src/allKadenaTokenUpdate');
const allTokenUpdate = require('./src/allTokenUpdate');
const candleUpdate = require('./src/candleUpdate');
const kdaPriceUpdate = require('./src/kdaPriceUpdate');
const hourCandlesUpdate = require('./src/hourCandlesUpdate');
const highLowUpdate = require('./src/highLowUpdate');

const jobs = [
  {
    name: 'All Token Update',
    schedule: '*/5 * * * *', // rate(5 minutes)
    handler: allTokenUpdate,
  },
  {
    name: 'KDA Price Update',
    schedule: '* * * * *', // rate(1 minute)
    handler: kdaPriceUpdate,
  },
  {
    name: 'Candle Update 1',
    schedule: '* * * * *', // rate(1 minute)
    handler: candleUpdate,
  },
  {
    name: 'Hour Candles Update',
    schedule: '* * * * *', // rate(1 minute)
    handler: hourCandlesUpdate,
  },
  {
    name: 'High Low Update',
    schedule: '*/30 * * * *', // rate(30 minutes)
    enabled: false, // enabled: false
    handler: highLowUpdate,
  },
  {
    name: 'All Kadena Token Update',
    schedule: '0 12 * * *', // cron(0 12 * * ? *)
    handler: allKadenaTokenUpdate,
  },
  {
    name: 'Update Accounts Balance',
    schedule: '0 20 * * *', // cron(0 20 * * ? *)
    handler: updateAccountsBalance,
  },
];

jobs.forEach((job) => {
  if (job.enabled !== false) {
    console.log(`🚀 Scheduling ${job.name} - ${job.schedule}`);

    cron.schedule(job.schedule, async () => {
      console.log(`⏰ Running ${job.name} - ${new Date().toISOString()}`);
      try {
        await job.handler();
        console.log(`✅ Completed ${job.name} - ${new Date().toISOString()}`);
      } catch (error) {
        console.error(`❌ Error in ${job.name}:`, error);
      }
    });
  }
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Shutting down...');
  process.exit(0);
});

console.log('🤖 Dextools Cron Service Started');
