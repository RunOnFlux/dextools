const { connectPg } = require('../clients/pg');

const highLowUpdate = async () => {
  const client = connectPg();
  try {
    console.log('starting refresh');
    await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY hl_view`);
    console.log('ending refresh');
  } catch (e) {
    console.log(e);
    console.log('error happaend');
  }
};

module.exports = highLowUpdate;
