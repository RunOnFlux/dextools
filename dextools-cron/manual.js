require('dotenv').config();

const updateAccountsBalance = require('./src/accountsBalanceUpdate');
const { allKadenaTokenUpdate } = require('./src/allKadenaTokenUpdate');
const allTokenUpdate = require('./src/allTokenUpdate');
const candleUpdate = require('./src/candleUpdate');
const kdaPriceUpdate = require('./src/kdaPriceUpdate');
const hourCandlesUpdate = require('./src/hourCandlesUpdate');
const highLowUpdate = require('./src/highLowUpdate');

const functions = {
  updateAccountsBalance,
  allKadenaTokenUpdate,
  allTokenUpdate,
  candleUpdate,
  kdaPriceUpdate,
  hourCandlesUpdate,
  highLowUpdate,
};

async function main() {
  const args = process.argv.slice(2);
  const functionArg = args.find((arg) => arg.startsWith('--function='));

  if (!functionArg) {
    console.error('Please specify a function using --function=functionName');
    console.log('Available functions:');
    Object.keys(functions).forEach((fn) => console.log(`  - ${fn}`));
    process.exit(1);
  }

  const functionName = functionArg.split('=')[1];
  const functionToRun = functions[functionName];

  if (!functionToRun) {
    console.error(`Function "${functionName}" not found`);
    console.log('Available functions:');
    Object.keys(functions).forEach((fn) => console.log(`  - ${fn}`));
    process.exit(1);
  }

  console.log(`⏰ Running ${functionName} manually - ${new Date().toISOString()}`);

  try {
    await functionToRun();
    console.log(`✅ Completed ${functionName} - ${new Date().toISOString()}`);
  } catch (error) {
    console.error(`❌ Error in ${functionName}:`, error);
    process.exit(1);
  }
}

main();
