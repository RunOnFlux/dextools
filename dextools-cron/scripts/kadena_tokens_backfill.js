require('dotenv').config();

const { allKadenaTokenUpdate } = require('../src/allKadenaTokenUpdate');

(async () => {
  await allKadenaTokenUpdate();
  console.log('Done');
  process.exit();
})();
