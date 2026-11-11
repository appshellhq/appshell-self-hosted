const remote = require('../webpack.remote');
const { dependencies } = require('./package.json');

module.exports = remote({
  name: 'OrdersModule',
  exposes: { './Orders': './src/Orders' },
  port: 7413,
  uniqueName: 'acme-orders',
  dependencies,
});
